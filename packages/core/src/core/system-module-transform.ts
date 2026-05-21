/**
 * Module transformation for namespaced systems.
 *
 * Converts a module's unprefixed keys to prefixed internal format
 * (e.g., `token` → `auth::token`). Used by both the initial system
 * setup loop and `registerModule()`.
 *
 * @internal
 */

import isDevelopment from "#is-development";
import { freezeSpec } from "../utils/utils.js";
import {
  applyPatch,
  evaluateTemplate,
  isPredicate,
  isTemplate,
  memoizePredicate,
} from "./predicate.js";
import {
  SEPARATOR,
  createCrossModuleFactsProxy,
  createModuleDeriveProxy,
  createModuleFactsProxy,
} from "./system-proxies.js";
import type { ModuleDef, ModuleSchema } from "./types.js";
import { isDerivationWithMeta } from "./types/meta.js";

/**
 * The flat engine module format produced by prefixModuleDefinition.
 * Ready to be passed to createEngine or engine.registerModule.
 *
 * @internal
 */
export interface FlatModuleDefinition {
  id: string;
  schema: Record<string, unknown>;
  requirements: Record<string, unknown>;
  init: ((facts: Record<string, unknown>) => void) | undefined;
  derive: Record<string, unknown> | undefined;
  events: Record<string, unknown> | undefined;
  effects: Record<string, unknown> | undefined;
  constraints: Record<string, unknown> | undefined;
  resolvers: Record<string, unknown> | undefined;
  hooks: ModuleDef<ModuleSchema>["hooks"];
  meta?: ModuleDef<ModuleSchema>["meta"];
  history: { snapshotEvents?: string[] };
}

/**
 * Options for prefixModuleDefinition.
 *
 * @internal
 */
export interface PrefixModuleOptions {
  /** The module to transform */
  mod: ModuleDef<ModuleSchema>;
  /** The namespace to prefix keys with */
  namespace: string;
  /** Set of modules to snapshot (null = all). Used for history filtering. */
  snapshotModulesSet: Set<string> | null;
}

/**
 * Create a facts proxy appropriate for the module's cross-module configuration.
 * Returns a cross-module proxy when deps are declared, otherwise a module proxy.
 *
 * @internal
 */
function createScopedFactsProxy(
  facts: Record<string, unknown>,
  namespace: string,
  hasCrossModuleDeps: boolean,
  depNamespaces: string[],
): Record<string, unknown> {
  return hasCrossModuleDeps
    ? createCrossModuleFactsProxy(facts, namespace, depNamespaces)
    : createModuleFactsProxy(facts, namespace);
}

/** Prefix a key with the namespace separator */
function prefixKey(namespace: string, key: string): string {
  return `${namespace}${SEPARATOR}${key}`;
}

/** True if a key already includes the namespace separator (cross-module ref). */
function isAlreadyPrefixed(key: string): boolean {
  return key.includes(SEPARATOR);
}

/**
 * Rewrite a data-form predicate spec so its top-level fact-key references
 * point at the namespaced flat keyspace (e.g. `phase` → `traffic::phase`).
 *
 * Recurses into `$all` / `$any` / `$not` combinators. Array-of-clauses form
 * has each `fact` field rewritten. Object form keys are rewritten, with
 * `$`-operator keys and already-prefixed keys passed through unchanged.
 *
 * Recognizes **namespace pivot** keys — a top-level key that equals `"self"`
 * or any declared cross-module dep namespace name is unwrapped one level:
 * its child predicate's keys are then prefixed with the appropriate
 * namespace. So `{ self: { phase: "red" } }` in module `traffic` becomes
 * `{ "traffic::phase": "red" }`, and `{ auth: { token: { $exists: true } } }`
 * with declared dep `auth` becomes `{ "auth::token": { $exists: true } }`.
 *
 * Operator keys (`$eq`, `$gte`, etc.) inside the nested object pass through
 * unchanged.
 *
 * Returns a frozen, structurally-identical spec.
 */
