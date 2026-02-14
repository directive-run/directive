/**
 * @directive-run/adapter-ollama
 *
 * Ollama adapter for Directive AI. Provides runners for local
 * Ollama inference.
 *
 * @example
 * ```typescript
 * import { createOllamaRunner } from '@directive-run/adapter-ollama';
 *
 * const runner = createOllamaRunner({ model: 'llama3' });
 * ```
 */

import { createRunner } from "@directive-run/ai";
import type { AgentRunner } from "@directive-run/ai";

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
}

/**
 * Create an AgentRunner for local Ollama inference.
 *
 * @example
 * ```typescript
 * const runner = createOllamaRunner({ model: "llama3" });
 * const stack = createAgentStack({ runner, agents: { ... } });
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
	} = options;

	return createRunner({
		fetch: fetchFn,
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
			const totalTokens =
				((data.prompt_eval_count as number) ?? 0) + ((data.eval_count as number) ?? 0);

			return { text, totalTokens };
		},
	});
}
