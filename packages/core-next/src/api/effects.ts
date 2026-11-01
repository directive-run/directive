/**
 * Effects: the 1.35 effects manager. An effect runs in the reconcile pass
 * after the facts it depends on changed, sees facts read-only, and may
 * return a cleanup.
 *
 * Dependencies are either declared (`deps`) or tracked on each run through
 * the system's tracker. Nothing here is module-level mutable state.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX, type Tracker, describeDep } from "./facts.js";
import { type CheckedReadView, createCheckedReadView } from "./readonly.js";
import type { Facts, FactsStore, Schema } from "./types.js";

export interface CreateEffectsOptions<S extends Schema> {
  definitions: Record<string, any>;
  facts: Facts<S>;
  store: FactsStore<S>;
  derived?: Record<string, unknown>;
  tracker?: Tracker;
  onRun?: (id: string, deps: string[]) => void;
  /**
   * Whether `onRun` will read its `deps` right now (1.35). When this returns
   * false, `onRun` gets an empty list instead of one built per run.
   */
  wantsRunDeps?: () => boolean;
  onError?: (id: string, error: unknown) => void;
  onWriteBlocked?: (id: string, key: string) => void;
  /**
   * The key a declared dependency name stands for: a derivation's own dep
   * key (1.35's resolveDeps), else the name itself, a fact key.
   */
  depKey?: (name: string) => string;
  /** Watch derivation `id` again: `enable` restores what `disable` released. */
  watch?: (id: string) => void;
}

export interface EffectsManager {
  runEffects(changedKeys: Set<string>): Promise<void>;
  /** Runs the effects due; returns a promise only when one of them is async. */
  runEffectsFast(changedKeys: Set<string>): Promise<void> | undefined;
  runAll(): Promise<void>;
  callOne(id: string): Promise<void>;
  cleanupAll(): void;
  /**
   * Stops the effect and runs its cleanup at once (x). Its dependencies are
   * kept (y); only the watching of their derivations goes, at the pass end.
   * An unknown id throws, in production too (1.35).
   */
  disable(id: string): void;
  /** Watches its derivations again; does not run it or replay changes (y). */
  enable(id: string): void;
  isEnabled(id: string): boolean;
  /** Run `id` in the next pass whatever changed (1.35's requestRerun). */
  rerun_(id: string): void;
  reruns_(): boolean;
  /** Every prefixed derivation id an enabled effect reads (1.35). */
  observed_(into: Set<string>): void;
}

interface EffectState {
  id: string;
  enabled: boolean;
  explicit: boolean;
  /**
   * What it depends on: declared, or what its last good run read (null: an
   * auto-tracked effect that has not run yet). Indexed by key in `index`.
   */
  deps: Set<string> | null;
  /** T1: the cleared set the next auto-tracked run tracks into. */
  spare_?: Set<string>;
  /** The pass whose changed keys reached it (T2). */
  hit_?: number;
  cleanup: (() => void) | null;
  /** Its cleanup is running: the boundary's "disable" does not start it again. */
  cleaning_?: boolean;
  /** What the current run's `run` returned. */
  out_?: unknown;
}

function writeMessage(id: string, key: string, inPlace?: boolean): string {
  return `[Directive] effect "${id}" ${inPlace ? `changed "${key}" in place` : `tried to write "${key}"`}. Effects only talk to the outside world and cannot change facts. Use an event handler for a change caused by input (events: { move: (facts) => { facts.${key.split(".")[0]} = … } }), a derivation for a value computed from other facts, or a resolver for work a constraint requires. For data that comes back from async work, publish it from a source or write it in a resolver. See https://directive.run/docs/effects#effects-never-write-facts`;
}

/** 1.35's isPredicate (predicate.ts:52–125): a plain object, or clauses. */
function isPredicate(v: unknown): boolean {
  const plain = (o: unknown) =>
    typeof o === "object" &&
    o !== null &&
    !Array.isArray(o) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(o));

  return Array.isArray(v)
    ? v.every((c) => plain(c) && "fact" in c && "op" in c)
    : plain(v);
}

/** What `onRun` gets when `wantsRunDeps` says it will not read the list. */
const NO_DEPS = Object.freeze([]) as unknown as string[];

/** Set on a wrapped run (namespaced.ts): whether the author's run reads prev. */
export const PREV_READ: unique symbol = Symbol();

