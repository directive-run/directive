/**
 * @directive-run/ai/workers-ai
 *
 * Cloudflare Workers AI adapter for Directive AI. Runs an agent through the
 * `env.AI` binding – no API key, no fetch, no base URL. The binding is an RPC
 * handle Cloudflare injects into the Worker, so there is no credential to hold,
 * rotate or leak.
 *
 * Non-streaming only: the runner buffers the whole answer. A call that passes
 * `onToken` still gets the buffered result.
 *
 * The binding is typed structurally ({@link WorkersAIBinding}), so this package
 * takes no dependency on `@cloudflare/workers-types`; `env.AI` satisfies it.
 *
 * @example
 * ```typescript
 * import { createWorkersAIRunner } from '@directive-run/ai/workers-ai';
 *
 * export default {
 *   async fetch(req: Request, env: { AI: Ai }) {
 *     const runner = createWorkersAIRunner({ binding: env.AI });
 *     // ...
 *   },
 * };
 * ```
 */

import {
  type ModelPricing,
  attachReportedUsage,
  toTokenPricingTable,
} from "../pricing.js";
import type {
  AdapterHooks,
  AgentLike,
  AgentRunner,
  Message,
  RunOptions,
  RunResult,
  TokenUsage,
} from "../types.js";
import {
  anyTokenCountReported,
  fireAfterCallHook,
  fireBeforeCallHook,
  fireErrorHook,
  readTokenCount,
} from "./shared.js";

// ============================================================================
// Pricing Constants
// ============================================================================

