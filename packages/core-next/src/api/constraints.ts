/**
 * Constraints (L2): the 1.35 constraints manager's evaluation rules, ported
 * in its shape so a pass awaits where 1.35 awaits.
 *
 * - A constraint is evaluated when a key it read changed, when it is dirty
 *   (`after` dependency resolved, `start()`), when it is async without
 *   declared deps (every pass), or on the first evaluation (all of them).
 * - Order: priority (higher first), then `after` dependencies first. A
 *   constraint waits on an `after` dependency only while that one may still
 *   act, read from its current state each time the dependent is asked
 *   (GATE-1 quirk e; 1.35 keeps sticky flags, so a dependent waits forever
 *   on one that never fires, or runs early after one re-fires). The
 *   dependency stops blocking when it is disabled, or it has answered and
 *   every requirement it now emits has resolved (none when it did not
 *   fire). Each change to that state (its answer, a requirement resolving,
 *   disable) asks the dependents it was holding back again. While a
 *   constraint waits it carries its last requirements forward.
 * - A `when` or `require` that throws keeps the deps it read, so the write
 *   that fixes it wakes it (1.35 H1).
 * - Dependencies are tracked through the system tracker: fact keys and
 *   `\u001F`-prefixed derivation ids, the same names the pass's changed keys
 *   carry.
 */

import isDevelopment from "#is-development";
import type { Clock } from "../clock.js";
import { DERIVATION_DEP_PREFIX, type Tracker, withTracking } from "./facts.js";
import {
  type Requirement,
  type RequirementKeyFn,
  type RequirementWithId,
  requirementId,
} from "./requirements.js";
import { withTimeout } from "./timeout.js";

type Fn = (...args: any[]) => any;

export interface ConstraintDef {
  when: Fn;
  require?: unknown;
  priority?: number;
  after?: string[];
  async?: boolean;
  deps?: string[];
  timeout?: number;
  /** RFC-0003: the facts its resolver's run is bound to (reconcile.ts). */
  abortOn?: readonly string[];
}

export interface ConstraintsOptions {
  defs: Record<string, ConstraintDef>;
  facts: unknown;
  derived: unknown;
  tracker: Tracker;
  keys: Record<string, RequirementKeyFn>;
  isDerivation: (name: string) => boolean;
  /** A derivation named in declared deps (see SystemContext.watch). */
  watch: (id: string) => void;
  clock: Clock;
  onEvaluate: (id: string, active: boolean) => void;
  onError: (id: string, error: unknown) => void;
}

export interface Constraints {
  /** Evaluate what the changed keys affect (everything the first time). */
  evaluate(changed?: Set<string>): Promise<RequirementWithId[]>;
  /** Last pass's requirements, when nothing is affected; else null. */
  unaffected(changed: Set<string>): RequirementWithId[] | null;
  /** What the constraint read last time: fact keys and prefixed derivation ids. */
  depsOf(id: string): Set<string> | undefined;
  /** Declared async, or found async when its `when` returned a promise. */
  isAsync(id: string): boolean;
  /** A requirement's run completed: it no longer holds back dependents. */
  markResolved(req: RequirementWithId): void;
  /** A requirement left the set: if it is asked again, it must resolve again. */
  forget(requirementId: string): void;
  markAllDirty(): void;
  hasDirty(): boolean;
  /** True when a dependent it held back is now free (ask for a pass). */
  disable(id: string): boolean;
  enable(id: string): void;
  isDisabled(id: string): boolean;
  /** 1.35's constraint state, for inspect() and explain(). */
  state_(id: string): ConstraintState | undefined;
  /** Every constraint's state, in declaration order. */
  states_(): ConstraintState[];
}

/** What inspect() reports of a constraint (1.35's ConstraintState subset). */
export interface ConstraintState {
  id: string;
  priority: number;
  /** The last answer of its `when`; null before it is asked (a throw is false). */
  lastResult: boolean | null;
  hitCount: number;
  lastActiveAt: number | null;
}

/** A `require` that threw, with what it read before it threw. */
class RequireError {
  constructor(
    readonly original: unknown,
    readonly deps: Set<string>,
  ) {}
}

/** An async constraint's `when` gives up after this long, unless it sets `timeout`. */
const ASYNC_WHEN_TIMEOUT_MS = 5000;

const EMPTY: RequirementWithId[] = [];

