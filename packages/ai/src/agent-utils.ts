/**
 * Agent utilities — createRunner, estimateCost, state queries, URL validation.
 */

import type {
  StreamActivityDeadline,
  StreamEventResult,
  StreamTotals,
  StreamWireFormat,
} from "./adapters/shared.js";
import {
  assertEventStreamResponse,
  buildProviderHTTPError,
  getStreamReader,
  parseEventStream,
} from "./adapters/shared.js";
// Re-exported because `RunnerStreamingSupport` names them and `createRunner`
// is public – a consumer writing their own adapter needs to spell these out.
export type {
  ParseEventStreamOptions,
  StreamActivityDeadline,
  StreamEventResult,
  StreamTotals,
  StreamWireFormat,
} from "./adapters/shared.js";
import { attachReportedUsage, readReportedUsage } from "./pricing.js";
import type {
  AdapterHooks,
  AgentLike,
  AgentRunner,
  AgentState,
  ApprovalState,
  Message,
  RunOptions,
  RunResult,
  StopReason,
  TokenUsage,
  ToolCall,
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
  return linkSignals(signals).signal;
}

/**
 * A combined signal together with the way to take it apart again.
 *
 * @internal
 */
export interface LinkedSignal {
  readonly signal: AbortSignal | undefined;
  /** Detach the fallback listeners. Safe to call more than once. */
  release(): void;
}

/** Nothing to detach, nothing to stop. */
const noop = (): void => {};

/**
 * {@link combineSignals}, plus a way to unwire it.
 *
 * On runtimes with `AbortSignal.any` there is nothing to unwire – the platform
 * owns the lifetime. On the fallback path there is: a listener on each input
 * signal, holding a controller and its closure. A caller's signal typically
 * outlives the call it was passed to by a long way (one signal per user
 * session, one call per turn), so a listener left behind on every call is a
 * leak that grows for as long as the session does.
 *
 * @internal
 */
export function linkSignals(
  signals: ReadonlyArray<AbortSignal | undefined>,
): LinkedSignal {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 0) {
    return { signal: undefined, release: noop };
  }
  if (live.length === 1) {
    return { signal: live[0], release: noop };
  }

  // Prefer the standard helper when available (Node 20.3+, modern browsers).
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return { signal: anyFn(live), release: noop };
  }

  // Fallback: manual controller. If any input is already aborted, the
  // result is too — wire listeners for the rest.
  const controller = new AbortController();
  const already = live.find((s) => s.aborted);
  if (already) {
    controller.abort(
      (already as AbortSignal & { reason?: unknown }).reason ?? undefined,
    );

    return { signal: controller.signal, release: noop };
  }

  const listeners: [AbortSignal, () => void][] = [];
  const release = (): void => {
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.length = 0;
  };
  for (const s of live) {
    const listener = (): void => {
      release();
      controller.abort(
        (s as AbortSignal & { reason?: unknown }).reason ?? undefined,
      );
    };
    s.addEventListener("abort", listener, { once: true });
    listeners.push([s, listener]);
  }

  return { signal: controller.signal, release };
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
 * How long a stream may be alive but produce nothing before it is abandoned.
 *
 * The second clock, and the one a keep-alive cannot restart. A ping says the
 * connection is up. It does not say the model is producing, and a provider that
 * is wedged behind a queue keeps pinging for as long as the socket is open – so
 * a deadline that a ping restarts is a deadline the exact failure it was added
 * for can hold off forever. Measured against the version this replaces: pings
 * every 100ms held a 500ms deadline open past three seconds and were still
 * going.
 *
 * Ten minutes. It has to clear the longest a real model goes without producing
 * while still saying it is alive, which on an extended-thinking model over a
 * large transcript is minutes rather than seconds, and it has to be short
 * enough that a call nobody will get an answer from eventually releases the
 * caller. A model that genuinely thinks for longer has
 * `contentTimeoutMs`.
 *
 * @internal
 */
export const DEFAULT_STREAM_STALL_MS = 600_000;

/**
 * Reject a stream deadline that can never do anything, at adapter-creation
 * time rather than on the first stalled call.
 *
 * @internal
 */
