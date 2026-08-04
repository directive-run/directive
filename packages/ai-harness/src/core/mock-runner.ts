/**
 * An `AgentRunner` that answers from a script instead of a provider.
 *
 * The offline path for tests, demos, and anyone without an API key. It sits
 * exactly where the real adapter sits — under `withRetry` and `withBudget` —
 * so the offline chain exercises the same retry policy, the same ledger, and
 * the same termination condition as the online one.
 *
 * **It observes `RunOptions.signal`, and that is not decoration either.** A
 * shipped adapter folds the caller's signal into the `fetch` and into the
 * stream reader, so an abort mid-response rejects the call. A mock that ignored
 * the signal would be structurally incapable of failing an abort assertion —
 * every cancellation test written against it would pass whatever the code under
 * test did with the signal, which is the opposite of what a stand-in is for. So
 * a pre-aborted signal rejects before anything is delivered, and an abort during
 * delivery rejects between deltas, both with an `AbortError`.
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
   * Deltas to stream before throwing, so the failure lands mid-turn — the
   * case that would duplicate a turn if the transcript appended per token.
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
  /**
   * Whether {@link RunOptions.signal} ends the call, the way it ends a real
   * provider request. @default true
   *
   * Off is for a test that wants a call the signal cannot reach — an
   * unstoppable in-flight turn, say. It is not for making an abort assertion
   * pass; the shipped adapter cancels, and a mock that does not is a mock that
   * cannot fail the assertion.
   */
  signalAware?: boolean;
}

/**
 * The rejection a cancelled provider call produces.
 *
 * `fetch` rejects with an `AbortError` when its signal fires, so that is what
 * this rejects with — the point of the mock is that the code above it cannot
 * tell which one it is talking to.
 */
function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("This operation was aborted", "AbortError");
  }

  const error = new Error("This operation was aborted");
  error.name = "AbortError";

  return error;
}

/** Wait, unless the signal ends the wait first. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
    signalAware = true,
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

    // Where the signal sits, so it is read the way the adapter reads it —
    // once before the request goes out, and again between chunks. Read through
    // a call rather than inline, because `aborted` is a readonly property and
    // narrowing it once would tell the compiler every later read has the same
    // answer. The whole point is that it does not.
    const signal = signalAware ? runOptions?.signal : undefined;
    const aborted = () => signal?.aborted === true;

    // `fetch` rejects immediately on a signal that is already aborted, without
    // opening a connection. Nothing is delivered here either.
    if (aborted()) {
      throw abortError();
    }

    if (delayMs > 0) {
      await delay(delayMs, signal);
    }

    const text = responseFor(agent.name, call);
    const deltas = toDeltas(text, chunkChars);
    const failure = failures.find(
      (candidate) => candidate.agent === agent.name && candidate.call === call,
    );
    const failAfter = failure ? (failure.afterDeltas ?? 1) : Number.NaN;

    for (const [index, delta] of deltas.entries()) {
      // Between chunks, which is where the stream reader checks it. Deltas
      // already handed over stay handed over — a cancelled response keeps
      // whatever crossed the wire before the cancel.
      if (aborted()) {
        throw abortError();
      }
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

    // The last chunk is delivered and the terminal event has not arrived. A
    // stream reader given an aborted signal here rejects rather than handing
    // back a response, so this does too.
    if (aborted()) {
      throw abortError();
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
