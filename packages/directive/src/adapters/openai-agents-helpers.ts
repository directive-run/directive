/**
 * Helper functions for AI adapter — createRunFn, estimateCost, state queries.
 */

import type {
  AgentLike,
  RunFn,
  RunResult,
  RunOptions,
  Message,
  AgentState,
  ApprovalState,
} from "./openai-agents-types.js";

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
// createRunFn Helper
// ============================================================================

/** Options for creating a RunFn from buildRequest/parseResponse */
export interface CreateRunFnOptions {
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
 * Create a RunFn from buildRequest/parseResponse helpers.
 * Reduces ~50 lines of fetch boilerplate to ~20 lines of configuration.
 *
 * @example
 * ```typescript
 * const runClaude = createRunFn({
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
export function createRunFn(options: CreateRunFnOptions): RunFn {
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
      throw new Error(`[Directive] RunFn request failed: ${response.status} ${response.statusText}`);
    }

    const { text, totalTokens } = await parseResponse(response, messages);

    const assistantMessage: Message = { role: "assistant", content: text };
    const allMessages: Message[] = [...messages, assistantMessage];

    runOptions?.onMessage?.(assistantMessage);

    return {
      finalOutput: parse<T>(text),
      messages: allMessages,
      toolCalls: [],
      totalTokens,
    };
  };
}

// ============================================================================
// Pre-built RunFn Factories
// ============================================================================

/** Options for createOpenAIRunFn */
export interface OpenAIRunFnOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a RunFn for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * @example
 * ```typescript
 * const run = createOpenAIRunFn({ apiKey: process.env.OPENAI_API_KEY! });
 * const stack = createAgentStack({ run, agents: { ... } });
 * ```
 */
export function createOpenAIRunFn(options: OpenAIRunFnOptions): RunFn {
  const { apiKey, model = "gpt-4o", baseURL = "https://api.openai.com/v1", fetch: fetchFn } = options;
  return createRunFn({
    fetch: fetchFn,
    buildRequest: (agent, _input, messages) => ({
      url: `${baseURL}/chat/completions`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: agent.model ?? model,
          messages: [
            ...(agent.instructions ? [{ role: "system", content: agent.instructions }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      const totalTokens = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
      return { text, totalTokens };
    },
  });
}

/** Options for createAnthropicRunFn */
export interface AnthropicRunFnOptions {
  apiKey: string;
  model?: string;
  /** @default 4096 */
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a RunFn for the Anthropic Messages API.
 *
 * @example
 * ```typescript
 * const run = createAnthropicRunFn({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * const stack = createAgentStack({ run, agents: { ... } });
 * ```
 */
export function createAnthropicRunFn(options: AnthropicRunFnOptions): RunFn {
  const { apiKey, model = "claude-sonnet-4-5-20250929", maxTokens = 4096, baseURL = "https://api.anthropic.com/v1", fetch: fetchFn } = options;
  return createRunFn({
    fetch: fetchFn,
    buildRequest: (agent, _input, messages) => ({
      url: `${baseURL}/messages`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: agent.model ?? model,
          max_tokens: maxTokens,
          system: agent.instructions ?? "",
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      const totalTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      return { text, totalTokens };
    },
  });
}

/** Options for createOllamaRunFn */
export interface OllamaRunFnOptions {
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a RunFn for local Ollama inference.
 *
 * @example
 * ```typescript
 * const run = createOllamaRunFn({ model: "llama3" });
 * const stack = createAgentStack({ run, agents: { ... } });
 * ```
 */
export function createOllamaRunFn(options: OllamaRunFnOptions = {}): RunFn {
  const { model = "llama3", baseURL = "http://localhost:11434", fetch: fetchFn } = options;
  return createRunFn({
    fetch: fetchFn,
    buildRequest: (agent, _input, messages) => ({
      url: `${baseURL}/api/chat`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: agent.model ?? model,
          messages: [
            ...(agent.instructions ? [{ role: "system", content: agent.instructions }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: false,
        }),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.message?.content ?? "";
      const totalTokens = (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0);
      return { text, totalTokens };
    },
  });
}
