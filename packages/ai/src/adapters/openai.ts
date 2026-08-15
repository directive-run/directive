/**
 * @directive-run/ai/openai
 *
 * OpenAI adapter for Directive AI. Provides runners and embedders
 * for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * @example
 * ```typescript
 * import { createOpenAIRunner, createOpenAIEmbedder } from '@directive-run/ai/openai';
 *
 * const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
 * const embedder = createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
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
import type { EmbedderFn, Embedding } from "../guardrails/semantic-cache.js";
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

/** The single source of OpenAI rates. Widened below; never exported raw. */
const OPENAI_RATES = {
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "o4-mini": { input: 1.1, output: 4.4 },
  o3: { input: 10, output: 40 },
  "o3-mini": { input: 1.1, output: 4.4 },
};

/**
 * OpenAI model pricing (USD per million tokens).
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
 * {@link OPENAI_TOKEN_PRICING} is an alias for this table, kept for callers
 * that already reference it.
 *
 * @example
 * ```typescript
 * import { estimateCost, withBudget } from '@directive-run/ai';
 * import { OPENAI_PRICING } from '@directive-run/ai/openai';
 *
 * const rates = OPENAI_PRICING["gpt-4o"];
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
 * and may not reflect the latest rates. Always verify at https://openai.com/pricing
 */
/**
 * The date the rates in {@link OPENAI_PRICING} were last checked against
 * https://openai.com/api/pricing.
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
export const OPENAI_PRICING_AS_OF = "2026-08-14";

export const OPENAI_PRICING: Record<string, ModelPricing> = toTokenPricingTable(
  OPENAI_RATES,
  "OPENAI_PRICING",
);

/**
 * Alias for {@link OPENAI_PRICING} — the same object, not a copy.
 *
 * The two names once held different shapes, one for `estimateCost` and one for
 * `withBudget`. They no longer do: a single widened table serves both, so
 * whichever name a caller reaches for is the right one. This export remains so
 * existing code keeps working.
 */
export const OPENAI_TOKEN_PRICING: Record<string, ModelPricing> =
  OPENAI_PRICING;

// ============================================================================
// Shared Stream Event Parsing
// ============================================================================

/**
 * Extract text and token counts from one OpenAI chat-completion SSE event.
 *
 * Shared by the streaming path of `createOpenAIRunner` and by
 * `createOpenAIStreamingRunner` so the two cannot drift.
 */
/** OpenAI's `finish_reason` values, in the shared vocabulary. */
const OPENAI_STOP_REASONS: Record<string, StopReason> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "content_filter",
};

function parseOpenAIStreamEvent(
  event: Record<string, unknown>,
): StreamEventResult {
  const result: StreamEventResult = {};

  const choice = (event.choices as Record<string, unknown>[])?.[0];
  const delta = choice?.delta as Record<string, unknown> | undefined;
  if (delta?.content) {
    result.text = delta.content as string;
  }
  // The completion ended. `[DONE]` says the same thing and the parser reads it
  // directly, but gateways vary in which of the two they send.
  if (choice?.finish_reason != null) {
    result.terminal = true;
    if (typeof choice.finish_reason === "string") {
      result.rawStopReason = choice.finish_reason;
      result.stopReason = OPENAI_STOP_REASONS[choice.finish_reason] ?? "other";
    }
  }

  // Read the counts, not the container. A gateway that forwards
  // `"usage":{"prompt_tokens":null,"completion_tokens":null}` has reported no
  // usage at all; treating the object's presence as a report recorded the call
  // as costing zero, which is the one answer that is certainly wrong.
  if (event.usage) {
    const usage = event.usage as Record<string, unknown>;
    const promptTokens = readTokenCount(usage.prompt_tokens);
    if (promptTokens !== undefined) {
      result.inputTokens = promptTokens;
    }
    const completionTokens = readTokenCount(usage.completion_tokens);
    if (completionTokens !== undefined) {
      result.outputTokens = completionTokens;
    }
  }

  return result;
}

// ============================================================================
// OpenAI Runner
// ============================================================================

