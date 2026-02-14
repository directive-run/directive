/**
 * Helper functions for AI adapter — createRunner, estimateCost, state queries.
 */

import type {
  AgentLike,
  AgentRunner,
  RunResult,
  RunOptions,
  Message,
  AgentState,
  ApprovalState,
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
  ratePerMillionTokens: number
): number {
  return (tokenUsage / 1_000_000) * ratePerMillionTokens;
}

// ============================================================================
// createRunner Helper
// ============================================================================

/** Options for creating a AgentRunner from buildRequest/parseResponse */
export interface CreateRunnerOptions {
  fetch?: typeof globalThis.fetch;
  buildRequest: (
    agent: AgentLike,
    input: string,
    messages: Message[]
  ) => { url: string; init: RequestInit };
  parseResponse: (
    response: Response,
    messages: Message[]
  ) => Promise<{ text: string; totalTokens: number }>;
  parseOutput?: <T>(text: string) => T;
}

/**
 * Create a AgentRunner from buildRequest/parseResponse helpers.
 * Reduces ~50 lines of fetch boilerplate to ~20 lines of configuration.
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
 *     return {
 *       text: data.content?.[0]?.text ?? "",
 *       totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
 *     };
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
    runOptions?: RunOptions
  ): Promise<RunResult<T>> => {
    const messages: Message[] = [{ role: "user", content: input }];
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

    const { text, totalTokens } = await parseResponse(response, messages);

    const assistantMessage: Message = { role: "assistant", content: text };
    const allMessages: Message[] = [...messages, assistantMessage];

    runOptions?.onMessage?.(assistantMessage);

    return {
      output: parse<T>(text),
      messages: allMessages,
      toolCalls: [],
      totalTokens,
    };
  };
}

