/**
 * Shared utilities for streaming adapters.
 *
 * Extracts common SSE parsing, error handling, hook lifecycle, and response
 * building logic used across Anthropic, OpenAI, and Gemini streaming runners.
 */

import { attachReportedUsage } from "../pricing.js";
import { StreamConsumerError } from "../streaming.js";
import type {
  AdapterHooks,
  AgentLike,
  Message,
  StopReason,
  TokenUsage,
  ToolCall,
} from "../types.js";

// ============================================================================
// HTTP Error Handling
// ============================================================================

/**
 * Response headers worth carrying out on an HTTP failure.
 *
 * `retry-after` is the one the server used to say when to come back, and the
 * rate-limit family is what a caller needs to decide whether to come back at
 * all. Everything else is left behind: an error object is a thing people log,
 * and a wholesale header dump is how a bearer token or a cookie ends up in a
 * log line.
 */
function isDiagnosticHeader(name: string): boolean {
  return (
    name === "retry-after" ||
    name === "request-id" ||
    name === "x-request-id" ||
    name.includes("ratelimit") ||
    name.includes("rate-limit")
  );
}

/**
 * Read `Retry-After` as milliseconds.
 *
 * RFC 9110 §10.2.3 allows two spellings – a whole number of seconds, or an
 * HTTP-date to wait until. Both are accepted; anything else, and any date in
 * the past, reads as "the server said nothing usable".
 */
function parseRetryAfterHeader(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return undefined;
  }

  return Math.max(0, at - Date.now());
}

/**
 * A provider answered with an HTTP failure.
 *
 * Carries the status and the server's own retry instruction as properties
 * rather than only as prose in the message. `withRetry` reads `status` and
 * `retryAfter` directly; before they were here it scanned the message for a
 * `Retry-After` that had never been put in it, and backed off on its own
 * exponential schedule against a 429 that had told it exactly how long to wait.
 */
