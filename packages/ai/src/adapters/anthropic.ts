/**
 * @directive-run/ai/anthropic
 *
 * Anthropic adapter for Directive AI. Provides runners for the
 * Anthropic Messages API, including streaming support.
 *
 * @example
 * ```typescript
 * import { createAnthropicRunner, createAnthropicStreamingRunner } from '@directive-run/ai/anthropic';
 *
 * const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * ```
 */

import { createRunner, validateBaseURL } from "../agent-utils.js";
import type {
  AdapterHooks,
  AgentRunner,
  Message,
  TokenUsage,
} from "../types.js";
import type { StreamingCallbackRunner } from "../types.js";

// ============================================================================
// Pricing Constants
// ============================================================================

/**
 * Anthropic model pricing (USD per million tokens).
 *
 * Use with `estimateCost()` for per-call cost tracking:
 * ```typescript
 * import { estimateCost } from '@directive-run/ai';
 * import { ANTHROPIC_PRICING } from '@directive-run/ai/anthropic';
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"].input) +
 *   estimateCost(result.tokenUsage!.outputTokens, ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"].output);
 * ```
 *
 * **Note:** Pricing changes over time. These values are provided as a convenience
 * and may not reflect the latest rates. Always verify at https://anthropic.com/pricing
 */
export const ANTHROPIC_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-3-5-20241022": { input: 0.8, output: 4 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
};

// ============================================================================
// Anthropic Runner
// ============================================================================

/** Options for createAnthropicRunner */
export interface AnthropicRunnerOptions {
  apiKey: string;
  model?: string;
  /** @default 4096 */
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** @default undefined */
  timeoutMs?: number;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
}

/**
 * Create an AgentRunner for the Anthropic Messages API.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * const runner = createAnthropicRunner({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   hooks: {
 *     onAfterCall: ({ durationMs, tokenUsage }) => {
 *       console.log(`${durationMs}ms – ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
 *     },
 *   },
 * });
 * const orchestrator = createAgentOrchestrator({ runner });
 * const result = await orchestrator.run(agent, input);
 * ```
 */
export function createAnthropicRunner(
  options: AnthropicRunnerOptions,
): AgentRunner {
  const {
    apiKey,
    model = "claude-sonnet-4-5-20250929",
    maxTokens = 4096,
    baseURL = "https://api.anthropic.com/v1",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs,
    hooks,
  } = options;

  validateBaseURL(baseURL);

  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production" &&
    !apiKey
  ) {
    console.warn(
      "[Directive] createAnthropicRunner: apiKey is empty. API calls will fail.",
    );
  }

  return createRunner({
    fetch: fetchFn,
    hooks,
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
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        ...(timeoutMs != null
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      return {
        text,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
      };
    },
  });
}

// ============================================================================
// Anthropic Streaming Runner
// ============================================================================

/** Options for createAnthropicStreamingRunner */
export interface AnthropicStreamingRunnerOptions {
  apiKey: string;
  model?: string;
  /** @default 4096 */
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
}

/**
 * Create a StreamingCallbackRunner for the Anthropic Messages API with
 * server-sent events. Can be used standalone or paired with `createAnthropicRunner`.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * const streamingRunner = createAnthropicStreamingRunner({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * const streamRunner = createStreamingRunner(streamingRunner);
 * const { stream, result } = streamRunner(agent, input);
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
    hooks,
  } = options;

  validateBaseURL(baseURL);

  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production" &&
    !apiKey
  ) {
    console.warn(
      "[Directive] createAnthropicStreamingRunner: apiKey is empty. API calls will fail.",
    );
  }

  return async (agent, input, callbacks) => {
    const startTime = Date.now();
    hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

    try {
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
        const errBody = await response.text().catch(() => "");

        throw new Error(
          `[Directive] Anthropic streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("[Directive] No response body");
      }

      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) {
              continue;
            }
            const data = line.slice(6).trim();

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
                  console.warn(
                    "[Directive] Malformed SSE event from Anthropic:",
                    data,
                  );
                }
              } else {
                throw parseErr;
              }
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      const assistantMsg: Message = { role: "assistant", content: fullText };
      callbacks.onMessage?.(assistantMsg);

      const tokenUsage: TokenUsage = { inputTokens, outputTokens };
      const totalTokens = inputTokens + outputTokens;

      hooks?.onAfterCall?.({
        agent,
        input,
        output: fullText,
        totalTokens,
        tokenUsage,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      });

      return {
        output: fullText,
        messages: [{ role: "user" as const, content: input }, assistantMsg],
        toolCalls: [],
        totalTokens,
        tokenUsage,
      };
    } catch (err) {
      if (err instanceof Error) {
        hooks?.onError?.({
          agent,
          input,
          error: err,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
        });
      }

      throw err;
    }
  };
}
