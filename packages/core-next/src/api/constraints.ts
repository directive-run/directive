/**
 * Constraints (L2 spike): the 1.35 constraints manager's evaluation rules,
 * ported in its shape so a pass awaits where 1.35 awaits.
 *
 * - A constraint is evaluated when a key it read changed, when it is dirty
 *   (`after` dependency resolved, `start()`), when it is async without
 *   declared deps (every pass), or on the first evaluation (all of them).
 * - Order: priority (higher first), then `after` dependencies first. A
 *   constraint whose `after` dependency has not resolved carries its last
 *   requirements forward and waits.
 * - A `when` or `require` that throws keeps the deps it read, so the write
 *   that fixes it wakes it (1.35 H1).
 * - Dependencies are tracked through the system tracker: fact keys and
 *   `\u001F`-prefixed derivation ids, the same names the pass's changed keys
 *   carry.
 *
 * SPIKE: not reviewed, not for merge. See docs/rfc-l2-reconcile.md.
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

type Fn = (...args: any[]) => any;

export interface ConstraintDef {
  when: Fn;
  require?: unknown;
  priority?: number;
  after?: string[];
  async?: boolean;
  deps?: string[];
  timeout?: number;
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
  owner: number;
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
  markResolved(id: string): void;
  markAllDirty(): void;
  hasDirty(): boolean;
  disable(id: string): void;
  enable(id: string): void;
  isDisabled(id: string): boolean;
}

/** A `require` that threw, with what it read before it threw. */
class RequireError {
  constructor(
    readonly original: unknown,
    readonly deps: Set<string>,
  ) {}
}

const TIMEOUT: unique symbol = Symbol();
export const isTimeout = (error: unknown): boolean =>
  !!(error as Record<symbol, unknown> | null)?.[TIMEOUT];

/** Reject with a marked error after `ms` on the kernel clock, owned by `owner`. */
export function withTimeout<T>(
  clock: Clock,
  owner: number,
  value: T | Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(
      () => reject(Object.assign(new Error(message), { [TIMEOUT]: true })),
      ms,
      { owner, kind: "timeout" },
    );
    Promise.resolve(value).then(
      (v) => {
        clock.clearTimeout(timer);
        resolve(v);
      },
      (error) => {
        clock.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const EMPTY: RequirementWithId[] = [];

export function createConstraints(options: ConstraintsOptions): Constraints {
  const { defs, facts, derived, tracker, keys, onEvaluate, onError } = options;
  const ids = Object.keys(defs);
  const deps = new Map<string, Set<string>>();
  const byKey = new Map<string, Set<string>>();
  const last = new Map<string, RequirementWithId[]>();
  const whenDeps = new Map<string, Set<string>>();
  const dirty = new Set<string>();
  const disabled = new Set<string>();
  const resolved = new Set<string>();
  const noFire = new Set<string>();
  const asyncIds = new Set(ids.filter((id) => defs[id]!.async));
  let evaluated = false;

  // --- order: priority, then `after` dependencies first ------------------
  const topo = new Map<string, number>();
  const visiting: string[] = [];
  const visit = (id: string) => {
    if (topo.has(id) || !defs[id]) {
      return;
    }
    if (visiting.includes(id)) {
      throw new Error(
        `[Directive] Constraint cycle detected: ${[...visiting.slice(visiting.indexOf(id)), id].join(" -> ")}`,
      );
    }
    visiting.push(id);
    for (const dep of defs[id]!.after ?? []) {
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
  function setDeps(id: string, next: Set<string>): void {
    for (const key of deps.get(id) ?? []) {
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
  /** `when`, tracked; the deps are kept when it throws. */
  function when(id: string, def: ConstraintDef): boolean | Promise<boolean> {
    if (def.deps) {
      whenDeps.set(id, named(def.deps));

      return call(def.when);
    }
    let threw = false;
    let thrown: unknown;
    const tracked = withTracking(tracker, () => {
      try {
        return call(def.when);
      } catch (error) {
        threw = true;
        thrown = error;

        return false;
      }
    });
    whenDeps.set(id, tracked.deps);
    if (threw) {
      throw thrown;
    }

    return tracked.value;
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
            onError(id, error);

            return false;
          },
        );
      }
      onEvaluate(id, result);

      return result;
    } catch (error) {
      onError(id, error);

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
        options.owner,
        call(def.when) as Promise<boolean>,
        def.timeout ?? 5000,
        `Constraint "${id}" timed out after ${def.timeout ?? 5000}ms`,
      );
      onEvaluate(id, active);

      return active;
    } catch (error) {
      onError(id, error);

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
      let threw = false;
      let thrown: unknown;
      const tracked = withTracking(tracker, () => {
        try {
          return call(spec as Fn);
        } catch (error) {
          threw = true;
          thrown = error;

          return [];
        }
      });
      if (threw) {
        throw new RequireError(thrown, tracked.deps);
      }
      out = tracked.value;
      read = tracked.deps;
    }
    const reqs =
      out == null
        ? []
        : Array.isArray(out)
          ? out.filter((r) => r != null)
          : [out as Requirement];

    return { reqs, read };
  }
  function inactive(id: string): void {
    const read = whenDeps.get(id);
    if (read !== undefined) {
      setDeps(id, read);
    }
    noFire.add(id);
    last.set(id, EMPTY);
  }
  function process(
    id: string,
    active: boolean,
    into: Map<string, RequirementWithId>,
  ): void {
    if (disabled.has(id)) {
      return;
    }
    if (!active) {
      inactive(id);

      return;
    }
    noFire.delete(id);
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
        noFire.add(id);
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
  const afterReady = (id: string) =>
    (defs[id]!.after ?? []).every(
      (dep) =>
        !defs[dep] || disabled.has(dep) || noFire.has(dep) || resolved.has(dep),
    );
  async function settle(
    pairs: [string, Promise<boolean>][],
    into: Map<string, RequirementWithId>,
  ): Promise<void> {
    const results = await Promise.all(
      pairs.map(async ([id, p]) => [id, await p] as const),
    );
    for (const [id, active] of results) {
      process(id, active, into);
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
        ready.push(id);
      } else {
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
        process(id, result, into);
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
      noFire.clear();
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
      for (let rounds = todo.length + 1; todo.length > 0 && rounds > 0; ) {
        const before = todo.length;
        todo = await batch(todo, into);
        if (todo.length === before) {
          break;
        }
        rounds--;
      }

      return [...into.values()];
    },
    unaffected(changed) {
      if (sorted.length === 0 && dirty.size === 0) {
        noFire.clear();

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
      noFire.clear();
      dirty.clear();
      const into = new Map<string, RequirementWithId>();
      for (const id of enabled()) {
        add(into, last.get(id) ?? EMPTY);
      }

      return into.size === 0 ? EMPTY : [...into.values()];
    },
    depsOf: (id) => deps.get(id),
    markResolved(id) {
      resolved.add(id);
      for (const other of ids) {
        if (defs[other]!.after?.includes(id)) {
          dirty.add(other);
        }
      }
    },
    markAllDirty() {
      for (const id of ids) {
        dirty.add(id);
      }
    },
    hasDirty: () => [...dirty].some((id) => !disabled.has(id)),
    disable(id) {
      if (defs[id]) {
        disabled.add(id);
      }
    },
    enable(id) {
      if (disabled.delete(id)) {
        dirty.add(id);
      }
    },
    isDisabled: (id) => disabled.has(id),
  };
}
