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
      throw new Error(`[Directive] AgentRunner request failed: ${response.status} ${response.statusText}`);
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

// ============================================================================
// Pre-built AgentRunner Factories
// ============================================================================

/** Options for createOpenAIRunner */
export interface OpenAIRunnerOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a AgentRunner for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * @example
 * ```typescript
 * const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
 * const stack = createAgentStack({ runner, agents: { ... } });
 * ```
 */
export function createOpenAIRunner(options: OpenAIRunnerOptions): AgentRunner {
  const { apiKey, model = "gpt-4o", baseURL = "https://api.openai.com/v1", fetch: fetchFn } = options;
  return createRunner({
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

/** Options for createAnthropicRunner */
export interface AnthropicRunnerOptions {
  apiKey: string;
  model?: string;
  /** @default 4096 */
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a AgentRunner for the Anthropic Messages API.
 *
 * @example
 * ```typescript
 * const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * const stack = createAgentStack({ runner, agents: { ... } });
 * ```
 */
export function createAnthropicRunner(options: AnthropicRunnerOptions): AgentRunner {
  const { apiKey, model = "claude-sonnet-4-5-20250929", maxTokens = 4096, baseURL = "https://api.anthropic.com/v1", fetch: fetchFn } = options;
  return createRunner({
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

/** Options for createOllamaRunner */
export interface OllamaRunnerOptions {
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a AgentRunner for local Ollama inference.
 *
 * @example
 * ```typescript
 * const runner = createOllamaRunner({ model: "llama3" });
 * const stack = createAgentStack({ runner, agents: { ... } });
 * ```
 */
export function createOllamaRunner(options: OllamaRunnerOptions = {}): AgentRunner {
  const { model = "llama3", baseURL = "http://localhost:11434", fetch: fetchFn } = options;
  return createRunner({
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
