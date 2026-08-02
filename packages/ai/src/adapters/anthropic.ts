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
import type { AdapterHooks, AgentRunner } from "../types.js";
import type { StreamingCallbackRunner } from "../types.js";
import type { StreamEventResult } from "./shared.js";
import {
  anyTokenCountReported,
  buildStreamingResult,
  fireAfterCallHook,
  fireBeforeCallHook,
  fireErrorHook,
  getStreamReader,
  parseEventStream,
  readTokenCount,
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
// Shared Stream Event Parsing
// ============================================================================

/**
 * Extract text and token counts from one Anthropic SSE event.
 *
 * Shared by the streaming path of `createAnthropicRunner` and by
 * `createAnthropicStreamingRunner` so the two cannot drift.
 */
function parseAnthropicStreamEvent(
  event: Record<string, unknown>,
): StreamEventResult {
  if (event.type === "error") {
    throw new Error(
      `[Directive] Anthropic stream error: ${(event.error as Record<string, unknown>)?.message ?? JSON.stringify(event.error)}`,
    );
  }

  const result: StreamEventResult = {};
  if (event.type === "message_stop") {
    result.terminal = true;
  }
  if (
    event.type === "content_block_delta" &&
    (event.delta as Record<string, unknown>)?.type === "text_delta"
  ) {
    result.text = (event.delta as Record<string, unknown>).text as string;
  }
  // Read the counts, not the container: a `usage` object whose numbers are
  // null or absent is a provider that reported nothing, and recording it as a
  // report of zero prices a real call at nothing.
  if (event.type === "message_delta" && event.usage) {
    const outputTokens = readTokenCount(
      (event.usage as Record<string, unknown>).output_tokens,
    );
    if (outputTokens !== undefined) {
      result.outputTokens = outputTokens;
    }
  }
  if (
    event.type === "message_start" &&
    (event.message as Record<string, unknown>)?.usage
  ) {
    const usage = (event.message as Record<string, unknown>).usage as Record<
      string,
      unknown
    >;
    const inputTokens = readTokenCount(usage.input_tokens);
    if (inputTokens !== undefined) {
      result.inputTokens = inputTokens;
    }
    // Emitted whenever reported; whether they reach `tokenUsage` is decided by
    // the caller, which knows whether prompt caching was requested. Left unset
    // when the provider sent no number, so a `usage` object with nothing usable
    // in it cannot make the call look priced by way of a zero.
    const cacheReadTokens = readTokenCount(usage.cache_read_input_tokens);
    if (cacheReadTokens !== undefined) {
      result.cacheReadTokens = cacheReadTokens;
    }
    const cacheCreationTokens = readTokenCount(
      usage.cache_creation_input_tokens,
    );
    if (cacheCreationTokens !== undefined) {
      result.cacheCreationTokens = cacheCreationTokens;
    }
  }

  return result;
}

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
    buildRequest: (agent, _input, messages, stream) => {
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
            // Omitted entirely when buffering, so the non-streaming request
            // stays byte-for-byte what it was.
            ...(stream ? { stream: true } : {}),
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
      const inputTokens = readTokenCount(data.usage?.input_tokens) ?? 0;
      const outputTokens = readTokenCount(data.usage?.output_tokens) ?? 0;
      // A `usage` object holding no usable number says the same thing as no
      // `usage` object at all: nothing was reported. Both are unpriceable.
      const usageReported = anyTokenCountReported(
        data.usage?.input_tokens,
        data.usage?.output_tokens,
      );

      // Cache-token emission is gated on the OPTION, not on the response fields:
      // the live API returns `cache_*_input_tokens: 0` on every response even
      // when no `cache_control` was sent, so keying off their presence would
      // wrongly emit `cacheReadTokens: 0` on a caching-off call. When caching is
      // on we always emit both (default 0, so a cache miss correctly reports 0);
      // when it's off we omit them entirely so `tokenUsage` is byte-identical to
      // the pre-caching behavior. `input_tokens` is the uncached remainder, so
      // cache tokens are additive – include them in `totalTokens`.
      if (promptCaching === "automatic") {
        const cacheReadTokens =
          readTokenCount(data.usage?.cache_read_input_tokens) ?? 0;
        const cacheCreationTokens =
          readTokenCount(data.usage?.cache_creation_input_tokens) ?? 0;

        return {
          text,
          totalTokens:
            inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          usageReported,
        };
      }

      return {
        text,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        usageReported,
      };
    },
    streaming: {
      adapterName: "Anthropic",
      parseEvent: parseAnthropicStreamEvent,
      requireTerminalEvent: true,
      // Mirrors `parseResponse` exactly – cache tokens are gated on the option,
      // never on the presence of the response fields, so `tokenUsage` is the
      // same shape whether or not the caller asked for deltas.
      buildResponse: (totals) => {
        const { fullText: text, inputTokens, outputTokens } = totals;

        if (promptCaching === "automatic") {
          const cacheReadTokens = totals.cacheReadTokens ?? 0;
          const cacheCreationTokens = totals.cacheCreationTokens ?? 0;

          return {
            text,
            totalTokens:
              inputTokens +
              outputTokens +
              cacheReadTokens +
              cacheCreationTokens,
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

      const reader = getStreamReader(response);

      const { fullText, inputTokens, outputTokens, usageReported } =
        await parseEventStream(
          reader,
          callbacks.onToken,
          parseAnthropicStreamEvent,
          "Anthropic",
          "sse",
          { signal: callbacks.signal, requireTerminalEvent: true },
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

      return buildStreamingResult(
        input,
        fullText,
        totalTokens,
        tokenUsage,
        usageReported,
      );
    } catch (err) {
      fireErrorHook(hooks, agent, input, err, startTime);

      throw err;
    }
  };
}
