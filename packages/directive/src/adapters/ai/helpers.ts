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
import type { StreamingCallbackRunner } from "./stack.js";

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

// ============================================================================
// Streaming Runner: Anthropic
// ============================================================================

/** Options for createAnthropicStreamingRunner */
export interface AnthropicStreamingRunnerOptions {
  apiKey: string;
  model?: string;
  /** @default 4096 */
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a StreamingCallbackRunner for the Anthropic Messages API with
 * server-sent events. Pairs with `createAnthropicRunner` (non-streaming).
 *
 * @example
 * ```typescript
 * const streamingRunner = createAnthropicStreamingRunner({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * const stack = createAgentStack({
 *   runner: createAnthropicRunner({ apiKey }),
 *   streaming: { runner: streamingRunner },
 *   agents: { ... },
 * });
 * ```
 */
export function createAnthropicStreamingRunner(
  options: AnthropicStreamingRunnerOptions,
): StreamingCallbackRunner {
  const {
    apiKey,
    model = "claude-sonnet-4-5-20250929",
    maxTokens = 4096,
    baseURL = "https://api.anthropic.com/v1",
    fetch: fetchFn = globalThis.fetch,
  } = options;

  return async (agent, input, callbacks) => {
    const response = await fetchFn(`${baseURL}/messages`, {
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
        messages: [{ role: "user", content: input }],
        stream: true,
      }),
      signal: callbacks.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `[Directive] Anthropic streaming error ${response.status}: ${errBody}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("[Directive] No response body");

    const decoder = new TextDecoder();
    let buf = "";
    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);
          if (event.type === "error") {
            throw new Error(
              `[Directive] Anthropic stream error: ${event.error?.message ?? JSON.stringify(event.error)}`,
            );
          }
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
          ) {
            fullText += event.delta.text;
            callbacks.onToken?.(event.delta.text);
          }
          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? 0;
          }
          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            if (
              typeof process !== "undefined" &&
              process.env?.NODE_ENV === "development"
            ) {
              console.warn("[Directive] Malformed SSE event from Anthropic:", data);
            }
          } else {
            throw parseErr;
          }
        }
      }
    }

    const assistantMsg: Message = { role: "assistant", content: fullText };
    callbacks.onMessage?.(assistantMsg);

    return {
      output: fullText,
      messages: [{ role: "user" as const, content: input }, assistantMsg],
      toolCalls: [],
      totalTokens: inputTokens + outputTokens,
    };
  };
}
