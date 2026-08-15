/**
 * @directive-run/ai/gemini
 *
 * Google Gemini adapter for Directive AI. Provides runners for the
 * Gemini generateContent API, including streaming support.
 *
 * @example
 * ```typescript
 * import { createGeminiRunner, createGeminiStreamingRunner } from '@directive-run/ai/gemini';
 *
 * const runner = createGeminiRunner({ apiKey: process.env.GEMINI_API_KEY! });
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

/** The single source of Gemini rates. Widened below; never exported raw. */
const GEMINI_RATES = {
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-flash-lite": { input: 0.025, output: 0.1 },
};

/**
 * Gemini model pricing (USD per million tokens).
 *
 * Each entry carries the same two rates under both field spellings, so it works
 * with every cost surface in the library without conversion: `.input` /
 * `.output` for `estimateCost`, which takes a bare per-million number, and
 * `.inputPerMillion` / `.outputPerMillion` for `withBudget` and
 * `createConstraintRouter`, which are typed against `TokenPricing`. Both pairs
 * are derived from one source, so they cannot drift.
 *
 * No separate cache rates are published for these models, so `withBudget`
 * prices any cache tokens at the input rate — conservative, and never free.
 *
 * {@link GEMINI_TOKEN_PRICING} is an alias for this table, kept for callers
 * that already reference it.
 *
 * @example
 * ```typescript
 * import { estimateCost, withBudget } from '@directive-run/ai';
 * import { GEMINI_PRICING } from '@directive-run/ai/gemini';
 *
 * const rates = GEMINI_PRICING["gemini-2.0-flash"];
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
 * and may not reflect the latest rates. Always verify at https://ai.google.dev/pricing
 */
/**
 * The date the rates in {@link GEMINI_PRICING} were last checked against
 * https://ai.google.dev/pricing.
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
export const GEMINI_PRICING_AS_OF = "2026-08-14";

export const GEMINI_PRICING: Record<string, ModelPricing> = toTokenPricingTable(
  GEMINI_RATES,
  "GEMINI_PRICING",
);

/**
 * Alias for {@link GEMINI_PRICING} — the same object, not a copy.
 *
 * The two names once held different shapes, one for `estimateCost` and one for
 * `withBudget`. They no longer do: a single widened table serves both, so
 * whichever name a caller reaches for is the right one. This export remains so
 * existing code keeps working.
 */
export const GEMINI_TOKEN_PRICING: Record<string, ModelPricing> =
  GEMINI_PRICING;

// ============================================================================
// Shared Stream Event Parsing
// ============================================================================

/**
 * Extract text and token counts from one Gemini `streamGenerateContent` event.
 *
 * Shared by the streaming path of `createGeminiRunner` and by
 * `createGeminiStreamingRunner` so the two cannot drift.
 */
/** Gemini's `finishReason` values, in the shared vocabulary. */
const GEMINI_STOP_REASONS: Record<string, StopReason> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  BLOCKLIST: "content_filter",
  SPII: "content_filter",
  IMAGE_SAFETY: "content_filter",
  MALFORMED_FUNCTION_CALL: "other",
  OTHER: "other",
};

/**
 * The answer text in a Gemini candidate, which is not necessarily the first
 * part of it.
 *
 * A thinking model returns its reasoning summary as an ordinary text part
 * flagged `thought: true`, ahead of the answer, in the same chunk. Reading
 * `parts[0].text` therefore returned "Let me think..." as the response and
 * discarded the answer entirely, with a clean terminal marker and no error – on
 * `gemini-2.5-flash` and `-pro`, both of which this adapter publishes rates for.
 * Every non-thought part is concatenated, because a single chunk can also split
 * one answer across several parts.
 */
function readAnswerText(
  parts: Record<string, unknown>[] | undefined,
): string | undefined {
  if (!parts) {
    return undefined;
  }
  let text = "";
  for (const part of parts) {
    if (part?.thought === true) {
      continue;
    }
    if (typeof part?.text === "string") {
      text += part.text;
    }
  }

  return text === "" ? undefined : text;
}

/**
 * The prompt never reached the model.
 *
 * A blocked prompt produces a body with `promptFeedback` and no candidates, so
 * without this it read as a stream that ended with no completion marker – which
 * sends the caller looking for a truncated response instead of telling them
 * their prompt was refused.
 */
function assertNotBlocked(event: Record<string, unknown>): void {
  const feedback = event.promptFeedback as Record<string, unknown> | undefined;
  const blockReason = feedback?.blockReason;
  if (typeof blockReason !== "string") {
    return;
  }

  throw new Error(
    `[Directive] Gemini refused the prompt: ${blockReason}. Nothing was generated.`,
  );
}

