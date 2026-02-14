/**
 * @directive-run/adapter-anthropic
 *
 * Anthropic adapter for Directive AI. Provides runners for the
 * Anthropic Messages API, including streaming support.
 *
 * @example
 * ```typescript
 * import { createAnthropicRunner, createAnthropicStreamingRunner } from '@directive-run/adapter-anthropic';
 *
 * const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * ```
 */

import { createRunner } from "@directive-run/ai";
import type {
	AgentRunner,
	Message,
	StreamingCallbackRunner,
} from "@directive-run/ai";

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
	/** @default undefined */
	timeoutMs?: number;
}

/**
 * Create an AgentRunner for the Anthropic Messages API.
 *
 * @example
 * ```typescript
 * const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
 * const stack = createAgentStack({ runner, agents: { ... } });
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
	} = options;

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createAnthropicRunner: apiKey is empty. API calls will fail.");
	}

	return createRunner({
		fetch: fetchFn,
		buildRequest: (agent, _input, messages) => ({
			url: `${baseURL}/messages`,
			init: {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: agent.model ?? model,
					max_tokens: maxTokens,
					system: agent.instructions ?? "",
					messages: messages.map((m) => ({
						role: m.role,
						content: m.content,
					})),
				}),
				...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
			},
		}),
		parseResponse: async (res) => {
			const data = await res.json();
			const text = data.content?.[0]?.text ?? "";
			const totalTokens =
				(data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

			return { text, totalTokens };
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
}

/**
 * Create a StreamingCallbackRunner for the Anthropic Messages API with
 * server-sent events. Pairs with `createAnthropicRunner` (non-streaming).
 *
 * @example
 * ```typescript
 * const streamingRunner = createAnthropicStreamingRunner({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * const stack = createAgentStack({
 *   runner: createAnthropicRunner({ apiKey }),
 *   streaming: { runner: streamingRunner },
 *   agents: { ... },
 * });
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
	} = options;

	if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production" && !apiKey) {
		console.warn("[Directive] createAnthropicStreamingRunner: apiKey is empty. API calls will fail.");
	}

	return async (agent, input, callbacks) => {
		const response = await fetchFn(`${baseURL}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: agent.model ?? model,
				max_tokens: maxTokens,
				system: agent.instructions ?? "",
				messages: [{ role: "user", content: input }],
				stream: true,
			}),
			signal: callbacks.signal,
		});

		if (!response.ok) {
			const errBody = await response.text().catch(() => "");
			throw new Error(
				`[Directive] Anthropic streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
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

				try {
					const event = JSON.parse(data);
					if (event.type === "error") {
						throw new Error(
							`[Directive] Anthropic stream error: ${event.error?.message ?? JSON.stringify(event.error)}`,
						);
					}
					if (
						event.type === "content_block_delta" &&
						event.delta?.type === "text_delta"
					) {
						fullText += event.delta.text;
						callbacks.onToken?.(event.delta.text);
					}
					if (event.type === "message_delta" && event.usage) {
						outputTokens = event.usage.output_tokens ?? 0;
					}
					if (event.type === "message_start" && event.message?.usage) {
						inputTokens = event.message.usage.input_tokens ?? 0;
					}
				} catch (parseErr) {
					if (parseErr instanceof SyntaxError) {
						if (
							typeof process !== "undefined" &&
							process.env?.NODE_ENV === "development"
						) {
							console.warn(
								"[Directive] Malformed SSE event from Anthropic:",
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
			totalTokens: inputTokens + outputTokens,
		};
	};
}
