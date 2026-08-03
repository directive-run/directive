/**
 * withQueries — Merge query definitions into a module config.
 *
 * This is the PRIMARY API for using queries. It takes an array of
 * QueryDefinition objects and a base module config, and returns a
 * merged config with all query fragments included.
 *
 * @module
 */

import type { InfiniteQueryDefinition } from "./create-infinite-query.js";
import type { SubscriptionDefinition } from "./create-subscription.js";
import { PREFIX } from "./internal.js";
import type { QueryDefinition } from "./types.js";
import type { MutationDefinition } from "./types.js";

type ModuleConfig = Record<string, any>;

export type AnyQueryDefinition =
  | QueryDefinition<any>
  | MutationDefinition<any, any>
  | InfiniteQueryDefinition
  | SubscriptionDefinition<any>;

const TAGS_INVALIDATED_KEY = `${PREFIX}tags_invalidated`;

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
/** Normalize a tag to a comparable string. */
function normalizeTag(
  tag: string | { type: string; id?: string | number },
): string {
  if (typeof tag === "string") {
    return tag;
  }

  return tag.id !== undefined ? `${tag.type}:${tag.id}` : tag.type;
}

/** Check if an invalidation tag matches a query tag. */
function tagMatches(invalidatedTag: string, queryTag: string): boolean {
  if (invalidatedTag === queryTag) {
    return true;
  }

  // Wildcard: invalidating "users:*" matches "users" and "users:42"
  if (invalidatedTag.endsWith(":*")) {
    const prefix = invalidatedTag.slice(0, -2);

    return queryTag === prefix || queryTag.startsWith(`${prefix}:`);
  }

  // Invalidating "users" (no id) matches "users:42" (any id)
  if (
    !invalidatedTag.includes(":") &&
    queryTag.startsWith(`${invalidatedTag}:`)
  ) {
    return true;
  }

  return false;
}

