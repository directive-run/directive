/**
 * An `AgentRunner` that answers from a script instead of a provider.
 *
 * The offline path for tests, demos, and anyone without an API key. It sits
 * exactly where the real adapter sits — under `withRetry` and `withBudget` —
 * so the offline chain exercises the same retry policy, the same ledger, and
 * the same termination condition as the online one.
 *
 * **It reports token usage, and that is not decoration.** The chain stops when
 * the budget runner's ledger reaches the preset's ceiling, and the ledger only
 * moves when a call reports usage. A mock returning `tokenUsage: undefined`
 * prices every call at the pre-call estimate of an empty prompt, the ledger
 * barely moves, and the offline chain runs until the iteration backstop catches
 * it — which looks like the budget working and is not. So usage is reported,
 * and it scales with the text actually produced.
 *
 * @module
 */

import type {
  AgentLike,
  AgentRunner,
  RunOptions,
  RunResult,
} from "@directive-run/ai";

/** A scripted failure, for exercising the retry path. */
export interface MockFailure {
  /** Agent name this applies to. */
  agent: string;
  /** Which call to that agent fails, 1-based. */
  call: number;
  /**
   * Deltas to stream before throwing, so the failure lands mid-burst — the
   * case that would duplicate a burst if the transcript appended per token.
   * @default 1
   */
  afterDeltas?: number;
  message?: string;
}

export interface MockRunnerOptions {
  /**
   * Canned text per agent name. An array cycles: the Nth call to that agent
   * gets entry `N % length`, so a persona can have a different thing to say
   * each turn without the script running out.
   */
  responses?: Record<string, string | string[]>;
  /** Used for any agent `responses` has no entry for. */
  defaultResponse?: string;
  /** Characters per streamed delta. @default 24 */
  chunkChars?: number;
  /** Scripted failures. */
  failures?: MockFailure[];
  /** Artificial latency per call, in ms. @default 0 */
  delayMs?: number;
  /** Approximate characters per token, for the reported usage. @default 4 */
  charsPerToken?: number;
}

/** Split text into fixed-size deltas, the way a provider streams it. */
function toDeltas(text: string, chunkChars: number): string[] {
  if (text === "") {
    return [];
  }

  const deltas: string[] = [];
  for (let index = 0; index < text.length; index += chunkChars) {
    deltas.push(text.slice(index, index + chunkChars));
  }

  return deltas;
}

export function createMockRunner(options: MockRunnerOptions = {}): AgentRunner {
  const {
    responses = {},
    defaultResponse = "(mock response)",
    chunkChars = 24,
    failures = [],
    delayMs = 0,
    charsPerToken = 4,
  } = options;

  /** Calls made per agent, so `MockFailure.call` and response cycling line up. */
  const callCounts = new Map<string, number>();

  function responseFor(agentName: string, call: number): string {
    const scripted = Object.hasOwn(responses, agentName)
      ? responses[agentName]
      : undefined;

    if (scripted === undefined) {
      return defaultResponse;
    }
    if (typeof scripted === "string") {
      return scripted;
    }
    if (scripted.length === 0) {
      return defaultResponse;
    }

    return scripted[(call - 1) % scripted.length] ?? defaultResponse;
  }

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    runOptions?: RunOptions,
  ): Promise<RunResult<T>> => {
    const call = (callCounts.get(agent.name) ?? 0) + 1;
    callCounts.set(agent.name, call);

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const text = responseFor(agent.name, call);
    const deltas = toDeltas(text, chunkChars);
    const failure = failures.find(
      (candidate) => candidate.agent === agent.name && candidate.call === call,
    );
    const failAfter = failure ? (failure.afterDeltas ?? 1) : Number.NaN;

    for (const [index, delta] of deltas.entries()) {
      if (failure !== undefined && index >= failAfter) {
        throw new Error(
          failure.message ??
            `[ai-harness mock] scripted failure on call ${call} to ${agent.name}`,
        );
      }
      // Read back as value-returning: `onToken` is annotated `=> void` for
      // assignability, but the shipped adapters await it, so a mock that did
      // not would apply no backpressure and behave unlike the thing it stands
      // in for.
      const sink = runOptions?.onToken as
        | ((token: string) => unknown)
        | undefined;
      await sink?.(delta);
    }

    if (failure !== undefined && deltas.length <= failAfter) {
      throw new Error(
        failure.message ??
          `[ai-harness mock] scripted failure on call ${call} to ${agent.name}`,
      );
    }

    runOptions?.onMessage?.({ role: "assistant", content: text });

    const inputTokens = Math.max(1, Math.ceil(input.length / charsPerToken));
    const outputTokens = Math.max(1, Math.ceil(text.length / charsPerToken));

    return {
      output: text as T,
      messages: [
        { role: "user", content: input },
        { role: "assistant", content: text },
      ],
      toolCalls: [],
      totalTokens: inputTokens + outputTokens,
      tokenUsage: { inputTokens, outputTokens },
      usageReported: true,
    };
  };
}
