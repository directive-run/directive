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
 * Gemini model pricing (USD per million tokens).
 *
 * Use with `estimateCost()` for per-call cost tracking:
 * ```typescript
 * import { estimateCost } from '@directive-run/ai';
 * import { GEMINI_PRICING } from '@directive-run/ai/gemini';
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, GEMINI_PRICING["gemini-2.0-flash"].input) +
 *   estimateCost(result.tokenUsage!.outputTokens, GEMINI_PRICING["gemini-2.0-flash"].output);
 * ```
 *
 * **Note:** Pricing changes over time. These values are provided as a convenience
 * and may not reflect the latest rates. Always verify at https://ai.google.dev/pricing
 */
export const GEMINI_PRICING: Record<string, { input: number; output: number }> =
  {
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.0-flash-lite": { input: 0.025, output: 0.1 },
  };

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
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createGeminiRunner");

  return createRunner({
    fetch: fetchFn,
    hooks,
    buildRequest: (agent, _input, messages) => ({
      url: `${baseURL}/models/${agent.model ?? model}:generateContent`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
          ...(maxOutputTokens != null
            ? { generationConfig: { maxOutputTokens } }
            : {}),
        }),
        ...(timeoutMs != null
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {}),
      },
    }),
    parseResponse: async (res) => {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

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
// Gemini Streaming Runner
// ============================================================================

/** Options for createGeminiStreamingRunner */
export interface GeminiStreamingRunnerOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
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
    hooks,
  } = options;

  validateBaseURL(baseURL);
  warnIfMissingApiKey(apiKey, "createGeminiStreamingRunner");

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);

    try {
      const response = await fetchFn(
        `${baseURL}/models/${agent.model ?? model}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            ...(agent.instructions
              ? { systemInstruction: { parts: [{ text: agent.instructions }] } }
              : {}),
            contents: [{ role: "user", parts: [{ text: input }] }],
            ...(maxOutputTokens != null
              ? { generationConfig: { maxOutputTokens } }
              : {}),
          }),
          signal: callbacks.signal,
        },
      );

      if (!response.ok) {
        await throwStreamingHTTPError(response, "Gemini");
      }

      const reader = getSSEReader(response);

      const { fullText, inputTokens, outputTokens } = await parseSSEStream(
        reader,
        callbacks.onToken,
        (event) => {
          const result: { text?: string; inputTokens?: number; outputTokens?: number } = {};

          const text = (
            (event.candidates as Array<Record<string, unknown>>)?.[0]
              ?.content as Record<string, unknown>
          )?.parts as Array<Record<string, unknown>> | undefined;
          const textVal = text?.[0]?.text;
          if (textVal) {
            result.text = textVal as string;
          }

          if (event.usageMetadata) {
            const meta = event.usageMetadata as Record<string, unknown>;
            if (meta.promptTokenCount !== undefined) {
              result.inputTokens = meta.promptTokenCount as number;
            }
            if (meta.candidatesTokenCount !== undefined) {
              result.outputTokens = meta.candidatesTokenCount as number;
            }
          }

          return result;
        },
        "Gemini",
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
