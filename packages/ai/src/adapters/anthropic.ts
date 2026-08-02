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
import { type ModelPricing, toTokenPricingTable } from "../budget.js";
import type { AdapterHooks, AgentRunner } from "../types.js";
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

/** The single source of Anthropic rates. Widened below; never exported raw. */
const ANTHROPIC_RATES = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20250514": { input: 0.8, output: 4 },
  "claude-haiku-3-5-20241022": { input: 0.8, output: 4 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
};

/**
 * Anthropic model pricing (USD per million tokens).
 *
 * Each entry carries the same two rates under both field spellings, so it works
 * with every cost surface in the library without conversion: `.input` /
 * `.output` for `estimateCost`, which takes a bare per-million number, and
 * `.inputPerMillion` / `.outputPerMillion` for `withBudget` and
 * `createConstraintRouter`, which are typed against `TokenPricing`. Both pairs
 * are derived from one source, so they cannot drift.
 *
 * {@link ANTHROPIC_TOKEN_PRICING} is an alias for this table, kept for callers
 * that already reference it.
 *
 * @example
 * ```typescript
 * import { estimateCost, withBudget } from '@directive-run/ai';
 * import { ANTHROPIC_PRICING } from '@directive-run/ai/anthropic';
 *
 * const rates = ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"];
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, rates.input) +
 *   estimateCost(result.tokenUsage!.outputTokens, rates.output);
 *
 * const guarded = withBudget(runner, {
 *   pricing: rates,
 *   budgets: [{ window: "day", maxCost: 10, pricing: rates }],
 * });
 * ```
 *
 * **Note:** Pricing changes over time. These values are provided as a convenience
 * and may not reflect the latest rates. Always verify at https://anthropic.com/pricing
 */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> =
  toTokenPricingTable(ANTHROPIC_RATES);

/**
 * Alias for {@link ANTHROPIC_PRICING} — the same object, not a copy.
 *
 * The two names once held different shapes, one for `estimateCost` and one for
 * `withBudget`. They no longer do: a single widened table serves both, so
 * whichever name a caller reaches for is the right one. This export remains so
 * existing code keeps working.
 */
export const ANTHROPIC_TOKEN_PRICING: Record<string, ModelPricing> =
  ANTHROPIC_PRICING;

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
  /**
   * Prompt caching strategy. When `"automatic"`, a `cache_control` breakpoint is
   * placed on the system prompt so the stable instructions prefix is cached across
   * calls – subsequent runs read it from cache instead of re-processing it. The
   * variable message suffix is never cached. Cache token usage is surfaced on
   * `tokenUsage.cacheReadTokens` / `tokenUsage.cacheCreationTokens`.
   *
   * Anthropic silently ignores `cache_control` when the cached prefix is below a
   * per-model minimum (~1024 tokens Sonnet-tier, 2048 for Sonnet-4.6 & Haiku-3.5,
   * 4096 for Opus & Haiku-4.5) – no error, no caching, and `cacheReadTokens` stays
   * 0 (that 0 is the diagnostic). Since Directive caches `agent.instructions`,
   * short instructions commonly fall below this. The `ephemeral` breakpoint has a
   * 5-minute default TTL.
   *
   * @default undefined – caching disabled (bare-string system, current behavior).
   */
  promptCaching?: "automatic";
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
 *
 * @example Prompt caching – cache the stable instructions prefix and read the
 * cache-token breakdown back for cost tracking:
 * ```typescript
 * const runner = createAnthropicRunner({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   promptCaching: "automatic",
 * });
 * const result = await orchestrator.run(agent, input);
 * // tokenUsage.cacheCreationTokens – tokens written on the first call
 * // tokenUsage.cacheReadTokens     – tokens served from cache on repeat calls
 * const { inputTokens, cacheReadTokens = 0, cacheCreationTokens = 0 } =
 *   result.tokenUsage!;
 * // Cache reads bill ~0.1x and cache writes ~1.25x the base input rate.
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
    promptCaching,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createAnthropicRunner");

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages) => {
      const instructions = agent.instructions ?? "";
      // With prompt caching enabled, send the structured system form so a
      // `cache_control` breakpoint caches the stable instructions prefix.
      // Fall back to the bare string – byte-for-byte the prior behavior – when
      // caching is off, and also when there is nothing stable to cache: an
      // empty/whitespace-only cached block is wasteful and risks a 400.
      const system =
        promptCaching === "automatic" && instructions.trim() !== ""
          ? [
              {
                type: "text",
                text: instructions,
                cache_control: { type: "ephemeral" },
              },
            ]
          : instructions;

      return {
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
            system,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          ...(timeoutMs != null
            ? { signal: AbortSignal.timeout(timeoutMs) }
            : {}),
        },
      };
    },
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.content?.[0]?.text ?? "";
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;

      // Cache-token emission is gated on the OPTION, not on the response fields:
      // the live API returns `cache_*_input_tokens: 0` on every response even
      // when no `cache_control` was sent, so keying off their presence would
      // wrongly emit `cacheReadTokens: 0` on a caching-off call. When caching is
      // on we always emit both (default 0, so a cache miss correctly reports 0);
      // when it's off we omit them entirely so `tokenUsage` is byte-identical to
      // the pre-caching behavior. `input_tokens` is the uncached remainder, so
      // cache tokens are additive – include them in `totalTokens`.
      if (promptCaching === "automatic") {
        const cacheReadTokens = data.usage?.cache_read_input_tokens ?? 0;
        const cacheCreationTokens =
          data.usage?.cache_creation_input_tokens ?? 0;

        return {
          text,
          totalTokens:
            inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        };
      }

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

          const result: {
            text?: string;
            inputTokens?: number;
            outputTokens?: number;
          } = {};
          if (
            event.type === "content_block_delta" &&
            (event.delta as Record<string, unknown>)?.type === "text_delta"
          ) {
            result.text = (event.delta as Record<string, unknown>)
              .text as string;
          }
          if (event.type === "message_delta" && event.usage) {
            result.outputTokens =
              ((event.usage as Record<string, unknown>)
                .output_tokens as number) ?? 0;
          }
          if (
            event.type === "message_start" &&
            (event.message as Record<string, unknown>)?.usage
          ) {
            result.inputTokens =
              ((
                (event.message as Record<string, unknown>).usage as Record<
                  string,
                  unknown
                >
              ).input_tokens as number) ?? 0;
          }

          return result;
        },
        "Anthropic",
      );

      const tokenUsage = { inputTokens, outputTokens };
      const totalTokens = inputTokens + outputTokens;

      callbacks.onMessage?.({ role: "assistant", content: fullText });
      fireAfterCallHook(
        hooks,
        agent,
        input,
        fullText,
        totalTokens,
        tokenUsage,
        startTime,
      );

      return buildStreamingResult(input, fullText, totalTokens, tokenUsage);
    } catch (err) {
      fireErrorHook(hooks, agent, input, err, startTime);

      throw err;
    }
  };
}
