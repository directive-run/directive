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

import { createRunner, validateBaseURL } from "../helpers.js";
import type { AdapterHooks, AgentRunner, Message, TokenUsage } from "../types.js";
import type { StreamingCallbackRunner } from "../stack.js";
import type { EmbedderFn, Embedding } from "../guardrails/semantic-cache.js";

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
export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
	"gpt-4o": { input: 2.5, output: 10 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
	"gpt-4-turbo": { input: 10, output: 30 },
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
	} = options;

	validateBaseURL(baseURL);

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createOpenAIRunner: apiKey is empty. API calls will fail.");
	}

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
					messages: [
						...(agent.instructions
							? [{ role: "system", content: agent.instructions }]
							: []),
						...messages.map((m) => ({ role: m.role, content: m.content })),
					],
				}),
				...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createOpenAIEmbedder: apiKey is empty. API calls will fail.");
	}

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
 * const stack = createAgentStack({
 *   runner: createOpenAIRunner({ apiKey }),
 *   streaming: { runner: streamingRunner },
 *   agents: { ... },
 * });
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
	} = options;

	validateBaseURL(baseURL);

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createOpenAIStreamingRunner: apiKey is empty. API calls will fail.");
	}

	return async (agent, input, callbacks) => {
		const startTime = Date.now();
		hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

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
				const errBody = await response.text().catch(() => "");

				throw new Error(
					`[Directive] OpenAI streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
				);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("[Directive] No response body");
			}

			const decoder = new TextDecoder();
			let buf = "";
			let fullText = "";
			let promptTokens = 0;
			let completionTokens = 0;

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

							// Extract token content from delta
							const delta = event.choices?.[0]?.delta;
							if (delta?.content) {
								fullText += delta.content;
								callbacks.onToken?.(delta.content);
							}

							// Extract usage from the final chunk (stream_options: include_usage)
							if (event.usage) {
								promptTokens = event.usage.prompt_tokens ?? 0;
								completionTokens = event.usage.completion_tokens ?? 0;
							}
						} catch (parseErr) {
							if (parseErr instanceof SyntaxError) {
								if (
									typeof process !== "undefined" &&
									process.env?.NODE_ENV === "development"
								) {
									console.warn(
										"[Directive] Malformed SSE event from OpenAI:",
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

			const tokenUsage: TokenUsage = {
				inputTokens: promptTokens,
				outputTokens: completionTokens,
			};
			const totalTokens = promptTokens + completionTokens;

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