/** The single source of Workers AI rates (USD per million tokens). */
const WORKERS_AI_RATES = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 0.293, output: 2.253 },
  "@cf/meta/llama-3.1-8b-instruct": { input: 0.282, output: 0.827 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 0.045, output: 0.384 },
  "@cf/meta/llama-3.2-1b-instruct": { input: 0.027, output: 0.201 },
  "@cf/meta/llama-3.2-3b-instruct": { input: 0.051, output: 0.335 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {
    input: 0.351,
    output: 0.555,
  },
  // Re-checked 2026-11-15. Every row of the page's LLM pricing table is here.
  // `cacheRead` is the page's cached-input rate, present only on the models
  // that list one.
  "@cf/meta/llama-3.2-11b-vision-instruct": { input: 0.049, output: 0.676 },
  "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 0.293, output: 2.253 },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    input: 0.497,
    output: 4.881,
  },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": {
    input: 0.44,
    output: 1.32,
    cacheRead: 0.014,
  },
  "@cf/deepseek-ai/deepseek-v4.1-flash-1017": {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
  },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    input: 1.32,
    output: 3.96,
    cacheRead: 0.044,
  },
  "@cf/mistral/mistral-7b-instruct-v0.1": { input: 0.11, output: 0.19 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { input: 0.152, output: 0.287 },
  "@cf/meta/llama-3.1-8b-instruct-awq": { input: 0.123, output: 0.266 },
  "@cf/meta/llama-3-8b-instruct": { input: 0.282, output: 0.827 },
  "@cf/meta/llama-3-8b-instruct-awq": { input: 0.123, output: 0.266 },
  "@cf/meta/llama-2-7b-chat-fp16": { input: 0.556, output: 6.667 },
  "@cf/meta/llama-guard-3-8b": { input: 0.484, output: 0.03 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { input: 0.27, output: 0.85 },
  "@cf/google/gemma-3-12b-it": { input: 0.345, output: 0.556 },
  "@cf/qwen/qwq-32b": { input: 0.66, output: 1 },
  "@cf/qwen/qwen2.5-coder-32b-instruct": { input: 0.66, output: 1 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 0.051, output: 0.335 },
  "@cf/qwen/qwen3.8-27b": { input: 0.45, output: 3.2 },
  "@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75 },
  "@cf/openai/gpt-oss-20b": { input: 0.2, output: 0.3 },
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": { input: 0.351, output: 0.555 },
  "@cf/ibm-granite/granite-4.0-h-micro": { input: 0.017, output: 0.112 },
  "@cf/zai-org/glm-4.7-flash": { input: 0.06, output: 0.4 },
  "@cf/zai-org/glm-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26 },
  "@cf/zai-org/glm-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26 },
  "@cf/zai-org/glm-5.3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03 },
  "@cf/nvidia/nemotron-3-120b-a12b": { input: 0.5, output: 1.5 },
  "@cf/moonshotai/kimi-k2.5": { input: 0.6, output: 3, cacheRead: 0.1 },
  "@cf/moonshotai/kimi-k2.6": { input: 0.95, output: 4, cacheRead: 0.16 },
  "@cf/moonshotai/kimi-k2.7-code": { input: 0.95, output: 4, cacheRead: 0.19 },
  "@cf/google/gemma-4-26b-a4b-it": { input: 0.1, output: 0.3 },
  "@cf/daily-co/phonellm-mini-alpha-2": { input: 0.06, output: 0.24 },
  "@cf/thinkingmachines/inkling-2-small": {
    input: 0.3,
    output: 1,
    cacheRead: 0.1,
  },
};

/**
 * The date the rates in {@link WORKERS_AI_PRICING} were last checked against
 * https://developers.cloudflare.com/workers-ai/platform/pricing/
 *
 * Workers AI bills in neurons ($0.011 per 1,000); the page publishes the
 * per-million-token equivalents used here. Never inferred from the clock. It
 * records when a person last looked.
 */
export const WORKERS_AI_PRICING_AS_OF = "2026-11-15";

/**
 * Workers AI model pricing (USD per million tokens), keyed by the exact model
 * ID the binding accepts. Each entry carries both field spellings, as the other
 * adapters' tables do. A model missing from the table is unpriced – look it up
 * with `requireModelPricing` rather than assuming a rate. The free daily
 * allocation is not modelled: these are the paid rates, so a spend cap errs on
 * the side of firing.
 */
export const WORKERS_AI_PRICING: Record<string, ModelPricing> =
  toTokenPricingTable(WORKERS_AI_RATES, "WORKERS_AI_PRICING");

// ============================================================================
// Binding + Options
// ============================================================================

/**
 * The Workers AI binding, narrowed to what this adapter calls. `env.AI`
 * satisfies it.
 */
export interface WorkersAIBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

/** Options for createWorkersAIRunner */
export interface WorkersAIRunnerOptions {
  /** The `env.AI` binding. */
  binding: WorkersAIBinding;
  /** @default "@cf/meta/llama-3.3-70b-instruct-fp8-fast" */
  model?: string;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Sampling temperature. Higher = more random. */
  temperature?: number;
  /** Nucleus sampling: top-P probability mass (0–1). */
  topP?: number;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
}

export const DEFAULT_WORKERS_AI_MODEL =
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ============================================================================
// Response Parsing
// ============================================================================

interface ParsedWorkersAI {
  /** Output as the model produced it: text, or an already-parsed object. */
  value: unknown;
  text: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
}

function fromChoices(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length === 0) {
    return undefined;
  }
  const first = v[0] as { message?: { content?: unknown }; text?: unknown };
  if (typeof first?.message?.content === "string") {
    return first.message.content;
  }

  return typeof first?.text === "string" ? first.text : undefined;
}

/** Read the token counts a response reports, `undefined` when it reports none. */
function readUsage(raw: unknown): {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
} {
  const usage = ((raw as { usage?: Record<string, unknown> } | null)?.usage ??
    {}) as Record<string, unknown>;

  return {
    inputTokens: readTokenCount(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: readTokenCount(
      usage.completion_tokens ?? usage.output_tokens,
    ),
  };
}

/**
 * Narrow a Workers AI response to output plus token counts. Workers AI has more
 * than one envelope: `{ response: string }` (classic), `{ response: object }`
 * (JSON mode), and the OpenAI-compatible `{ choices: [{ message }] }`. An
 * unrecognised shape throws, naming the keys (never values).
 */
function parseResponse(raw: unknown): ParsedWorkersAI {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("[Directive] Workers AI response was not an object");
  }
  const bag = raw as Record<string, unknown>;
  const usage = readUsage(raw);

  let value: unknown;
  if (typeof bag.response === "string") {
    value = bag.response;
  } else if (typeof bag.response === "object" && bag.response !== null) {
    value = bag.response;
  } else if (typeof bag.result === "string") {
    value = bag.result;
  } else if (typeof bag.output_text === "string") {
    value = bag.output_text;
  } else {
    value = fromChoices(bag.choices);
  }

  if (value === undefined) {
    throw new TypeError(
      `[Directive] Workers AI response has no text field (keys: ${Object.keys(
        bag,
      )
        .slice(0, 12)
        .join(", ")})`,
    );
  }

  return {
    value,
    text: typeof value === "string" ? value : JSON.stringify(value),
    ...usage,
  };
}