export function validateStreamTimeout(
  timeoutMs: number,
  functionName: string,
  optionName = "timeoutMs",
): void {
  if (timeoutMs === Number.POSITIVE_INFINITY) {
    return;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `[Directive] ${functionName}: ${optionName} must be a positive number of milliseconds (received ${JSON.stringify(timeoutMs)}). Pass Infinity to run without a deadline.`,
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
export interface StreamDeadline extends StreamActivityDeadline {
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
   *
   * Which of the two clocks ran out is in the message.
   */
  readonly reason: Error;
  /** Stop both clocks. Call from a `finally`, once. */
  release(): void;
}

/** Optional second clock for {@link createStreamDeadline}. */
export interface StreamDeadlineOptions {
  /**
   * How long the stream may be alive but produce nothing, in milliseconds.
   * `Infinity` disables this clock. See {@link DEFAULT_STREAM_STALL_MS}.
   *
   * @default DEFAULT_STREAM_STALL_MS
   */
  contentMs?: number;
}

/**
 * Start the silence clocks for one streamed call. See {@link StreamDeadline}.
 *
 * `idleMs` bounds total silence – nothing at all on the wire, not even a
 * keep-alive. `contentMs` bounds a connection that is alive and producing
 * nothing. Both are needed and neither substitutes for the other: with only the
 * first, a proxy's keep-alives make a wedged provider immortal; with only the
 * second, a healthy stream that is merely slow to start is killed.
 *
 * `Infinity` on either disables that clock; `Infinity` on both leaves the
 * caller's signal as the only way to end a stalled stream.
 *
 * @internal
 */
export function createStreamDeadline(
  idleMs: number,
  callerSignal: AbortSignal | undefined,
  adapterName: string,
  options: StreamDeadlineOptions = {},
): StreamDeadline {
  const contentMs = options.contentMs ?? DEFAULT_STREAM_STALL_MS;
  const hasIdle = idleMs !== Number.POSITIVE_INFINITY;
  const hasContent = contentMs !== Number.POSITIVE_INFINITY;

  if (!hasIdle && !hasContent) {
    return {
      signal: callerSignal,
      expired: false,
      reason: streamSilenceError(adapterName, idleMs),
      touch: noop,
      progress: noop,
      suspend: noop,
      release: noop,
    };
  }

  const controller = new AbortController();
  const link = linkSignals([controller.signal, callerSignal]);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let contentTimer: ReturnType<typeof setTimeout> | undefined;

  const deadline = {
    signal: link.signal,
    expired: false,
    reason: streamSilenceError(adapterName, idleMs),
    touch: (): void => {
      // Once it has fired the call is over; re-arming would only leave a timer
      // running past the error that ended it.
      if (deadline.expired || !hasIdle) {
        return;
      }
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        deadline.expired = true;
        deadline.reason = streamSilenceError(adapterName, idleMs);
        controller.abort(deadline.reason);
      }, idleMs);
    },
    progress: (): void => {
      if (deadline.expired) {
        return;
      }
      deadline.touch();
      if (!hasContent) {
        return;
      }
      if (contentTimer !== undefined) {
        clearTimeout(contentTimer);
      }
      contentTimer = setTimeout(() => {
        deadline.expired = true;
        deadline.reason = streamStallError(adapterName, contentMs);
        controller.abort(deadline.reason);
      }, contentMs);
    },
    suspend: (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      if (contentTimer !== undefined) {
        clearTimeout(contentTimer);
        contentTimer = undefined;
      }
    },
    release: (): void => {
      deadline.suspend();
      link.release();
    },
  };
  deadline.progress();

  return deadline;
}

/**
 * The error a stream that went quiet ends with.
 *
 * A plain `Error` rather than a `DOMException`, which is what
 * `AbortSignal.timeout` produces: the name is the part callers read, every
 * runtime has `Error`, and an abort reason that is not an `Error` is replaced
 * with a generic one on its way out of the stream reader.
 */
function streamSilenceError(adapterName: string, idleMs: number): Error {
  const error = new Error(
    `[Directive] ${adapterName} stream sent nothing for ${idleMs}ms and was abandoned. The connection was open and silent – the provider stalled, or something between it and here did. Raise \`timeoutMs\` if this is a model that pauses for longer than that.`,
  );
  error.name = "TimeoutError";

  return error;
}

