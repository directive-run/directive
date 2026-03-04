/**
 * Constraint Templates - Pre-built patterns for common use cases
 *
 * These templates reduce boilerplate for frequently needed constraint patterns
 * like data fetching, polling, debouncing, and validation.
 */

import { forType } from "../core/requirements.js";
import type {
  ConstraintsDef,
  Facts,
  InferSchema,
  Requirement,
  ResolverContext,
  ResolversDef,
  Schema,
} from "../core/types.js";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Helper type for accessing facts by key with proper typing.
 * This provides type-safe access to fact values without excessive casting.
 */
type FactValue<S extends Schema, K extends keyof S> = InferSchema<S>[K];

/**
 * Type-safe fact getter
 */
function getFact<S extends Schema, K extends keyof S>(
  facts: Facts<S>,
  key: K,
): FactValue<S, K> | undefined {
  return facts[key] as FactValue<S, K> | undefined;
}

/**
 * Type-safe fact setter
 */
function setFact<S extends Schema, K extends keyof S>(
  facts: Facts<S>,
  key: K,
  value: FactValue<S, K> | null | undefined,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (facts as any)[key] = value;
}

// ============================================================================
// Data Fetching Constraint
// ============================================================================

export interface FetchConstraintOptions<
  S extends Schema,
  TData = unknown,
  TError = Error,
> {
  /** Unique ID for this fetch constraint */
  id: string;
  /** Key in facts where data should be stored */
  dataKey: keyof S;
  /** Key in facts for loading state (optional) */
  loadingKey?: keyof S;
  /** Key in facts for error state (optional) */
  errorKey?: keyof S;
  /** Condition for when to fetch (return true to trigger fetch) */
  when: (facts: Facts<S>) => boolean;
  /** The fetch function */
  fetch: (facts: Facts<S>, signal: AbortSignal) => Promise<TData>;
  /** Transform data before storing (optional) */
  transform?: (data: TData) => unknown;
  /** Custom error handler (optional) */
  onError?: (error: TError, facts: Facts<S>) => void;
  /** Retry configuration */
  retry?: {
    attempts?: number;
    backoff?: "none" | "linear" | "exponential";
  };
}

/**
 * Create a data fetching constraint with resolver.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createFetchConstraint({
 *   id: "fetchUser",
 *   dataKey: "user",
 *   loadingKey: "userLoading",
 *   errorKey: "userError",
 *   when: (facts) => facts.userId != null && !facts.user,
 *   fetch: async (facts, signal) => {
 *     const res = await fetch(`/api/users/${facts.userId}`, { signal });
 *     return res.json();
 *   },
 * });
 * ```
 */
export function createFetchConstraint<
  S extends Schema,
  TData = unknown,
  TError = Error,
>(
  options: FetchConstraintOptions<S, TData, TError>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    dataKey,
    loadingKey,
    errorKey,
    when,
    fetch: fetchFn,
    transform,
    onError,
    retry,
  } = options;

  const requirementType = `FETCH_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when,
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      retry: retry
        ? {
            attempts: retry.attempts ?? 3,
            backoff: retry.backoff ?? "exponential",
          }
        : undefined,
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;

        // Set loading state
        if (loadingKey) {
          setFact(facts, loadingKey, true as FactValue<S, typeof loadingKey>);
        }
        if (errorKey) {
          setFact(facts, errorKey, null);
        }

        try {
          const data = await fetchFn(facts, ctx.signal);
          const transformedData = transform ? transform(data) : data;
          setFact(
            facts,
            dataKey,
            transformedData as FactValue<S, typeof dataKey>,
          );
        } catch (error) {
          if (errorKey) {
            setFact(facts, errorKey, error as FactValue<S, typeof errorKey>);
          }
          if (onError) {
            onError(error as TError, facts);
          }
        } finally {
          if (loadingKey) {
            setFact(
              facts,
              loadingKey,
              false as FactValue<S, typeof loadingKey>,
            );
          }
        }
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Polling Constraint
// ============================================================================

export interface PollingConstraintOptions<S extends Schema> {
  /** Unique ID for this polling constraint */
  id: string;
  /** Interval in milliseconds */
  intervalMs: number;
  /** Key in facts to store last poll time */
  lastPollKey: keyof S;
  /** Condition for when polling should be active */
  when?: (facts: Facts<S>) => boolean;
  /** Action to perform on each poll */
  action: (facts: Facts<S>, signal: AbortSignal) => Promise<void> | void;
  /** Custom clock function for testability (default: Date.now) */
  clock?: () => number;
}

/**
 * Create a polling constraint that triggers periodically.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createPollingConstraint({
 *   id: "pollStatus",
 *   intervalMs: 5000,
 *   lastPollKey: "lastStatusPoll",
 *   when: (facts) => facts.isOnline,
 *   action: async (facts) => {
 *     const status = await fetchStatus();
 *     facts.status = status;
 *   },
 * });
 * ```
 */
