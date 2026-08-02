/**
 * Shared utilities for streaming adapters.
 *
 * Extracts common SSE parsing, error handling, hook lifecycle, and response
 * building logic used across Anthropic, OpenAI, and Gemini streaming runners.
 */

import { StreamConsumerError } from "../streaming.js";
import type { AdapterHooks, AgentLike, Message, TokenUsage } from "../types.js";

// ============================================================================
// HTTP Error Handling
// ============================================================================

/**
 * Throw a standardized HTTP error from a streaming response.
 * Reads up to 200 chars of the error body for diagnostics.
 */
export async function throwStreamingHTTPError(
  response: Response,
  adapterName: string,
): Promise<never> {
  const errBody = await response.text().catch(() => "");

  throw new Error(
    `[Directive] ${adapterName} streaming error ${response.status}${errBody ? ` – ${errBody.slice(0, 200)}` : ""}`,
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
   */
  usageReported: boolean;
}

/** Options for {@link parseEventStream}. */
export interface ParseEventStreamOptions {
  /**
   * Abort signal for the run. The awaited `onToken` callback is raced against
   * it, so a callback that never settles cannot hold the reader open past an
   * `abort()` – without the race the run leaks its socket, its fetch and its
   * "running" state with no way to reach any of them.
   */
  signal?: AbortSignal;
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
  const { signal, requireTerminalEvent = false } = options;
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheCreationTokens: number | undefined;
  let usageReported = false;
  let sawTerminal = false;

  const handleLine = async (line: string): Promise<void> => {
    if (isSseTerminalLine(line, wireFormat)) {
      sawTerminal = true;
    }
    const data = extractPayload(line, wireFormat);
    if (data === undefined) {
      return;
    }

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

    if (result.terminal) {
      sawTerminal = true;
    }
    if (result.text) {
      fullText += result.text;
      await deliverToken(onToken, result.text, signal);
    }
    if (result.inputTokens !== undefined) {
      inputTokens = result.inputTokens;
      usageReported = true;
    }
    if (result.outputTokens !== undefined) {
      outputTokens = result.outputTokens;
      usageReported = true;
    }
    if (result.cacheReadTokens !== undefined) {
      cacheReadTokens = result.cacheReadTokens;
      usageReported = true;
    }
    if (result.cacheCreationTokens !== undefined) {
      cacheCreationTokens = result.cacheCreationTokens;
      usageReported = true;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        await handleLine(line);
      }
    }

    // Servers are not obliged to end the body with a newline, so the last
    // event can arrive with nothing after it. Dropping it silently cost a
    // token count before; now it would also cost the completion marker and
    // turn a complete response into a truncation error.
    if (buf.length > 0) {
      await handleLine(buf);
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  // A body cut short arrives as a clean EOF. Without this the caller gets a
  // short answer and no indication that the rest of it is missing.
  if (requireTerminalEvent && !sawTerminal) {
    throw new Error(
      `[Directive] ${adapterName} stream ended without a completion marker after ${fullText.length} characters – the response is incomplete.`,
    );
  }

  return {
    fullText,
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
    usageReported,
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
  signal: AbortSignal | undefined,
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

  if (!signal) {
    return settled;
  }

  if (signal.aborted) {
    throw abortReason(signal);
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    await Promise.race([settled, aborted]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    // Whichever side lost the race is no longer awaited by anyone: give both
    // a handler so a late rejection is not reported as unhandled.
    settled.catch(() => {});
    aborted.catch(() => {});
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

/** Does this line carry the SSE end-of-stream sentinel? */
function isSseTerminalLine(
  line: string,
  wireFormat: StreamWireFormat,
): boolean {
  if (wireFormat !== "sse" || !line.startsWith("data: ")) {
    return false;
  }

  return line.slice(6).trim() === "[DONE]";
}

/**
 * Pull the JSON payload out of one wire line, or `undefined` when the line
 * carries no event (an SSE comment, a `[DONE]` sentinel, a blank separator).
 */
function extractPayload(
  line: string,
  wireFormat: StreamWireFormat,
): string | undefined {
  if (wireFormat === "ndjson") {
    const trimmed = line.trim();

    return trimmed === "" ? undefined : trimmed;
  }

  if (!line.startsWith("data: ")) {
    return undefined;
  }
  const data = line.slice(6).trim();

  return data === "[DONE]" ? undefined : data;
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
): {
  output: string;
  messages: Message[];
  toolCalls: never[];
  totalTokens: number;
  tokenUsage: TokenUsage;
  usageReported: boolean;
} {
  const assistantMsg: Message = { role: "assistant", content: fullText };

  return {
    output: fullText,
    messages: [{ role: "user" as const, content: input }, assistantMsg],
    toolCalls: [],
    totalTokens,
    tokenUsage,
    usageReported,
  };
}
