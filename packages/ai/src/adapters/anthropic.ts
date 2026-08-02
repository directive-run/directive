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
import { type ModelPricing, toTokenPricingTable } from "../pricing.js";
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
 * The single source of Anthropic rates. Widened below; never exported raw.
 *
 * `cacheRead` is 0.1x input and `cacheWrite` is 1.25x input — Anthropic's
 * published multipliers for the **5-minute** ephemeral cache, which is the TTL
 * the adapter requests. The 1-hour cache writes at 2.0x instead, and a single
 * `cacheWrite` rate cannot say both; a caller using the 1-hour TTL should pass
 * their own pricing object. The write rate is above the input rate, so cache
 * tokens are the one class where leaving them unpriced under-counts the ledger
 * the most.
 *
 * Keys are the exact model IDs the Messages API accepts. A key that is close to
 * a real ID but not equal to one is worse than an absent row: the caller who
 * passes the *correct* ID gets `undefined` back and prices their run at nothing.
 *
 * Current-generation IDs carry no date suffix — `claude-opus-5`,
 * `claude-sonnet-5` — while some older models have both a dated ID and an
 * undated alias. Where both exist, both are listed: a row keyed only by the
 * dated form leaves the caller who passes the alias with no pricing at all, and
 * an extra key costs nothing.
 *
 * **What belongs here: every model ID a caller might pass, in every spelling.**
 * Not the current ones — every one. Missing pricing throws, so an absent row
 * for a model still being served locks that caller out of budget windows
 * entirely, and an absent row for a retired one makes last quarter's spend
 * impossible to reconcile. Rows therefore go in and stay in; a model leaving
 * the API is a reason to move its row down, not to delete it. Each addition is
 * checked against the published rates rather than inferred from its neighbours
 * — a plausible row is worse than no row, because it prices silently.
 */
const ANTHROPIC_RATES = {
  // ---- Current generation ----
  "claude-fable-5": {
    input: 10,
    output: 50,
    cacheRead: 1,
    cacheWrite: 12.5,
  },
  "claude-opus-5": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-opus-4-7": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-opus-4-6": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  // List price. Sonnet 5 carries promotional introductory rates ($2/$10 per
  // million) that expire; a budget priced at the promotion under-reads the
  // moment it lapses, and a spend guard that reads low is a spend guard that
  // does not gate. Over-estimating is the safe direction here.
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  // Haiku 4.5 is the one current model whose ID has a dated form as well.
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },

  // ---- Previous generation, still served ----
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-0": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-sonnet-4-20250514": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  "claude-opus-4-5-20251101": {
    input: 5,
    output: 25,
    cacheRead: 0.5,
    cacheWrite: 6.25,
  },
  // Deprecated, with a retirement date already set. Kept for the same reason
  // the retired row below is: a caller reconciling last month's invoice needs
  // rates the month was billed at, and a row that disappears on the retirement
  // date takes that ability with it.
  "claude-opus-4-1": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-1-20250805": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-0": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
  "claude-opus-4-20250514": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },

  // ---- Retired; kept for reconciling historical spend ----
  "claude-3-5-haiku-20241022": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheWrite: 1,
  },
};

/**
 * Anthropic model pricing (USD per million tokens).
 *
 * Each entry carries the same rates under both field spellings, so it works
 * with every cost surface in the library without conversion: `.input` /
 * `.output` / `.cacheRead` / `.cacheWrite` for `estimateCost`, which takes a
 * bare per-million number, and the `*PerMillion` spellings for `withBudget` and
 * `createConstraintRouter`, which are typed against `TokenPricing`. Both pairs
 * are derived from one source, so they cannot drift.
 *
 * Cache rates are included, because Anthropic prices cache tokens differently
 * from ordinary input: a cache read is ~0.1x the input rate and a cache write
 * is ~1.25x it. With `promptCaching: "automatic"`, `inputTokens` is only the
 * uncached remainder, so a budget that priced input and output alone would read
 * a heavily cached run as nearly free.
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
  toTokenPricingTable(ANTHROPIC_RATES, "ANTHROPIC_PRICING");

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