export function createPollingConstraint<S extends Schema>(
  options: PollingConstraintOptions<S>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    intervalMs,
    lastPollKey,
    when,
    action,
    clock = Date.now,
  } = options;

  const requirementType = `POLL_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when: (facts) => {
        // Check custom condition
        if (when && !when(facts)) return false;

        // Check if enough time has passed
        const lastPoll = getFact(facts, lastPollKey) as number | undefined;
        if (lastPoll == null) return true;

        return clock() - lastPoll >= intervalMs;
      },
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        await action(ctx.facts, ctx.signal);
        setFact(
          ctx.facts,
          lastPollKey,
          clock() as FactValue<S, typeof lastPollKey>,
        );
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Debounced Constraint
// ============================================================================

export interface DebouncedConstraintOptions<S extends Schema> {
  /** Unique ID for this debounced constraint */
  id: string;
  /** Debounce delay in milliseconds */
  delayMs: number;
  /** Key in facts that triggers the debounce (when it changes) */
  watchKey: keyof S;
  /** Key in facts to store the timestamp when the value first changed (after last process) */
  firstChangeKey: keyof S;
  /** Key in facts to store last processed value (prevents re-processing) */
  processedValueKey: keyof S;
  /** Condition for when debounce should be active (optional) */
  when?: (facts: Facts<S>) => boolean;
  /** Action to perform after debounce period */
  action: (facts: Facts<S>, signal: AbortSignal) => Promise<void> | void;
  /** Custom clock function for testability (default: Date.now) */
  clock?: () => number;
}

/**
 * Create a debounced constraint that waits for a quiet period after
 * the watched value first changes.
 *
 * Unlike the previous implementation, this tracks when the value FIRST changed
 * (after the last processing), not when it last changed. This means rapid
 * changes won't keep resetting the timer - the action fires after delayMs
 * from the first change.
 *
 * The constraint automatically manages the firstChangeKey timestamp when
 * the watched value changes and differs from the processed value.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createDebouncedConstraint({
 *   id: "saveSearch",
 *   delayMs: 300,
 *   watchKey: "searchQuery",
 *   firstChangeKey: "searchFirstChange",
 *   processedValueKey: "lastProcessedQuery",
 *   action: async (facts) => {
 *     facts.searchResults = await search(facts.searchQuery);
 *   },
 * });
 *
 * // In your module's events - just update the value, constraint handles timing:
 * events: {
 *   setSearchQuery: (facts, event) => {
 *     facts.searchQuery = event.query;
 *   },
 * }
 * ```
 */
export function createDebouncedConstraint<S extends Schema>(
  options: DebouncedConstraintOptions<S>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    delayMs,
    watchKey,
    firstChangeKey,
    processedValueKey,
    when,
    action,
    clock = Date.now,
  } = options;

  const requirementType = `DEBOUNCED_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when: (facts) => {
        // Check custom condition
        if (when && !when(facts)) return false;

        // Get current and processed values
        const value = getFact(facts, watchKey);
        if (value == null) return false;

        const processedValue = getFact(facts, processedValueKey);

        // If value matches processed, nothing to do
        if (value === processedValue) return false;

        // Check/set first change timestamp
        let firstChange = getFact(facts, firstChangeKey) as number | undefined;

        // If no first change recorded, this is a new change - record it
        // (This happens inside when() which is tracked, so it updates the fact)
        if (firstChange == null) {
          setFact(
            facts,
            firstChangeKey,
            clock() as FactValue<S, typeof firstChangeKey>,
          );
          firstChange = getFact(facts, firstChangeKey) as number;
        }

        // Check if enough time has passed since first change
        return clock() - firstChange >= delayMs;
      },
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;

        // Store current value as processed (before action)
        const currentValue = getFact(facts, watchKey);
        setFact(
          facts,
          processedValueKey,
          currentValue as FactValue<S, typeof processedValueKey>,
        );

        // Clear first change timestamp (next change will start a new debounce)
        setFact(facts, firstChangeKey, null);

        await action(facts, ctx.signal);
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Throttle Constraint
// ============================================================================

export interface ThrottleConstraintOptions<S extends Schema> {
  /** Unique ID for this throttle constraint */
  id: string;
  /** Minimum interval between executions in milliseconds */
  intervalMs: number;
  /** Key in facts to store last execution timestamp */
  lastExecutionKey: keyof S;
  /** Condition for when throttle should trigger (return true to attempt execution) */
  when: (facts: Facts<S>) => boolean;
  /** Action to perform (will be throttled) */
  action: (facts: Facts<S>, signal: AbortSignal) => Promise<void> | void;
  /** Custom clock function for testability (default: Date.now) */
  clock?: () => number;
}

/**
 * Create a throttle constraint that limits execution frequency.
 *
 * Unlike debounce (which waits for quiet period), throttle executes immediately
 * on first trigger, then ignores subsequent triggers until the interval passes.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createThrottleConstraint({
 *   id: "rateLimitedApi",
 *   intervalMs: 1000, // Max 1 call per second
 *   lastExecutionKey: "lastApiCall",
 *   when: (facts) => facts.pendingRequest != null,
 *   action: async (facts, signal) => {
 *     const result = await fetch("/api/data", { signal });
 *     facts.data = await result.json();
 *     facts.pendingRequest = null;
 *   },
 * });
 * ```
 */
