/**
 * Agent utilities — createRunner, estimateCost, state queries, URL validation.
 */

import type {
  StreamEventResult,
  StreamTotals,
  StreamWireFormat,
} from "./adapters/shared.js";
import { getStreamReader, parseEventStream } from "./adapters/shared.js";
// Re-exported because `RunnerStreamingSupport` names them and `createRunner`
// is public – a consumer writing their own adapter needs to spell these out.
export type {
  ParseEventStreamOptions,
  StreamEventResult,
  StreamTotals,
  StreamWireFormat,
} from "./adapters/shared.js";
import type {
  AdapterHooks,
  AgentLike,
  AgentRunner,
  AgentState,
  ApprovalState,
  Message,
  RunOptions,
  RunResult,
  TokenUsage,
} from "./types.js";

// ============================================================================
// State Query Helpers
// ============================================================================

/**
 * Check whether an agent is currently executing a run.
 *
 * @param state - The current {@link AgentState} to inspect.
 * @returns `true` when the agent status is `"running"`.
 */
export function isAgentRunning(state: AgentState): boolean {
  return state.status === "running";
}

/**
 * Check whether there are tool-call approvals waiting for user confirmation.
 *
 * @param state - The current {@link ApprovalState} to inspect.
 * @returns `true` when one or more approvals are pending.
 */
export function hasPendingApprovals(state: ApprovalState): boolean {
  return state.pending.length > 0;
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Estimate the dollar cost of an agent run based on total token usage.
 *
 * @remarks
 * No default rate is provided — callers must supply the current per-million-token
 * price to avoid silently using stale pricing.
 *
 * @param tokenUsage - Total number of tokens consumed (input + output).
 * @param ratePerMillionTokens - Cost in dollars per one million tokens.
 * @returns Estimated cost in dollars.
 */
export function estimateCost(
  tokenUsage: number,
  ratePerMillionTokens: number,
): number {
  return (tokenUsage / 1_000_000) * ratePerMillionTokens;
}

/** Characters per token, the estimate this package applies throughout. */
const CHARS_PER_TOKEN = 4;

/**
 * How many tokens a run should accrue against a token budget.
 *
 * The rule is that a ceiling accrues what was observed and never what it was
 * told:
 *
 * - The provider's own counts, when it sent any. That is an observation of the
 *   response, not a claim about a future one.
 * - Otherwise the text that actually arrived — the assistant messages on the
 *   result, or the deltas already delivered when the call threw before
 *   returning one — plus the input that was sent to produce it.
 * - Nothing at all, when nothing arrived. A call that produced no bytes has no
 *   observed cost, so it accrues none.
 *
 * The version this replaces filled the last case with `agent.maxTokens`, which
 * is a number the caller writes. A ceiling that accrues a caller-declared
 * figure is not measuring anything; the same field priced its way past a
 * five-cent per-call cap for eighteen dollars of real spend. It is a request
 * parameter and nothing else here reads it.
 *
 * @param input - The input the run was given.
 * @param result - What the run returned, or `undefined` when it threw.
 * @param observedOutputChars - Characters delivered as deltas for this call.
 * @returns Tokens to add to the budget's running total.
 *
 * @internal
 */
export function tokensForBudget(
  input: string,
  result: RunResult<unknown> | undefined,
  observedOutputChars = 0,
): number {
  if (result && result.usageReported !== false) {
    return result.totalTokens;
  }

  let outputChars = 0;
  if (result) {
    for (const message of result.messages) {
      if (message.role === "assistant" && typeof message.content === "string") {
        outputChars += message.content.length;
      }
    }
    if (outputChars === 0 && typeof result.output === "string") {
      outputChars = result.output.length;
    }
  }
  // A stream that failed part-way delivered what it delivered, and the result
  // that would have carried it never existed.
  outputChars = Math.max(outputChars, observedOutputChars);

  // Nothing came back and nothing was delivered: there is nothing to price.
  if (!result && outputChars === 0) {
    return 0;
  }

  return (
    Math.ceil(input.length / CHARS_PER_TOKEN) +
    Math.ceil(outputChars / CHARS_PER_TOKEN)
  );
}

// ============================================================================
// Validation Helpers
// ============================================================================

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate that a base URL uses the `http:` or `https:` protocol.
 * Throws immediately at adapter creation time (not at call time) to surface
 * configuration errors before any LLM requests are made.
 *
 * @param baseURL - The base URL string to validate.
 * @throws When the URL is malformed or uses a protocol other than `http:` or `https:`.
 */
export function validateBaseURL(baseURL: string): void {
  try {
    const url = new URL(baseURL);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      throw new Error(
        `[Directive] Invalid baseURL protocol "${url.protocol}" – only http: and https: are allowed`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[Directive]")) {
      throw err;
    }

    throw new Error(
      `[Directive] Invalid baseURL "${baseURL}" – must be a valid URL (e.g. "https://api.openai.com/v1")`,
    );
  }
}

// ============================================================================
// AbortSignal combination helper
// ============================================================================

/**
 * Combine multiple `AbortSignal`s into one — the resulting signal aborts
 * as soon as ANY input signal aborts. Falls back to a manual controller
 * wiring on runtimes without `AbortSignal.any` (Node < 20).
 *
 * @internal
 */
export function combineSignals(
  signals: ReadonlyArray<AbortSignal | undefined>,
): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];

  // Prefer the standard helper when available (Node 20.3+, modern browsers).
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn(live);
  }

  // Fallback: manual controller. If any input is already aborted, the
  // result is too — wire listeners for the rest.
  const controller = new AbortController();
  const already = live.find((s) => s.aborted);
  if (already) {
    controller.abort(
      (already as AbortSignal & { reason?: unknown }).reason ?? undefined,
    );

    return controller.signal;
  }
  for (const s of live) {
    s.addEventListener(
      "abort",
      () => {
        controller.abort(
          (s as AbortSignal & { reason?: unknown }).reason ?? undefined,
        );
      },
      { once: true },
    );
  }

  return controller.signal;
}

