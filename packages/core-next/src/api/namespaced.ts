/**
 * L1: systems of several modules, `createSystem({ modules })`, with the 1.35
 * namespacing.
 *
 * One system core runs every module. Each namespace's keys are stored as
 * `ns::key` and every definition is wrapped so it sees only its own module's
 * view (`facts.self.*` and its `crossModuleDeps` namespaces when it declares
 * any). A single-module system is the same core with one unprefixed
 * namespace, so both shapes share every fact, derivation and event path.
 *
 * Views are cached per source object and namespace, and a module view reads
 * the core's key directly (`src[prefix + key]`), so a namespaced read costs
 * one extra lookup over a flat one.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { createSystemCore } from "./core.js";
import { PREV_READ, declaresPrev } from "./effects.js";
import {
  BLOCKED_PROPS,
  detectNonJsonValueType,
  isPrototypeSafe,
  warnNonJson,
} from "./facts.js";
import { createCheckedReadView } from "./readonly.js";
import type { ModuleDefinition, System, SystemOptions } from "./types.js";

export const SEPARATOR = "::";
const INSPECT = Symbol.for("nodejs.util.inspect.custom");
const no = () => false;

type Rec = Record<string, any>;
type Fn = (...args: any[]) => any;
interface Spec {
  get(key: string): unknown;
  set?(key: string, value: unknown): boolean;
  has?(key: string): boolean;
  ownKeys?(): string[];
  delete?(key: string): boolean;
}

/** 1.35's hardened view: no symbols, no prototype keys, no new properties. */
function hardened(spec: Spec): Rec {
  const ok = (key: string | symbol): key is string =>
    typeof key === "string" && !BLOCKED_PROPS.has(key);

  return new Proxy({} as Rec, {
    get(_, key) {
      if (ok(key)) {
        return spec.get(key);
      }
      if (key === INSPECT) {
        return () => {
          const out: Rec = {};
          for (const k of spec.ownKeys?.() ?? []) {
            out[k] = spec.get(k);
          }

          return out;
        };
      }

      return undefined;
    },
    set: (_, key, value) => ok(key) && !!spec.set?.(key, value),
    has: (_, key) => ok(key) && !!spec.has?.(key),
    deleteProperty: (_, key) => ok(key) && !!spec.delete?.(key),
    ownKeys: () => spec.ownKeys?.() ?? [],
    getOwnPropertyDescriptor: (_, key) =>
      typeof key === "string" && spec.has?.(key)
        ? { configurable: true, enumerable: true }
        : undefined,
    defineProperty: no,
    getPrototypeOf: () => null,
    setPrototypeOf: no,
  });
}

/** `auth.status` → `auth::status`; anything without a dot is unchanged. */
export const toInternalKey = (key: string): string =>
  key.includes(".") ? key.split(".").join(SEPARATOR) : key;

const keysUnder = (src: Rec, prefix: string): string[] =>
  Object.keys(src)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));

/** Topological order over crossModuleDeps (dependencies first). */
function order(modules: Rec): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (ns: string) => {
    if (done.has(ns)) {
      return;
    }
    if (path.includes(ns)) {
      const cycle = [...path.slice(path.indexOf(ns)), ns].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${cycle}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    path.push(ns);
    for (const dep of Object.keys(modules[ns]?.crossModuleDeps ?? {})) {
      if (Object.hasOwn(modules, dep)) {
        visit(dep);
      }
    }
    path.pop();
    done.add(ns);
    out.push(ns);
  };
  for (const ns of Object.keys(modules)) {
    visit(ns);
  }

  return out;
}

const ROLE: Record<string, [string, string]> = {
  derive: ["a derivation", "Derivations"],
  constraint: ["a constraint", "Constraints"],
  effect: ["an effect", "Effects"],
};

