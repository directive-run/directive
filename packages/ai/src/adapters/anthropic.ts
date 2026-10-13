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

import {
  DEFAULT_STREAM_IDLE_MS,
  DEFAULT_STREAM_STALL_MS,
  createRunner,
  createStreamDeadline,
  validateBaseURL,
  validateStreamTimeout,
} from "../agent-utils.js";
import {
  type ModelPricing,
  attachReportedUsage,
  readReportedUsage,
  toTokenPricingTable,
} from "../pricing.js";
import type { AdapterHooks, AgentRunner, StopReason } from "../types.js";
import type { StreamingCallbackRunner } from "../types.js";
import type { StreamEventResult } from "./shared.js";
import {
  SSE_ACCEPT_HEADER,
  anyTokenCountReported,
  assertEventStreamResponse,
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
    // $2/$10 was announced as introductory pricing through 2026-08-31 and is
    // now the standard price; the scheduled rise to $3/$15 on 2026-09-01 was
    // cancelled. This table carried the cancelled figures.
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
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
/**
 * The date the rates in {@link ANTHROPIC_PRICING} were last checked against
 * https://anthropic.com/pricing.
 *
 * A published table is a snapshot, and a stale one is not an error anywhere: a
 * rate that moved produces a uniform arithmetic drift in every cost this
 * package reports, with no exception, no warning, and nothing for a check to
 * compare against. The date is that comparable thing — it lets a caller decide
 * whether these numbers are fresh enough to bill against, and it lets a test
 * refuse a rate change that forgets to move it.
 *
 * Never inferred from the clock. It records when a person last looked.
 */
export const ANTHROPIC_PRICING_AS_OF = "2026-08-15";

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
 * The cache-token half of an Anthropic `tokenUsage`.
 *
 * One function, called from every Anthropic path – buffered, `createRunner`
 * streaming, and the standalone streaming runner – because the standalone one
 * used to have its own answer: it destructured four fields off the stream
 * totals and let the cache counts fall on the floor. On a fully cached prompt
 * that is the difference between a bill of nine thousand tokens and a bill of
 * nineteen, which any token-window budget reads as a free call.
 *
 * With caching requested, both counts are always emitted, defaulting to zero –
 * a cache miss really did read zero cached tokens. Without it they are omitted,
 * because the live API answers `cache_read_input_tokens: 0` on every response
 * whether or not a `cache_control` was ever sent, and emitting that pair would
 * change the shape of `tokenUsage` for every caller who never asked for
 * caching. A count *above* zero is emitted either way: something cached the
 * prompt, the provider billed it, and the ledger has to see it.
 */
function anthropicCacheTokens(
  promptCaching: "automatic" | undefined,
  cacheReadTokens: number | undefined,
  cacheCreationTokens: number | undefined,
): { cacheReadTokens?: number; cacheCreationTokens?: number } {
  if (promptCaching === "automatic") {
    return {
      cacheReadTokens: cacheReadTokens ?? 0,
      cacheCreationTokens: cacheCreationTokens ?? 0,
    };
  }

  return {
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
  };
}

/** Anthropic's `stop_reason` values, in the shared vocabulary. */
const ANTHROPIC_STOP_REASONS: Record<string, StopReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_use",
  pause_turn: "other",
  refusal: "content_filter",
};

/** The buffered response's `stop_reason`, in both spellings. */
function readAnthropicStopReason(value: unknown): {
  stopReason?: StopReason;
  rawStopReason?: string;
} {
  if (typeof value !== "string") {
    return {};
  }

  return {
    stopReason: ANTHROPIC_STOP_REASONS[value] ?? "other",
    rawStopReason: value,
  };
}