/** 0 or 2+ parameters, or anything opaque, may read prevFacts. */
export function declaresPrev(run: unknown): boolean {
  if (typeof run !== "function") {
    return true;
  }
  if (run.length !== 1) {
    return true;
  }
  let source: string;
  try {
    source = Function.prototype.toString.call(run);
  } catch {
    return true;
  }
  if (source.includes("arguments") || source.includes("[native code]")) {
    return true;
  }
  const open = source.indexOf("(");
  if (open === -1) {
    return false;
  }
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (--depth === 0) {
        return false;
      }
    } else if (ch === "," && depth === 1) {
      return true;
    }
  }

  return true;
}

export function createEffectsManager<S extends Schema>(
  options: CreateEffectsOptions<S>,
): EffectsManager {
  const {
    definitions,
    facts,
    store,
    onRun,
    wantsRunDeps,
    onError,
    onWriteBlocked,
  } = options;
  const derived = options.derived ?? {};
  const tracker = options.tracker ?? { deps: null };
  const states = new Map<string, EffectState>();
  const warnedAsync = new Set<string>();
  let stopped = false;
  let previous: Record<string, unknown> | null = null;
  const prevObserved = Object.values(definitions).some(
    (d) => d?.run?.[PREV_READ] ?? declaresPrev(d?.run),
  );

  const depKey = options.depKey ?? ((name: string) => name);
  /**
   * T2: dependency key to the effects that depend on it, so a pass looks up
   * its changed keys instead of walking every effect's set. It changes only
   * when a set does (T1's swap), never per pass. A disabled effect keeps its
   * entries (y) and selection skips it, so `enable` re-indexes nothing.
   *
   * TODO(L8): a history navigation wakes every effect but those declaring
   * `onNavigate: "skip"`, which see only the real keys: `reach` marks per
   * key set, so a pass can call it once for each. TODO(L10): `refreshDeps`
   * links a declared name when it comes to exist (`link`). Neither feature
   * exists in core-next yet, so their tests land with them.
   */
  const index = new Map<string, EffectState[]>();
  const link = (state: EffectState, key: string) => {
    const at = index.get(key);
    at ? at.push(state) : index.set(key, [state]);
  };
  const unlink = (state: EffectState, key: string) => {
    const at = index.get(key)!;
    at.splice(at.indexOf(state), 1);
    if (at.length === 0) {
      index.delete(key);
    }
  };
  /** Declaration order, for selection. */
  const order: EffectState[] = [];
  for (const id of Object.keys(definitions)) {
    const def = definitions[id];
    const deps = def?.deps as string[] | undefined;
    // As 1.35's initState: a data-form `on` that is no predicate is a user
    // error, thrown rather than ignored.
    if (!deps && def?.on !== undefined && !isPredicate(def.on)) {
      throw new Error(
        `[Directive] effect on must be a FactPredicate spec; got ${typeof def.on}`,
      );
    }
    const state: EffectState = {
      id,
      enabled: true,
      explicit: Array.isArray(deps),
      deps: Array.isArray(deps) ? new Set(deps.map(depKey)) : null,
      cleanup: null,
    };
    for (const key of state.deps ?? []) {
      link(state, key);
    }
    states.set(id, state);
    order.push(state);
  }

  /**
   * T1: a good auto-tracked run's reads become its dependencies. It tracked
   * into the spare set: the same keys keep the old set and clear the spare
   * for the next run, so a frame whose reads did not change allocates
   * nothing; different keys swap the two and re-index what moved.
   */
  function commit(state: EffectState, next: Set<string>): void {
    const old = state.deps;
    let same = old?.size === next.size;
    for (const key of next) {
      same &&= old!.has(key);
    }
    if (same) {
      next.clear();
      state.spare_ = next;

      return;
    }
    for (const key of old ?? []) {
      unlink(state, key);
    }
    for (const key of next) {
      link(state, key);
    }
    if (old) {
      old.clear();
      state.spare_ = old;
    }
    state.deps = next;
  }

  const refuse = (id: string, key: string): true => {
    onWriteBlocked?.(id, key);
    if (isDevelopment) {
      throw new Error(writeMessage(id, key));
    }

    return true;
  };

  /** The read-only view of the facts for effect `id`: writes are refused. */
  const views = new Map<string, CheckedReadView<object>>();
  // A miss builds the view in its own function: the closures below capture
  // `id`, and a capture in viewFor would allocate on every (hit) call.
  const viewFor = (id: string): CheckedReadView<object> =>
    views.get(id) ?? newView(id);
  function newView(id: string): CheckedReadView<object> {
    let readonlyStore: FactsStore<S> | undefined;
    const view = createCheckedReadView(
      facts as object,
      (key) => refuse(id, key),
      {
        override: (prop) =>
          prop === "$store"
            ? (readonlyStore ??= {
                get: (key) => store.get(key),
                has: (key) => store.has(key),
                set: (key) => {
                  refuse(id, String(key));
                },
                delete: (key) => {
                  refuse(id, String(key));
                },
                batch: (fn) => store.batch(fn),
                subscribe: (keys, listener) => store.subscribe(keys, listener),
                subscribeAll: (listener) => store.subscribeAll(listener),
                toObject: () => store.toObject(),
              })
            : undefined,
      },
    );
    views.set(id, view);

    return view;
  }

  /** Development: this run's prev and derived checks. */
  const runChecks = new Map<string, CheckedReadView<object>[]>();
  /** Development: throw if the effect changed a value in place. */
  function checkInPlace(id: string): void {
    if (isDevelopment) {
      const found =
        viewFor(id).takeMutation() ??
        (runChecks.get(id) ?? []).reduce<string | null>(
          (first, check) => first ?? check.takeMutation(),
          null,
        );
      runChecks.delete(id);
      if (found !== null) {
        onWriteBlocked?.(id, found);
        throw new Error(writeMessage(id, found, true));
      }
    }
  }

  function runCleanup(state: EffectState): void {
    // A throw reaches the boundary, whose "disable" runs the cleanup (x): the
    // guard stops it starting again. Cleared only after it returns, so one
    // whose throw "throw" rethrows is kept and called again (1.35).
    if (state.cleanup && !state.cleaning_) {
      state.cleaning_ = true;
      try {
        try {
          state.cleanup();
        } catch (error) {
          onError?.(state.id, error);
          console.error(
            `[Directive] Effect "${state.id}" cleanup threw an error:`,
            error,
          );
        }
        state.cleanup = null;
      } finally {
        state.cleaning_ = false;
      }
    }
  }

  function keep(state: EffectState, result: unknown): void {
    if (typeof result === "function") {
      state.cleanup = result as () => void;
      // Stopped, or disabled while this run was going (x): an effect that
      // will not run holds no cleanup.
      if (stopped || !state.enabled) {
        runCleanup(state);
      }
    }
  }

  const get = (id: string): EffectState => {
    const state = states.get(id);
    if (!state) {
      throw new Error(`[Directive] Unknown effect: ${id}`);
    }

    return state;
  };

  function report(state: EffectState, error: unknown): void {
    onError?.(state.id, error);
    console.error(`[Directive] Effect "${state.id}" threw an error:`, error);
  }

  /**
   * Development: an async auto-tracked effect that read nothing before its
   * first await. The whole body is behind the dev flag: a nested function
   * declaration is not tree-shaken, so a gated call site alone would leave the
   * warning text in a production bundle (scripts/size.mjs guards this).
   */
  function warnAsyncAutoTracked(id: string, deps: Set<unknown>): void {
    if (isDevelopment) {
      if (deps.size > 0 || warnedAsync.has(id)) {
        return;
      }
      warnedAsync.add(id);
      console.warn(
        `[Directive] Async effect "${id}" recorded no dependencies, so it runs on every reconcile. Auto-tracking cannot see across an \`await\` — the tracking context closes when the body returns its promise — and this effect read nothing before its first one. Add \`deps: ["key1", "key2"]\`, or move the reads above the first \`await\`.`,
      );
    }
  }

  /**
   * The effect about to run and its definition. One body serves every run,
   * so a run allocates no closures: `body` reads these before calling the
   * author's code, and keeps the result on the effect's own state, so a run
   * started from inside another leaves the outer run's result in place.
   */
  let running: EffectState;
  let runningDef: any;
  const body = () => {
    const state = running;
    const def = runningDef;
    const id = state.id;
    let prev: object | null = previous;
    let d: object = derived;
    if (isDevelopment) {
      const checks: CheckedReadView<object>[] = [];
      const checked = (src: object, prefix: string) => {
        const check = createCheckedReadView(
          src,
          (key) => refuse(id, `${prefix}.${key}`),
          { prefix },
        );
        checks.push(check);

        return check.view;
      };
      if (prev !== null) {
        prev = checked(prev, "prevFacts");
      }
      d = checked(derived, "derived");
      runChecks.set(id, checks);
    }
    state.out_ = def.run(viewFor(id).view, prev, d);
  };

  /** Run one effect. A sync throw is returned in `thrown`; async errors are reported. */
  function run(
    state: EffectState,
    thrown: Array<[EffectState, unknown]>,
  ): Promise<void> | undefined {
    const def = definitions[state.id];
    if (!state.enabled || !def) {
      return undefined;
    }
    runCleanup(state);
    onRun?.(
      state.id,
      wantsRunDeps?.() === false
        ? NO_DEPS
        : state.deps
          ? Array.from(state.deps, describeDep)
          : [],
    );
    const id = state.id;
    try {
      running = state;
      runningDef = def;
      if (state.explicit) {
        store.batch(body);
      } else {
        // withTracking's frame, without its result object, into the spare
        // set (T1), marked as an effect's for the membership rule (c). Taken
        // off the state while it runs, so a nested run makes its own.
        const deps = state.spare_ ?? new Set<string>();
        state.spare_ = undefined;
        const outer = tracker.deps;
        const outerEffect = tracker.effect_;
        tracker.deps = tracker.effect_ = deps;
        try {
          store.batch(body);
        } catch (error) {
          // A throwing run keeps the last good run's dependencies (U3).
          deps.clear();
          state.spare_ = deps;
          throw error;
        } finally {
          tracker.deps = outer;
          tracker.effect_ = outerEffect;
        }
        commit(state, deps);
        if (isDevelopment && state.out_ instanceof Promise) {
          // Not `deps`: when the reads matched, commit cleared it as the spare.
          warnAsyncAutoTracked(id, state.deps!);
        }
      }
      const result = state.out_;
      state.out_ = undefined;
      if (result instanceof Promise) {
        return later(state, result);
      }
      keep(state, result);
      checkInPlace(id);
    } catch (error) {
      thrown.push([state, error]);
    }

    return undefined;
  }

  /**
   * An async run's result. Its own function: the closures capture `state`,
   * and a capture in `run` would allocate on every (sync) run.
   */
  const later = (state: EffectState, result: Promise<unknown>) =>
    result
      .then((settled) => {
        keep(state, settled);
        checkInPlace(state.id);
      })
      .catch((error) => report(state, error));

  /** Effects asked to run again, taken by the next pass's selection. */
  const reruns = new Set<string>();
  let pass = 0;
  /** Stamp the effects that `keys` reach with this pass (T2). */
  function reach(keys: Set<string>, now: number): void {
    // From whichever side is smaller: the changed keys, or the index.
    for (const key of keys.size > index.size ? index.keys() : keys) {
      const at = keys.has(key) && index.get(key);
      if (at) {
        for (const state of at) {
          state.hit_ = now;
        }
      }
    }
  }
  /**
   * The pass's effects in declaration order: those its keys reached, those
   * asked to run again, and auto-tracked ones that depend on nothing (never
   * run, or read nothing), which run on every change (1.35).
   */
  function select(changed: Set<string>): EffectState[] {
    const out: EffectState[] = [];
    const now = ++pass;
    if (index.size > 0) {
      reach(changed, now);
    }
    for (const state of order) {
      if (
        state.enabled &&
        (state.hit_ === now ||
          reruns.has(state.id) ||
          (!state.explicit && !state.deps?.size))
      ) {
        out.push(state);
      }
    }
    reruns.clear();

    return out;
  }

  const snapshotPrevious = () => {
    previous = prevObserved ? { ...store.toObject() } : null;
  };

  function runFast(selected: EffectState[]): Promise<void> | undefined {
    const thrown: Array<[EffectState, unknown]> = [];
    const pending: Array<Promise<void>> = [];
    for (const state of selected) {
      const done = run(state, thrown);
      if (done) {
        pending.push(done);
      }
    }
    for (const [state, error] of thrown) {
      report(state, error);
    }
    if (pending.length === 0) {
      snapshotPrevious();

      return undefined;
    }

    return Promise.all(pending).then(snapshotPrevious);
  }

  return {
    async runEffects(changed) {
      await runFast(select(changed));
    },
    runEffectsFast: (changed) => runFast(select(changed)),
    async runAll() {
      await runFast([...states.values()]);
    },
    async callOne(id) {
      const state = states.get(id);
      if (state) {
        await runFast([state]);
      }
    },
    cleanupAll() {
      stopped = true;
      for (const state of states.values()) {
        runCleanup(state);
      }
    },
    disable(id) {
      const state = get(id);
      // Off before the cleanup: one that throws under "throw" cannot leave it
      // on. (y): the dependencies stay. observed_ skips a disabled effect, so
      // the pass-end trim releases the derivations only it watched.
      state.enabled = false;
      runCleanup(state);
    },
    enable(id) {
      const state = get(id);
      if (!state.enabled) {
        state.enabled = true;
        // Released while disabled, so a stale one would never wake it.
        for (const key of state.deps ?? []) {
          if (key.startsWith(DERIVATION_DEP_PREFIX)) {
            options.watch?.(key.slice(DERIVATION_DEP_PREFIX.length));
          }
        }
      }
    },
    isEnabled: (id) => get(id).enabled,
    rerun_(id) {
      if (states.has(id)) {
        reruns.add(id);
      }
    },
    reruns_: () => reruns.size > 0,
    observed_(into) {
      // A disabled effect pins nothing (1.35 drops its dependencies,
      // effects.ts:1457; (y) keeps them and skips it here).
      for (const state of states.values()) {
        if (state.enabled && state.deps) {
          for (const key of state.deps) {
            if (key.startsWith(DERIVATION_DEP_PREFIX)) {
              into.add(key);
            }
          }
        }
      }
    },
  };
}