export function withQueries(
  queries: AnyQueryDefinition[],
  config: ModuleConfig,
): ModuleConfig {
  // Detect duplicate names
  const seenNames = new Set<string>();
  for (const query of queries) {
    if (seenNames.has(query.name)) {
      throw new Error(
        `[Directive] Query name "${query.name}" is already registered. Each query, mutation, subscription, and infinite query must have a unique name.`,
      );
    }
    seenNames.add(query.name);
  }

  // Collect all fragments
  const allFacts: Record<string, unknown> = {};
  const allDerivations: Record<string, unknown> = {};
  const allRequirements: Record<string, Record<string, unknown>> = {};
  const allDerive: Record<string, (...args: any[]) => unknown> = {};
  const allConstraints: Record<string, unknown> = {};
  const allResolvers: Record<string, unknown> = {};
  const allEffects: Record<string, unknown> = {};
  const inits: ((facts: any) => void)[] = [];

  // Track queries with tags for tag-based invalidation
  const taggedQueries: {
    name: string;
    tags:
      | string[]
      | ((
          data: unknown,
        ) => (string | { type: string; id?: string | number })[]);
  }[] = [];
  let hasMutationsWithTags = false;
  /**
   * Teardown callbacks a query asked to have run at system stop.
   *
   * Separate from effect cleanups because they mean a different thing: a
   * cleanup fires before every re-run of its effect, and these fire only when
   * the system is actually going away.
   */
  const stops: Array<() => void> = [];

  for (const query of queries) {
    // Merge schema facts
    Object.assign(allFacts, query.schema.facts);
    Object.assign(allDerivations, query.schema.derivations);
    if (query.requirements) {
      Object.assign(allRequirements, query.requirements);
    }

    // Merge fragments
    if (query.derive) {
      Object.assign(allDerive, query.derive);
    }
    if (query.constraints) {
      Object.assign(allConstraints, query.constraints);
    }
    if (query.resolvers) {
      Object.assign(allResolvers, query.resolvers);
    }
    if (query.effects) {
      Object.assign(allEffects, query.effects);
    }
    if (typeof (query as { onStop?: () => void }).onStop === "function") {
      stops.push((query as { onStop: () => void }).onStop);
    }

    // Collect init functions
    inits.push(query.init);

    // Track tags for invalidation wiring
    if ("tags" in query && query.tags) {
      taggedQueries.push({ name: query.name, tags: query.tags as string[] });
    }
    if ("mutate" in query) {
      hasMutationsWithTags = true;
    }
  }

  // Wire up tag-based invalidation if we have both tagged queries and mutations
  if (taggedQueries.length > 0 && hasMutationsWithTags) {
    allFacts[TAGS_INVALIDATED_KEY] = { _type: null as unknown };

    // Add a constraint that watches the invalidated tags and triggers matching queries
    allConstraints[`${PREFIX}tag_invalidation`] = {
      when: (facts: Record<string, unknown>) => {
        const tags = facts[TAGS_INVALIDATED_KEY] as string[] | undefined;

        return tags !== undefined && tags !== null && tags.length > 0;
      },
      require: (facts: Record<string, unknown>) => ({
        type: `${PREFIX}TAG_INVALIDATE`,
        tags: facts[TAGS_INVALIDATED_KEY],
      }),
      priority: 90,
    };

    allRequirements[`${PREFIX}TAG_INVALIDATE`] = {};

    allResolvers[`${PREFIX}tag_invalidation_resolve`] = {
      requirement: `${PREFIX}TAG_INVALIDATE`,
      key: () => `${PREFIX}tag_invalidation:${Date.now()}`,
      resolve: (
        req: Record<string, unknown>,
        context: { facts: Record<string, unknown> },
      ) => {
        const { facts } = context;
        const invalidatedTags = req.tags as string[];

        // Atomic batching prevents a torn read where a subscriber sees the
        // cleared invalidation list before the matching trigger writes
        // land. Without the batch the resolver writes one fact at a time
        // and the reactive flush runs between every write, so any
        // listener subscribed to both keys would observe a half-applied
        // step (tags cleared but triggers not yet fired, or vice versa).
        const store = (
          facts as { $store?: { batch: (fn: () => void) => void } }
        ).$store;
        const apply = () => {
          // Clear the invalidation list immediately
          facts[TAGS_INVALIDATED_KEY] = [];

          // Match against each tagged query
          for (const { name: queryName, tags } of taggedQueries) {
            const queryTags: string[] =
              typeof tags === "function"
                ? (
                    tags(
                      (
                        facts[`${PREFIX}${queryName}_state`] as {
                          data?: unknown;
                        }
                      )?.data,
                    ) as (string | { type: string; id?: string | number })[]
                  ).map(normalizeTag)
                : tags;

            const matched = invalidatedTags.some((invTag) =>
              queryTags.some((qTag) => tagMatches(invTag, qTag)),
            );

            if (matched) {
              // Trigger refetch by setting the query's trigger
              facts[`${PREFIX}${queryName}_trigger`] = Date.now();
            }
          }
        };
        if (store) {
          store.batch(apply);
        } else {
          // Defensive: if $store isn't accessible (e.g. namespaced system
          // path), fall back to direct writes. Behaviour matches the
          // pre-batch implementation.
          apply();
        }
      },
    };

    // Add init for the tags fact
    inits.push((facts: Record<string, unknown>) => {
      facts[TAGS_INVALIDATED_KEY] = [];
    });
  }

  // Merge with user's config
  const userSchema = config.schema ?? {};
  const userFacts = userSchema.facts ?? {};
  const userDerivations = userSchema.derivations ?? {};
  const userEvents = userSchema.events ?? {};
  const userRequirements = userSchema.requirements ?? {};

  // Build merged init
  const userInit = config.init;
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

  // Module hooks, with the queries' teardowns appended to whatever the caller
  // declared. Runs after `effectsManager.cleanupAll()`, which is what lets a
  // subscription's cleanup mark rather than abort.
  const userHooks = (
    config as { hooks?: { onStop?: (system: unknown) => void } }
  ).hooks;
  const mergedHooks =
    stops.length === 0
      ? userHooks
      : {
          ...userHooks,
          onStop: (system: unknown) => {
            userHooks?.onStop?.(system);
            for (const stop of stops) {
              stop();
            }
          },
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
    hooks: mergedHooks,
  };
}
