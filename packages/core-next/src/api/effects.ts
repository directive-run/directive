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
import {
  BLOCKED_PROPS,
  type Tracker,
  describeDep,
  withTracking,
} from "./facts.js";
import type { Facts, FactsStore, Schema } from "./types.js";

export interface CreateEffectsOptions<S extends Schema> {
  definitions: Record<string, any>;
  facts: Facts<S>;
  store: FactsStore<S>;
  derived?: Record<string, unknown>;
  tracker?: Tracker;
  onRun?: (id: string, deps: string[]) => void;
  onError?: (id: string, error: unknown) => void;
  onWriteBlocked?: (id: string, key: string) => void;
}

export interface EffectsManager {
  runEffects(changedKeys: Set<string>): Promise<void>;
  /** Runs the effects due; returns a promise only when one of them is async. */
  runEffectsFast(changedKeys: Set<string>): Promise<void> | undefined;
  runAll(): Promise<void>;
  callOne(id: string): Promise<void>;
  cleanupAll(): void;
  disable(id: string): void;
  enable(id: string): void;
  isEnabled(id: string): boolean;
}

interface EffectState {
  id: string;
  enabled: boolean;
  explicit: boolean;
  deps: Set<string> | null;
  cleanup: (() => void) | null;
}

function writeMessage(id: string, key: string): string {
  return `[Directive] effect "${id}" tried to write "${key}". Effects only talk to the outside world and cannot change facts. Use an event handler for a change caused by input (events: { move: (facts) => { facts.${key.split(".")[0]} = … } }), a derivation for a value computed from other facts, or a resolver for work a constraint requires. For data that comes back from async work, publish it from a source or write it in a resolver. See https://directive.run/docs/effects#effects-never-write-facts`;
}

/** 0 or 2+ parameters, or anything opaque, may read prevFacts. */
function declaresPrev(run: unknown): boolean {
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
  const { definitions, facts, store, onRun, onError, onWriteBlocked } = options;
  const derived = options.derived ?? {};
  const tracker = options.tracker ?? { deps: null };
  const states = new Map<string, EffectState>();
  let stopped = false;
  let previous: Record<string, unknown> | null = null;
  const prevObserved = Object.values(definitions).some((d) =>
    declaresPrev(d?.run),
  );

  for (const id of Object.keys(definitions)) {
    const deps = definitions[id]?.deps as string[] | undefined;
    states.set(id, {
      id,
      enabled: true,
      explicit: Array.isArray(deps),
      deps: Array.isArray(deps) ? new Set(deps) : null,
      cleanup: null,
    });
  }

  const refuse = (id: string, key: string): boolean => {
    onWriteBlocked?.(id, key);
    if (isDevelopment) {
      throw new Error(writeMessage(id, key));
    }

    return true;
  };

  /** A read-only view of the facts for effect `id`: writes are refused. */
  const views = new Map<string, unknown>();
  function viewFor(id: string): unknown {
    let view = views.get(id);
    if (view) {
      return view;
    }
    const readonlyStore: FactsStore<S> = {
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
    };
    view = new Proxy(facts as object, {
      get(target, prop) {
        if (prop === "$store") {
          return readonlyStore;
        }

        return Reflect.get(target, prop);
      },
      set(_, prop) {
        if (typeof prop === "symbol" || BLOCKED_PROPS.has(prop)) {
          return false;
        }

        return refuse(id, prop);
      },
      deleteProperty(_, prop) {
        if (typeof prop === "symbol" || BLOCKED_PROPS.has(prop)) {
          return false;
        }

        return refuse(id, prop);
      },
    });
    views.set(id, view);

    return view;
  }

  function runCleanup(state: EffectState): void {
    if (state.cleanup) {
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
    }
  }

  function keep(state: EffectState, result: unknown): void {
    if (typeof result !== "function") {
      return;
    }
    if (!stopped) {
      state.cleanup = result as () => void;

      return;
    }
    try {
      (result as () => void)();
    } catch (error) {
      onError?.(state.id, error);
      console.error(
        `[Directive] Effect "${state.id}" cleanup threw an error:`,
        error,
      );
    }
  }

  function report(state: EffectState, error: unknown): void {
    onError?.(state.id, error);
    console.error(`[Directive] Effect "${state.id}" threw an error:`, error);
  }

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
    onRun?.(state.id, state.deps ? Array.from(state.deps, describeDep) : []);
    try {
      let out: unknown;
      const call = () =>
        store.batch(() => {
          out = def.run(viewFor(state.id), previous, derived);
        });
      if (state.explicit) {
        call();
      } else {
        const tracked = withTracking(tracker, call);
        state.deps = tracked.deps.size > 0 ? tracked.deps : null;
      }
      if (out instanceof Promise) {
        return out.then(
          (settled) => keep(state, settled),
          (error) => report(state, error),
        );
      }
      keep(state, out);
    } catch (error) {
      thrown.push([state, error]);
    }

    return undefined;
  }

  function select(changed: Set<string>): EffectState[] {
    const out: EffectState[] = [];
    for (const state of states.values()) {
      if (!state.enabled) {
        continue;
      }
      if (state.deps) {
        let hit = false;
        for (const key of state.deps) {
          if (changed.has(key)) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          continue;
        }
      }
      out.push(state);
    }

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
      const state = states.get(id);
      if (state) {
        runCleanup(state);
        state.enabled = false;
      }
    },
    enable(id) {
      const state = states.get(id);
      if (state) {
        state.enabled = true;
      }
    },
    isEnabled: (id) => states.get(id)?.enabled ?? false,
  };
}

/**
 * The effects part: builds the manager from the module's `effects` and
 * defines it as the kernel's `effects` feature, which the reconcile pass
 * runs. A system without this part bundles none of the manager.
 */
export const withEffects: SystemPart = (ctx) => {
  const { kernel, reportError } = ctx;
  const { hooks } = kernel;
  const manager = createEffectsManager({
    definitions: (ctx.module.effects ?? {}) as Record<string, any>,
    facts: ctx.facts,
    store: ctx.store,
    derived: ctx.derived,
    tracker: ctx.tracker,
    onRun(id) {
      if (hooks.live) {
        hooks.emit("effect.run", { id });
      }
    },
    onError(id, error) {
      if (hooks.live) {
        hooks.emit("effect.error", { id, error });
      }
      reportError("effect", id, error);
    },
    onWriteBlocked(id, key) {
      if (hooks.live) {
        hooks.emit("effect.write-blocked", { id, key });
      }
    },
  });
  kernel.define("effects", manager);
};
