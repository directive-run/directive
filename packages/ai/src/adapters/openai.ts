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

import { createRunner, validateBaseURL } from "../agent-utils.js";
import type { EmbedderFn, Embedding } from "../guardrails/semantic-cache.js";
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
 * OpenAI model pricing (USD per million tokens).
 *
 * Use with `estimateCost()` for per-call cost tracking:
 * ```typescript
 * import { estimateCost } from '@directive-run/ai';
 * import { OPENAI_PRICING } from '@directive-run/ai/openai';
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, OPENAI_PRICING["gpt-4o"].input) +
 *   estimateCost(result.tokenUsage!.outputTokens, OPENAI_PRICING["gpt-4o"].output);
 * ```
 *
 * **Note:** Pricing changes over time. These values are provided as a convenience
 * and may not reflect the latest rates. Always verify at https://openai.com/pricing
 */
export const OPENAI_PRICING: Record<string, { input: number; output: number }> =
  {
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10, output: 30 },
    "o4-mini": { input: 1.1, output: 4.4 },
    "o3": { input: 10, output: 40 },
    "o3-mini": { input: 1.1, output: 4.4 },
  };

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
      : responseFormat ?? undefined;

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages) => ({
      url: `${baseURL}/chat/completions`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
    hooks,
    temperature,
    topP,
    stop,
    responseFormat,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createOpenAIStreamingRunner");

  const resolvedResponseFormat =
    responseFormat === "json"
      ? { type: "json_object" as const }
      : responseFormat ?? undefined;

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);

    try {
      const response = await fetchFn(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
          stream_options: { include_usage: true },
        }),
        signal: callbacks.signal,
      });

      if (!response.ok) {
        await throwStreamingHTTPError(response, "OpenAI");
      }

      const reader = getSSEReader(response);

      const { fullText, inputTokens, outputTokens } = await parseSSEStream(
        reader,
        callbacks.onToken,
        (event) => {
          const result: { text?: string; inputTokens?: number; outputTokens?: number } = {};

          const delta = (event.choices as Array<Record<string, unknown>>)?.[0]
            ?.delta as Record<string, unknown> | undefined;
          if (delta?.content) {
            result.text = delta.content as string;
          }

          if (event.usage) {
            result.inputTokens = (event.usage as Record<string, unknown>).prompt_tokens as number ?? 0;
            result.outputTokens = (event.usage as Record<string, unknown>).completion_tokens as number ?? 0;
          }

          return result;
        },
        "OpenAI",
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
