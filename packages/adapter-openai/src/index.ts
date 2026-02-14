/**
 * @directive-run/adapter-openai
 *
 * OpenAI adapter for Directive AI. Provides runners and embedders
 * for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * @example
 * ```typescript
 * import { createOpenAIRunner, createOpenAIEmbedder } from '@directive-run/adapter-openai';
 *
 * const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
 * const embedder = createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
 * ```
 */

import { createRunner } from "@directive-run/ai";
import type {
	AgentRunner,
	EmbedderFn,
	Embedding,
	StreamingCallbackRunner,
	Message,
} from "@directive-run/ai";

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
}

/**
 * Create an AgentRunner for OpenAI-compatible APIs (OpenAI, Azure, Together, etc.)
 *
 * @example
 * ```typescript
 * const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });
 * const stack = createAgentStack({ runner, agents: { ... } });
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
	} = options;

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createOpenAIRunner: apiKey is empty. API calls will fail.");
	}

	return createRunner({
		fetch: fetchFn,
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
			const totalTokens =
				(data.usage?.prompt_tokens ?? 0) +
				(data.usage?.completion_tokens ?? 0);

			return { text, totalTokens };
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
				`[Directive] OpenAI embedding failed: ${response.status}${errBody ? ` - ${errBody.slice(0, 200)}` : ""}`,
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
}

/**
 * Create a StreamingCallbackRunner for OpenAI-compatible chat completions
 * with server-sent events. Pairs with `createOpenAIRunner` (non-streaming).
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
	} = options;

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createOpenAIStreamingRunner: apiKey is empty. API calls will fail.");
	}

	return async (agent, input, callbacks) => {
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

		const assistantMsg: Message = { role: "assistant", content: fullText };
		callbacks.onMessage?.(assistantMsg);

		return {
			output: fullText,
			messages: [{ role: "user" as const, content: input }, assistantMsg],
			toolCalls: [],
			totalTokens: promptTokens + completionTokens,
		};
	};
}