// ============================================================================
// Workers AI Runner
// ============================================================================

/**
 * Create an AgentRunner over a Workers AI binding.
 *
 * `agent.instructions` becomes the system message and `input` the user message.
 * `agent.model` overrides the runner's `model`. Token counts come from the
 * response's `usage`; when the binding reports none, `usageReported` is `false`
 * so a budget charges its estimate instead of a measured-looking zero.
 *
 * @example
 * ```typescript
 * const runner = createWorkersAIRunner({ binding: env.AI });
 * const result = await runner(agent, "Summarise this.");
 * ```
 */
export function createWorkersAIRunner(
  options: WorkersAIRunnerOptions,
): AgentRunner {
  const {
    binding,
    model = DEFAULT_WORKERS_AI_MODEL,
    hooks,
    temperature,
    topP,
    maxTokens,
  } = options;

  if (binding == null || typeof binding.run !== "function") {
    throw new TypeError(
      "[Directive] createWorkersAIRunner requires a `binding` with a run() method (env.AI)",
    );
  }

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    runOptions?: RunOptions,
  ): Promise<RunResult<T>> => {
    const startTime = fireBeforeCallHook(hooks, agent, input);
    // A response whose usage was read before its text failed to parse was still
    // billed; carry it on the error.
    let billed: TokenUsage | undefined;

    try {
      const userMessage: Message = { role: "user", content: input };
      const raw = await binding.run(
        agent.model ?? model,
        {
          messages: [
            ...(agent.instructions
              ? [{ role: "system", content: agent.instructions }]
              : []),
            { role: "user", content: input },
          ],
          ...(temperature != null ? { temperature } : {}),
          ...(topP != null ? { top_p: topP } : {}),
          ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
        },
        runOptions?.signal ? { signal: runOptions.signal } : undefined,
      );

      const rawUsage = readUsage(raw);
      if (rawUsage.inputTokens || rawUsage.outputTokens) {
        billed = {
          inputTokens: rawUsage.inputTokens ?? 0,
          outputTokens: rawUsage.outputTokens ?? 0,
        };
      }
      const parsed = parseResponse(raw);

      const inputTokens = parsed.inputTokens ?? 0;
      const outputTokens = parsed.outputTokens ?? 0;
      const totalTokens = inputTokens + outputTokens;
      const tokenUsage: TokenUsage = { inputTokens, outputTokens };
      const usageReported = anyTokenCountReported(
        parsed.inputTokens,
        parsed.outputTokens,
      );

      const assistantMessage: Message = {
        role: "assistant",
        content: parsed.text,
      };
      runOptions?.onMessage?.(assistantMessage);

      fireAfterCallHook(
        hooks,
        agent,
        input,
        parsed.text,
        totalTokens,
        tokenUsage,
        startTime,
      );

      let output: unknown = parsed.value;
      if (typeof output === "string") {
        try {
          output = JSON.parse(output);
        } catch {
          /* plain text stays text */
        }
      }

      return {
        output: output as T,
        messages: [userMessage, assistantMessage],
        toolCalls: [],
        totalTokens,
        tokenUsage,
        usageReported,
      };
    } catch (err) {
      const error = attachReportedUsage(err, billed);
      fireErrorHook(hooks, agent, input, error, startTime);

      throw error;
    }
  };
}