// ============================================================================
// Stream deadlines
// ============================================================================

/**
 * How long a stream may say nothing before it is abandoned, when the adapter's
 * caller did not choose an interval.
 *
 * Two minutes. The number has to clear the longest silence a healthy stream
 * produces, and on a streamed call that is short: the provider acknowledges the
 * request before it starts generating, and keeps the connection warm with
 * keep-alive frames while it thinks. It also has to be short enough that a run
 * nobody is going to get an answer from stops occupying the caller – an
 * interrupt that waits for the turn in flight to finish has to be able to
 * finish. Two minutes clears the first by a wide margin without failing the
 * second, and a model that genuinely pauses for longer has `timeoutMs`.
 *
 * @internal
 */
export const DEFAULT_STREAM_IDLE_MS = 120_000;

/**
 * Reject a stream deadline that can never do anything, at adapter-creation
 * time rather than on the first stalled call.
 *
 * @internal
 */
export function validateStreamTimeout(
  timeoutMs: number,
  functionName: string,
): void {
  if (timeoutMs === Number.POSITIVE_INFINITY) {
    return;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `[Directive] ${functionName}: timeoutMs must be a positive number of milliseconds (received ${JSON.stringify(timeoutMs)}). Pass Infinity to run without a deadline.`,
    );
  }
}

/**
 * A silence clock for one streamed call.
 *
 * The deadline a stream needs is not the one a buffered call needs. A buffered
 * call has a single answer arriving at a single moment, so a wall-clock cap on
 * the whole call – `AbortSignal.timeout(timeoutMs)` – says exactly the right
 * thing. A stream has no such moment: its total duration is a function of how
 * much the model chooses to say, so the same cap either cuts a healthy long
 * generation off mid-sentence or is set so high that it no longer bounds
 * anything. What goes wrong on a stream is not that it takes a long time, it is
 * that it stops saying anything and never ends, and the measurement that catches
 * that is the gap between events rather than the length of the call.
 *
 * So this measures silence. The clock starts when the request goes out and is
 * restarted by every sign of life – response headers, a delta, a keep-alive
 * ping – and when it runs out, the call is abandoned. A stream that talks for an
 * hour is never touched; a stream that goes quiet is cut off a fixed interval
 * later, whatever it had already delivered.
 *
 * @internal
 */
