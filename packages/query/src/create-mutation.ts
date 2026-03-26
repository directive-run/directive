/**
 * createMutation — Generate resolver fragments for write operations with cache invalidation.
 *
 * Returns a MutationDefinition containing fragments that merge into a module
 * via `withQueries`. Supports optimistic updates via onMutate/onError/onSettled lifecycle.
 *
 * @module
 */

import { PREFIX, buildKey } from "./internal.js";
import type {
  MutationDefinition,
  MutationOptions,
  MutationState,
} from "./types.js";

function reqType(name: string): string {
  return `MUTATE_${name.toUpperCase()}`;
}

/** Create a default idle MutationState. */
export function createIdleMutationState<
  TData,
  TError = Error,
  TVariables = unknown,
>(): MutationState<TData, TError, TVariables> {
  return {
    status: "idle",
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: null,
    error: null,
    variables: null,
  };
}

// ============================================================================
// createMutation
// ============================================================================

/**
 * Create a mutation (write operation) with cache invalidation and optimistic update support.
 *
 * @example
 * ```typescript
 * const updateUser = createMutation({
 *   name: "updateUser",
 *   mutator: async (vars: { id: string; name: string }, signal) => {
 *     const res = await fetch(`/api/users/${vars.id}`, {
 *       method: "PATCH",
 *       body: JSON.stringify(vars),
 *       signal,
 *     });
 *     return res.json();
 *   },
 *   invalidateTags: ["users"],
 *   onMutate: (vars) => {
 *     // Return context for rollback
 *     return { previousName: system.derive.user?.data?.name };
 *   },
 *   onError: (error, vars, context) => {
 *     // Rollback using context
 *     console.error("Failed:", error);
 *   },
 * });
 * ```
 */
export function createMutation<
  TData,
  TVariables,
  TError = Error,
  TContext = unknown,