function prefixPredicateSpec(
  spec: unknown,
  selfNamespace: string,
  depNamespaces: ReadonlySet<string>,
): unknown {
  if (Array.isArray(spec)) {
    const out = spec.map((clause) => {
      if (
        clause &&
        typeof clause === "object" &&
        typeof (clause as { fact?: unknown }).fact === "string"
      ) {
        const fact = (clause as { fact: string }).fact;
        if (isAlreadyPrefixed(fact)) {
          return clause;
        }

        return { ...clause, fact: prefixKey(selfNamespace, fact) };
      }

      return clause;
    });
    freezeSpec(out);

    return out;
  }

  if (!spec || typeof spec !== "object") {
    return spec;
  }

  const src = spec as Record<string, unknown>;

  if ("$all" in src || "$any" in src) {
    const combinator = "$all" in src ? "$all" : "$any";
    const list = src[combinator] as unknown[];
    const out: Record<string, unknown> = {
      [combinator]: list.map((child) =>
        prefixPredicateSpec(child, selfNamespace, depNamespaces),
      ),
    };
    freezeSpec(out);

    return out;
  }
  if ("$not" in src) {
    const out = {
      $not: prefixPredicateSpec(src.$not, selfNamespace, depNamespaces),
    };
    freezeSpec(out);

    return out;
  }

  /**
   * Re-prefix one level of a pivot's nested predicate against a target
   * namespace. The child shape is the same as the parent spec — combinators,
   * array form, or `{ key: value }` map — so we recurse with a swapped
   * `selfNamespace`. The pivot's own depNamespaces are not re-checked one
   * level deeper (cross-module pivots cannot themselves contain further
   * cross-module pivots).
   */
  function prefixPivot(child: unknown, targetNamespace: string): unknown {
    return prefixPredicateSpec(child, targetNamespace, EMPTY_DEP_SET);
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (key.startsWith("$") || isAlreadyPrefixed(key)) {
      out[key] = src[key];
      continue;
    }
    if (key === "self") {
      // Namespace pivot — flatten one level against the self namespace.
      const child = src[key];
      if (child && typeof child === "object") {
        const flattened = prefixPivot(child, selfNamespace);
        if (
          flattened &&
          typeof flattened === "object" &&
          !Array.isArray(flattened)
        ) {
          for (const [k, v] of Object.entries(
            flattened as Record<string, unknown>,
          )) {
            out[k] = v;
          }
          continue;
        }
      }
      // Fall through to default behavior if child isn't a usable object.
    }
    if (depNamespaces.has(key)) {
      // Namespace pivot — flatten one level against the declared dep namespace.
      const child = src[key];
      if (child && typeof child === "object") {
        const flattened = prefixPivot(child, key);
        if (
          flattened &&
          typeof flattened === "object" &&
          !Array.isArray(flattened)
        ) {
          for (const [k, v] of Object.entries(
            flattened as Record<string, unknown>,
          )) {
            out[k] = v;
          }
          continue;
        }
      }
      // Fall through to default behavior if child isn't a usable object.
    }
    out[prefixKey(selfNamespace, key)] = src[key];
  }
  freezeSpec(out);

  return out;
}

/** Shared empty set used when recursing into a pivot (no nested pivots). */
const EMPTY_DEP_SET: ReadonlySet<string> = new Set<string>();

/**
 * Convert any data-form definition arm in a module to its function-shape
 * equivalent, leaving the namespace prefixing to the existing per-arm
 * prefixers. Returns a shallow-copied module — the caller's input is never
 * mutated.
 *
 * - Constraint `when`: data spec → prefixed spec (still data) so the
 *   constraints manager normalizes it against the flat keyspace and
 *   `getWhenSpec()` returns a spec consistent with that keyspace.
 * - Derivation `compute`: data spec → bare `(facts) => value` function so the
 *   per-arm prefixer can wrap it with a module-scoped proxy.
 * - Event `patch`: data spec → `{ handler, meta }` form so the event
 *   prefixer's existing handler branch wraps it with a module-scoped proxy.
 * - Effect `on`: data spec → prefixed spec so the effects manager extracts
 *   prefixed deps and gates against the flat snapshot.
 */