export function createThrottleConstraint<S extends Schema>(
  options: ThrottleConstraintOptions<S>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    intervalMs,
    lastExecutionKey,
    when,
    action,
    clock = Date.now,
  } = options;

  const requirementType = `THROTTLE_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when: (facts) => {
        // Check custom condition first
        if (!when(facts)) return false;

        // Check if enough time has passed since last execution
        const lastExecution = getFact(facts, lastExecutionKey) as
          | number
          | undefined;
        if (lastExecution == null) return true;

        return clock() - lastExecution >= intervalMs;
      },
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        // Record execution time immediately (throttle pattern)
        setFact(
          ctx.facts,
          lastExecutionKey,
          clock() as FactValue<S, typeof lastExecutionKey>,
        );
        await action(ctx.facts, ctx.signal);
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Validation Constraint
// ============================================================================

export interface ValidationRule<S extends Schema> {
  /** Rule ID (used in error messages) */
  id: string;
  /** Validation function - return true if valid */
  validate: (facts: Facts<S>) => boolean;
  /** Error message if validation fails */
  message: string;
  /** Severity level */
  severity?: "error" | "warning";
}

export interface ValidationConstraintOptions<S extends Schema> {
  /** Unique ID for this validation constraint */
  id: string;
  /** Key in facts to store validation errors */
  errorsKey: keyof S;
  /** Key in facts to store validation state (valid/invalid) */
  validKey?: keyof S;
  /** Key in facts to store last validation hash (prevents infinite loops) */
  hashKey?: keyof S;
  /** Keys to watch for changes (triggers re-validation) */
  watchKeys: Array<keyof S>;
  /** Validation rules to apply */
  rules: ValidationRule<S>[];
  /** Only validate when this condition is true (optional) */
  when?: (facts: Facts<S>) => boolean;
}

export interface ValidationError {
  ruleId: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Create a validation constraint that checks multiple rules.
 *
 * The constraint only triggers when watched keys change, preventing infinite loops.
 * It computes a hash of watched values and compares with the previous hash.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createValidationConstraint({
 *   id: "formValidation",
 *   errorsKey: "formErrors",
 *   validKey: "formValid",
 *   hashKey: "formValidationHash", // Tracks what was validated
 *   watchKeys: ["email", "password"], // Only re-validate when these change
 *   rules: [
 *     {
 *       id: "emailRequired",
 *       validate: (facts) => (facts.email as string)?.length > 0,
 *       message: "Email is required",
 *     },
 *     {
 *       id: "emailFormat",
 *       validate: (facts) => /\S+@\S+/.test((facts.email as string) ?? ""),
 *       message: "Invalid email format",
 *     },
 *   ],
 * });
 * ```
 */
