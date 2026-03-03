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
  Message,
  TokenUsage,
} from "../types.js";
import type { StreamingCallbackRunner } from "../types.js";

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

  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production" &&
    !apiKey
  ) {
    console.warn(
      "[Directive] createGeminiRunner: apiKey is empty. API calls will fail.",
    );
  }

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

  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production" &&
    !apiKey
  ) {
    console.warn(
      "[Directive] createGeminiStreamingRunner: apiKey is empty. API calls will fail.",
    );
  }

  return async (agent, input, callbacks) => {
    const startTime = Date.now();
    hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

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
        const errBody = await response.text().catch(() => "");

        throw new Error(
          `[Directive] Gemini streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("[Directive] No response body");
      }

      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) {
              continue;
            }
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              continue;
            }

            try {
              const event = JSON.parse(data);

              // Extract text from candidates
              const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                fullText += text;
                callbacks.onToken?.(text);
              }

              // Extract usage metadata from any chunk that has it
              if (event.usageMetadata) {
                inputTokens =
                  event.usageMetadata.promptTokenCount ?? inputTokens;
                outputTokens =
                  event.usageMetadata.candidatesTokenCount ?? outputTokens;
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) {
                if (
                  typeof process !== "undefined" &&
                  process.env?.NODE_ENV === "development"
                ) {
                  console.warn(
                    "[Directive] Malformed SSE event from Gemini:",
                    data,
                  );
                }
              } else {
                throw parseErr;
              }
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      const assistantMsg: Message = { role: "assistant", content: fullText };
      callbacks.onMessage?.(assistantMsg);

      const tokenUsage: TokenUsage = { inputTokens, outputTokens };
      const totalTokens = inputTokens + outputTokens;

      hooks?.onAfterCall?.({
        agent,
        input,
        output: fullText,
        totalTokens,
        tokenUsage,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      });

      return {
        output: fullText,
        messages: [{ role: "user" as const, content: input }, assistantMsg],
        toolCalls: [],
        totalTokens,
        tokenUsage,
      };
    } catch (err) {
      if (err instanceof Error) {
        hooks?.onError?.({
          agent,
          input,
          error: err,
          durationMs: Date.now() - startTime,
          timestamp: Date.now(),
        });
      }

      throw err;
    }
  };
}