>(
  options: MutationOptions<TData, TVariables, TError, TContext>,
): MutationDefinition<TData, TVariables> {
  const {
    name,
    mutator,
    retry,
    invalidateTags,
    onMutate,
    onSuccess,
    onError,
    onSettled,
  } = options;

  // Deferred promises for mutateAsync — supports concurrent calls
  const pendingPromises = new Map<
    number,
    { resolve: (data: TData) => void; reject: (error: unknown) => void }
  >();

  function settleAll(action: "resolve" | "reject", value: unknown): void {
    for (const [id, deferred] of pendingPromises) {
      if (action === "resolve") {
        deferred.resolve(value as TData);
      } else {
        deferred.reject(value);
      }
      pendingPromises.delete(id);
    }
  }

  const stateKey = buildKey(name, "state");
  const varsKey = buildKey(name, "vars");
  const triggerKey = buildKey(name, "trigger");
  const requirementType = reqType(name);

  // Normalize retry
  const retryPolicy =
    typeof retry === "number"
      ? { attempts: retry, backoff: "exponential" as const }
      : retry;

  /** Build the MutationState derivation from internal facts. */
  function buildMutationState(
    facts: Record<string, unknown>,
  ): MutationState<TData, TError> {
    const state = facts[stateKey] as MutationState<TData, TError> | undefined;
    if (!state) {
      return createIdleMutationState<TData, TError>();
    }

    return state;
  }

  const definition: MutationDefinition<TData, TVariables> = {
    name,

    schema: {
      facts: {
        [stateKey]: { _type: null as unknown },
        [varsKey]: { _type: null as unknown },
        [triggerKey]: { _type: 0 as unknown },
      },
      derivations: {
        [name]: { _type: null as unknown },
      },
    },

    requirements: {
      [requirementType]: {},
    },

    init: (facts: Record<string, unknown>) => {
      facts[stateKey] = createIdleMutationState<TData, TError>();
      facts[varsKey] = null;
      facts[triggerKey] = 0;
    },

    derive: {
      [name]: buildMutationState,
    },

    constraints: {
      [`${PREFIX}${name}_trigger`]: {
        when: (facts: Record<string, unknown>) => {
          const trigger = facts[triggerKey] as number;

          return trigger > 0;
        },
        require: (facts: Record<string, unknown>) => ({
          type: requirementType,
          variables: facts[varsKey],
          triggeredAt: facts[triggerKey],
        }),
        priority: 80,
      },
    },

    resolvers: {
      [`${PREFIX}${name}_resolve`]: {
        requirement: requirementType,
        key: (req: Record<string, unknown>) =>
          `${requirementType}:${req.triggeredAt}`,
        retry: retryPolicy,
        resolve: async (
          req: Record<string, unknown>,
          context: { facts: Record<string, unknown>; signal: AbortSignal },
        ) => {
          const { facts, signal } = context;
          const variables = req.variables as TVariables;

          // Clear trigger to prevent re-fire
          facts[triggerKey] = 0;

          // Run onMutate (optimistic update)
          let mutateContext: TContext | undefined;
          if (onMutate) {
            try {
              mutateContext = await onMutate(variables);
            } catch (error) {
              // onMutate failure — reject pending promises and don't proceed
              settleAll("reject", error);

              return;
            }
          }

          // Set pending state
          facts[stateKey] = {
            status: "pending",
            isPending: true,
            isSuccess: false,
            isError: false,
            isIdle: false,
            data: null,
            error: null,
            variables,
          } satisfies MutationState<TData, TError, TVariables>;

          try {
            const data = await mutator(variables, signal);

            // Success
            facts[stateKey] = {
              status: "success",
              isPending: false,
              isSuccess: true,
              isError: false,
              isIdle: false,
              data,
              error: null,
              variables,
            } satisfies MutationState<TData, TError, TVariables>;

            // Resolve deferred mutateAsync promises
            settleAll("resolve", data);

            onSuccess?.(data, variables, mutateContext as TContext);
            onSettled?.(data, null, variables, mutateContext);

            // Tag invalidation — set trigger facts for matching queries
            if (invalidateTags && invalidateTags.length > 0) {
              // Tags are stored as a convention: $tags_invalidated fact
              // The tag system reads this in constraint evaluation
              const currentTags =
                (facts[`${PREFIX}tags_invalidated`] as string[] | undefined) ??
                [];
              const newTags = invalidateTags.map((tag) =>
                typeof tag === "string" ? tag : `${tag.type}:${tag.id ?? "*"}`,
              );
              facts[`${PREFIX}tags_invalidated`] = [...currentTags, ...newTags];
            }
          } catch (error) {
            if (signal.aborted) {
              settleAll(
                "reject",
                new DOMException("Mutation aborted", "AbortError"),
              );

              return;
            }

            const typedError = error as TError;

            facts[stateKey] = {
              status: "error",
              isPending: false,
              isSuccess: false,
              isError: true,
              isIdle: false,
              data: null,
              error: typedError,
              variables,
            } satisfies MutationState<TData, TError, TVariables>;

            // Reject deferred mutateAsync promises
            settleAll("reject", typedError);

            onError?.(typedError, variables, mutateContext);
            onSettled?.(undefined, typedError, variables, mutateContext);
          }
        },
      },
    },

    effects: {},

    // --- Imperative handles ---

    mutate: (facts: Record<string, unknown>, variables: TVariables) => {
      facts[varsKey] = variables;
      facts[triggerKey] = Date.now();
    },

    mutateAsync: (
      facts: Record<string, unknown>,
      variables: TVariables,
    ): Promise<TData> => {
      return new Promise<TData>((resolve, reject) => {
        const id = Date.now() + Math.random();
        pendingPromises.set(id, { resolve, reject });
        facts[varsKey] = variables;
        facts[triggerKey] = Date.now();
      });
    },

    reset: (facts: Record<string, unknown>) => {
      // Reject any pending mutateAsync promises
      settleAll(
        "reject",
        new Error(`[Directive] Mutation "${name}" was reset`),
      );
      facts[stateKey] = createIdleMutationState<TData, TError>();
      facts[varsKey] = null;
      facts[triggerKey] = 0;
    },
  };

  return definition;
}