function normalizePredicateDefs(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
): ModuleDef<ModuleSchema> {
  // Cross-module dep namespaces declared by this module — used by
  // prefixPredicateSpec to detect namespace pivots like `auth` in
  // `when: { auth: { token: { $exists: true } } }`.
  const depNamespaces: ReadonlySet<string> = mod.crossModuleDeps
    ? new Set(Object.keys(mod.crossModuleDeps))
    : EMPTY_DEP_SET;

  let constraints = mod.constraints;
  if (constraints) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(constraints)) {
      const def = raw as { when?: unknown };
      if (def.when !== undefined && typeof def.when !== "function") {
        next[key] = {
          ...def,
          when: prefixPredicateSpec(def.when, namespace, depNamespaces),
        };
        changed = true;
        continue;
      }
      next[key] = raw;
    }
    if (changed) {
      constraints = next as typeof constraints;
    }
  }

  let derive = mod.derive;
  if (derive) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(derive)) {
      const obj =
        raw && typeof raw === "object" && Object.hasOwn(raw, "compute")
          ? (raw as { compute: unknown; meta?: unknown })
          : null;
      if (!obj) {
        next[key] = raw;
        continue;
      }

      const c = obj.compute;
      if (typeof c === "function") {
        next[key] = raw;
        continue;
      }

      if (isTemplate(c)) {
        freezeSpec(c);
        const fn = (facts: unknown) =>
          evaluateTemplate(c, facts as Record<string, unknown>);
        next[key] = obj.meta ? { compute: fn, meta: obj.meta } : fn;
        changed = true;
        continue;
      }

      if (isPredicate(c)) {
        freezeSpec(c as object);
        const memoized = memoizePredicate(c as object);
        const fn = (facts: unknown) =>
          memoized(facts as Record<string, unknown>);
        next[key] = obj.meta ? { compute: fn, meta: obj.meta } : fn;
        changed = true;
        continue;
      }

      next[key] = raw;
    }
    if (changed) {
      derive = next as typeof derive;
    }
  }

  let events = mod.events;
  if (events) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(events)) {
      if (raw && typeof raw === "object") {
        const hasHandler = Object.hasOwn(raw, "handler");
        const hasPatch = Object.hasOwn(raw, "patch");

        // Both forms provided — mirror engine.ts unwrapEventDefinitions:
        // dev-warn once at registration so namespaced authors see the same
        // diagnostic as the single-module path. Keep the existing implicit
        // behavior of preferring the handler (skip patch conversion).
        if (hasHandler && hasPatch && isDevelopment) {
          console.warn(
            `[Directive] event "${key}": both \`handler\` and \`patch\` provided — using \`handler\` (patch is ignored).`,
          );
        }

        if (hasPatch && !hasHandler) {
          const obj = raw as {
            patch: { $set: Record<string, unknown> };
            meta?: unknown;
          };
          freezeSpec(obj.patch);
          const handler = (
            facts: Record<string, unknown>,
            event: Record<string, unknown> | undefined,
          ) =>
            applyPatch(
              obj.patch as Parameters<typeof applyPatch>[0],
              facts,
              event ?? {},
            );
          next[key] = obj.meta ? { handler, meta: obj.meta } : handler;
          changed = true;
          continue;
        }
      }
      next[key] = raw;
    }
    if (changed) {
      events = next as typeof events;
    }
  }

  let effects = mod.effects;
  if (effects) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(effects)) {
      const def = raw as { on?: unknown };
      if (def.on !== undefined && isPredicate(def.on)) {
        next[key] = {
          ...def,
          on: prefixPredicateSpec(def.on, namespace, depNamespaces),
        };
        changed = true;
        continue;
      }
      next[key] = raw;
    }
    if (changed) {
      effects = next as typeof effects;
    }
  }

  if (
    constraints === mod.constraints &&
    derive === mod.derive &&
    events === mod.events &&
    effects === mod.effects
  ) {
    return mod;
  }

  return { ...mod, constraints, derive, events, effects };
}

