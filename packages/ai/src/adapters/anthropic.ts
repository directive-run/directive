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
} from "../types.js";
import type { StreamingCallbackRunner } from "../types.js";
import {
  buildStreamingResult,
  fireAfterCallHook,
  fireBeforeCallHook,
  fireErrorHook,
  getSSEReader,
  parseSSEStream,
  throwStreamingHTTPError,
  warnIfMissingApiKey,
} from "./shared.js";

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
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20250514": { input: 0.8, output: 4 },
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
  /** Sampling temperature (0–1). Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Custom stop sequences. The model will stop generating when it encounters one. */
  stopSequences?: string[];
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
    temperature,
    topP,
    stopSequences,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createAnthropicRunner");

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
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(stopSequences != null ? { stop_sequences: stopSequences } : {}),
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
  /** Sampling temperature (0–1). Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Custom stop sequences. The model will stop generating when it encounters one. */
  stopSequences?: string[];
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
    temperature,
    topP,
    stopSequences,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createAnthropicStreamingRunner");

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);

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
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(stopSequences != null ? { stop_sequences: stopSequences } : {}),
          system: agent.instructions ?? "",
          messages: [{ role: "user", content: input }],
          stream: true,
        }),
        signal: callbacks.signal,
      });

      if (!response.ok) {
        await throwStreamingHTTPError(response, "Anthropic");
      }

      const reader = getSSEReader(response);

      const { fullText, inputTokens, outputTokens } = await parseSSEStream(
        reader,
        callbacks.onToken,
        (event) => {
          if (event.type === "error") {
            throw new Error(
              `[Directive] Anthropic stream error: ${(event.error as Record<string, unknown>)?.message ?? JSON.stringify(event.error)}`,
            );
          }

          const result: { text?: string; inputTokens?: number; outputTokens?: number } = {};
          if (
            event.type === "content_block_delta" &&
            (event.delta as Record<string, unknown>)?.type === "text_delta"
          ) {
            result.text = (event.delta as Record<string, unknown>).text as string;
          }
          if (event.type === "message_delta" && event.usage) {
            result.outputTokens = (event.usage as Record<string, unknown>).output_tokens as number ?? 0;
          }
          if (event.type === "message_start" && (event.message as Record<string, unknown>)?.usage) {
            result.inputTokens = ((event.message as Record<string, unknown>).usage as Record<string, unknown>).input_tokens as number ?? 0;
          }

          return result;
        },
        "Anthropic",
      );

      const tokenUsage = { inputTokens, outputTokens };
      const totalTokens = inputTokens + outputTokens;

      callbacks.onMessage?.({ role: "assistant", content: fullText });
      fireAfterCallHook(hooks, agent, input, fullText, totalTokens, tokenUsage, startTime);

      return buildStreamingResult(input, fullText, totalTokens, tokenUsage);
    } catch (err) {
      fireErrorHook(hooks, agent, input, err, startTime);

      throw err;
    }
  };
}