export function createValidationConstraint<S extends Schema>(
  options: ValidationConstraintOptions<S>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const { id, errorsKey, validKey, hashKey, watchKeys, rules, when } = options;

  const requirementType = `VALIDATE_${id.toUpperCase()}` as const;

  /** Compute a simple hash of watched values */
  function computeHash(facts: Facts<S>): string {
    const values = watchKeys.map((key) => {
      const val = getFact(facts, key);
      return JSON.stringify(val);
    });
    return values.join("|");
  }

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when: (facts) => {
        // Check custom condition
        if (when && !when(facts)) return false;

        // Compute current hash of watched values
        const currentHash = computeHash(facts);

        // If we track hash, check if values changed since last validation
        if (hashKey) {
          const lastHash = getFact(facts, hashKey) as string | undefined;
          if (lastHash === currentHash) return false; // Already validated this state
        }

        return true;
      },
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;

        // Store current hash before validation (prevents re-triggering)
        if (hashKey) {
          const currentHash = computeHash(facts);
          setFact(facts, hashKey, currentHash as FactValue<S, typeof hashKey>);
        }

        const errors: ValidationError[] = [];

        for (const rule of rules) {
          if (!rule.validate(facts)) {
            errors.push({
              ruleId: rule.id,
              message: rule.message,
              severity: rule.severity ?? "error",
            });
          }
        }

        setFact(facts, errorsKey, errors as FactValue<S, typeof errorsKey>);

        if (validKey) {
          const hasErrors = errors.some((e) => e.severity === "error");
          setFact(facts, validKey, !hasErrors as FactValue<S, typeof validKey>);
        }
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Retry Until Success Constraint
// ============================================================================

export interface RetryUntilSuccessOptions<S extends Schema, TResult = unknown> {
  /** Unique ID for this constraint */
  id: string;
  /** Condition for when to start retrying */
  when: (facts: Facts<S>) => boolean;
  /** The operation to retry */
  operation: (facts: Facts<S>, signal: AbortSignal) => Promise<TResult>;
  /** Check if the result is successful */
  isSuccess: (result: TResult, facts: Facts<S>) => boolean;
  /** Maximum attempts before giving up */
  maxAttempts?: number;
  /** Delay between retries in milliseconds */
  delayMs?: number;
  /** Key to store the result */
  resultKey?: keyof S;
  /** Key to store attempt count */
  attemptKey?: keyof S;
}

/**
 * Create a constraint that retries an operation until it succeeds.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createRetryUntilSuccess({
 *   id: "waitForReady",
 *   when: (facts) => facts.status === "initializing",
 *   operation: async (facts) => await checkStatus(),
 *   isSuccess: (result) => result.ready === true,
 *   maxAttempts: 10,
 *   delayMs: 1000,
 *   resultKey: "readyResult",
 * });
 * ```
 */
export function createRetryUntilSuccess<S extends Schema, TResult = unknown>(
  options: RetryUntilSuccessOptions<S, TResult>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    when,
    operation,
    isSuccess,
    maxAttempts = 10,
    delayMs = 1000,
    resultKey,
    attemptKey,
  } = options;

  const requirementType = `RETRY_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when,
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      retry: {
        attempts: maxAttempts,
        backoff: "none",
        initialDelay: delayMs,
      },
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;

        if (attemptKey) {
          const current = (getFact(facts, attemptKey) as number) ?? 0;
          setFact(
            facts,
            attemptKey,
            (current + 1) as FactValue<S, typeof attemptKey>,
          );
        }

        const result = await operation(facts, ctx.signal);

        if (resultKey) {
          setFact(facts, resultKey, result as FactValue<S, typeof resultKey>);
        }

        if (!isSuccess(result, facts)) {
          throw new Error("Operation not yet successful");
        }
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// Optimistic Update Constraint
// ============================================================================

export interface OptimisticUpdateOptions<
  S extends Schema,
  TPayload = unknown,
  TResult = unknown,
> {
  /** Unique ID for this constraint */
  id: string;
  /** Condition for when to trigger the update */
  when: (facts: Facts<S>) => boolean;
  /** Get the pending payload from facts */
  getPayload: (facts: Facts<S>) => TPayload | null;
  /** Apply optimistic update immediately (before server response) */
  applyOptimistic: (facts: Facts<S>, payload: TPayload) => void;
  /** Perform the actual async operation */
  perform: (
    payload: TPayload,
    facts: Facts<S>,
    signal: AbortSignal,
  ) => Promise<TResult>;
  /** Apply server response (may differ from optimistic) */
  applyResult: (facts: Facts<S>, result: TResult, payload: TPayload) => void;
  /** Rollback on error - restore to previous state */
  rollback: (facts: Facts<S>, payload: TPayload, error: Error) => void;
  /** Key to clear pending payload after processing */
  pendingKey: keyof S;
  /** Key to track in-flight request */
  inflightKey?: keyof S;
}

/**
 * Create an optimistic update constraint for immediate UI feedback.
 *
 * This pattern applies changes immediately (optimistically), then reconciles
 * with the server response. On error, it rolls back the optimistic changes.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createOptimisticUpdate({
 *   id: "updateTodo",
 *   when: (facts) => facts.pendingTodoUpdate != null,
 *   getPayload: (facts) => facts.pendingTodoUpdate,
 *   applyOptimistic: (facts, payload) => {
 *     // Immediately update UI
 *     facts.todos = facts.todos.map(t =>
 *       t.id === payload.id ? { ...t, ...payload.changes } : t
 *     );
 *   },
 *   perform: async (payload, facts, signal) => {
 *     return await api.updateTodo(payload.id, payload.changes, { signal });
 *   },
 *   applyResult: (facts, result) => {
 *     // Server may have normalized data
 *     facts.todos = facts.todos.map(t =>
 *       t.id === result.id ? result : t
 *     );
 *   },
 *   rollback: (facts, payload, error) => {
 *     // Restore original todo
 *     facts.todos = facts.todos.map(t =>
 *       t.id === payload.id ? payload.original : t
 *     );
 *     facts.error = error.message;
 *   },
 *   pendingKey: "pendingTodoUpdate",
 * });
 * ```
 */
export function createOptimisticUpdate<
  S extends Schema,
  TPayload = unknown,
  TResult = unknown,
>(
  options: OptimisticUpdateOptions<S, TPayload, TResult>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
} {
  const {
    id,
    when,
    getPayload,
    applyOptimistic,
    perform,
    applyResult,
    rollback,
    pendingKey,
    inflightKey,
  } = options;

  const requirementType = `OPTIMISTIC_${id.toUpperCase()}` as const;

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when,
      require: { type: requirementType },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (_req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;
        const payload = getPayload(facts);
        if (payload == null) return;

        // Clear pending immediately to prevent re-triggering
        setFact(facts, pendingKey, null);

        // Mark as inflight
        if (inflightKey) {
          setFact(facts, inflightKey, true as FactValue<S, typeof inflightKey>);
        }

        // Apply optimistic update immediately
        applyOptimistic(facts, payload);

        try {
          const result = await perform(payload, facts, ctx.signal);
          applyResult(facts, result, payload);
        } catch (error) {
          // Rollback on error
          rollback(
            facts,
            payload,
            error instanceof Error ? error : new Error(String(error)),
          );
        } finally {
          if (inflightKey) {
            setFact(
              facts,
              inflightKey,
              false as FactValue<S, typeof inflightKey>,
            );
          }
        }
      },
    },
  };

  return { constraints, resolvers };
}

