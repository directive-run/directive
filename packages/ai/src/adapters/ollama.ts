/**
 * @directive-run/ai/ollama
 *
 * Ollama adapter for Directive AI. Provides runners for local
 * Ollama inference. No API key required.
 *
 * Requires Ollama to be running locally. Start it with: `ollama serve`
 *
 * @example
 * ```typescript
 * import { createOllamaRunner } from '@directive-run/ai/ollama';
 *
 * const runner = createOllamaRunner({ model: 'llama3' });
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
  anyTokenCountReported,
  buildStreamingResult,
  fireAfterCallHook,
  fireBeforeCallHook,
  fireErrorHook,
  getStreamReader,
  parseEventStream,
  readTokenCount,
  throwStreamingHTTPError,
} from "./shared.js";

// ============================================================================
// Pricing Constants
// ============================================================================

/** The single source of Ollama rates. Widened below; never exported raw. */
const OLLAMA_RATES = {
  llama3: { input: 0, output: 0 },
  "llama3.1": { input: 0, output: 0 },
  "llama3.2": { input: 0, output: 0 },
  "llama3.3": { input: 0, output: 0 },
  mistral: { input: 0, output: 0 },
  mixtral: { input: 0, output: 0 },
  codellama: { input: 0, output: 0 },
  gemma2: { input: 0, output: 0 },
  phi3: { input: 0, output: 0 },
  qwen2: { input: 0, output: 0 },
  deepseek: { input: 0, output: 0 },
  "deepseek-coder": { input: 0, output: 0 },
  "command-r": { input: 0, output: 0 },
};

/**
 * Ollama model pricing (USD per million tokens).
 *
 * Ollama runs locally, so every rate is 0. The table exists so cost tracking
 * and budget wiring are written identically whether the runner points at a
 * local model or a paid API.
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
 * {@link OLLAMA_TOKEN_PRICING} is an alias for this table, kept for callers
 * that already reference it.
 *
 * @example
 * ```typescript
 * import { estimateCost, withBudget } from '@directive-run/ai';
 * import { OLLAMA_PRICING } from '@directive-run/ai/ollama';
 *
 * const rates = OLLAMA_PRICING["llama3"];
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, rates.input) +
 *   estimateCost(result.tokenUsage!.outputTokens, rates.output);
 * // → 0
 *
 * const guarded = withBudget(runner, {
 *   pricing: rates,
 *   budgets: [{ window: "day", maxCost: 10, pricing: rates }],
 * });
 * ```
 */
/**
 * The date the rates in {@link OLLAMA_PRICING} were last checked against
 * https://ollama.com.
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
export const OLLAMA_PRICING_AS_OF = "2026-08-14";

export const OLLAMA_PRICING: Record<string, ModelPricing> = toTokenPricingTable(
  OLLAMA_RATES,
  "OLLAMA_PRICING",
);

/**
 * Alias for {@link OLLAMA_PRICING} — the same object, not a copy.
 *
 * The two names once held different shapes, one for `estimateCost` and one for
 * `withBudget`. They no longer do: a single widened table serves both, so
 * whichever name a caller reaches for is the right one. This export remains so
 * existing code keeps working.
 */
export const OLLAMA_TOKEN_PRICING: Record<string, ModelPricing> =
  OLLAMA_PRICING;

// ============================================================================
// Shared Stream Chunk Parsing
// ============================================================================

/**
 * Extract text and token counts from one Ollama streaming chunk.
 *
 * Ollama frames its stream as newline-delimited JSON rather than server-sent
 * events, and reports token counts only on the final `done` chunk.
 */
/** Ollama's `done_reason` values, in the shared vocabulary. */
const OLLAMA_STOP_REASONS: Record<string, StopReason> = {
  stop: "stop",
  length: "length",
  load: "other",
  unload: "other",
};

function parseOllamaStreamChunk(
  chunk: Record<string, unknown>,
): StreamEventResult {
  // Ollama reports a mid-generation failure – a model that will not fit in
  // memory, a model pulled out from under the call – as an `error` field on a
  // chunk of an otherwise healthy HTTP 200 body. Without this it parses as an
  // event carrying nothing, and the run ends as a stream with no completion
  // marker rather than as the failure it is.
  if (typeof chunk.error === "string" && chunk.error !== "") {
    throw new Error(`[Directive] Ollama stream error: ${chunk.error}`);
  }

  const result: StreamEventResult = {};

  const message = chunk.message as Record<string, unknown> | undefined;
  const content = message?.content as string | undefined;
  if (content) {
    result.text = content;
  }

  if (chunk.done) {
    result.terminal = true;
    if (typeof chunk.done_reason === "string") {
      result.rawStopReason = chunk.done_reason;
      result.stopReason = OLLAMA_STOP_REASONS[chunk.done_reason] ?? "other";
    }
    // Left unset when the field holds no usable number, so a `done` chunk
    // stripped of its counts is recorded as unpriceable rather than free.
    const promptEvalCount = readTokenCount(chunk.prompt_eval_count);
    if (promptEvalCount !== undefined) {
      result.inputTokens = promptEvalCount;
    }
    const evalCount = readTokenCount(chunk.eval_count);
    if (evalCount !== undefined) {
      result.outputTokens = evalCount;
    }
  }

  return result;
}

// ============================================================================
// Ollama Runner
// ============================================================================

/** Options for createOllamaRunner */
export interface OllamaRunnerOptions {
  model?: string;
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
  stop?: string[];
  /** Maximum number of tokens to generate. Ollama uses `num_predict`. */
  numPredict?: number;
}