export interface StreamDeadline {
  /**
   * The signal to hand to `fetch` and to the stream reader – the caller's own
   * signal and the deadline combined, so aborting either one ends the call.
   */
  readonly signal: AbortSignal | undefined;
  /** Whether the deadline is what ended this call. */
  readonly expired: boolean;
  /**
   * The error the deadline aborted with. Named `"TimeoutError"`, the same name
   * `AbortSignal.timeout` gives the buffered path, so one check covers both and
   * a provider that stalled is never mistaken for a caller that cancelled.
   */
  readonly reason: Error;
  /** Something arrived: restart the clock. */
  touch(): void;
  /** Stop the clock. Call from a `finally`, once. */
  release(): void;
}

/**
 * Start a silence clock for one streamed call. See {@link StreamDeadline}.
 *
 * `idleMs` is the interval, and `Infinity` disables the deadline entirely,
 * leaving the caller's signal as the only way to end a stalled stream.
 *
 * @internal
 */
export function createStreamDeadline(
  idleMs: number,
  callerSignal: AbortSignal | undefined,
  adapterName: string,
): StreamDeadline {
  if (idleMs === Number.POSITIVE_INFINITY) {
    return {
      signal: callerSignal,
      expired: false,
      reason: streamTimeoutError(adapterName, idleMs),
      touch: () => {},
      release: () => {},
    };
  }

  const controller = new AbortController();
  const reason = streamTimeoutError(adapterName, idleMs);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = {
    signal: combineSignals([controller.signal, callerSignal]),
    expired: false,
    reason,
    touch: (): void => {
      // Once it has fired the call is over; re-arming would only leave a timer
      // running past the error that ended it.
      if (deadline.expired) {
        return;
      }
      deadline.release();
      timer = setTimeout(() => {
        deadline.expired = true;
        controller.abort(reason);
      }, idleMs);
    },
    release: (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
  deadline.touch();

  return deadline;
}

/**
 * The error a stalled stream ends with.
 *
 * A plain `Error` rather than a `DOMException`, which is what
 * `AbortSignal.timeout` produces: the name is the part callers read, every
 * runtime has `Error`, and an abort reason that is not an `Error` is replaced
 * with a generic one on its way out of the stream reader.
 */
function streamTimeoutError(adapterName: string, idleMs: number): Error {
  const error = new Error(
    `[Directive] ${adapterName} stream sent nothing for ${idleMs}ms and was abandoned. The connection was open and silent – the provider stalled, or something between it and here did. Raise \`timeoutMs\` if this is a model that pauses for longer than that.`,
  );
  error.name = "TimeoutError";

  return error;
}

// ============================================================================
// createRunner Helper
// ============================================================================

/** Parsed response from an LLM provider */
export interface ParsedResponse {
  text: string;
  totalTokens: number;
  /** Input token count, when available from the provider */
  inputTokens?: number;
  /** Output token count, when available from the provider */
  outputTokens?: number;
  /** Prompt-cache read token count, when available from the provider */
  cacheReadTokens?: number;
  /** Prompt-cache creation token count, when available from the provider */
  cacheCreationTokens?: number;
  /**
   * Whether the provider reported token usage at all.
   *
   * Omit – or pass `true` – when the counts above came from the response. Pass
   * `false` when they are zeros standing in for numbers the provider never
   * sent, so cost tracking can treat the call as unpriceable rather than free.
   */
  usageReported?: boolean;
}

/**
 * Optional streaming support for a runner built with {@link createRunner}.
 *
 * Supplying this does not change what the runner does by default. It only
 * teaches the runner how to consume the provider's stream so that a caller who
 * passes `RunOptions.onToken` gets per-delta callbacks from the *same* runner –
 * no second runner slot, and so nothing for a wrapper to forget to forward.
 */
export interface RunnerStreamingSupport {
  /** Adapter name, used in dev-mode malformed-event warnings. */
  adapterName: string;
  /** Extract text and token counts from one streamed event. */
  parseEvent: (event: Record<string, unknown>) => StreamEventResult;
  /** How the provider frames its streamed events. @default "sse" */
  wireFormat?: StreamWireFormat;
  /**
   * Fail the run when the stream ends without the provider's end-of-response
   * marker – `[DONE]`, a `terminal` event from {@link RunnerStreamingSupport.parseEvent},
   * or both.
   *
   * A truncated body arrives as a clean end of stream, so without this a
   * partial response resolves successfully and reads as a short answer. Off by
   * default so a `parseEvent` written before the flag existed keeps working;
   * the shipped adapters set it.
   *
   * @default false
   */
  requireTerminalEvent?: boolean;
  /**
   * Build the final parsed response from the accumulated stream totals.
   * Supply this when the buffered path computes `totalTokens` from more than
   * input + output (e.g. Anthropic with prompt caching) so both paths agree.
   */
  buildResponse?: (totals: StreamTotals) => ParsedResponse;
}

/** Options for creating an AgentRunner from buildRequest/parseResponse */
export interface CreateRunnerOptions {
  fetch?: typeof globalThis.fetch;
  /**
   * Build the HTTP request. `stream` is `true` only when the caller passed
   * `RunOptions.onToken` *and* {@link CreateRunnerOptions.streaming} is
   * configured – implementations that ignore the parameter keep their existing
   * buffered behavior.
   */
  buildRequest: (
    agent: AgentLike,
    input: string,
    messages: Message[],
    stream: boolean,
  ) => { url: string; init: RequestInit };
  parseResponse: (
    response: Response,
    messages: Message[],
  ) => Promise<ParsedResponse>;
  parseOutput?: <T>(text: string) => T;
  /** Lifecycle hooks for tracing, logging, and metrics */
  hooks?: AdapterHooks;
  /** Enables `RunOptions.onToken` on this runner. Omit for buffered-only. */
  streaming?: RunnerStreamingSupport;
}

/** Default stream totals → parsed response mapping. */
function defaultStreamResponse(totals: StreamTotals): ParsedResponse {
  return {
    text: totals.fullText,
    totalTokens: totals.inputTokens + totals.outputTokens,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    usageReported: totals.usageReported,
  };
}

/**
 * Create an {@link AgentRunner} from `buildRequest`/`parseResponse` helpers, reducing
 * ~50 lines of fetch boilerplate to ~20 lines of configuration.
 *
 * @remarks
 * Supports lifecycle hooks for observability:
 * - `onBeforeCall` fires before each API request
 * - `onAfterCall` fires after a successful response (includes token breakdown)
 * - `onError` fires when the request fails
 *
 * Output parsing defaults to `JSON.parse` with a string fallback. Supply a custom
 * `parseOutput` to override (e.g. for structured output schemas).
 *
 * When `streaming` is configured, the same runner streams from the provider for
 * any call that passes `RunOptions.onToken` and buffers for every call that does
 * not. Both paths share the response assembly below, so `output`, `messages`,
 * `tokenUsage` and the adapter hooks are identical either way.
 *
 * @param options - Configuration for the runner, including request building, response parsing, and hooks.
 * @returns An {@link AgentRunner} function that performs LLM calls via fetch.
 *
 * @example
 * ```typescript
 * const runClaude = createRunner({
 *   buildRequest: (agent, input) => ({
 *     url: "/api/claude",
 *     init: {
 *       method: "POST",
 *       headers: { "Content-Type": "application/json" },
 *       body: JSON.stringify({
 *         model: agent.model ?? "claude-haiku-4-5-20251001",
 *         system: agent.instructions ?? "",
 *         messages: [{ role: "user", content: input }],
 *       }),
 *     },
 *   }),
 *   parseResponse: async (res) => {
 *     const data = await res.json();
 *     const inputTokens = data.usage?.input_tokens ?? 0;
 *     const outputTokens = data.usage?.output_tokens ?? 0;
 *     return {
 *       text: data.content?.[0]?.text ?? "",
 *       totalTokens: inputTokens + outputTokens,
 *       inputTokens,
 *       outputTokens,
 *     };
 *   },
 *   hooks: {
 *     onAfterCall: ({ durationMs, tokenUsage }) => {
 *       console.log(`LLM call: ${durationMs}ms, ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`);
 *     },
 *   },
 * });
 * ```
 *
 * @public
 */
export function createRunner(options: CreateRunnerOptions): AgentRunner {
  const {
    fetch: fetchFn = globalThis.fetch,
    buildRequest,
    parseResponse,
    parseOutput,
    hooks,
    streaming,
  } = options;

  const defaultParseOutput = <T>(text: string): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  };

  const parse = parseOutput ?? defaultParseOutput;

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    runOptions?: RunOptions,
  ): Promise<RunResult<T>> => {
    const startTime = Date.now();
    hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

    const messages: Message[] = [{ role: "user", content: input }];

    // `onToken` is a request, not a guarantee: a runner without streaming
    // support ignores it and returns the same buffered result it always would.
    const onToken = runOptions?.onToken;
    const shouldStream = onToken !== undefined && streaming !== undefined;

    try {
      const { url, init } = buildRequest(agent, input, messages, shouldStream);

      // Combine signals — `buildRequest` may set
      // `init.signal` (e.g. `AbortSignal.timeout(timeoutMs)`) and the
      // caller may pass their own via `runOptions.signal`. Naively
      // overwriting one with the other silently disables whichever was
      // dropped. `combineSignals` aborts as soon as either fires.
      const combined = combineSignals([
        init.signal ?? undefined,
        runOptions?.signal,
      ]);
      const fetchInit: RequestInit = combined
        ? { ...init, signal: combined }
        : init;

      const response = await fetchFn(url, fetchInit);

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");

        throw new Error(
          `[Directive] AgentRunner request failed: ${response.status} ${response.statusText}${errBody ? ` – ${errBody.slice(0, 300)}` : ""}`,
        );
      }

      let parsed: ParsedResponse;
      if (shouldStream) {
        const totals = await parseEventStream(
          getStreamReader(response),
          onToken,
          streaming.parseEvent,
          streaming.adapterName,
          streaming.wireFormat,
          {
            signal: combined,
            requireTerminalEvent: streaming.requireTerminalEvent,
          },
        );
        // Read off the totals rather than off `buildResponse`, so an adapter
        // that supplies its own response builder cannot lose the distinction
        // between "the provider said zero" and "the provider said nothing".
        parsed = {
          ...(streaming.buildResponse ?? defaultStreamResponse)(totals),
          usageReported: totals.usageReported,
        };
      } else {
        parsed = await parseResponse(response, messages);
      }
      const tokenUsage: TokenUsage = {
        inputTokens: parsed.inputTokens ?? 0,
        outputTokens: parsed.outputTokens ?? 0,
        ...(parsed.cacheReadTokens != null
          ? { cacheReadTokens: parsed.cacheReadTokens }
          : {}),
        ...(parsed.cacheCreationTokens != null
          ? { cacheCreationTokens: parsed.cacheCreationTokens }
          : {}),
      };

      const assistantMessage: Message = {
        role: "assistant",
        content: parsed.text,
      };
      const allMessages: Message[] = [...messages, assistantMessage];

      runOptions?.onMessage?.(assistantMessage);

      const durationMs = Date.now() - startTime;
      hooks?.onAfterCall?.({
        agent,
        input,
        output: parsed.text,
        totalTokens: parsed.totalTokens,
        tokenUsage,
        durationMs,
        timestamp: Date.now(),
      });

      return {
        output: parse<T>(parsed.text),
        messages: allMessages,
        toolCalls: [],
        totalTokens: parsed.totalTokens,
        tokenUsage,
        usageReported: parsed.usageReported ?? true,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (err instanceof Error) {
        hooks?.onError?.({
          agent,
          input,
          error: err,
          durationMs,
          timestamp: Date.now(),
        });
      }

      throw err;
    }
  };
}