export function createNamespacedSystem(
  options: SystemOptions<any>,
  parts: readonly SystemPart[],
): System {
  const modules = options.modules as Record<string, ModuleDefinition>;
  const names = () => Object.keys(modules);
  const known = (ns: string) => Object.hasOwn(modules, ns);

  if (isDevelopment) {
    for (const [ns, mod] of Object.entries(modules)) {
      for (const dep of Object.keys(mod.crossModuleDeps ?? {})) {
        if (dep === ns) {
          console.warn(
            `[Directive] Module "${ns}" references itself in crossModuleDeps. Use "facts.self" to access own module's facts instead.`,
          );
        } else if (!known(dep)) {
          console.warn(
            `[Directive] Module "${ns}" declares crossModuleDeps.${dep}, but no module with namespace "${dep}" exists in the system. Available modules: ${names().join(", ")}`,
          );
        }
      }
    }
  }
  const initOrder = options.initOrder ?? "auto";
  let ordered: string[];
  if (Array.isArray(initOrder)) {
    const missing = names().filter((ns) => !initOrder.includes(ns));
    if (missing.length > 0) {
      throw new Error(
        `[Directive] initOrder is missing modules: ${missing.join(", ")}. All modules must be included in the explicit order.`,
      );
    }
    ordered = initOrder;
  } else {
    ordered = initOrder === "declaration" ? names() : order(modules);
  }
  for (const ns of names()) {
    if (ns.includes(SEPARATOR)) {
      throw new Error(
        `[Directive] Module name "${ns}" contains the reserved separator "${SEPARATOR}". Module names cannot contain "${SEPARATOR}".`,
      );
    }
    for (const key of Object.keys(modules[ns]!.schema.facts)) {
      if (key.includes(SEPARATOR)) {
        throw new Error(
          `[Directive] Schema key "${key}" in module "${ns}" contains the reserved separator "${SEPARATOR}". Schema keys cannot contain "${SEPARATOR}".`,
        );
      }
    }
  }

  // --- views ---------------------------------------------------------------
  const warned = new Set<string>();
  const cache = new WeakMap<object, Map<string, Rec>>();
  const cached = (src: object, key: string, build: () => Rec): Rec => {
    let byKey = cache.get(src);
    if (!byKey) {
      cache.set(src, (byKey = new Map()));
    }
    let view = byKey.get(key);
    if (!view) {
      byKey.set(key, (view = build()));
    }

    return view;
  };
  /** One module's facts in `src` (the core's facts, a read-only view or prev). */
  const factsOf = (src: Rec, ns: string): Rec =>
    cached(src, ns, () => {
      const prefix = ns + SEPARATOR;

      return hardened({
        get: (key) =>
          key === "$store" || key === "$snapshot"
            ? src[key]
            : src[prefix + key],
        set(key, value) {
          if (isDevelopment) {
            const type = detectNonJsonValueType(value);
            if (type) {
              warnNonJson(warned, `${ns}.${key}`, type);
            }
          }
          src[prefix + key] = value;

          return true;
        },
        has: (key) => prefix + key in src,
        delete(key) {
          delete src[prefix + key];

          return true;
        },
        ownKeys: () => keysUnder(src, prefix),
      });
    });
  /** `self` plus the declared dependencies, for a module with crossModuleDeps. */
  const crossOf = (src: Rec, ns: string, deps: string[], role: string): Rec =>
    cached(src, `${ns}|${deps.join(",")}|${role}`, () => {
      const [singular, plural] = ROLE[role]!;

      return hardened({
        get(key) {
          if (key === "self") {
            return factsOf(src, ns);
          }
          if (deps.includes(key)) {
            return factsOf(src, key);
          }
          if (isDevelopment) {
            console.warn(
              `[Directive] Module "${ns}" accessed undeclared cross-module property "${key}". Add it to crossModuleDeps or use "facts.self.${key}" for own module facts.`,
            );
          }

          return undefined;
        },
        set(key) {
          const id = `cross-module-set|${ns}|${role}|${key}`;
          if (isDevelopment && !warned.has(id)) {
            warned.add(id);
            console.warn(
              `[Directive] Module "${ns}": ${singular} tried to write "${key}". ${plural} read facts and never write them – change "${key}" from an event handler or a resolver.`,
            );
          }

          return false;
        },
        has: (key) => key === "self" || deps.includes(key),
        ownKeys: () => ["self", ...deps],
      });
    });
  const scopedFacts = (src: Rec, ns: string, deps: string[], role: string) =>
    deps.length > 0 ? crossOf(src, ns, deps, role) : factsOf(src, ns);
  const deriveOf = (src: Rec, ns: string): Rec => {
    if (src == null) {
      throw new Error(
        `[Directive] a constraint or effect of module "${ns}" was invoked without the system's derivations. Every \`derived\` read would return undefined and every gate reading one would go falsy, silently. If you are calling a transformed definition directly, pass the derive store as the last argument.`,
      );
    }

    return cached(src, `derive|${ns}`, () => {
      const prefix = ns + SEPARATOR;

      return hardened({
        get: (key) => src[prefix + key],
        has: (key) => prefix + key in src,
        ownKeys: () => keysUnder(src, prefix),
      });
    });
  };

  // --- what a resolver sees (1.35's createResolver*Proxy) ------------------
  /** Another module's facts, read-only: a write throws in development. */
  const depView = (src: Rec, ns: string, dep: string): Rec =>
    cached(src, `resolver|${ns}|${dep}`, () => {
      const prefix = dep + SEPARATOR;
      const refuse = (key: string) => {
        if (isDevelopment) {
          throw new Error(
            `[Directive] Module "${ns}": a resolver wrote "${dep}.${key}". Another module's facts are read-only from a resolver – emit a requirement or dispatch an event that module "${dep}" owns instead.`,
          );
        }

        return true;
      };

      return hardened({
        get: (key) => src[prefix + key],
        set: refuse,
        delete: refuse,
        has: (key) => prefix + key in src,
        ownKeys: () => keysUnder(src, prefix),
      });
    });
  /** `context.deps`: one read-only view per declared dependency. */
  const depsOf = (src: Rec, ns: string, deps: string[]): Rec =>
    cached(src, `deps|${ns}|${deps.join(",")}`, () =>
      hardened({
        get(key) {
          if (deps.includes(key)) {
            return depView(src, ns, key);
          }
          if (isDevelopment && !RUNTIME_PROBE_PROPS.has(key)) {
            const id = `resolver-deps|${ns}|${key}`;
            if (!warned.has(id)) {
              warned.add(id);
              console.warn(
                `[Directive] Module "${ns}": a resolver read ctx.deps.${key}, but "${key}" is not in crossModuleDeps. Declared: ${deps.join(", ")}.`,
              );
            }
          }

          return undefined;
        },
        set(key) {
          if (isDevelopment) {
            throw new Error(
              `[Directive] Module "${ns}": ctx.deps is read-only (tried to set "${key}").`,
            );
          }

          return true;
        },
        has: (key) => deps.includes(key),
        ownKeys: () => [...deps],
      }),
    );
  /** `$store` scoped to the module: bare or own-prefixed keys only. */
  const storeOf = (src: Rec, ns: string): Rec =>
    cached(src, `store|${ns}`, () => {
      const prefix = ns + SEPARATOR;
      const store = src.$store as Rec;
      const own = (key: unknown): string | null =>
        typeof key !== "string"
          ? null
          : key.startsWith(prefix)
            ? key
            : key.includes(SEPARATOR)
              ? null
              : prefix + key;
      const refuse = (key: unknown) => {
        if (isDevelopment) {
          const target = String(key);
          const owner = target.includes(SEPARATOR)
            ? target.slice(0, target.indexOf(SEPARATOR))
            : "another module";
          throw new Error(
            `[Directive] Module "${ns}": a resolver wrote "${target}" through ctx.facts.$store. Another module's facts are read-only from a resolver – emit a requirement or dispatch an event that module "${owner}" owns instead.`,
          );
        }
      };
      const write =
        (op: "set" | "delete") =>
        (key: string, ...rest: unknown[]) => {
          const full = own(key);
          if (full === null) {
            refuse(key);

            return;
          }
          store[op](full, ...rest);
        };

      return Object.freeze({
        get: (key: string) => {
          const full = own(key);

          return full === null ? undefined : store.get(full);
        },
        has: (key: string) => {
          const full = own(key);

          return full === null ? false : store.has(full);
        },
        set: write("set"),
        delete: write("delete"),
        batch: (fn: () => void) => store.batch(fn),
        subscribe: (keys: string[], listener: () => void) =>
          store.subscribe(
            keys.map(own).filter((k): k is string => k !== null),
            listener,
          ),
        subscribeAll: (listener: () => void) => store.subscribeAll(listener),
        toObject: () => {
          const out: Rec = {};
          for (const [key, value] of Object.entries(store.toObject() as Rec)) {
            if (key.startsWith(prefix)) {
              out[key.slice(prefix.length)] = value;
            }
          }

          return out;
        },
      });
    });
  /** `context.facts`: own facts, bare keys, with `$store` scoped too. */
  const resolverFactsOf = (src: Rec, ns: string): Rec =>
    cached(src, `facts|${ns}`, () => {
      const own = factsOf(src, ns);
      const scoped = () => storeOf(src, ns);

      return hardened({
        get: (key) =>
          key === "$store" ? scoped() : key === "$snapshot" ? scoped : own[key],
        set(key, value) {
          own[key] = value;

          return true;
        },
        has: (key) => key in own,
        delete: (key) => Reflect.deleteProperty(own, key),
        ownKeys: () => Object.keys(own),
      });
    });

  // --- one flat module -----------------------------------------------------
  const facts: Rec = {};
  const derivations: Rec = {};
  const derive: Rec = {};
  const events: Rec = {};
  const effects: Rec = {};
  const constraints: Rec = {};
  const resolvers: Rec = {};
  /** Each resolver's module, for its onResolverError hook (1.35). */
  const owners: Rec = {};
  const inits: Array<(src: Rec) => void> = [];
  const namespaceKeys = new Map<string, string[]>();
  for (const ns of ordered) {
    const mod = modules[ns]!;
    for (const [section, obj] of [
      ["schema", mod.schema?.facts],
      ["events", mod.events],
      ["derive", mod.derive],
      ["effects", mod.effects],
      ["sources", mod.sources],
      ["constraints", mod.constraints],
      ["resolvers", mod.resolvers],
    ] as const) {
      for (const key of Object.keys(obj ?? {})) {
        if (BLOCKED_PROPS.has(key)) {
          throw new Error(
            `[Directive] Security: Module "${ns}" has dangerous key "${key}" in ${section}. This could indicate a prototype pollution attempt.`,
          );
        }
      }
    }
    const p = (key: string) => ns + SEPARATOR + key;
    const deps = Object.keys(mod.crossModuleDeps ?? {});
    const keys: string[] = [];
    for (const [key, type] of Object.entries(mod.schema.facts)) {
      facts[p(key)] = type;
      keys.push(p(key));
    }
    for (const [key, type] of Object.entries(mod.schema.derivations ?? {})) {
      derivations[p(key)] = type;
      keys.push(p(key));
    }
    namespaceKeys.set(ns, keys);
    for (const [key, raw] of Object.entries(mod.derive ?? {})) {
      const meta = typeof raw === "function" ? undefined : (raw as Rec)?.meta;
      const fn = typeof raw === "function" ? raw : (raw as Rec)?.compute;
      const wrapper = (src: Rec, d: Rec) =>
        fn(scopedFacts(src, ns, deps, "derive"), deriveOf(d, ns));
      derive[p(key)] = meta ? { compute: wrapper, meta } : wrapper;
    }
    for (const [key, raw] of Object.entries(mod.events ?? {})) {
      const handler =
        typeof raw === "object" && raw !== null && Object.hasOwn(raw, "handler")
          ? (raw as Rec).handler
          : raw;
      const meta = handler === raw ? undefined : (raw as Rec).meta;
      const wrapper = (src: Rec, event: unknown) =>
        handler(factsOf(src, ns), event);
      events[p(key)] = meta ? { handler: wrapper, meta } : wrapper;
    }
    for (const [key, def] of Object.entries(mod.effects ?? {}) as [
      string,
      Rec,
    ][]) {
      const run = (src: Rec, prev: Rec | null, d: Rec) =>
        def.run(
          scopedFacts(src, ns, deps, "effect"),
          prev ? scopedFacts(prev, ns, deps, "effect") : undefined,
          deriveOf(d, ns),
        );
      (run as unknown as Record<symbol, boolean>)[PREV_READ] = declaresPrev(
        def.run,
      );
      effects[p(key)] = { ...def, run, deps: def.deps?.map(p) };
    }
    // Constraints (1.35's prefixConstraints): ids, deps, `after` and
    // `abortOn` keys move into the namespace; a function `when` or
    // `require` reads `facts.self` (or the module's facts) and its own
    // derivations.
    const scoped =
      (fn: Fn) =>
      (src: Rec, d: Rec): unknown =>
        fn(scopedFacts(src, ns, deps, "constraint"), deriveOf(d, ns));
    const inNs = (key: string) => (key.includes(SEPARATOR) ? key : p(key));
    for (const [key, def] of Object.entries(mod.constraints ?? {}) as [
      string,
      Rec,
    ][]) {
      constraints[p(key)] = {
        ...def,
        deps: def.deps?.map(p),
        after: def.after?.map(inNs),
        abortOn: def.abortOn?.map(inNs),
        when: typeof def.when === "function" ? scoped(def.when) : def.when,
        require:
          typeof def.require === "function" ? scoped(def.require) : def.require,
      };
    }
    // Resolvers (1.35's prefixResolvers): `context.facts` is the module's
    // own facts, other modules only through `context.deps`. The wrappers
    // keep 1.35's async shape, so a run ends on the same microtask.
    const wrap = (context: Rec): Rec =>
      deps.length > 0
        ? {
            ...context,
            facts: resolverFactsOf(context.facts, ns),
            deps: depsOf(context.facts, ns, deps),
          }
        : { ...context, facts: resolverFactsOf(context.facts, ns) };
    const run = async (
      context: Rec,
      call: (wrapped: Rec) => Promise<unknown>,
    ) => {
      const wrapped = wrap(context);
      if (isDevelopment && deps.length > 0) {
        // A value handed out through context.deps changed in place is
        // reported once the run settles, naming the path (1.35).
        const checks = deps.map((dep) =>
          createCheckedReadView(
            wrapped.deps[dep] as Rec,
            (key) => {
              // The dependency view refuses the write, with its message.
              (wrapped.deps[dep] as Rec)[key] = undefined;

              return true;
            },
            { prefix: dep },
          ),
        );
        const views = new Proxy(wrapped.deps as Rec, {
          get: (target, key) => {
            const i = typeof key === "string" ? deps.indexOf(key) : -1;

            return i >= 0 ? checks[i]!.view : Reflect.get(target, key);
          },
        });
        const result = await call({ ...wrapped, deps: views });
        for (const check of checks) {
          const mutated = check.takeMutation();
          if (mutated !== null) {
            throw new Error(
              `[Directive] Module "${ns}": a resolver changed "${mutated}" in place. Another module's facts are read-only from a resolver – emit a requirement or dispatch an event that module "${mutated.slice(0, mutated.indexOf("."))}" owns instead.`,
            );
          }
        }

        return result;
      }

      return call(wrapped);
    };
    for (const [key, def] of Object.entries(mod.resolvers ?? {}) as [
      string,
      Rec,
    ][]) {
      owners[p(key)] = mod;
      resolvers[p(key)] = {
        ...def,
        ...(def.resolve && {
          resolve: async (req: unknown, context: Rec) => {
            await run(context, (wrapped) => def.resolve(req, wrapped));
          },
        }),
        ...(def.resolveBatch && {
          resolveBatch: async (reqs: unknown[], context: Rec) => {
            await run(context, (wrapped) => def.resolveBatch(reqs, wrapped));
          },
        }),
        ...(def.resolveBatchWithResults && {
          resolveBatchWithResults: async (reqs: unknown[], context: Rec) => {
            return run(context, (wrapped) =>
              def.resolveBatchWithResults(reqs, wrapped),
            );
          },
        }),
      };
    }
    if (mod.init) {
      inits.push((src) => mod.init!(factsOf(src, ns)));
    }
  }
  const flat = {
    id: ordered.join(","),
    schema: { facts, derivations, events: {} },
    inits_: inits,
    hooks_: ordered.map((ns) => modules[ns]!.hooks).filter(Boolean),
    // 1.35 ticks the first module, in init order, that has a `tick` event.
    tick_: Object.keys(events).find((key) => key.endsWith(`${SEPARATOR}tick`)),
    // 1.35's applyNamespacedFacts (system.ts:398–440), run at start.
    load_(src: Rec, set: (key: string, value: unknown) => void) {
      for (const [ns, values] of Object.entries(src)) {
        if (BLOCKED_PROPS.has(ns)) {
          if (isDevelopment) {
            console.warn(
              `[Directive] initialFacts/hydrate contains blocked namespace "${ns}". Skipping.`,
            );
          }
          continue;
        }
        if (!known(ns)) {
          if (isDevelopment) {
            console.warn(
              `[Directive] initialFacts/hydrate contains unknown namespace "${ns}". Available modules: ${names().join(", ")}`,
            );
          }
          continue;
        }
        if (values && typeof values === "object" && !isPrototypeSafe(values)) {
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${ns}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        }
        for (const [key, value] of Object.entries(values as Rec)) {
          if (!BLOCKED_PROPS.has(key)) {
            set(ns + SEPARATOR + key, value);
          }
        }
      }
    },
    modules_: ordered.map((ns) => ({ id: ns, meta: modules[ns]!.meta })),
    owners_: owners,
    derive,
    events,
    effects,
    constraints,
    resolvers,
  } as unknown as ModuleDefinition;

  const system = createSystemCore(
    { ...options, module: flat } as SystemOptions<any>,
    parts,
  ) as Rec;
  const core = {
    facts: system.facts as Rec,
    derive: system.derive as Rec,
    read: system.read as (id: string) => unknown,
    subscribe: system.subscribe as (
      ids: string[],
      fn: () => void,
    ) => () => void,
    watch: system.watch as (...args: any[]) => () => void,
    when: system.when as (...args: any[]) => Promise<void>,
  };

  // --- the namespaced surface ----------------------------------------------
  const warnedReads = new Set<string>();
  const eventViews = new Map<string, Rec>();
  const nsFacts = hardened({
    get: (ns) => (known(ns) ? factsOf(core.facts, ns) : undefined),
    has: known,
    ownKeys: names,
  });
  Object.assign(system, {
    _mode: "namespaced",
    facts: nsFacts,
    derive: hardened({
      get(ns) {
        if (known(ns)) {
          return deriveOf(core.derive, ns);
        }
        if (
          isDevelopment &&
          !RUNTIME_PROBE_PROPS.has(ns) &&
          !ns.startsWith("@@") &&
          !warnedReads.has(ns)
        ) {
          const suffix = SEPARATOR + ns;
          const owners = Object.keys(core.derive)
            .filter((k) => k.endsWith(suffix))
            .map((k) => k.slice(0, -suffix.length));
          if (owners.length > 0) {
            warnedReads.add(ns);
            const owner = owners[0];
            const where =
              owners.length === 1
                ? `module "${owner}"`
                : `modules ${owners.map((n) => `"${n}"`).join(", ")}`;
            console.warn(
              `[Directive] system.derive.${ns} is undefined — "${ns}" is a derivation of ${where}, not a module. This system was built with createSystem({ modules }), where system.derive holds module names and the derivations are one level down. Inside a constraint or effect, read the \`derived\` parameter instead: \`when: (facts, derived) => derived.${ns}\`. Outside one, use system.derive.${owner}.${ns}. This system's modules are: ${names().join(", ")}.`,
            );
          }
        }

        return undefined;
      },
      has: known,
      ownKeys: names,
    }),
    events: hardened({
      get(ns) {
        if (!known(ns)) {
          return undefined;
        }
        let view = eventViews.get(ns);
        if (!view) {
          view = hardened({
            get: (name) => (payload?: Rec) =>
              system.dispatch({ type: ns + SEPARATOR + name, ...payload }),
          });
          eventViews.set(ns, view);
        }

        return view;
      },
      has: known,
      ownKeys: names,
    }),
    read: (id: string) => core.read(toInternalKey(id)),
    subscribe(ids: string[], listener: () => void) {
      const internal: string[] = [];
      for (const id of ids) {
        if (id.endsWith(".*")) {
          const keys = namespaceKeys.get(id.slice(0, -2));
          if (keys) {
            internal.push(...keys);
          } else if (isDevelopment) {
            console.warn(
              `[Directive] subscribe wildcard "${id}" — namespace "${id.slice(0, -2)}" not found.`,
            );
          }
        } else {
          internal.push(toInternalKey(id));
        }
      }

      return core.subscribe(internal, listener);
    },
    subscribeModule(ns: string, listener: () => void) {
      const keys = namespaceKeys.get(ns);
      if (!keys || keys.length === 0) {
        if (isDevelopment) {
          console.warn(
            `[Directive] subscribeModule("${ns}") — namespace not found. Available: ${[...namespaceKeys.keys()].join(", ")}`,
          );
        }

        return () => {};
      }

      return core.subscribe(keys, listener);
    },
    watch: (id: string, ...rest: unknown[]) =>
      core.watch(toInternalKey(id), ...rest),
    when: (predicate: (facts: Rec) => boolean, opts?: unknown) =>
      core.when(() => predicate(nsFacts), opts),
  });

  return system as System;
}

/** Keys a runtime probes on any object; reading one is not a mistake. */
const RUNTIME_PROBE_PROPS: ReadonlySet<string> = new Set([
  "$$typeof",
  "toJSON",
  "then",
  "nodeType",
  "tagName",
  "hasAttribute",
  "asymmetricMatch",
  "Symbol(Symbol.toStringTag)",
  "@@__IMMUTABLE_ITERABLE__@@",
  "@@__IMMUTABLE_RECORD__@@",
]);