/**
 * The effects part: builds the manager from the module's `effects` and
 * defines it as the kernel's `effects` feature, which the reconcile pass
 * runs. A system without this part bundles none of the manager.
 */
export const withEffects: SystemPart = (ctx) => {
  const { kernel } = ctx;
  const { hooks } = kernel;
  /** Retries in a row per effect under "retry"; an ordinary write resets. */
  const retries = new Map<string, number>();
  const derivations = ctx.module.derive ?? {};
  const manager = createEffectsManager({
    // A derivation named in `deps` wakes the effect when it goes stale, and
    // every change upstream while it stays stale (core.ts `watched`).
    depKey(name) {
      if (!Object.hasOwn(derivations, name)) {
        return name;
      }
      ctx.watch(name);

      return DERIVATION_DEP_PREFIX + name;
    },
    watch: ctx.watch,
    definitions: (ctx.module.effects ?? {}) as Record<string, any>,
    facts: ctx.facts,
    store: ctx.store,
    derived: ctx.derived,
    tracker: ctx.tracker,
    onRun(id) {
      if (hooks.wants("effect.run")) {
        hooks.emit("effect.run", { id });
      }
    },
    // The hook reports the id only: no dependency list is built per run.
    wantsRunDeps: () => false,
    onError(id, error) {
      // As in 1.35: the error boundary hears it before the effect hook, and
      // the strategy acts after it.
      const strategy = ctx.reportError("effect", id, error);
      if (hooks.wants("effect.error")) {
        hooks.emit("effect.error", { id, error });
      }
      if (strategy === "disable") {
        manager.disable(id);
      }
      if (strategy === "retry") {
        // Bounded, as 1.35 (MAX_EFFECT_RETRIES): one that fails every time
        // would otherwise run again for as long as the process does.
        const attempts = (retries.get(id) ?? 0) + 1;
        retries.set(id, attempts);
        if (attempts <= 3) {
          manager.rerun_(id);
          ctx.schedule();
        } else if (isDevelopment) {
          console.warn(
            `[Directive] effect "${id}" failed 3 retries in a row; it will run again on its next change.`,
          );
        }
      }
    },
    onWriteBlocked(id, key) {
      if (hooks.wants("effect.write-blocked")) {
        hooks.emit("effect.write-blocked", { id, key });
      }
    },
  });
  kernel.define(
    "effects",
    Object.assign(manager, { fresh_: () => retries.clear() }),
  );
  // 1.35's controls (engine.ts:2633–2636); none asks for a pass.
  ctx.system.effects = {
    disable: manager.disable,
    enable: manager.enable,
    isEnabled: manager.isEnabled,
  };
};