function parseGeminiStreamEvent(
  event: Record<string, unknown>,
): StreamEventResult {
  assertNotBlocked(event);

  const result: StreamEventResult = {};

  const candidate = (event.candidates as Record<string, unknown>[])?.[0];
  const parts = (candidate?.content as Record<string, unknown>)?.parts as
    | Record<string, unknown>[]
    | undefined;
  const textVal = readAnswerText(parts);
  if (textVal) {
    result.text = textVal;
  }
  // Gemini's SSE stream carries no `[DONE]` sentinel; the last chunk of a
  // complete response is the one that says why generation stopped.
  if (candidate?.finishReason != null) {
    result.terminal = true;
    if (typeof candidate.finishReason === "string") {
      result.rawStopReason = candidate.finishReason;
      result.stopReason =
        GEMINI_STOP_REASONS[candidate.finishReason] ?? "other";
    }
  }

  // Read the counts, not the container: a `usageMetadata` object whose numbers
  // are null reports nothing, and recording it as a report of zero prices a
  // real call at nothing.
  if (event.usageMetadata) {
    const meta = event.usageMetadata as Record<string, unknown>;
    const promptTokenCount = readTokenCount(meta.promptTokenCount);
    if (promptTokenCount !== undefined) {
      result.inputTokens = promptTokenCount;
    }
    const outputTokens = readGeminiOutputTokens(meta);
    if (outputTokens !== undefined) {
      result.outputTokens = outputTokens;
    }
  }

  return result;
}

/**
 * Gemini's billed output count.
 *
 * `candidatesTokenCount` covers the answer only. A thinking model bills its
 * reasoning as output too and reports it separately as `thoughtsTokenCount`, so
 * reading the first field alone under-counts every call to a 2.5-series model
 * by however much of it was thinking – which on a hard question is most of it.
 */
function readGeminiOutputTokens(
  meta: Record<string, unknown>,
): number | undefined {
  const candidates = readTokenCount(meta.candidatesTokenCount);
  const thoughts = readTokenCount(meta.thoughtsTokenCount);
  if (candidates === undefined && thoughts === undefined) {
    return undefined;
  }

  return (candidates ?? 0) + (thoughts ?? 0);
}

// ============================================================================
// Gemini Runner
// ============================================================================

/** Options for createGeminiRunner */
export interface GeminiRunnerOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** @default undefined */
  timeoutMs?: number;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature. Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Stop sequences. The model will stop generating when it encounters one. */
  stopSequences?: string[];
}

/**
 * Create an AgentRunner for the Google Gemini generateContent API.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * const runner = createGeminiRunner({
 *   apiKey: process.env.GEMINI_API_KEY!,
 *   model: 'gemini-2.0-flash',
 * });
 * const orchestrator = createAgentOrchestrator({ runner });
 * const result = await orchestrator.run(agent, input);
 * ```
 */
export function createGeminiRunner(options: GeminiRunnerOptions): AgentRunner {
  const {
    apiKey,
    model = "gemini-2.0-flash",
    maxOutputTokens,
    baseURL = "https://generativelanguage.googleapis.com/v1beta",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs,
    hooks,
    temperature,
    topP,
    stopSequences,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createGeminiRunner");

  const genConfig: Record<string, unknown> = {};
  if (maxOutputTokens != null) {
    genConfig.maxOutputTokens = maxOutputTokens;
  }
  if (temperature != null) {
    genConfig.temperature = temperature;
  }
  if (topP != null) {
    genConfig.topP = topP;
  }
  if (stopSequences != null) {
    genConfig.stopSequences = stopSequences;
  }
  const hasGenConfig = Object.keys(genConfig).length > 0;

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages, stream) => ({
      // Gemini streams from a different method; the body is identical.
      url: stream
        ? `${baseURL}/models/${agent.model ?? model}:streamGenerateContent?alt=sse`
        : `${baseURL}/models/${agent.model ?? model}:generateContent`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stream ? { Accept: SSE_ACCEPT_HEADER } : {}),
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          ...(agent.instructions
            ? { systemInstruction: { parts: [{ text: agent.instructions }] } }
            : {}),
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          ...(hasGenConfig ? { generationConfig: genConfig } : {}),
        }),
        ...(timeoutMs != null
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      assertNotBlocked(data);
      const text = readAnswerText(data.candidates?.[0]?.content?.parts) ?? "";
      const inputTokens =
        readTokenCount(data.usageMetadata?.promptTokenCount) ?? 0;
      const outputTokens =
        readGeminiOutputTokens(data.usageMetadata ?? {}) ?? 0;
      const finishReason = data.candidates?.[0]?.finishReason;

      return {
        text,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        ...(typeof finishReason === "string"
          ? {
              rawStopReason: finishReason,
              stopReason: GEMINI_STOP_REASONS[finishReason] ?? "other",
            }
          : {}),
        // A `usageMetadata` object holding no usable number says the same
        // thing as no `usageMetadata` at all: nothing was reported.
        usageReported: anyTokenCountReported(
          data.usageMetadata?.promptTokenCount,
          data.usageMetadata?.candidatesTokenCount,
          data.usageMetadata?.thoughtsTokenCount,
        ),
      };
    },
    streaming: {
      adapterName: "Gemini",
      parseEvent: parseGeminiStreamEvent,
      requireTerminalEvent: true,
    },
  });
}