export function createConstraints(options: ConstraintsOptions): Constraints {
  const { defs, facts, derived, tracker, keys } = options;
  const ids = Object.keys(defs);
  for (const id of ids) {
    const spec = defs[id]?.when;
    // 1.35: `$changed` is effects-only, refused at registration in every
    // build. (The rest of the data form is the L11 compiler.)
    if (spec !== undefined && typeof spec !== "function" && hasChanged(spec)) {
      throw new Error(
        `[Directive] constraint "${id}": $changed is effects-only — constraint when has no previous-facts snapshot. Move the change-detection to an effect, or use a boolean derivation as a synthetic previous value.`,
      );
    }
  }
  const states = new Map<string, ConstraintState>(
    ids.map((id) => [
      id,
      {
        id,
        priority: defs[id]!.priority ?? 0,
        lastResult: null,
        hitCount: 0,
        lastActiveAt: null,
      },
    ]),
  );
  /** 1.35's recordConstraintResult: the answer, and a hit when active. */
  const onEvaluate = (id: string, active: boolean) => {
    const state = states.get(id)!;
    state.lastResult = active;
    if (active) {
      state.hitCount++;
      state.lastActiveAt = options.clock.now();
    }
    options.onEvaluate(id, active);
  };
  /** 1.35's recordConstraintError: a `when` that threw is not active. */
  const onWhenError = (id: string, error: unknown) => {
    states.get(id)!.lastResult = false;
    options.onError(id, error);
  };
  const onError = options.onError;
  const deps = new Map<string, Set<string>>();
  const byKey = new Map<string, Set<string>>();
  const last = new Map<string, RequirementWithId[]>();
  const whenDeps = new Map<string, Set<string>>();
  const dirty = new Set<string>();
  const disabled = new Set<string>();
  /** Requirement ids whose run completed while they stayed in the set. */
  const met = new Set<string>();
  /** Asked (or never asked) and not answered yet: it may still act. */
  const unanswered = new Set(ids);
  /** Held back by an `after` dependency when last asked. */
  const held = new Set<string>();
  const asyncIds = new Set(ids.filter((id) => defs[id]!.async));
  let evaluated = false;
  if (isDevelopment) {
    for (const id of asyncIds) {
      if (!defs[id]!.deps) {
        console.warn(
          `[Directive] Async constraint "${id}" has no \`deps\` declared. Auto-tracking cannot work across async boundaries. Add \`deps: ["key1", "key2"]\` to enable dependency tracking — fact keys and derivation IDs both work.`,
        );
      }
    }
  }

  // --- order: priority, then `after` dependencies first ------------------
  const topo = new Map<string, number>();
  const visiting: string[] = [];
  const visit = (id: string) => {
    if (topo.has(id) || !defs[id]) {
      return;
    }
    if (visiting.includes(id)) {
      throw new Error(
        `[Directive] Constraint cycle detected: ${[...visiting.slice(visiting.indexOf(id)), id].join(" \u2192 ")}. Remove one of the \`after\` dependencies to break the cycle.`,
      );
    }
    visiting.push(id);
    for (const dep of defs[id]!.after ?? []) {
      if (isDevelopment && !defs[dep]) {
        console.warn(
          `[Directive] Constraint "${id}" references unknown constraint "${dep}" in \`after\`. This dependency will be ignored. Check for typos or ensure the constraint exists.`,
        );
      }
      visit(dep);
    }
    visiting.pop();
    topo.set(id, topo.size);
  };
  ids.forEach(visit);
  const sorted = [...ids].sort(
    (a, b) =>
      (defs[b]!.priority ?? 0) - (defs[a]!.priority ?? 0) ||
      topo.get(a)! - topo.get(b)!,
  );
  const enabled = () =>
    disabled.size === 0 ? sorted : sorted.filter((id) => !disabled.has(id));

  // --- dependencies ------------------------------------------------------
  const named = (list: readonly string[]) =>
    new Set(
      list.map((n) => {
        if (!options.isDerivation(n)) {
          return n;
        }
        options.watch(n);

        return DERIVATION_DEP_PREFIX + n;
      }),
    );
  /**
   * 1.35's updateDependencies: unchanged deps (same keys, not none) leave the
   * index alone, so a constraint keeps its place in each key's set, and the
   * order a pass evaluates affected constraints in is 1.35's.
   */
  function setDeps(id: string, next: Set<string>): void {
    const prev = deps.get(id);
    if (prev !== undefined && prev.size === next.size && prev.size > 0) {
      let same = true;
      for (const key of next) {
        if (!prev.has(key)) {
          same = false;
          break;
        }
      }
      if (same) {
        return;
      }
    }
    for (const key of prev ?? []) {
      byKey.get(key)?.delete(id);
    }
    deps.set(id, next);
    for (const key of next) {
      let set = byKey.get(key);
      if (!set) {
        byKey.set(key, (set = new Set()));
      }
      set.add(id);
    }
  }
  /** Async constraints without declared deps: evaluated on every pass. */
  const untrackedAsync = () =>
    [...asyncIds].filter((id) => !defs[id]!.deps && !disabled.has(id));

  // --- evaluating one constraint -------------------------------------------
  const call = (fn: Fn) => fn(facts, derived);
  /** `fn`, tracked; a throw is caught and kept with what it read before it. */
  function tracked(fn: Fn) {
    let threw = false;
    let thrown: unknown;
    const { value, deps } = withTracking(tracker, () => {
      try {
        return call(fn);
      } catch (error) {
        threw = true;
        thrown = error;

        return undefined;
      }
    });

    return { value, deps, threw, thrown };
  }
  /** `when`, tracked; the deps are kept when it throws. */
  function when(id: string, def: ConstraintDef): boolean | Promise<boolean> {
    if (def.deps) {
      whenDeps.set(id, named(def.deps));

      return call(def.when);
    }
    const read = tracked(def.when);
    whenDeps.set(id, read.deps);
    if (read.threw) {
      throw read.thrown;
    }

    return read.value;
  }
  function evaluateSync(id: string): boolean | Promise<boolean> {
    try {
      const result = when(id, defs[id]!);
      if (result instanceof Promise) {
        // Found async at runtime: from now on it is evaluated as async.
        asyncIds.add(id);
        if (isDevelopment) {
          console.warn(
            `[Directive] Constraint "${id}" returned a Promise but was not marked as async. Add \`async: true\` to the constraint definition to avoid this warning and improve performance.`,
          );
        }

        return result.then(
          (active) => {
            onEvaluate(id, active);

            return active;
          },
          (error) => {
            onWhenError(id, error);

            return false;
          },
        );
      }
      onEvaluate(id, result);

      return result;
    } catch (error) {
      onWhenError(id, error);

      return false;
    }
  }
  async function evaluateAsync(id: string): Promise<boolean> {
    const def = defs[id]!;
    if (def.deps?.length) {
      const declared = named(def.deps);
      setDeps(id, declared);
      whenDeps.set(id, declared);
    }
    try {
      const active = await withTimeout(
        options.clock,
        call(def.when) as Promise<boolean>,
        def.timeout ?? ASYNC_WHEN_TIMEOUT_MS,
        `Constraint "${id}" timed out after ${def.timeout ?? ASYNC_WHEN_TIMEOUT_MS}ms`,
      );
      onEvaluate(id, active);

      return active;
    } catch (error) {
      onWhenError(id, error);

      return false;
    }
  }

  // --- requirements ------------------------------------------------------
  function requirementsOf(id: string): {
    reqs: Requirement[];
    read: Set<string>;
  } {
    const spec = defs[id]!.require;
    let out: unknown = spec;
    let read = new Set<string>();
    if (typeof spec === "function") {
      const result = tracked(spec as Fn);
      if (result.threw) {
        throw new RequireError(result.thrown, result.deps);
      }
      out = result.value;
      read = result.deps;
    }
    const reqs =
      out == null
        ? []
        : Array.isArray(out)
          ? out.filter((r) => r != null)
          : [out as Requirement];
    if (isDevelopment && reqs.length > 10) {
      console.warn(
        `[Directive] Constraint "${id}" produced ${reqs.length} requirements. Consider splitting into multiple constraints for better performance.`,
      );
    }

    return { reqs, read };
  }
  function inactive(id: string): void {
    const read = whenDeps.get(id);
    if (read !== undefined) {
      setDeps(id, read);
    }
    last.set(id, EMPTY);
  }
  function answer(
    id: string,
    active: boolean,
    into: Map<string, RequirementWithId>,
  ): void {
    if (disabled.has(id)) {
      return;
    }
    unanswered.delete(id);
    if (!active) {
      inactive(id);

      return;
    }
    const read = whenDeps.get(id);
    try {
      const { reqs, read: requireRead } = requirementsOf(id);
      setDeps(id, new Set([...(read ?? []), ...requireRead]));
      const withIds = reqs.map((requirement) => ({
        requirement,
        id: requirementId(requirement, keys[requirement.type]),
        fromConstraint: id,
      }));
      add(into, withIds);
      last.set(id, withIds);
    } catch (error) {
      if (error instanceof RequireError) {
        onError(id, error.original);
        // What `when` and `require` read, so the write that fixes either wakes it.
        setDeps(id, new Set([...(read ?? []), ...error.deps]));
        last.set(id, EMPTY);

        return;
      }
      onError(id, error);
      inactive(id);
    }
  }
  /** First wins, as in 1.35's RequirementSet. */
  const add = (
    into: Map<string, RequirementWithId>,
    reqs: readonly RequirementWithId[],
  ) => {
    for (const req of reqs) {
      if (!into.has(req.id)) {
        into.set(req.id, req);
      }
    }
  };

  // --- one evaluation pass (1.35's shape, so it awaits where 1.35 does) ----
  /** `dep` may still act: enabled, and unanswered or a requirement unresolved. */
  const blocks = (dep: string) =>
    !!defs[dep] &&
    !disabled.has(dep) &&
    (unanswered.has(dep) ||
      (last.get(dep) ?? EMPTY).some((r) => !met.has(r.id)));
  const afterReady = (id: string) => !(defs[id]!.after ?? []).some(blocks);
  /** Ask again each held-back constraint that nothing blocks any more. */
  const release = () => {
    let freed = false;
    for (const id of held) {
      if (!disabled.has(id) && afterReady(id)) {
        dirty.add(id);
        freed = true;
      }
    }

    return freed;
  };
  async function settle(
    pairs: [string, Promise<boolean>][],
    into: Map<string, RequirementWithId>,
  ): Promise<void> {
    const results = await Promise.all(
      pairs.map(async ([id, p]) => [id, await p] as const),
    );
    for (const [id, active] of results) {
      answer(id, active, into);
    }
  }
  async function batch(
    todo: string[],
    into: Map<string, RequirementWithId>,
  ): Promise<string[]> {
    const blocked: string[] = [];
    const ready: string[] = [];
    for (const id of todo) {
      if (afterReady(id)) {
        held.delete(id);
        ready.push(id);
      } else {
        held.add(id);
        blocked.push(id);
        add(into, last.get(id) ?? EMPTY);
      }
    }
    if (ready.length === 0) {
      return blocked;
    }
    const late: [string, Promise<boolean>][] = [];
    const asyncReady: string[] = [];
    for (const id of ready) {
      if (asyncIds.has(id)) {
        asyncReady.push(id);
        continue;
      }
      const result = evaluateSync(id);
      if (result instanceof Promise) {
        late.push([id, result]);
      } else {
        answer(id, result, into);
      }
    }
    if (late.length > 0) {
      await settle(late, into);
    }
    if (asyncReady.length > 0) {
      await settle(
        asyncReady.map((id) => [id, evaluateAsync(id)]),
        into,
      );
    }

    return blocked;
  }

  return {
    async evaluate(changed) {
      const into = new Map<string, RequirementWithId>();
      const all = enabled();
      let todo: string[];
      if (!evaluated || !changed || changed.size === 0) {
        todo = all;
        evaluated = true;
        dirty.clear();
      } else {
        const affected = new Set<string>();
        for (const key of changed) {
          for (const id of byKey.get(key) ?? []) {
            if (!disabled.has(id)) {
              affected.add(id);
            }
          }
        }
        for (const id of dirty) {
          if (!disabled.has(id)) {
            affected.add(id);
          }
        }
        dirty.clear();
        for (const id of untrackedAsync()) {
          affected.add(id);
        }
        todo = [...affected];
        for (const id of all) {
          if (!affected.has(id)) {
            add(into, last.get(id) ?? EMPTY);
          }
        }
      }
      // Quirk e: one asked now holds its dependents back until it answers;
      // one not asked keeps its answer, so a dependent asked alone is held
      // only while that answer's requirements are unresolved.
      for (const id of todo) {
        unanswered.add(id);
      }
      for (let rounds = todo.length + 1; todo.length > 0 && rounds > 0; ) {
        const before = todo.length;
        todo = await batch(todo, into);
        if (todo.length === before) {
          break;
        }
        rounds--;
      }
      // Quirk e: one held back on a constraint that has now answered is not
      // left waiting for a write it may not read; it is asked on the next
      // pass (the part schedules one when dirty).
      release();

      return [...into.values()];
    },
    unaffected(changed) {
      if (sorted.length === 0 && dirty.size === 0) {
        return EMPTY;
      }
      if (!evaluated || untrackedAsync().length > 0) {
        return null;
      }
      for (const id of dirty) {
        if (!disabled.has(id)) {
          return null;
        }
      }
      for (const key of changed) {
        for (const id of byKey.get(key) ?? []) {
          if (!disabled.has(id)) {
            return null;
          }
        }
      }
      dirty.clear();
      const into = new Map<string, RequirementWithId>();
      for (const id of enabled()) {
        add(into, last.get(id) ?? EMPTY);
      }

      return into.size === 0 ? EMPTY : [...into.values()];
    },
    depsOf: (id) => deps.get(id),
    isAsync: (id) => asyncIds.has(id),
    markResolved(req) {
      met.add(req.id);
      // As 1.35, the asking constraint's dependents are asked again; so are
      // those of any other constraint that emits the same requirement.
      const emitters = ids.filter(
        (id) =>
          id === req.fromConstraint ||
          (last.get(id) ?? EMPTY).some((r) => r.id === req.id),
      );
      for (const other of ids) {
        if (defs[other]!.after?.some((dep) => emitters.includes(dep))) {
          dirty.add(other);
        }
      }
    },
    forget: (id) => met.delete(id),
    markAllDirty() {
      for (const id of ids) {
        dirty.add(id);
      }
    },
    hasDirty: () => [...dirty].some((id) => !disabled.has(id)),
    disable(id) {
      if (!defs[id]) {
        if (isDevelopment) {
          console.warn(
            `[Directive] constraints.disable("${id}") — no such constraint`,
          );
        }

        return false;
      }
      disabled.add(id);
      // As 1.35: its requirements leave the next pass, and what it read no
      // longer wakes it.
      last.delete(id);
      setDeps(id, new Set());
      whenDeps.delete(id);

      // Quirk e: it no longer holds anything back.
      return release();
    },
    enable(id) {
      if (!defs[id]) {
        if (isDevelopment) {
          console.warn(
            `[Directive] constraints.enable("${id}") — no such constraint`,
          );
        }

        return;
      }
      if (disabled.delete(id)) {
        // Unanswered until it is asked: its dependents wait for its answer.
        unanswered.add(id);
        dirty.add(id);
      }
    },
    isDisabled: (id) => disabled.has(id),
    state_: (id) => states.get(id),
    states_: () => [...states.values()],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 1.35's containsChangedOperator over its walkPredicate: `$changed` as an
 * operator (object or array clause form) or a stray `$`-key at fact
 * position; combinators and nested plain objects are followed, operands are
 * not. Cycles stop the walk, and so does depth past 64.
 */
function hasChanged(
  spec: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): boolean {
  if (depth > 64) {
    return false;
  }
  if (Array.isArray(spec)) {
    return spec.some(
      (c) => isObject(c) && typeof c.fact === "string" && c.op === "$changed",
    );
  }
  if (
    !isObject(spec) ||
    spec instanceof Date ||
    spec instanceof RegExp ||
    seen.has(spec)
  ) {
    return false;
  }
  seen.add(spec);
  for (const kind of ["$all", "$any", "$not"]) {
    if (kind in spec) {
      const children =
        kind === "$not" ? [spec.$not] : ((spec[kind] as unknown[]) ?? []);

      return children.some((child) => hasChanged(child, seen, depth + 1));
    }
  }
  for (const key of Object.keys(spec)) {
    if (key.startsWith("$")) {
      if (key === "$changed") {
        return true;
      }
      continue;
    }
    const value = spec[key];
    if (
      isObject(value) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp)
    ) {
      const ops = Object.keys(value);
      if (ops.length > 0 && ops.every((op) => op.startsWith("$"))) {
        if (ops.includes("$changed")) {
          return true;
        }
        continue;
      }
      const proto = Object.getPrototypeOf(value);
      if (
        (proto === Object.prototype || proto === null) &&
        hasChanged(value, seen, depth + 1)
      ) {
        return true;
      }
    }
  }

  return false;
}
