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
import type { ModuleDef, ModuleSchema, ModulesMap } from "./types.js";

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
  derive:
    | Record<string, (facts: unknown, derive: unknown) => unknown>
    | undefined;
  events: Record<string, (facts: unknown, event: unknown) => void> | undefined;
  effects: Record<string, unknown> | undefined;
  constraints: Record<string, unknown> | undefined;
  resolvers: Record<string, unknown> | undefined;
  hooks: ModuleDef<ModuleSchema>["hooks"];
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
  /** The full modules map (used by resolver facts proxy) */
  modulesMap: ModulesMap;
  /** Function returning current module names (used by namespaced proxies for ownKeys enumeration and dynamic registration) */
  getModuleNames: () => string[];
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

  // --- Schema prefixing ---

  const prefixedFacts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mod.schema.facts)) {
    prefixedFacts[`${namespace}${SEPARATOR}${key}`] = value;
  }

  // --- Init ---

  // biome-ignore lint/suspicious/noExplicitAny: Facts proxy type coercion
  const prefixedInit = mod.init
    ? (facts: any) => {
        const moduleFactsProxy = createModuleFactsProxy(facts, namespace);
        // biome-ignore lint/suspicious/noExplicitAny: Module init type coercion
        (mod.init as any)(moduleFactsProxy);
      }
    : undefined;

  // --- Derive ---

  const prefixedDerive: Record<
    string,
    (facts: unknown, derive: unknown) => unknown
  > = {};
  if (mod.derive) {
    for (const [key, fn] of Object.entries(mod.derive)) {
      prefixedDerive[`${namespace}${SEPARATOR}${key}`] = (
        facts: unknown,
        derive: unknown,
      ) => {
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
    }
  }

  // --- Event handlers ---

  const prefixedEventHandlers: Record<
    string,
    (facts: unknown, event: unknown) => void
  > = {};
  if (mod.events) {
    for (const [key, handler] of Object.entries(mod.events)) {
      prefixedEventHandlers[`${namespace}${SEPARATOR}${key}`] = (
        facts: unknown,
        event: unknown,
      ) => {
        const moduleFactsProxy = createModuleFactsProxy(
          facts as Record<string, unknown>,
          namespace,
        );
        // biome-ignore lint/suspicious/noExplicitAny: Event handler type coercion
        (handler as any)(moduleFactsProxy, event);
      };
    }
  }

  // --- Constraints ---

  const prefixedConstraints: Record<string, unknown> = {};
  if (mod.constraints) {
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

      prefixedConstraints[`${namespace}${SEPARATOR}${key}`] = {
        ...constraintDef,
        // Transform deps to use prefixed keys
        deps: constraintDef.deps?.map(
          (dep) => `${namespace}${SEPARATOR}${dep}`,
        ),
        // Transform after to use prefixed keys (same-module references)
        after: constraintDef.after?.map((dep) =>
          dep.includes(SEPARATOR) ? dep : `${namespace}${SEPARATOR}${dep}`,
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
  }

  // --- Resolvers ---

  const prefixedResolvers: Record<string, unknown> = {};
  if (mod.resolvers) {
    for (const [key, resolver] of Object.entries(mod.resolvers)) {
      const resolverDef = resolver as {
        requirement: string;
        resolve: (
          req: unknown,
          ctx: { facts: unknown; signal: AbortSignal },
        ) => Promise<void>;
        key?: (req: unknown) => string;
        retry?: unknown;
        timeout?: number;
      };

      prefixedResolvers[`${namespace}${SEPARATOR}${key}`] = {
        ...resolverDef,
        resolve: async (
          req: unknown,
          ctx: { facts: unknown; signal: AbortSignal },
        ) => {
          // Use the same scoped proxy as constraints/derive so resolvers
          // can access facts.self.* and facts.{dep}.* consistently
          const factsProxy = createScopedFactsProxy(
            ctx.facts as Record<string, unknown>,
            namespace,
            hasCrossModuleDeps,
            depNamespaces,
          );
          await resolverDef.resolve(req, {
            facts: factsProxy,
            signal: ctx.signal,
          });
        },
      };
    }
  }

  // --- Effects ---

  const prefixedEffects: Record<string, unknown> = {};
  if (mod.effects) {
    for (const [key, effect] of Object.entries(mod.effects)) {
      const effectDef = effect as {
        // biome-ignore lint/suspicious/noExplicitAny: Effect run function type
        run: (facts: any, prev: any) => void | Promise<void>;
        deps?: string[];
      };

      prefixedEffects[`${namespace}${SEPARATOR}${key}`] = {
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
        // Transform deps to use prefixed keys
        deps: effectDef.deps?.map((dep) => `${namespace}${SEPARATOR}${dep}`),
      };
    }
  }

  // --- History ---

  const history = {
    snapshotEvents:
      snapshotModulesSet && !snapshotModulesSet.has(namespace)
        ? [] // Module excluded from snapshots
        : mod.history?.snapshotEvents?.map(
            (e: string) => `${namespace}${SEPARATOR}${e}`,
          ),
  };

  return {
    id: mod.id,
    schema: prefixedFacts,
    requirements: mod.schema.requirements ?? {},
    init: prefixedInit,
    derive: Object.keys(prefixedDerive).length > 0 ? prefixedDerive : undefined,
    events:
      Object.keys(prefixedEventHandlers).length > 0
        ? prefixedEventHandlers
        : undefined,
    effects:
      Object.keys(prefixedEffects).length > 0 ? prefixedEffects : undefined,
    constraints:
      Object.keys(prefixedConstraints).length > 0
        ? prefixedConstraints
        : undefined,
    resolvers:
      Object.keys(prefixedResolvers).length > 0 ? prefixedResolvers : undefined,
    hooks: mod.hooks,
    history,
  };
}
