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
} from "./shared.js";

// ============================================================================
// Pricing Constants
// ============================================================================

/**
 * Ollama model pricing (USD per million tokens).
 *
 * Ollama runs locally — all costs are zero. This table is provided for
 * compatibility with `estimateCost()` so local models integrate seamlessly
 * into cost-tracking pipelines.
 *
 * @example
 * ```typescript
 * import { estimateCost } from '@directive-run/ai';
 * import { OLLAMA_PRICING } from '@directive-run/ai/ollama';
 *
 * const cost =
 *   estimateCost(result.tokenUsage!.inputTokens, OLLAMA_PRICING["llama3"].input) +
 *   estimateCost(result.tokenUsage!.outputTokens, OLLAMA_PRICING["llama3"].output);
 * // → 0
 * ```
 */
export const OLLAMA_PRICING: Record<string, { input: number; output: number }> =
  {
    llama3: { input: 0, output: 0 },
    "llama3.1": { input: 0, output: 0 },
    "llama3.2": { input: 0, output: 0 },
    "llama3.3": { input: 0, output: 0 },
    mistral: { input: 0, output: 0 },
    mixtral: { input: 0, output: 0 },
    codellama: { input: 0, output: 0 },
    "gemma2": { input: 0, output: 0 },
    phi3: { input: 0, output: 0 },
    qwen2: { input: 0, output: 0 },
    deepseek: { input: 0, output: 0 },
    "deepseek-coder": { input: 0, output: 0 },
    "command-r": { input: 0, output: 0 },
  };

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
    buildRequest: (agent, _input, messages) => ({
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
          stream: false,
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
      const inputTokens = (data.prompt_eval_count as number) ?? 0;
      const outputTokens = (data.eval_count as number) ?? 0;

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
// Ollama Streaming Runner
// ============================================================================

/** Options for createOllamaStreamingRunner */
export interface OllamaStreamingRunnerOptions {
  model?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
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

  return async (agent, input, callbacks) => {
    const startTime = fireBeforeCallHook(hooks, agent, input);

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
        signal: callbacks.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");

        throw new Error(
          `[Directive] Ollama streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("[Directive] No response body from Ollama");
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
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }

            let chunk: Record<string, unknown>;
            try {
              chunk = JSON.parse(trimmed);
            } catch {
              if (
                typeof process !== "undefined" &&
                process.env?.NODE_ENV === "development"
              ) {
                console.warn(
                  "[Directive] Malformed streaming chunk from Ollama:",
                  trimmed,
                );
              }

              continue;
            }

            const msg = chunk.message as
              | Record<string, unknown>
              | undefined;
            const content = (msg?.content as string) ?? "";
            if (content) {
              fullText += content;
              callbacks.onToken?.(content);
            }

            if (chunk.done) {
              inputTokens =
                (chunk.prompt_eval_count as number) ?? 0;
              outputTokens = (chunk.eval_count as number) ?? 0;
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }

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
