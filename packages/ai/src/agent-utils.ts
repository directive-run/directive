/**
 * Agent utilities — createRunner, estimateCost, state queries, URL validation.
 */

import type {
  AdapterHooks,
  AgentLike,
  AgentRunner,
  AgentState,
  ApprovalState,
  Message,
  RunOptions,
  RunResult,
  TokenUsage,
} from "./types.js";

// ============================================================================
// State Query Helpers
// ============================================================================

/**
 * Check whether an agent is currently executing a run.
 *
 * @param state - The current {@link AgentState} to inspect.
 * @returns `true` when the agent status is `"running"`.
 */
export function isAgentRunning(state: AgentState): boolean {
  return state.status === "running";
}

/**
 * Check whether there are tool-call approvals waiting for user confirmation.
 *
 * @param state - The current {@link ApprovalState} to inspect.
 * @returns `true` when one or more approvals are pending.
 */
export function hasPendingApprovals(state: ApprovalState): boolean {
  return state.pending.length > 0;
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Estimate the dollar cost of an agent run based on total token usage.
 *
 * @remarks
 * No default rate is provided — callers must supply the current per-million-token
 * price to avoid silently using stale pricing.
 *
 * @param tokenUsage - Total number of tokens consumed (input + output).
 * @param ratePerMillionTokens - Cost in dollars per one million tokens.
 * @returns Estimated cost in dollars.
 */
export function estimateCost(
  tokenUsage: number,
  ratePerMillionTokens: number,
): number {
  return (tokenUsage / 1_000_000) * ratePerMillionTokens;
}

// ============================================================================
// Validation Helpers
// ============================================================================

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate that a base URL uses the `http:` or `https:` protocol.
 * Throws immediately at adapter creation time (not at call time) to surface
 * configuration errors before any LLM requests are made.
 *
 * @param baseURL - The base URL string to validate.
 * @throws When the URL is malformed or uses a protocol other than `http:` or `https:`.
 */
export function validateBaseURL(baseURL: string): void {
  try {
    const url = new URL(baseURL);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      throw new Error(
        `[Directive] Invalid baseURL protocol "${url.protocol}" – only http: and https: are allowed`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[Directive]")) {
      throw err;
    }

    throw new Error(
      `[Directive] Invalid baseURL "${baseURL}" – must be a valid URL (e.g. "https://api.openai.com/v1")`,
    );
  }
}

// ============================================================================
// AbortSignal combination helper
// ============================================================================

/**
 * Combine multiple `AbortSignal`s into one — the resulting signal aborts
 * as soon as ANY input signal aborts. Falls back to a manual controller
 * wiring on runtimes without `AbortSignal.any` (Node < 20).
 *
 * @internal
 */
export function combineSignals(
  signals: ReadonlyArray<AbortSignal | undefined>,
): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];

  // Prefer the standard helper when available (Node 20.3+, modern browsers).
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn(live);
  }

  // Fallback: manual controller. If any input is already aborted, the
  // result is too — wire listeners for the rest.
  const controller = new AbortController();
  const already = live.find((s) => s.aborted);
  if (already) {
    controller.abort(
      (already as AbortSignal & { reason?: unknown }).reason ?? undefined,
    );

    return controller.signal;
  }
  for (const s of live) {
    s.addEventListener(
      "abort",
      () => {
        controller.abort(
          (s as AbortSignal & { reason?: unknown }).reason ?? undefined,
        );
      },
      { once: true },
    );
  }

  return controller.signal;
}

// ============================================================================
// createRunner Helper
// ============================================================================

/** Parsed response from an LLM provider */
export interface ParsedResponse {
  text: string;
  totalTokens: number;
  /** Input token count, when available from the provider */
  inputTokens?: number;
  /** Output token count, when available from the provider */
  outputTokens?: number;
  /** Prompt-cache read token count, when available from the provider */
  cacheReadTokens?: number;
  /** Prompt-cache creation token count, when available from the provider */
  cacheCreationTokens?: number;
}

/** Options for creating an AgentRunner from buildRequest/parseResponse */
export interface CreateRunnerOptions {
  fetch?: typeof globalThis.fetch;
  buildRequest: (
    agent: AgentLike,
    input: string,
    messages: Message[],
  ) => { url: string; init: RequestInit };
  parseResponse: (
    response: Response,
    messages: Message[],
  ) => Promise<ParsedResponse>;
  parseOutput?: <T>(text: string) => T;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
}