// ============================================================================
// Gemini Streaming Runner
// ============================================================================

/** Options for createGeminiStreamingRunner */
export interface GeminiStreamingRunnerOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * How long the stream may say nothing at all – not even a keep-alive – before
   * the call is abandoned, in milliseconds. `Infinity` disables it.
   *
   * The gap between events, not the length of the call. A stalled stream fails
   * with an error named `"TimeoutError"`.
   *
   * @default 120_000
   */
  timeoutMs?: number;
  /**
   * How long the stream may stay alive and produce nothing, in milliseconds.
   * Keep-alives do not restart this clock. `Infinity` disables it.
   *
   * @default 600_000
   */
  contentTimeoutMs?: number;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature. Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Stop sequences. The model will stop generating when it encounters one. */
  stopSequences?: string[];
}

/**
 * Create a StreamingCallbackRunner for the Gemini streamGenerateContent API
 * with server-sent events. Can be used standalone or paired with `createGeminiRunner`.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * const streamingRunner = createGeminiStreamingRunner({
 *   apiKey: process.env.GEMINI_API_KEY!,
 * });
 * const streamRunner = createStreamingRunner(streamingRunner);
 * const { stream, result } = streamRunner(agent, input);
 * ```
 */
export function createGeminiStreamingRunner(
  options: GeminiStreamingRunnerOptions,
): StreamingCallbackRunner {
  const {
    apiKey,
    model = "gemini-2.0-flash",
    maxOutputTokens,
    baseURL = "https://generativelanguage.googleapis.com/v1beta",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_STREAM_IDLE_MS,
    contentTimeoutMs = DEFAULT_STREAM_STALL_MS,
    hooks,
    temperature,
    topP,
    stopSequences,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createGeminiStreamingRunner");
  validateStreamTimeout(timeoutMs, "createGeminiStreamingRunner");
  validateStreamTimeout(
    contentTimeoutMs,
    "createGeminiStreamingRunner",
    "contentTimeoutMs",
  );

  const genConfig: Record<string, unknown> = {};
  if (maxOutputTokens != null) {
    genConfig.maxOutputTokens = maxOutputTokens;
  }
  if (temperature != null) {
    genConfig.temperature = temperature;
  }
  if (topP != null) {
    genConfig.topP = topP;
  }
  if (stopSequences != null) {
    genConfig.stopSequences = stopSequences;
  }
  const hasGenConfig = Object.keys(genConfig).length > 0;

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);
    const deadline = createStreamDeadline(
      timeoutMs,
      callbacks.signal,
      "Gemini",
      {
        contentMs: contentTimeoutMs,
      },
    );

    try {
      const response = await fetchFn(
        `${baseURL}/models/${agent.model ?? model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: SSE_ACCEPT_HEADER,
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            ...(agent.instructions
              ? { systemInstruction: { parts: [{ text: agent.instructions }] } }
              : {}),
            contents: [{ role: "user", parts: [{ text: input }] }],
            ...(hasGenConfig ? { generationConfig: genConfig } : {}),
          }),
          signal: deadline.signal,
        },
      );
      deadline.progress();

      if (!response.ok) {
        await throwStreamingHTTPError(response, "Gemini");
      }
      await assertEventStreamResponse(response, "Gemini");

      const reader = getStreamReader(response);

      const totals = await parseEventStream(
        reader,
        callbacks.onToken,
        parseGeminiStreamEvent,
        "Gemini",
        "sse",
        { signal: deadline.signal, deadline, requireTerminalEvent: true },
      );

      const { fullText, inputTokens, outputTokens, usageReported } = totals;
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
        {
          stopReason: totals.stopReason,
          rawStopReason: totals.rawStopReason,
        },
      );
    } catch (err) {
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