/** The error a stream that kept saying hello and nothing else ends with. */
function streamStallError(adapterName: string, contentMs: number): Error {
  const error = new Error(
    `[Directive] ${adapterName} stream produced nothing for ${contentMs}ms and was abandoned. The connection stayed alive – keep-alives kept arriving – but no part of a response did. Raise \`contentTimeoutMs\` if this is a model that thinks for longer than that.`,
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
  /** Why the provider stopped, normalized. See {@link RunResult.stopReason}. */
  stopReason?: StopReason;
  /** The provider's own spelling of {@link ParsedResponse.stopReason}. */
  rawStopReason?: string;
  /** Tool calls the model made, when the provider reported any. */
  toolCalls?: ToolCall[];
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
  /**
   * How long the streamed body may say nothing at all – not even a keep-alive –
   * before the call is abandoned, in milliseconds. `Infinity` disables it.
   *
   * The gap between events, not the length of the call: a stream runs for as
   * long as the model has something to say, so a wall-clock cap either truncates
   * a long answer or bounds nothing. A stalled call fails with an error named
   * `"TimeoutError"`.
   *
   * @default 120_000
   */
  idleTimeoutMs?: number;
  /**
   * How long the streamed body may stay alive and produce nothing before the
   * call is abandoned, in milliseconds. `Infinity` disables it.
   *
   * Keep-alives do not restart this clock, which is the point of it: a provider
   * wedged behind a queue keeps its connection warm indefinitely, and that is
   * exactly the failure {@link RunnerStreamingSupport.idleTimeoutMs} cannot see.
   *
   * @default 600_000
   */
  contentTimeoutMs?: number;
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
    // Armed for the streamed path only, and armed before the request goes out
    // so a connection that never answers is bounded by the same clocks as one
    // that answers and then stops. This is the path `createRunner` adapters and
    // the harness take, and until it had a deadline the only streamed calls in
    // the package that could be stalled forever were the ones most callers
    // actually use.
    let deadline: StreamDeadline | undefined;
    let link: LinkedSignal | undefined;

    try {
      const { url, init } = buildRequest(agent, input, messages, shouldStream);

      // Combine signals — `buildRequest` may set
      // `init.signal` (e.g. `AbortSignal.timeout(timeoutMs)`) and the
      // caller may pass their own via `runOptions.signal`. Naively
      // overwriting one with the other silently disables whichever was
      // dropped. `combineSignals` aborts as soon as either fires.
      link = linkSignals([init.signal ?? undefined, runOptions?.signal]);
      let signal = link.signal;
      if (shouldStream && streaming) {
        deadline = createStreamDeadline(
          streaming.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_MS,
          signal,
          streaming.adapterName,
          { contentMs: streaming.contentTimeoutMs ?? DEFAULT_STREAM_STALL_MS },
        );
        signal = deadline.signal;
      }
      const fetchInit: RequestInit = signal ? { ...init, signal } : init;

      const response = await fetchFn(url, fetchInit);
      // Headers arrived: the connection is up and the clocks start again here.
      deadline?.progress();

      if (!response.ok) {
        throw await buildProviderHTTPError(
          response,
          "AgentRunner",
          "request failed:",
        );
      }

      let parsed: ParsedResponse;
      if (shouldStream && streaming) {
        // A gateway that answers a streaming request with a JSON body did not
        // stream, and saying so beats the truncation error zero parsed events
        // would otherwise produce.
        if (streaming.wireFormat !== "ndjson") {
          await assertEventStreamResponse(response, streaming.adapterName);
        }
        const totals = await parseEventStream(
          getStreamReader(response),
          onToken,
          streaming.parseEvent,
          streaming.adapterName,
          streaming.wireFormat,
          {
            signal,
            deadline,
            requireTerminalEvent: streaming.requireTerminalEvent,
          },
        );
        // Read off the totals rather than off `buildResponse`, so an adapter
        // that supplies its own response builder cannot lose the distinction
        // between "the provider said zero" and "the provider said nothing",
        // nor drop what the stream said about why it ended or what it called.
        parsed = {
          ...(streaming.buildResponse ?? defaultStreamResponse)(totals),
          usageReported: totals.usageReported,
          ...(totals.stopReason !== undefined
            ? { stopReason: totals.stopReason }
            : {}),
          ...(totals.rawStopReason !== undefined
            ? { rawStopReason: totals.rawStopReason }
            : {}),
          ...(totals.toolCalls.length > 0
            ? { toolCalls: totals.toolCalls }
            : {}),
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
        toolCalls: parsed.toolCalls ?? [],
        totalTokens: parsed.totalTokens,
        tokenUsage,
        usageReported: parsed.usageReported ?? true,
        ...(parsed.stopReason !== undefined
          ? { stopReason: parsed.stopReason }
          : {}),
        ...(parsed.rawStopReason !== undefined
          ? { rawStopReason: parsed.rawStopReason }
          : {}),
      };
    } catch (err) {
      // What a cancelled body rejects with is the runtime's business, and it is
      // not always the reason the signal carried. When a deadline is what ended
      // the call, the caller sees that rather than whatever the socket said on
      // the way down – and whatever the abandoned stream had already been
      // billed for travels across with it.
      const error =
        deadline?.expired === true
          ? attachReportedUsage(deadline.reason, readReportedUsage(err))
          : err;
      const durationMs = Date.now() - startTime;
      if (error instanceof Error) {
        hooks?.onError?.({
          agent,
          input,
          error,
          durationMs,
          timestamp: Date.now(),
        });
      }

      throw error;
    } finally {
      deadline?.release();
      link?.release();
    }
  };
}