/** Return a non-empty record or undefined */
function nonEmpty<T extends Record<string, unknown>>(rec: T): T | undefined {
  return Object.keys(rec).length > 0 ? rec : undefined;
}

/** Prefix schema fact keys */
function prefixSchema(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mod.schema.facts)) {
    result[prefixKey(namespace, key)] = value;
  }

  return result;
}

/** Create a prefixed init function */
function prefixInit(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
): ((facts: Record<string, unknown>) => void) | undefined {
  if (!mod.init) {
    return undefined;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Facts proxy type coercion
  return (facts: any) => {
    const moduleFactsProxy = createModuleFactsProxy(facts, namespace);
    // biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
    (mod.init as any)(moduleFactsProxy);
  };
}

/** Prefix derivation keys and wrap derivation functions with scoped proxies */
function prefixDerive(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
  hasCrossModuleDeps: boolean,
  depNamespaces: string[],
): Record<string, unknown> | undefined {
  if (!mod.derive) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(mod.derive)) {
    const isObj = isDerivationWithMeta(raw);
    const fn = isObj ? raw.compute : raw;
    const meta = isObj ? raw.meta : undefined;

    const wrapper = (facts: unknown, derive: unknown) => {
      const factsProxy = createScopedFactsProxy(
        facts as Record<string, unknown>,
        namespace,
        hasCrossModuleDeps,
        depNamespaces,
      );
      const deriveProxy = createModuleDeriveProxy(
        derive as Record<string, unknown>,
        namespace,
      );
      // biome-ignore lint/suspicious/noExplicitAny: Derive function type coercion
      return (fn as any)(factsProxy, deriveProxy);
    };

    // Pass through as { compute, meta } so derivationsManager can unwrap
    result[prefixKey(namespace, key)] = meta
      ? { compute: wrapper, meta }
      : wrapper;
  }

  return nonEmpty(result);
}

/** Prefix event handler keys and wrap handlers with module-scoped proxies */
function prefixEventHandlers(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
): Record<string, unknown> | undefined {
  if (!mod.events) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(mod.events)) {
    // Unwrap { handler, meta } form
    const isObj =
      typeof raw === "object" && raw !== null && Object.hasOwn(raw, "handler");
    const handler = isObj ? (raw as { handler: Function }).handler : raw;
    const meta = isObj ? (raw as { meta?: unknown }).meta : undefined;

    const wrapper = (facts: unknown, event: unknown) => {
      const moduleFactsProxy = createModuleFactsProxy(
        facts as Record<string, unknown>,
        namespace,
      );
      // biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
      (handler as any)(moduleFactsProxy, event);
    };

    // Pass through as { handler, meta } so engine can extract meta
    result[prefixKey(namespace, key)] = meta
      ? { handler: wrapper, meta }
      : wrapper;
  }

  return nonEmpty(result);
}