/** Options for createOpenAIRunner */
export interface OpenAIRunnerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** @default undefined */
  timeoutMs?: number;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature (0–2). Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Up to 4 sequences where the API will stop generating. */
  stop?: string | string[];
  /**
   * Response format for structured output.
   * - `"json"` enables JSON mode (`{ type: "json_object" }`)
   * - Object form enables JSON Schema mode (`{ type: "json_schema", json_schema: ... }`)
   */
  responseFormat?: "json" | { type: "json_schema"; json_schema: unknown };
  /**
   * Ask the endpoint for a token-usage frame at the end of a streamed response
   * (`stream_options: { include_usage: true }`).
   *
   * On by default, because without it a streamed call reports no usage at all
   * and every ledger downstream falls back to an estimate. Turn it off for
   * endpoints that reject the parameter rather than ignoring it: Azure OpenAI
   * below api-version 2024-06-01 answers 400, which made every streamed call
   * through such a deployment fail outright with no way to ask for anything
   * else.
   *
   * @default true
   */
  includeUsage?: boolean;
}

/**
 * Create an AgentRunner for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * // OpenAI
 * const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
 *
 * // Azure OpenAI
 * const azure = createOpenAIRunner({
 *   apiKey: process.env.AZURE_KEY!,
 *   baseURL: "https://your-resource.openai.azure.com/v1",
 * });
 *
 * // Together.ai (OpenAI-compatible)
 * const together = createOpenAIRunner({
 *   apiKey: process.env.TOGETHER_KEY!,
 *   baseURL: "https://api.together.xyz/v1",
 * });
 * ```
 */
export function createOpenAIRunner(options: OpenAIRunnerOptions): AgentRunner {
  const {
    apiKey,
    model = "gpt-4o",
    maxTokens,
    baseURL = "https://api.openai.com/v1",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs,
    includeUsage = true,
    hooks,
    temperature,
    topP,
    stop,
    responseFormat,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createOpenAIRunner");

  const resolvedResponseFormat =
    responseFormat === "json"
      ? { type: "json_object" as const }
      : (responseFormat ?? undefined);

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages, stream) => ({
      url: `${baseURL}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stream ? { Accept: SSE_ACCEPT_HEADER } : {}),
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: agent.model ?? model,
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(stop != null ? { stop } : {}),
          ...(resolvedResponseFormat != null
            ? { response_format: resolvedResponseFormat }
            : {}),
          messages: [
            ...(agent.instructions
              ? [{ role: "system", content: agent.instructions }]
              : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          // Omitted entirely when buffering, so the non-streaming request
          // stays byte-for-byte what it was. `include_usage` keeps the token
          // breakdown available on the streaming path.
          ...(stream
            ? {
                stream: true,
                ...(includeUsage
                  ? { stream_options: { include_usage: true } }
                  : {}),
              }
            : {}),
        }),
        ...(timeoutMs != null
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;
      const finishReason = data.choices?.[0]?.finish_reason;

      return {
        text,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        ...(typeof finishReason === "string"
          ? {
              rawStopReason: finishReason,
              stopReason: OPENAI_STOP_REASONS[finishReason] ?? "other",
            }
          : {}),
        // Gateways that strip `usage` – or null out the counts inside it –
        // leave zeros behind; say so rather than letting cost tracking read
        // the response as free.
        usageReported: anyTokenCountReported(
          data.usage?.prompt_tokens,
          data.usage?.completion_tokens,
        ),
      };
    },
    streaming: {
      adapterName: "OpenAI",
      parseEvent: parseOpenAIStreamEvent,
      requireTerminalEvent: true,
    },
  });
}

// ============================================================================
// OpenAI Embedder
// ============================================================================

/** Options for createOpenAIEmbedder */
export interface OpenAIEmbedderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** @default 30000 */
  timeoutMs?: number;
}

/**
 * Create an EmbedderFn that calls the OpenAI embeddings API.
 *
 * @example
 * ```typescript
 * const embedder = createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
 * const embedding = await embedder('How do constraints work?');
 * ```
 */
export function createOpenAIEmbedder(
  options: OpenAIEmbedderOptions,
): EmbedderFn {
  const {
    apiKey,
    model = "text-embedding-3-small",
    dimensions = 1536,
    baseURL = "https://api.openai.com/v1",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createOpenAIEmbedder");

  return async (text: string): Promise<Embedding> => {
    const response = await fetchFn(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text, dimensions }),
      signal: AbortSignal.timeout(timeoutMs ?? 30_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");

      throw new Error(
        `[Directive] OpenAI embedding failed: ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    const entry = data.data[0];
    if (!entry) {
      throw new Error(
        "[Directive] OpenAI embedding response contained no data entries",
      );
    }

    return entry.embedding;
  };
}

// ============================================================================
// OpenAI Streaming Runner
// ============================================================================

/** Options for createOpenAIStreamingRunner */
export interface OpenAIStreamingRunnerOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature (0–2). Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Up to 4 sequences where the API will stop generating. */
  stop?: string | string[];
  /**
   * Response format for structured output.
   * - `"json"` enables JSON mode (`{ type: "json_object" }`)
   * - Object form enables JSON Schema mode (`{ type: "json_schema", json_schema: ... }`)
   */
  responseFormat?: "json" | { type: "json_schema"; json_schema: unknown };
  /**
   * How long the stream may say nothing at all – not even a keep-alive – before
   * the call is abandoned, in milliseconds.
   *
   * The gap between events, not the length of the call: a streamed response runs
   * for as long as the model has something to say, so a wall-clock cap either
   * truncates a long answer or bounds nothing. A stalled stream fails with an
   * error named `"TimeoutError"`. `Infinity` disables it.
   *
   * @default 120_000
   */
  timeoutMs?: number;
  /**
   * How long the stream may stay alive and produce nothing, in milliseconds.
   *
   * Keep-alives do not restart this clock, which is the point of it: a provider
   * wedged behind a queue keeps its connection warm indefinitely. `Infinity`
   * disables it.
   *
   * @default 600_000
   */
  contentTimeoutMs?: number;
  /**
   * Ask the endpoint for a token-usage frame at the end of a streamed response
   * (`stream_options: { include_usage: true }`).
   *
   * On by default, because without it a streamed call reports no usage at all
   * and every ledger downstream falls back to an estimate. Turn it off for
   * endpoints that reject the parameter rather than ignoring it: Azure OpenAI
   * below api-version 2024-06-01 answers 400, which made every streamed call
   * through such a deployment fail outright with no way to ask for anything
   * else.
   *
   * @default true
   */
  includeUsage?: boolean;
}