/**
 * Create an AgentRunner for local Ollama inference.
 *
 * Ollama runs locally – no API key or cloud service needed. Default model
 * is `llama3`, default base URL is `http://localhost:11434`.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking
 * (useful for monitoring local resource usage).
 *
 * @example
 * ```typescript
 * const runner = createOllamaRunner({ model: "llama3" });
 * const orchestrator = createAgentOrchestrator({ runner });
 * const result = await orchestrator.run(agent, input);
 * ```
 */
export function createOllamaRunner(
  options: OllamaRunnerOptions = {},
): AgentRunner {
  const {
    model = "llama3",
    baseURL = "http://localhost:11434",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs,
    hooks,
    temperature,
    topP,
    stop,
    numPredict,
  } = options;

  validateBaseURL(baseURL);

  const ollamaOptions: Record<string, unknown> = {};
  if (temperature != null) {
    ollamaOptions.temperature = temperature;
  }
  if (topP != null) {
    ollamaOptions.top_p = topP;
  }
  if (stop != null) {
    ollamaOptions.stop = stop;
  }
  if (numPredict != null) {
    ollamaOptions.num_predict = numPredict;
  }
  const hasOptions = Object.keys(ollamaOptions).length > 0;

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages, stream) => ({
      url: `${baseURL}/api/chat`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: agent.model ?? model,
          messages: [
            ...(agent.instructions
              ? [{ role: "system", content: agent.instructions }]
              : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream,
          ...(hasOptions ? { options: ollamaOptions } : {}),
        }),
        ...(timeoutMs != null
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      },
    }),
    parseResponse: async (res) => {
      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `[Directive] Ollama returned non-JSON response. Is Ollama running at ${baseURL}? Start it with: ollama serve`,
        );
      }
      const text =
        ((data.message as Record<string, unknown>)?.content as string) ?? "";
      const inputTokens = readTokenCount(data.prompt_eval_count) ?? 0;
      const outputTokens = readTokenCount(data.eval_count) ?? 0;
      const doneReason = data.done_reason;

      return {
        text,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        ...(typeof doneReason === "string"
          ? {
              rawStopReason: doneReason,
              stopReason: OLLAMA_STOP_REASONS[doneReason] ?? "other",
            }
          : {}),
        usageReported: anyTokenCountReported(
          data.prompt_eval_count,
          data.eval_count,
        ),
      };
    },
    streaming: {
      adapterName: "Ollama",
      wireFormat: "ndjson",
      parseEvent: parseOllamaStreamChunk,
      requireTerminalEvent: true,
    },
  });
}

// ============================================================================
// Ollama Streaming Runner
// ============================================================================

/** Options for createOllamaStreamingRunner */
export interface OllamaStreamingRunnerOptions {
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * How long the stream may say nothing at all before the call is abandoned, in
   * milliseconds. `Infinity` disables it.
   *
   * The gap between chunks, not the length of the call. A stalled stream fails
   * with an error named `"TimeoutError"`.
   *
   * @default 120_000
   */
  timeoutMs?: number;
  /**
   * How long the stream may stay alive and produce nothing, in milliseconds.
   * `Infinity` disables it.
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
  stop?: string[];
  /** Maximum number of tokens to generate. Ollama uses `num_predict`. */
  numPredict?: number;
}

/**
 * Create a StreamingCallbackRunner for local Ollama inference with
 * chunked JSON streaming. Can be used standalone or paired with `createOllamaRunner`.
 *
 * Ollama streams newline-delimited JSON objects with `{ message: { content }, done }`.
 * Token counts are included in the final chunk (`prompt_eval_count`, `eval_count`).
 *
 * Returns `tokenUsage` with input/output breakdown for resource tracking.
 *
 * @example
 * ```typescript
 * const streamingRunner = createOllamaStreamingRunner({ model: 'llama3' });
 * const streamRunner = createStreamingRunner(streamingRunner);
 * const { stream, result } = streamRunner(agent, input);
 * ```
 */
export function createOllamaStreamingRunner(
  options: OllamaStreamingRunnerOptions = {},
): StreamingCallbackRunner {
  const {
    model = "llama3",
    baseURL = "http://localhost:11434",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_STREAM_IDLE_MS,
    contentTimeoutMs = DEFAULT_STREAM_STALL_MS,
    hooks,
    temperature,
    topP,
    stop,
    numPredict,
  } = options;

  validateBaseURL(baseURL);
  validateStreamTimeout(timeoutMs, "createOllamaStreamingRunner");
  validateStreamTimeout(
    contentTimeoutMs,
    "createOllamaStreamingRunner",
    "contentTimeoutMs",
  );

  const ollamaOptions: Record<string, unknown> = {};
  if (temperature != null) {
    ollamaOptions.temperature = temperature;
  }
  if (topP != null) {
    ollamaOptions.top_p = topP;
  }
  if (stop != null) {
    ollamaOptions.stop = stop;
  }
  if (numPredict != null) {
    ollamaOptions.num_predict = numPredict;
  }
  const hasOptions = Object.keys(ollamaOptions).length > 0;

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);
    const deadline = createStreamDeadline(
      timeoutMs,
      callbacks.signal,
      "Ollama",
      {
        contentMs: contentTimeoutMs,
      },
    );

    try {
      const response = await fetchFn(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: agent.model ?? model,
          messages: [
            ...(agent.instructions
              ? [{ role: "system", content: agent.instructions }]
              : []),
            { role: "user", content: input },
          ],
          stream: true,
          ...(hasOptions ? { options: ollamaOptions } : {}),
        }),
        signal: deadline.signal,
      });
      deadline.progress();

      if (!response.ok) {
        await throwStreamingHTTPError(response, "Ollama");
      }

      const reader = getStreamReader(response);

      const totals = await parseEventStream(
        reader,
        callbacks.onToken,
        parseOllamaStreamChunk,
        "Ollama",
        "ndjson",
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