/** Prefix constraint keys and wrap when/require with scoped proxies */
function prefixConstraints(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
  hasCrossModuleDeps: boolean,
  depNamespaces: string[],
): Record<string, unknown> | undefined {
  if (!mod.constraints) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, constraint] of Object.entries(mod.constraints)) {
    const constraintDef = constraint as {
      when: ((facts: unknown) => boolean | Promise<boolean>) | unknown;
      require: unknown | ((facts: unknown) => unknown);
      priority?: number;
      async?: boolean;
      timeout?: number;
      deps?: string[];
      after?: string[];
      owns?: readonly string[];
    };

    const isWhenFn = typeof constraintDef.when === "function";

    result[prefixKey(namespace, key)] = {
      ...constraintDef,
      deps: constraintDef.deps?.map((dep) => prefixKey(namespace, dep)),
      after: constraintDef.after?.map((dep) =>
        dep.includes(SEPARATOR) ? dep : prefixKey(namespace, dep),
      ),
      // RFC-0003: prefix `owns` fact keys so clobber-detection compares
      // against the namespaced fact slots that the resolver actually writes.
      // Without this, the bound proxy's `owned.has(prop)` check fails for
      // every namespaced owned write and the entire clobber-detection
      // feature silently no-ops in any namespaced system.
      owns: constraintDef.owns?.map((k) =>
        k.includes(SEPARATOR) ? k : prefixKey(namespace, k),
      ),
      // Data-form `when` was rewritten with prefixed keys in
      // `normalizePredicateDefs`, so the constraints manager can normalize
      // it against the flat keyspace. Only function-form `when` needs the
      // module-scoped proxy wrapper.
      when: isWhenFn
        ? (facts: unknown) => {
            const factsProxy = createScopedFactsProxy(
              facts as Record<string, unknown>,
              namespace,
              hasCrossModuleDeps,
              depNamespaces,
            );

            return (
              constraintDef.when as (
                facts: unknown,
              ) => boolean | Promise<boolean>
            )(factsProxy);
          }
        : constraintDef.when,
      require:
        typeof constraintDef.require === "function"
          ? (facts: unknown) => {
              const factsProxy = createScopedFactsProxy(
                facts as Record<string, unknown>,
                namespace,
                hasCrossModuleDeps,
                depNamespaces,
              );

              return (constraintDef.require as (facts: unknown) => unknown)(
                factsProxy,
              );
            }
          : constraintDef.require,
    };
  }

  return nonEmpty(result);
}

/** Prefix resolver keys and wrap resolve/resolveBatch/resolveBatchWithResults with scoped proxies */
function prefixResolvers(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
  hasCrossModuleDeps: boolean,
  depNamespaces: string[],
): Record<string, unknown> | undefined {
  if (!mod.resolvers) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, resolver] of Object.entries(mod.resolvers)) {
    const resolverDef = resolver as {
      requirement: string;
      resolve?: (
        req: unknown,
        ctx: { facts: unknown; signal: AbortSignal },
      ) => Promise<void>;
      resolveBatch?: (
        reqs: unknown[],
        ctx: { facts: unknown; signal: AbortSignal },
      ) => Promise<void>;
      resolveBatchWithResults?: (
        reqs: unknown[],
        ctx: { facts: unknown; signal: AbortSignal },
      ) => Promise<unknown>;
      key?: (req: unknown) => string;
      retry?: unknown;
      timeout?: number;
    };

    /** Wrap resolver ctx.facts with the module-scoped proxy */
    function wrapCtx(ctx: { facts: unknown; signal: AbortSignal }): {
      facts: unknown;
      signal: AbortSignal;
    } {
      return {
        facts: createScopedFactsProxy(
          ctx.facts as Record<string, unknown>,
          namespace,
          hasCrossModuleDeps,
          depNamespaces,
        ),
        signal: ctx.signal,
      };
    }

    result[prefixKey(namespace, key)] = {
      ...resolverDef,
      ...(resolverDef.resolve && {
        resolve: async (
          req: unknown,
          ctx: { facts: unknown; signal: AbortSignal },
        ) => {
          await resolverDef.resolve!(req, wrapCtx(ctx));
        },
      }),
      ...(resolverDef.resolveBatch && {
        resolveBatch: async (
          reqs: unknown[],
          ctx: { facts: unknown; signal: AbortSignal },
        ) => {
          await resolverDef.resolveBatch!(reqs, wrapCtx(ctx));
        },
      }),
      ...(resolverDef.resolveBatchWithResults && {
        resolveBatchWithResults: async (
          reqs: unknown[],
          ctx: { facts: unknown; signal: AbortSignal },
        ) => {
          return resolverDef.resolveBatchWithResults!(reqs, wrapCtx(ctx));
        },
      }),
    };
  }

  return nonEmpty(result);
}