/**
 * Create a StreamingCallbackRunner for OpenAI-compatible chat completions
 * with server-sent events. Can be used standalone or paired with `createOpenAIRunner`.
 *
 * Returns `tokenUsage` with input/output breakdown for cost tracking.
 *
 * @example
 * ```typescript
 * const streamingRunner = createOpenAIStreamingRunner({
 *   apiKey: process.env.OPENAI_API_KEY!,
 * });
 * const streamRunner = createStreamingRunner(streamingRunner);
 * const { stream, result } = streamRunner(agent, input);
 * ```
 */
export function createOpenAIStreamingRunner(
  options: OpenAIStreamingRunnerOptions,
): StreamingCallbackRunner {
  const {
    apiKey,
    model = "gpt-4o",
    maxTokens,
    baseURL = "https://api.openai.com/v1",
    fetch: fetchFn = globalThis.fetch,
    timeoutMs = DEFAULT_STREAM_IDLE_MS,
    contentTimeoutMs = DEFAULT_STREAM_STALL_MS,
    includeUsage = true,
    hooks,
    temperature,
    topP,
    stop,
    responseFormat,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createOpenAIStreamingRunner");
  validateStreamTimeout(timeoutMs, "createOpenAIStreamingRunner");
  validateStreamTimeout(
    contentTimeoutMs,
    "createOpenAIStreamingRunner",
    "contentTimeoutMs",
  );

  const resolvedResponseFormat =
    responseFormat === "json"
      ? { type: "json_object" as const }
      : (responseFormat ?? undefined);

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);
    // `createStreamDeadline` was always provider-agnostic; it simply had not
    // been adopted here. A streamed OpenAI call had nothing but the caller's
    // own signal between it and a connection that stays open and silent.
    const deadline = createStreamDeadline(
      timeoutMs,
      callbacks.signal,
      "OpenAI",
      {
        contentMs: contentTimeoutMs,
      },
    );

    try {
      const response = await fetchFn(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: SSE_ACCEPT_HEADER,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: agent.model ?? model,
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(stop != null ? { stop } : {}),
          ...(resolvedResponseFormat != null
            ? { response_format: resolvedResponseFormat }
            : {}),
          messages: [
            ...(agent.instructions
              ? [{ role: "system", content: agent.instructions }]
              : []),
            { role: "user", content: input },
          ],
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        }),
        signal: deadline.signal,
      });
      deadline.progress();

      if (!response.ok) {
        await throwStreamingHTTPError(response, "OpenAI");
      }
      await assertEventStreamResponse(response, "OpenAI");

      const reader = getStreamReader(response);

      const totals = await parseEventStream(
        reader,
        callbacks.onToken,
        parseOpenAIStreamEvent,
        "OpenAI",
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
