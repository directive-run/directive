/**
 * Module transformation for namespaced systems.
 *
 * Converts a module's unprefixed keys to prefixed internal format
 * (e.g., `token` → `auth::token`). Used by both the initial system
 * setup loop and `registerModule()`.
 *
 * @internal
 */

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
  events: Record<string, (facts: unknown, event: unknown) => void> | undefined;
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
): Record<string, (facts: unknown, event: unknown) => void> | undefined {
  if (!mod.events) {
    return undefined;
  }

  const result: Record<string, (facts: unknown, event: unknown) => void> = {};
  for (const [key, handler] of Object.entries(mod.events)) {
    result[prefixKey(namespace, key)] = (facts: unknown, event: unknown) => {
      const moduleFactsProxy = createModuleFactsProxy(
        facts as Record<string, unknown>,
        namespace,
      );
      // biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
      (handler as any)(moduleFactsProxy, event);
    };
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
      when: (facts: unknown) => boolean | Promise<boolean>;
      require: unknown | ((facts: unknown) => unknown);
      priority?: number;
      async?: boolean;
      timeout?: number;
      deps?: string[];
      after?: string[];
    };

    result[prefixKey(namespace, key)] = {
      ...constraintDef,
      deps: constraintDef.deps?.map((dep) => prefixKey(namespace, dep)),
      after: constraintDef.after?.map((dep) =>
        dep.includes(SEPARATOR) ? dep : prefixKey(namespace, dep),
      ),
      when: (facts: unknown) => {
        const factsProxy = createScopedFactsProxy(
          facts as Record<string, unknown>,
          namespace,
          hasCrossModuleDeps,
          depNamespaces,
        );

        return constraintDef.when(factsProxy);
      },
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
  const { mod, namespace, snapshotModulesSet } = options;

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