// ============================================================================
// AI Agent Constraint (for LLM tool calling)
// ============================================================================

export interface AgentToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Tool name (used in LLM function calling) */
  name: string;
  /** Description for the LLM */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;
  /** Execute the tool */
  execute: (input: TInput, signal: AbortSignal) => Promise<TOutput>;
}

export interface AgentConstraintOptions<S extends Schema> {
  /** Unique ID for this agent constraint */
  id: string;
  /** Key storing the pending tool call request */
  requestKey: keyof S;
  /** Key to store tool call result */
  resultKey: keyof S;
  /** Key to store error if tool call fails */
  errorKey?: keyof S;
  /** Key to track loading state */
  loadingKey?: keyof S;
  /** Available tools the agent can call */
  tools: AgentToolDefinition[];
  /** Validate tool input before execution (optional) */
  validateInput?: (toolName: string, input: unknown) => boolean;
  /** Transform result before storing (optional) */
  transformResult?: (toolName: string, result: unknown) => unknown;
}

export interface AgentToolRequest {
  /** Tool name to execute */
  tool: string;
  /** Input parameters for the tool */
  input: unknown;
  /** Request ID for tracking */
  requestId?: string;
}

export interface AgentToolResult {
  /** Request ID if provided */
  requestId?: string;
  /** Tool name that was executed */
  tool: string;
  /** Tool output */
  output: unknown;
  /** Whether execution succeeded */
  success: boolean;
}