/**
 * Create an {@link AgentRunner} from `buildRequest`/`parseResponse` helpers, reducing
 * ~50 lines of fetch boilerplate to ~20 lines of configuration.
 *
 * @remarks
 * Supports lifecycle hooks for observability:
 * - `onBeforeCall` fires before each API request
 * - `onAfterCall` fires after a successful response (includes token breakdown)
 * - `onError` fires when the request fails
 *
 * Output parsing defaults to `JSON.parse` with a string fallback. Supply a custom
 * `parseOutput` to override (e.g. for structured output schemas).
 *
 * @param options - Configuration for the runner, including request building, response parsing, and hooks.
 * @returns An {@link AgentRunner} function that performs LLM calls via fetch.
 *
 * @example
 * ```typescript
 * const runClaude = createRunner({
 *   buildRequest: (agent, input) => ({
 *     url: "/api/claude",
 *     init: {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify({
 *         model: agent.model ?? "claude-haiku-4-5-20251001",
 *         system: agent.instructions ?? "",
 *         messages: [{ role: "user", content: input }],
 *       }),
 *     },
 *   }),
 *   parseResponse: async (res) => {
 *     const data = await res.json();
 *     const inputTokens = data.usage?.input_tokens ?? 0;
 *     const outputTokens = data.usage?.output_tokens ?? 0;
 *     return {
 *       text: data.content?.[0]?.text ?? "",
 *       totalTokens: inputTokens + outputTokens,
 *       inputTokens,
 *       outputTokens,
 *     };
 *   },
 *   hooks: {
 *     onAfterCall: ({ durationMs, tokenUsage }) => {
 *       console.log(`LLM call: ${durationMs}ms, ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
 *     },
 *   },
 * });
 * ```
 *
 * @public
 */
export function createRunner(options: CreateRunnerOptions): AgentRunner {
  const {
    fetch: fetchFn = globalThis.fetch,
    buildRequest,
    parseResponse,
    parseOutput,
    hooks,
  } = options;

  const defaultParseOutput = <T>(text: string): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  };

  const parse = parseOutput ?? defaultParseOutput;

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    runOptions?: RunOptions,
  ): Promise<RunResult<T>> => {
    const startTime = Date.now();
    hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

    const messages: Message[] = [{ role: "user", content: input }];

    try {
      const { url, init } = buildRequest(agent, input, messages);

      // (Sec MAJOR) Combine signals — `buildRequest` may set
      // `init.signal` (e.g. `AbortSignal.timeout(timeoutMs)`) and the
      // caller may pass their own via `runOptions.signal`. Naively
      // overwriting one with the other silently disables whichever was
      // dropped. `combineSignals` aborts as soon as either fires.
      const combined = combineSignals([
        init.signal ?? undefined,
        runOptions?.signal,
      ]);
      const fetchInit: RequestInit = combined
        ? { ...init, signal: combined }
        : init;

      const response = await fetchFn(url, fetchInit);

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");

        throw new Error(
          `[Directive] AgentRunner request failed: ${response.status} ${response.statusText}${errBody ? ` – ${errBody.slice(0, 300)}` : ""}`,
        );
      }

      const parsed = await parseResponse(response, messages);
      const tokenUsage: TokenUsage = {
        inputTokens: parsed.inputTokens ?? 0,
        outputTokens: parsed.outputTokens ?? 0,
        ...(parsed.cacheReadTokens != null
          ? { cacheReadTokens: parsed.cacheReadTokens }
          : {}),
        ...(parsed.cacheCreationTokens != null
          ? { cacheCreationTokens: parsed.cacheCreationTokens }
          : {}),
      };

      const assistantMessage: Message = {
        role: "assistant",
        content: parsed.text,
      };
      const allMessages: Message[] = [...messages, assistantMessage];

      runOptions?.onMessage?.(assistantMessage);

      const durationMs = Date.now() - startTime;
      hooks?.onAfterCall?.({
        agent,
        input,
        output: parsed.text,
        totalTokens: parsed.totalTokens,
        tokenUsage,
        durationMs,
        timestamp: Date.now(),
      });

      return {
        output: parse<T>(parsed.text),
        messages: allMessages,
        toolCalls: [],
        totalTokens: parsed.totalTokens,
        tokenUsage,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (err instanceof Error) {
        hooks?.onError?.({
          agent,
          input,
          error: err,
          durationMs,
          timestamp: Date.now(),
        });
      }

      throw err;
    }
  };
}