/** A content-block index, or `undefined` when the event carried no usable one. */
function readBlockIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Extract text, tool calls and token counts from one Anthropic SSE event.
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
  const delta = event.delta as Record<string, unknown> | undefined;
  if (event.type === "content_block_delta" && delta?.type === "text_delta") {
    result.text = delta.text as string;
  }
  // A tool call's arguments arrive as a run of string fragments that is only
  // valid JSON once concatenated. Dropping them left every tool-using stream
  // returning an empty answer, a clean terminal marker and a full token bill.
  if (
    event.type === "content_block_start" &&
    (event.content_block as Record<string, unknown>)?.type === "tool_use"
  ) {
    const block = event.content_block as Record<string, unknown>;
    const index = readBlockIndex(event.index);
    if (index !== undefined) {
      result.toolCallStart = {
        index,
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
      };
    }
  }
  if (
    event.type === "content_block_delta" &&
    delta?.type === "input_json_delta"
  ) {
    const index = readBlockIndex(event.index);
    if (index !== undefined && typeof delta.partial_json === "string") {
      result.toolCallDelta = { index, json: delta.partial_json };
    }
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
  // `stop_reason` rides the `message_delta` that precedes `message_stop`.
  // `"max_tokens"` is the one that matters: the answer is cut off mid-sentence,
  // and without this it arrived as an ordinary success.
  if (
    event.type === "message_delta" &&
    typeof delta?.stop_reason === "string"
  ) {
    result.rawStopReason = delta.stop_reason;
    result.stopReason = ANTHROPIC_STOP_REASONS[delta.stop_reason] ?? "other";
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
  /**
   * Wall-clock cap on the whole call, in milliseconds, applied through
   * `AbortSignal.timeout` – so a call that overruns it fails with an error named
   * `"TimeoutError"`, distinct from an abort the caller raised.
   *
   * It caps a streamed call the same way it caps a buffered one: from the
   * request going out to the last delta, however much the model had left to say.
   * That is the right shape for a buffered call and a blunt one for a stream,
   * where the interesting failure is silence rather than length – see
   * {@link AnthropicStreamingRunnerOptions.timeoutMs}, which measures the gap
   * between events instead.
   *
   * @default undefined – no deadline
   */
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
            // Without it a gateway is free to content-negotiate its way to a
            // buffered JSON body on a request that asked for a stream.
            ...(stream ? { Accept: SSE_ACCEPT_HEADER } : {}),
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
      const cache = anthropicCacheTokens(
        promptCaching,
        readTokenCount(data.usage?.cache_read_input_tokens),
        readTokenCount(data.usage?.cache_creation_input_tokens),
      );
      const stopReason = readAnthropicStopReason(data.stop_reason);

      return {
        text,
        totalTokens:
          inputTokens +
          outputTokens +
          (cache.cacheReadTokens ?? 0) +
          (cache.cacheCreationTokens ?? 0),
        inputTokens,
        outputTokens,
        ...cache,
        ...stopReason,
        usageReported,
      };
    },
    streaming: {
      adapterName: "Anthropic",
      parseEvent: parseAnthropicStreamEvent,
      requireTerminalEvent: true,
      // Mirrors `parseResponse` exactly – both call the same cache-token
      // function, so `tokenUsage` is the same shape whether or not the caller
      // asked for deltas.
      buildResponse: (totals) => {
        const { fullText: text, inputTokens, outputTokens } = totals;
        const cache = anthropicCacheTokens(
          promptCaching,
          totals.cacheReadTokens,
          totals.cacheCreationTokens,
        );

        return {
          text,
          totalTokens:
            inputTokens +
            outputTokens +
            (cache.cacheReadTokens ?? 0) +
            (cache.cacheCreationTokens ?? 0),
          inputTokens,
          outputTokens,
          ...cache,
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
  /**
   * How long the stream may say nothing before the call is abandoned, in
   * milliseconds.
   *
   * **The gap between events, not the length of the call.** A streamed response
   * runs for as long as the model has something to say, so a wall-clock cap on
   * the whole call – which is what `timeoutMs` means on
   * {@link AnthropicRunnerOptions} – either truncates a long answer or is set so
   * high that it bounds nothing. The failure worth catching is a connection that
   * is open and silent, and the measurement for that is how long it has been
   * quiet. Every sign of life restarts the clock: the response headers, each
   * delta, and the keep-alive pings Anthropic sends while it works.
   *
   * The default is two minutes of silence. A healthy stream is never anywhere
   * near that quiet – `message_start` follows the request almost immediately and
   * pings arrive throughout – so the interval is generous enough to survive a
   * slow start on a very large transcript while still bounding a stall to
   * something a person waiting on the turn will sit through.
   *
   * A stalled stream fails with an error named `"TimeoutError"`, matching what
   * `AbortSignal.timeout` raises on the buffered path, so a caller can tell a
   * provider that stopped talking from a run they cancelled themselves.
   *
   * `Infinity` disables the deadline and leaves `callbacks.signal` as the only
   * thing that can end a stalled stream.
   *
   * @default 120_000
   */
  timeoutMs?: number;
  /**
   * How long the stream may stay alive and produce nothing, in milliseconds.
   *
   * The other half of {@link AnthropicStreamingRunnerOptions.timeoutMs}, and the
   * one a keep-alive cannot hold off. `timeoutMs` measures total silence, which
   * a `ping` or a proxy's `:` comment legitimately breaks; this measures the gap
   * between the parts of an actual response. A provider wedged behind a queue
   * pings for as long as the socket is open, so without a second clock it holds
   * the call, the socket and the interrupt path open indefinitely – the precise
   * failure the deadline was added for.
   *
   * Ten minutes by default, which clears the longest a thinking model plausibly
   * goes without emitting anything. `Infinity` disables it.
   *
   * @default 600_000
   */
  contentTimeoutMs?: number;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature (0–1). Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Custom stop sequences. The model will stop generating when it encounters one. */
  stopSequences?: string[];
  /**
   * Prompt caching strategy. Identical in meaning and effect to
   * {@link AnthropicRunnerOptions.promptCaching} – a `cache_control` breakpoint
   * on the system prompt, and cache token counts on `tokenUsage`.
   *
   * @default undefined – caching disabled.
   */
  promptCaching?: "automatic";
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
    timeoutMs = DEFAULT_STREAM_IDLE_MS,
    contentTimeoutMs = DEFAULT_STREAM_STALL_MS,
    hooks,
    temperature,
    topP,
    stopSequences,
    promptCaching,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createAnthropicStreamingRunner");
  validateStreamTimeout(timeoutMs, "createAnthropicStreamingRunner");
  validateStreamTimeout(
    contentTimeoutMs,
    "createAnthropicStreamingRunner",
    "contentTimeoutMs",
  );

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);
    // Armed before the request goes out, so a connection that never answers is
    // bounded by the same clocks as one that answers and then stops. The
    // caller's own signal is folded in rather than replaced – a deadline that
    // took the fetch's only signal slot would disable cancellation to install
    // a timeout, which is a trade nobody asked for.
    const deadline = createStreamDeadline(
      timeoutMs,
      callbacks.signal,
      "Anthropic",
      { contentMs: contentTimeoutMs },
    );

    try {
      const instructions = agent.instructions ?? "";
      const response = await fetchFn(`${baseURL}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: SSE_ACCEPT_HEADER,
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: agent.model ?? model,
          max_tokens: maxTokens,
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(stopSequences != null ? { stop_sequences: stopSequences } : {}),
          system:
            promptCaching === "automatic" && instructions.trim() !== ""
              ? [
                  {
                    type: "text",
                    text: instructions,
                    cache_control: { type: "ephemeral" },
                  },
                ]
              : instructions,
          messages: [{ role: "user", content: input }],
          stream: true,
        }),
        signal: deadline.signal,
      });
      deadline.progress();

      if (!response.ok) {
        await throwStreamingHTTPError(response, "Anthropic");
      }
      await assertEventStreamResponse(response, "Anthropic");

      const reader = getStreamReader(response);

      const totals = await parseEventStream(
        reader,
        callbacks.onToken,
        parseAnthropicStreamEvent,
        "Anthropic",
        "sse",
        {
          signal: deadline.signal,
          deadline,
          requireTerminalEvent: true,
        },
      );

      const { fullText, inputTokens, outputTokens, usageReported } = totals;
      // The same cache-token function the buffered runner calls. Reading four
      // fields off the totals and stopping there is what let this path report a
      // fully cached run at 1/490th of what the other one reported for the same
      // body, and made the claim that the two "cannot drift" false.
      const cache = anthropicCacheTokens(
        promptCaching,
        totals.cacheReadTokens,
        totals.cacheCreationTokens,
      );
      const tokenUsage = { inputTokens, outputTokens, ...cache };
      const totalTokens =
        inputTokens +
        outputTokens +
        (cache.cacheReadTokens ?? 0) +
        (cache.cacheCreationTokens ?? 0);

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
        {
          stopReason: totals.stopReason,
          rawStopReason: totals.rawStopReason,
          toolCalls: totals.toolCalls,
        },
      );
    } catch (err) {
      // What a cancelled body rejects with is the runtime's business, and it is
      // not always the reason the signal carried. When this deadline is what
      // ended the call, the caller sees that and not whatever the socket said
      // on its way down – the whole point of the deadline is being able to tell
      // a stalled provider from an abort. Whatever the abandoned stream had
      // already been billed for travels across with it; a call cut off before
      // its first token has usually reported its input tokens, and those are
      // most of the bill on a long transcript.
      const error = deadline.expired
        ? attachReportedUsage(deadline.reason, readReportedUsage(err))
        : err;
      fireErrorHook(hooks, agent, input, error, startTime);

      throw error;
    } finally {
      deadline.release();
    }
  };
}