/**
 * Create a constraint for AI agent tool calling.
 *
 * This pattern handles LLM function/tool calling with validation,
 * error handling, and result transformation.
 *
 * @example
 * ```typescript
 * const { constraints, resolvers } = createAgentConstraint({
 *   id: "agentTools",
 *   requestKey: "pendingToolCall",
 *   resultKey: "toolResult",
 *   errorKey: "toolError",
 *   loadingKey: "toolLoading",
 *   tools: [
 *     {
 *       name: "search",
 *       description: "Search the web for information",
 *       inputSchema: { type: "object", properties: { query: { type: "string" } } },
 *       execute: async (input) => await searchApi(input.query),
 *     },
 *     {
 *       name: "calculate",
 *       description: "Perform mathematical calculations",
 *       inputSchema: { type: "object", properties: { expression: { type: "string" } } },
 *       execute: async (input) => eval(input.expression), // Use a safe evaluator!
 *     },
 *   ],
 * });
 *
 * // In your LLM handler:
 * function handleLLMToolCall(toolCall) {
 *   system.facts.pendingToolCall = {
 *     tool: toolCall.name,
 *     input: toolCall.arguments,
 *     requestId: toolCall.id,
 *   };
 * }
 * ```
 */
export function createAgentConstraint<S extends Schema>(
  options: AgentConstraintOptions<S>,
): {
  constraints: ConstraintsDef<S>;
  resolvers: ResolversDef<S>;
  /** Get tool definitions for LLM function calling */
  getToolDefinitions: () => Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
} {
  const {
    id,
    requestKey,
    resultKey,
    errorKey,
    loadingKey,
    tools,
    validateInput,
    transformResult,
  } = options;

  const requirementType = `AGENT_TOOL_${id.toUpperCase()}` as const;
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const constraints: ConstraintsDef<S> = {
    [id]: {
      when: (facts) => {
        const request = getFact(facts, requestKey) as AgentToolRequest | null;
        return request != null && request.tool != null;
      },
      require: (facts) => {
        const request = getFact(facts, requestKey) as AgentToolRequest;
        return {
          type: requirementType,
          tool: request.tool,
          input: request.input,
          requestId: request.requestId,
        };
      },
    },
  };

  const resolvers: ResolversDef<S> = {
    [id]: {
      requirement: forType(requirementType),
      resolve: async (req: Requirement, ctx: ResolverContext<S>) => {
        const { facts } = ctx;
        const toolReq = req as Requirement & AgentToolRequest;

        // Clear pending request
        setFact(facts, requestKey, null);

        // Set loading state
        if (loadingKey) {
          setFact(facts, loadingKey, true as FactValue<S, typeof loadingKey>);
        }
        if (errorKey) {
          setFact(facts, errorKey, null);
        }

        const tool = toolMap.get(toolReq.tool);
        if (!tool) {
          const error = `Unknown tool: ${toolReq.tool}. Available: ${[...toolMap.keys()].join(", ")}`;
          if (errorKey) {
            setFact(facts, errorKey, error as FactValue<S, typeof errorKey>);
          }
          setFact(facts, resultKey, {
            requestId: toolReq.requestId,
            tool: toolReq.tool,
            output: null,
            success: false,
          } as FactValue<S, typeof resultKey>);
          return;
        }

        // Validate input
        if (validateInput && !validateInput(toolReq.tool, toolReq.input)) {
          const error = `Invalid input for tool: ${toolReq.tool}`;
          if (errorKey) {
            setFact(facts, errorKey, error as FactValue<S, typeof errorKey>);
          }
          setFact(facts, resultKey, {
            requestId: toolReq.requestId,
            tool: toolReq.tool,
            output: null,
            success: false,
          } as FactValue<S, typeof resultKey>);
          return;
        }

        try {
          let output = await tool.execute(toolReq.input, ctx.signal);

          // Transform result if configured
          if (transformResult) {
            output = transformResult(toolReq.tool, output) as Awaited<
              ReturnType<typeof tool.execute>
            >;
          }

          const result: AgentToolResult = {
            requestId: toolReq.requestId,
            tool: toolReq.tool,
            output,
            success: true,
          };
          setFact(facts, resultKey, result as FactValue<S, typeof resultKey>);
        } catch (error) {
          if (errorKey) {
            setFact(
              facts,
              errorKey,
              (error instanceof Error
                ? error.message
                : String(error)) as FactValue<S, typeof errorKey>,
            );
          }
          setFact(facts, resultKey, {
            requestId: toolReq.requestId,
            tool: toolReq.tool,
            output: null,
            success: false,
          } as FactValue<S, typeof resultKey>);
        } finally {
          if (loadingKey) {
            setFact(
              facts,
              loadingKey,
              false as FactValue<S, typeof loadingKey>,
            );
          }
        }
      },
    },
  };

  /** Get tool definitions in a format suitable for LLM function calling */
  function getToolDefinitions() {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }

  return { constraints, resolvers, getToolDefinitions };
}
