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

/** Check if agent is currently running. */
export function isAgentRunning(state: AgentState): boolean {
  return state.status === "running";
}

/** Check if there are pending approvals. */
export function hasPendingApprovals(state: ApprovalState): boolean {
  return state.pending.length > 0;
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Get total cost estimate based on token usage.
 *
 * @param tokenUsage - Total token count
 * @param ratePerMillionTokens - Cost per million tokens (required, no default to avoid stale pricing)
 * @returns Estimated cost in dollars
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
 * Validate that a baseURL uses http or https.
 * Throws immediately at adapter creation time (not at call time) to catch config errors early.
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
 * Create an AgentRunner from buildRequest/parseResponse helpers.
 * Reduces ~50 lines of fetch boilerplate to ~20 lines of configuration.
 *
 * Supports lifecycle hooks for observability:
 * - `onBeforeCall` fires before each API request
 * - `onAfterCall` fires after a successful response (includes token breakdown)
 * - `onError` fires when the request fails
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

      const fetchInit: RequestInit = runOptions?.signal
        ? { ...init, signal: runOptions.signal }
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
