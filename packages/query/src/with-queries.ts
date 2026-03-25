/**
 * withQueries — Merge query definitions into a module config.
 *
 * This is the PRIMARY API for using queries. It takes an array of
 * QueryDefinition objects and a base module config, and returns a
 * merged config with all query fragments included.
 *
 * @module
 */

import type { QueryDefinition } from "./types.js";
import type { MutationDefinition } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: Module config shape varies
type ModuleConfig = Record<string, any>;

/**
 * Merge query and mutation definitions into a module config.
 *
 * @example
 * ```typescript
 * const module = createModule("app", withQueries([userQuery, postsQuery], {
 *   schema: { facts: { userId: t.string() } },
 *   init: (facts) => { facts.userId = ""; },
 *   events: { setUser: (facts, { id }) => { facts.userId = id; } },
 * }));
 * ```
 */
export function withQueries(
  // biome-ignore lint/suspicious/noExplicitAny: Query definitions have varying type params
  queries: (QueryDefinition<any> | MutationDefinition<any, any>)[],
  config: ModuleConfig,
): ModuleConfig {
  // Collect all fragments
  const allFacts: Record<string, unknown> = {};
  const allDerivations: Record<string, unknown> = {};
  const allRequirements: Record<string, Record<string, unknown>> = {};
  // biome-ignore lint/suspicious/noExplicitAny: Derive function signatures vary
  const allDerive: Record<string, (...args: any[]) => unknown> = {};
  const allConstraints: Record<string, unknown> = {};
  const allResolvers: Record<string, unknown> = {};
  const allEffects: Record<string, unknown> = {};
  // biome-ignore lint/suspicious/noExplicitAny: Init function signatures vary
  const inits: ((facts: any) => void)[] = [];

  for (const query of queries) {
    // Merge schema facts
    Object.assign(allFacts, query.schema.facts);
    Object.assign(allDerivations, query.schema.derivations);
    Object.assign(allRequirements, query.requirements);

    // Merge fragments
    Object.assign(allDerive, query.derive);
    Object.assign(allConstraints, query.constraints);
    Object.assign(allResolvers, query.resolvers);
    Object.assign(allEffects, query.effects);

    // Collect init functions
    inits.push(query.init);
  }

  // Merge with user's config
  const userSchema = config.schema ?? {};
  const userFacts = userSchema.facts ?? {};
  const userDerivations = userSchema.derivations ?? {};
  const userEvents = userSchema.events ?? {};
  const userRequirements = userSchema.requirements ?? {};

  // Build merged init
  const userInit = config.init;
  // biome-ignore lint/suspicious/noExplicitAny: Facts proxy type varies
  const mergedInit = (facts: any) => {
    // Run query inits first (set up default ResourceStates)
    for (const init of inits) {
      init(facts);
    }
    // Then run user init (may depend on query state)
    if (userInit) {
      userInit(facts);
    }
  };

  return {
    ...config,
    schema: {
      ...userSchema,
      facts: { ...userFacts, ...allFacts },
      derivations: { ...userDerivations, ...allDerivations },
      events: userEvents,
      requirements: { ...userRequirements, ...allRequirements },
    },
    init: mergedInit,
    derive: { ...(config.derive ?? {}), ...allDerive },
    constraints: { ...(config.constraints ?? {}), ...allConstraints },
    resolvers: { ...(config.resolvers ?? {}), ...allResolvers },
    effects: { ...(config.effects ?? {}), ...allEffects },
  };
}