export class ProviderHTTPError extends Error {
  /** The HTTP status the provider answered with. */
  readonly status: number;
  /** The provider's status text, when it sent one. */
  readonly statusText: string;
  /**
   * `Retry-After`, in **seconds** – the unit `withRetry` reads and the unit the
   * header is defined in. Absent when the server did not send a usable one.
   */
  readonly retryAfter?: number;
  /** The same interval in milliseconds, for callers doing their own waiting. */
  readonly retryAfterMs?: number;
  /** Rate-limit and request-id headers, lower-cased. See {@link isDiagnosticHeader}. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    message: string,
    status: number,
    statusText: string,
    headers: Readonly<Record<string, string>>,
    retryAfterMs: number | undefined,
  ) {
    super(message);
    this.name = "ProviderHTTPError";
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
      this.retryAfter = retryAfterMs / 1000;
    }
  }
}

/**
 * Build a {@link ProviderHTTPError} from a failed response, reading up to 200
 * chars of the error body for diagnostics.
 */
export async function buildProviderHTTPError(
  response: Response,
  adapterName: string,
  what = "streaming error",
): Promise<ProviderHTTPError> {
  const errBody = await response.text().catch(() => "");

  const headers: Record<string, string> = {};
  try {
    response.headers.forEach((value, name) => {
      const key = name.toLowerCase();
      if (isDiagnosticHeader(key)) {
        headers[key] = value;
      }
    });
  } catch {
    /* a Response stand-in without iterable headers still throws a good error */
  }

  return new ProviderHTTPError(
    `[Directive] ${adapterName} ${what} ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
    response.status,
    response.statusText,
    Object.freeze(headers),
    parseRetryAfterHeader(response.headers?.get?.("retry-after") ?? null),
  );
}

/**
 * Throw a standardized HTTP error from a streaming response.
 * Reads up to 200 chars of the error body for diagnostics.
 */
export async function throwStreamingHTTPError(
  response: Response,
  adapterName: string,
): Promise<never> {
  throw await buildProviderHTTPError(response, adapterName);
}

/**
 * The `Accept` header every SSE request should carry.
 *
 * Without it a gateway content-negotiates its way to `application/json` and
 * answers a streaming request with a buffered body, which arrives here as a
 * single unparseable line and reads as a truncated stream.
 */
export const SSE_ACCEPT_HEADER = "text/event-stream";

/**
 * Refuse a 200 that is not the stream we asked for.
 *
 * A gateway that answers a streaming request with `application/json` has sent
 * an error object, a buffered completion, or a login page. All three parse as
 * zero events and surface as "ended without a completion marker", which sends
 * the reader looking for a truncation that is not there. Only an explicitly
 * JSON content type is refused: a server that sends no `Content-Type` at all,
 * or an unfamiliar one, is left alone rather than guessed at.
 */
export async function assertEventStreamResponse(
  response: Response,
  adapterName: string,
): Promise<void> {
  const contentType = response.headers?.get?.("content-type");
  if (contentType === null || contentType === undefined) {
    return;
  }
  const type = contentType.toLowerCase();
  if (type.includes("event-stream") || !type.includes("json")) {
    return;
  }

  const body = await response.text().catch(() => "");

  throw new Error(
    `[Directive] ${adapterName} answered a streaming request with "${contentType}" rather than text/event-stream – the endpoint did not stream${body ? `: ${body.slice(0, 200)}` : "."}`,
  );
}

/**
 * Get an SSE reader from a response, throwing if body is missing.
 */
export function getStreamReader(
  response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("[Directive] No response body");
  }

  return reader;
}

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Warn in non-production environments if an API key is empty.
 */
export function warnIfMissingApiKey(
  apiKey: string | undefined,
  functionName: string,
): void {
  if (
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production" &&
    !apiKey
  ) {
    console.warn(
      `[Directive] ${functionName}: apiKey is empty. API calls will fail.`,
    );
  }
}

// ============================================================================
// Token Count Validation
// ============================================================================

/**
 * Read a token count that a provider may or may not have sent.
 *
 * Returns the number when the field holds a finite non-negative one, and
 * `undefined` for everything else – a missing field, `null`, a string, `NaN`.
 *
 * Whether a count is a *report* is a further question, answered by
 * {@link isReportedCount}: this one only says the field held a number.
 *
 * The distinction matters because "the provider reported usage" is what decides
 * whether a call is priceable, and testing the container rather than the
 * numbers answered that question wrong: a gateway forwarding
 * `"usage":{"prompt_tokens":null,"completion_tokens":null}` satisfied
 * `usage != null`, so the call was recorded as reporting zero tokens and cost
 * nothing, while the same gateway omitting the `usage` key entirely was
 * correctly charged at estimate. The two say exactly the same thing.
 *
 * @internal
 */
export function readTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

/**
 * Did the provider report at least one usable token count?
 *
 * "Usable" means a number greater than zero. A call that reached a model
 * consumed input tokens by definition – a prompt of zero tokens is not a thing
 * a provider can answer – so an all-zero usage block says the same thing a
 * missing one does: nobody counted. Accepting it as a report was the third way
 * the same hole opened: measured against a gateway returning
 * `"usage":{"prompt_tokens":0,"completion_tokens":0}`, two hundred calls with
 * four-thousand-character answers ran against a five-cent ceiling with recorded
 * spend of zero, an unpriced-call count of zero, and no signal of any kind.
 *
 * A real zero output count on a real call still reports, because the input
 * count beside it is non-zero.
 *
 * @internal
 */
export function anyTokenCountReported(...values: unknown[]): boolean {
  return values.some((value) => isReportedCount(value));
}

/**
 * Is this value a token count the provider actually measured, rather than a
 * placeholder? See {@link anyTokenCountReported} for why zero is not.
 *
 * @internal
 */
export function isReportedCount(value: unknown): boolean {
  const count = readTokenCount(value);

  return count !== undefined && count > 0;
}

// ============================================================================
// Event Stream Parser
// ============================================================================

/** Result from parsing a single streamed event (provider-specific). */
export interface StreamEventResult {
  /** Text token to append to output. */
  text?: string;
  /**
   * This event is the provider's end-of-response marker – Anthropic's
   * `message_stop`, Ollama's `done: true`, a `finish_reason` on an OpenAI
   * choice, a `finishReason` on a Gemini candidate.
   *
   * A stream that ends without one ended early. The SSE `[DONE]` sentinel is
   * recognized by the parser itself and needs no flag here.
   */
  terminal?: boolean;
  /** Updated input token count (cumulative, not delta). */
  inputTokens?: number;
  /** Updated output token count (cumulative, not delta). */
  outputTokens?: number;
  /** Updated prompt-cache read token count (cumulative, not delta). */
  cacheReadTokens?: number;
  /** Updated prompt-cache creation token count (cumulative, not delta). */
  cacheCreationTokens?: number;
  /**
   * Why the provider stopped, normalized. Set on whichever event carries the
   * provider's stop reason – which is not always the terminal one.
   */
  stopReason?: StopReason;
  /** The provider's own spelling of {@link StreamEventResult.stopReason}. */
  rawStopReason?: string;
  /** A tool-use block opened at this content-block index. */
  toolCallStart?: { index: number; id: string; name: string };
  /**
   * Partial JSON arguments for the tool-use block at this index. Providers
   * stream a tool call's arguments as a sequence of string fragments that are
   * only valid JSON once concatenated.
   */
  toolCallDelta?: { index: number; json: string };
}

/**
 * The clocks a streamed call runs against, as {@link parseEventStream} needs
 * to see them. Implemented by `createStreamDeadline` in `agent-utils`.
 *
 * Declared structurally here rather than imported so the parser owns when the
 * clocks move. They used to be driven from inside each adapter's `parseEvent`,
 * which meant they only moved for lines that produced a JSON payload: the
 * spec's own keep-alive – a `:` comment – never touched them, so a healthy
 * stream behind a proxy that keeps the connection warm was killed as stalled.
 *
 * @internal
 */
export interface StreamActivityDeadline {
  /** Back to waiting on the wire: restart the silence clock. */
  touch(): void;
  /** The provider produced something: restart the silence and stall clocks. */
  progress(): void;
  /** Control has left this library: stop both clocks until {@link progress}. */
  suspend(): void;
}

/**
 * How a provider frames the events it streams.
 *
 * - `"sse"` – server-sent events: `data: <json>` lines with a `[DONE]` sentinel
 *   (Anthropic, OpenAI, Gemini).
 * - `"ndjson"` – newline-delimited JSON objects, one per line (Ollama).
 */
export type StreamWireFormat = "sse" | "ndjson";

/** Accumulated totals from a fully consumed event stream. */
export interface StreamTotals {
  fullText: string;
  inputTokens: number;
  outputTokens: number;
  /** Only set when the provider reported prompt-cache reads. */
  cacheReadTokens?: number;
  /** Only set when the provider reported prompt-cache writes. */
  cacheCreationTokens?: number;
  /**
   * Whether any event in the stream carried token usage at all.
   *
   * `false` means the counts above are zero because the provider never sent
   * any – an OpenAI-compatible endpoint that ignores
   * `stream_options.include_usage`, for instance – rather than because the
   * call was free. Cost tracking needs to be able to tell those apart.
   *
   * A usage frame carrying only zeros counts as never sent: no call that
   * reached a model consumed zero input tokens.
   */
  usageReported: boolean;
  /** Why the provider stopped, when it said. See {@link StopReason}. */
  stopReason?: StopReason;
  /** The provider's own spelling of {@link StreamTotals.stopReason}. */
  rawStopReason?: string;
  /** Tool calls assembled from the stream. Empty when the model called none. */
  toolCalls: ToolCall[];
}

/** Options for {@link parseEventStream}. */
export interface ParseEventStreamOptions {
  /**
   * Abort signal for the run. Both `reader.read()` and the awaited `onToken`
   * callback are raced against it, so neither a provider that stops sending
   * nor a callback that never settles can hold the reader open past an
   * `abort()` – without the race the run leaks its socket, its fetch and its
   * "running" state with no way to reach any of them.
   *
   * Racing the read is what makes the guarantee this library's own rather than
   * the fetch implementation's. Every adapter takes an injected `fetch`, and a
   * wrapper that tees, records or re-`Response`s the body does not necessarily
   * error it on abort; before the race, such a wrapper silently disarmed every
   * stream deadline in the package.
   */
  signal?: AbortSignal;
  /**
   * The silence clocks for this call, restarted from here as events arrive.
   * See {@link StreamActivityDeadline}.
   */
  deadline?: StreamActivityDeadline;
  /**
   * Throw when the stream ends without a terminal marker.
   *
   * A body truncated before the end of the response arrives as a clean EOF, so
   * without this a partial answer resolves successfully and is
   * indistinguishable from a complete one. Off by default because a
   * hand-written {@link StreamEventResult} parser has no way to report the
   * marker it was never asked about; the shipped adapters turn it on.
   */
  requireTerminalEvent?: boolean;
}

/**
 * Parse an event stream from a Response, calling `onToken` for each text chunk
 * and `parseEvent` for provider-specific event extraction.
 *
 * Handles buffering, `[DONE]` sentinels, malformed JSON, and reader cleanup.
 *
 * `onToken` is awaited. A callback that returns a promise therefore applies
 * real backpressure: the next chunk is not read off the wire until it settles.
 * A synchronous callback returns `undefined`, which `await` resolves in a
 * microtask, so streaming semantics are unchanged for callers that pass one.
 *
 * @param reader - The ReadableStream reader from the response body.
 * @param onToken - Callback for each text token (may be undefined). Awaited.
 * @param parseEvent - Provider-specific function to extract text and tokens from a parsed event.
 * @param adapterName - Adapter name for dev-mode warnings.
 * @param wireFormat - How the provider frames its events. @default "sse"
 * @param options - Abort signal and terminal-marker enforcement.
 * @returns The full text output and final token counts.
 */
export async function parseEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken: ((token: string) => void | Promise<void>) | undefined,
  parseEvent: (event: Record<string, unknown>) => StreamEventResult,
  adapterName: string,
  wireFormat: StreamWireFormat = "sse",
  options: ParseEventStreamOptions = {},
): Promise<StreamTotals> {
  const { signal, deadline, requireTerminalEvent = false } = options;
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheCreationTokens: number | undefined;
  let usageReported = false;
  let stopReason: StopReason | undefined;
  let rawStopReason: string | undefined;
  const toolCalls = new Map<
    number,
    { id: string; name: string; json: string }
  >();
  /** The response is complete: no further text belongs to it. */
  let sawTerminal = false;
  /** The wire said the body is over: stop reading. */
  let sawEndOfStream = false;
  let warnedAfterTerminal = false;

  // One abort listener and one rejection for the whole stream rather than a
  // fresh pair per delta. The per-delta form allocated a promise, an executor
  // closure, a listener, a `.catch` handler and a `Promise.race` array for
  // every token, which at a thousand concurrent streams is a six-figure
  // allocation rate for a race that almost never fires. The semantics are
  // unchanged: one rejection settles every waiter.
  const abortWatch = watchAbort(signal);

  /**
   * Handle one assembled event payload – the `data` of one SSE event, or one
   * NDJSON line.
   */
  const handleData = async (data: string): Promise<void> => {
    // Parsing is guarded, delivery is not: a throw from `onToken` belongs
    // to the caller and must not be mistaken for a malformed event.
    let result: StreamEventResult;
    try {
      result = parseEvent(JSON.parse(data));
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        if (
          typeof process !== "undefined" &&
          process.env?.NODE_ENV === "development"
        ) {
          console.warn(
            `[Directive] Malformed stream event from ${adapterName}:`,
            data,
          );
        }

        return;
      }

      throw parseErr;
    }

    // Text after the end-of-response marker is not part of the response. It
    // arrives when a gateway concatenates two upstream generations onto one
    // body, and delivering it hands the consumer both answers as though they
    // were one. Counts are still read: OpenAI sends its usage frame *after*
    // the `finish_reason` that marks the response complete, so refusing
    // everything past the marker would make every streamed OpenAI call
    // unpriceable.
    if (result.text) {
      if (sawTerminal) {
        warnOnceAfterTerminal();
      } else {
        fullText += result.text;
        // The clocks stop while the consumer holds the token. A callback slower
        // than the deadline is a slow reader, not a silent provider, and
        // measuring one as the other made a `TimeoutError` blaming the provider
        // the normal outcome of any consumer doing real work per delta – the two
        // shipped features cancelling each other out.
        deadline?.suspend();
        await deliverToken(onToken, result.text, abortWatch);
      }
    }
    if (result.terminal) {
      sawTerminal = true;
    }
    if (result.stopReason !== undefined) {
      stopReason = result.stopReason;
    }
    if (result.rawStopReason !== undefined) {
      rawStopReason = result.rawStopReason;
    }
    if (result.toolCallStart) {
      const { index, id, name } = result.toolCallStart;
      toolCalls.set(index, { id, name, json: "" });
    }
    if (result.toolCallDelta) {
      const { index, json } = result.toolCallDelta;
      const open = toolCalls.get(index);
      if (open) {
        open.json += json;
      }
    }

    // Anything the parser recognized is the provider making progress. An event
    // it recognized nothing in – Anthropic's `ping`, a heartbeat frame – says
    // the connection is up and says nothing about whether the model is
    // producing, so it restarts the silence clock and not the stall clock.
    if (hasSignal(result)) {
      deadline?.progress();
    } else {
      deadline?.touch();
    }

    // Counts are taken as sent, including zeros – a response really can have
    // produced no output tokens. What a zero does not do is establish that
    // anyone counted, so `usageReported` needs a number above zero. A frame
    // carrying nothing but zeros is a placeholder, and treating it as a report
    // priced two hundred real calls at nothing.
    const nextInput = readTokenCount(result.inputTokens);
    if (nextInput !== undefined) {
      inputTokens = nextInput;
      usageReported ||= nextInput > 0;
    }
    const nextOutput = readTokenCount(result.outputTokens);
    if (nextOutput !== undefined) {
      outputTokens = nextOutput;
      usageReported ||= nextOutput > 0;
    }
    const nextCacheRead = readTokenCount(result.cacheReadTokens);
    if (nextCacheRead !== undefined) {
      cacheReadTokens = nextCacheRead;
      usageReported ||= nextCacheRead > 0;
    }
    const nextCacheCreation = readTokenCount(result.cacheCreationTokens);
    if (nextCacheCreation !== undefined) {
      cacheCreationTokens = nextCacheCreation;
      usageReported ||= nextCacheCreation > 0;
    }
  };

  function warnOnceAfterTerminal(): void {
    if (warnedAfterTerminal) {
      return;
    }
    warnedAfterTerminal = true;
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development"
    ) {
      console.warn(
        `[Directive] ${adapterName} sent content after its end-of-response marker – discarded. The endpoint is joining more than one generation onto a single body.`,
      );
    }
  }

  /**
   * What the provider has said it counted so far, for an error to carry out.
   *
   * Only when a number above zero has arrived: a report of all zeros is not a
   * report, and attaching one would turn a call nobody counted into a call
   * counted at nothing. Both token classes are always present, because a
   * partial report with a missing field is not one any ledger accepts – an
   * output count of zero on a stream cut off before its first delta is the
   * truth about what it generated.
   */
  const reportedSoFar = (): TokenUsage | undefined => {
    if (!usageReported) {
      return undefined;
    }

    return {
      inputTokens,
      outputTokens,
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    };
  };

  // ---- SSE event framing -------------------------------------------------
  // The unit of an event stream is the event, not the line. An event is a run
  // of fields terminated by a blank line, and its `data` is every `data` field
  // in that run joined with newlines. Dispatching per line instead dropped
  // every event a server chose to split across two `data` lines – legal, and
  // what a server does when the payload contains a newline – and the drop was
  // silent: the JSON fragment failed to parse, the SyntaxError was swallowed,
  // and a `message_start` lost that way took the input token count with it, so
  // the run succeeded and billed zero.
  /** `data` fields accumulated for the event currently being assembled. */
  let dataBuffer = "";
  /** Whether the event under assembly has had any `data` field at all. */
  let sawDataField = false;

  const dispatchSseEvent = async (): Promise<void> => {
    if (!sawDataField) {
      // A comment-only or `event:`-only block. Real traffic: an `event: ping`
      // with no data, and every keep-alive comment.
      return;
    }
    const data = dataBuffer;
    dataBuffer = "";
    sawDataField = false;

    const trimmed = data.trim();
    if (trimmed === "") {
      // `data:` with nothing after it is a heartbeat, not a malformed event.
      deadline?.touch();

      return;
    }
    if (trimmed === "[DONE]") {
      sawTerminal = true;
      sawEndOfStream = true;

      return;
    }

    await handleData(data);
  };

  const handleSseLine = async (line: string): Promise<void> => {
    if (line === "") {
      await dispatchSseEvent();

      return;
    }
    // A line beginning with a colon is a comment – the standard's own keep-alive
    // mechanism, and what nginx, Cloudflare and every SSE proxy send to hold a
    // connection open. It carries no event, and it is unambiguous proof the
    // connection is live.
    if (line.charCodeAt(0) === COLON) {
      deadline?.touch();

      return;
    }

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") {
      // `event`, `id` and `retry` carry nothing this parser reads. Reading them
      // is still a sign of life.
      deadline?.touch();

      return;
    }
    // The single space after the colon is optional, and is stripped when
    // present – exactly one, not "however many". Matching `"data: "` as a
    // literal prefix instead made every conformant server that writes
    // `data:{...}` – TGI, several vLLM builds, and anything using
    // `fmt.Fprintf(w, "data:%s\n\n")` – parse as zero events and fail as a
    // truncated stream, on a request that had already been billed.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.charCodeAt(0) === SPACE) {
      value = value.slice(1);
    }
    dataBuffer = sawDataField ? `${dataBuffer}\n${value}` : value;
    sawDataField = true;
  };

  const handleNdjsonLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed === "") {
      return;
    }

    await handleData(trimmed);
  };

  const handleLine = wireFormat === "ndjson" ? handleNdjsonLine : handleSseLine;

  try {
    while (!sawEndOfStream) {
      // Back to waiting on the wire: the silence clock measures the gap from
      // here, so time this library spent parsing or the consumer spent
      // rendering is never charged to the provider.
      deadline?.touch();

      const { done, value } = await readNext(reader, abortWatch);
      if (done) {
        break;
      }

      buf += decoder.decode(value, { stream: true });
      const { lines, rest } = takeLines(buf, false);
      buf = rest;

      for (const line of lines) {
        await handleLine(line);
        // The sentinel ends the body. Reading past it kept a truncated
        // response looking complete and let whatever followed reach the
        // consumer, which is the very failure the marker check was added to
        // catch.
        if (sawEndOfStream) {
          break;
        }
      }
    }

    // Servers are not obliged to end the body with a newline, and the last
    // event of a stream commonly arrives with nothing after it – no blank line
    // to dispatch it, sometimes not even a line terminator. The standard says
    // to discard an unterminated event; doing that here would throw away the
    // final `message_stop` of every server that ends the body tightly, turning
    // a complete response into a truncation error, so the tail is flushed.
    if (!sawEndOfStream && buf.length > 0) {
      const { lines, rest } = takeLines(buf, true);
      for (const line of lines) {
        await handleLine(line);
        if (sawEndOfStream) {
          break;
        }
      }
      if (!sawEndOfStream && rest.length > 0) {
        await handleLine(rest);
      }
    }
    if (!sawEndOfStream) {
      await dispatchSseEvent();
    }
  } catch (err) {
    // A stream that fails part-way still costs what it had already run up, and
    // the counts for it are sitting right here. Nothing else downstream can
    // recover them – the totals this function returns are the only place they
    // ever existed, and it is not going to return.
    throw attachReportedUsage(err, reportedSoFar());
  } finally {
    abortWatch?.release();
    reader.cancel().catch(() => {});
  }

  // A body cut short arrives as a clean EOF. Without this the caller gets a
  // short answer and no indication that the rest of it is missing.
  if (requireTerminalEvent && !sawTerminal) {
    throw attachReportedUsage(
      new Error(
        `[Directive] ${adapterName} stream ended without a completion marker after ${fullText.length} characters – the response is incomplete.`,
      ),
      reportedSoFar(),
    );
  }

  return {
    fullText,
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    usageReported,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(rawStopReason !== undefined ? { rawStopReason } : {}),
    toolCalls: [...toolCalls.values()].map(({ id, name, json }) => ({
      id,
      name,
      arguments: json,
    })),
  };
}

/** U+003A, the SSE field separator. */
const COLON = 58;
/** U+0020, the one optional space a field value may begin with. */
const SPACE = 32;

/** Did the parser recognize anything in this event? See {@link StreamActivityDeadline}. */
function hasSignal(result: StreamEventResult): boolean {
  for (const _key in result) {
    return true;
  }

  return false;
}

/**
 * Split off every complete line, leaving the incomplete tail.
 *
 * An event-stream line ends at CR, LF, or CRLF – all three, per the standard's
 * own grammar. Splitting on LF alone left a CR-only body as a single
 * ever-growing line that never parsed as JSON, and because the resulting
 * SyntaxError is swallowed as a malformed event, a perfectly healthy stream
 * reported that it had ended without a completion marker.
 *
 * A CR at the very end of a chunk is held back unless the body is over: it may
 * be the first half of a CRLF whose LF is in the next chunk, and treating it as
 * a terminator would emit one spurious blank line – which, in a format where
 * the blank line is what dispatches an event, cuts an event in half.
 */
function takeLines(
  buf: string,
  atEnd: boolean,
): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  let i = 0;

  while (i < buf.length) {
    const code = buf.charCodeAt(i);
    if (code === 10) {
      lines.push(buf.slice(start, i));
      i += 1;
      start = i;
      continue;
    }
    if (code === 13) {
      if (i === buf.length - 1 && !atEnd) {
        break;
      }
      lines.push(buf.slice(start, i));
      i += buf.charCodeAt(i + 1) === 10 ? 2 : 1;
      start = i;
      continue;
    }
    i += 1;
  }

  return { lines, rest: buf.slice(start) };
}

/**
 * Read the next chunk, and stop waiting on it if the run is aborted.
 *
 * The abort has to land here, in this library, rather than being left to the
 * fetch implementation to error the body. Every adapter accepts an injected
 * `fetch`, and a wrapper that tees the body for logging, replays it from a
 * recording, or hands back a fresh `Response` need not propagate the signal at
 * all – which silently turned every stream deadline in the package into a
 * suggestion. With the race, the deadline enforces itself against any body.
 */
function readNext(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortWatch: AbortWatch | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!abortWatch) {
    return reader.read();
  }
  if (abortWatch.signal.aborted) {
    return Promise.reject(abortReason(abortWatch.signal));
  }

  return Promise.race([reader.read(), abortWatch.rejection]);
}

/**
 * One abort listener and one rejected promise, shared by every delta of a
 * single stream.
 */
interface AbortWatch {
  signal: AbortSignal;
  /** Rejects with the signal's reason once, when the signal aborts. */
  readonly rejection: Promise<never>;
  /** Detach the listener. Called once, when the stream is done reading. */
  release(): void;
}

/** Start watching `signal` for the life of one stream, if there is one. */
function watchAbort(signal: AbortSignal | undefined): AbortWatch | undefined {
  if (!signal) {
    return undefined;
  }

  let onAbort: (() => void) | undefined;
  const rejection = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // Nothing awaits this promise until a delta races against it, and a stream
  // aborted between deltas would otherwise report an unhandled rejection.
  rejection.catch(() => {});

  return {
    signal,
    rejection,
    release: () => {
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
      }
    },
  };
}

/**
 * Hand one delta to the consumer, and stop waiting on it if the run is
 * aborted.
 *
 * The await is what makes backpressure real, and it is also what a callback
 * that never settles exploits: outside a race with the abort signal it parks
 * the reader forever, so `abort()` returns, the result promise never settles,
 * the `finally` above never runs, and the socket stays open. Racing keeps
 * backpressure for callbacks that settle and gives cancellation a way through
 * for the ones that do not.
 *
 * A throw from the callback belongs to the consumer, not the provider, and is
 * named as such so retry and fallback wrappers do not pay for the same
 * response again on its behalf.
 */
async function deliverToken(
  onToken: ((token: string) => void | Promise<void>) | undefined,
  token: string,
  abortWatch: AbortWatch | undefined,
): Promise<void> {
  if (!onToken) {
    return;
  }

  let pending: void | Promise<void>;
  try {
    pending = onToken(token);
  } catch (err) {
    throw new StreamConsumerError(err);
  }

  if (!isPromiseLike(pending)) {
    return;
  }

  const settled = Promise.resolve(pending).catch((err) => {
    throw new StreamConsumerError(err);
  });

  if (!abortWatch) {
    return settled;
  }

  if (abortWatch.signal.aborted) {
    settled.catch(() => {});

    throw abortReason(abortWatch.signal);
  }

  try {
    await Promise.race([settled, abortWatch.rejection]);
  } finally {
    // A callback that lost the race is no longer awaited by anyone: give it a
    // handler so a late rejection is not reported as unhandled. The shared
    // rejection already carries one.
    settled.catch(() => {});
  }
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return typeof (value as { then?: unknown } | undefined)?.then === "function";
}

function abortReason(signal: AbortSignal): Error {
  const { reason } = signal;

  return reason instanceof Error
    ? reason
    : new Error("[Directive] Stream aborted");
}

// ============================================================================
// Hook Lifecycle Helpers
// ============================================================================

/**
 * Fire the onBeforeCall hook and return the start timestamp.
 */
export function fireBeforeCallHook(
  hooks: AdapterHooks | undefined,
  agent: AgentLike,
  input: string,
): number {
  const startTime = Date.now();
  hooks?.onBeforeCall?.({ agent, input, timestamp: startTime });

  return startTime;
}

/**
 * Fire the onAfterCall hook with timing and token data.
 */
export function fireAfterCallHook(
  hooks: AdapterHooks | undefined,
  agent: AgentLike,
  input: string,
  output: string,
  totalTokens: number,
  tokenUsage: TokenUsage,
  startTime: number,
): void {
  hooks?.onAfterCall?.({
    agent,
    input,
    output,
    totalTokens,
    tokenUsage,
    durationMs: Date.now() - startTime,
    timestamp: Date.now(),
  });
}

/**
 * Fire the onError hook if the error is an Error instance.
 */
export function fireErrorHook(
  hooks: AdapterHooks | undefined,
  agent: AgentLike,
  input: string,
  err: unknown,
  startTime: number,
): void {
  if (err instanceof Error) {
    hooks?.onError?.({
      agent,
      input,
      error: err,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });
  }
}

// ============================================================================
// Streaming Response Builder
// ============================================================================

/**
 * Build the standard streaming runner return value.
 */
export function buildStreamingResult(
  input: string,
  fullText: string,
  totalTokens: number,
  tokenUsage: TokenUsage,
  usageReported = true,
  extras: {
    stopReason?: StopReason;
    rawStopReason?: string;
    toolCalls?: ToolCall[];
  } = {},
): {
  output: string;
  messages: Message[];
  toolCalls: ToolCall[];
  totalTokens: number;
  tokenUsage: TokenUsage;
  usageReported: boolean;
  stopReason?: StopReason;
  rawStopReason?: string;
} {
  const assistantMsg: Message = { role: "assistant", content: fullText };

  return {
    output: fullText,
    messages: [{ role: "user" as const, content: input }, assistantMsg],
    toolCalls: extras.toolCalls ?? [],
    totalTokens,
    tokenUsage,
    usageReported,
    ...(extras.stopReason !== undefined
      ? { stopReason: extras.stopReason }
      : {}),
    ...(extras.rawStopReason !== undefined
      ? { rawStopReason: extras.rawStopReason }
      : {}),
  };
}