/** Prefix effect keys and wrap run functions with scoped proxies */
function prefixEffects(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
  hasCrossModuleDeps: boolean,
  depNamespaces: string[],
): Record<string, unknown> | undefined {
  if (!mod.effects) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, effect] of Object.entries(mod.effects)) {
    const effectDef = effect as {
      // biome-ignore lint/suspicious/noExplicitAny: Effect run function type
      run: (facts: any, prev: any) => void | Promise<void>;
      deps?: string[];
    };

    result[prefixKey(namespace, key)] = {
      ...effectDef,
      // biome-ignore lint/suspicious/noExplicitAny: Effect run function wrapper
      run: (facts: any, prev: any) => {
        const factsProxy = createScopedFactsProxy(
          facts as Record<string, unknown>,
          namespace,
          hasCrossModuleDeps,
          depNamespaces,
        );
        const prevProxy = prev
          ? createScopedFactsProxy(
              prev as Record<string, unknown>,
              namespace,
              hasCrossModuleDeps,
              depNamespaces,
            )
          : undefined;

        return effectDef.run(factsProxy, prevProxy);
      },
      deps: effectDef.deps?.map((dep) => prefixKey(namespace, dep)),
    };
  }

  return nonEmpty(result);
}

/** Compute history config with prefixed snapshot events */
function prefixHistory(
  mod: ModuleDef<ModuleSchema>,
  namespace: string,
  snapshotModulesSet: Set<string> | null,
): { snapshotEvents?: string[] } {
  return {
    snapshotEvents:
      snapshotModulesSet && !snapshotModulesSet.has(namespace)
        ? [] // Module excluded from snapshots
        : mod.history?.snapshotEvents?.map((e: string) =>
            prefixKey(namespace, e),
          ),
  };
}

/**
 * Transform a module definition by prefixing all keys with a namespace.
 *
 * Handles: facts, derivations, events schema, init, derive, events handlers,
 * constraints (with deps/after), resolvers, and effects.
 *
 * @returns A flat module definition ready for the engine
 *
 * @internal
 */
export function prefixModuleDefinition(
  options: PrefixModuleOptions,
): FlatModuleDefinition {
  const { mod: rawMod, namespace, snapshotModulesSet } = options;

  // Normalize data-form definition arms before namespace prefixing so the
  // per-arm prefixers can assume function-shaped definitions (where they
  // wrap with module-scoped proxies) or already-prefixed data specs (where
  // the managers compile against the flat keyspace).
  const mod = normalizePredicateDefs(rawMod, namespace);

  // Compute cross-module deps info once (used by derive, constraints, effects)
  const hasCrossModuleDeps = !!(
    mod.crossModuleDeps && Object.keys(mod.crossModuleDeps).length > 0
  );
  const depNamespaces = hasCrossModuleDeps
    ? Object.keys(mod.crossModuleDeps!)
    : [];

  return {
    id: mod.id,
    schema: prefixSchema(mod, namespace),
    requirements: mod.schema.requirements ?? {},
    init: prefixInit(mod, namespace),
    derive: prefixDerive(mod, namespace, hasCrossModuleDeps, depNamespaces),
    events: prefixEventHandlers(mod, namespace),
    effects: prefixEffects(mod, namespace, hasCrossModuleDeps, depNamespaces),
    constraints: prefixConstraints(
      mod,
      namespace,
      hasCrossModuleDeps,
      depNamespaces,
    ),
    resolvers: prefixResolvers(
      mod,
      namespace,
      hasCrossModuleDeps,
      depNamespaces,
    ),
    hooks: mod.hooks,
    meta: mod.meta,
    history: prefixHistory(mod, namespace, snapshotModulesSet),
  };
}
