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
import type { AdapterHooks, AgentRunner } from "../types.js";

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
	} = options;

	validateBaseURL(baseURL);

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
				}),
				...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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
			const text = (data.message as Record<string, unknown>)?.content as string ?? "";
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
