/**
 * Shared utilities for streaming adapters.
 *
 * Extracts common SSE parsing, error handling, hook lifecycle, and response
 * building logic used across Anthropic, OpenAI, and Gemini streaming runners.
 */

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
 * @returns The full text output and final token counts.
 */
export async function parseEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken: ((token: string) => void | Promise<void>) | undefined,
  parseEvent: (event: Record<string, unknown>) => StreamEventResult,
  adapterName: string,
  wireFormat: StreamWireFormat = "sse",
): Promise<StreamTotals> {
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheCreationTokens: number | undefined;

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
        const data = extractPayload(line, wireFormat);
        if (data === undefined) {
          continue;
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

            continue;
          }

          throw parseErr;
        }

        if (result.text) {
          fullText += result.text;
          await onToken?.(result.text);
        }
        if (result.inputTokens !== undefined) {
          inputTokens = result.inputTokens;
        }
        if (result.outputTokens !== undefined) {
          outputTokens = result.outputTokens;
        }
        if (result.cacheReadTokens !== undefined) {
          cacheReadTokens = result.cacheReadTokens;
        }
        if (result.cacheCreationTokens !== undefined) {
          cacheCreationTokens = result.cacheCreationTokens;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return {
    fullText,
    inputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
  };
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
): {
  output: string;
  messages: Message[];
  toolCalls: never[];
  totalTokens: number;
  tokenUsage: TokenUsage;
} {
  const assistantMsg: Message = { role: "assistant", content: fullText };

  return {
    output: fullText,
    messages: [{ role: "user" as const, content: input }, assistantMsg],
    toolCalls: [],
    totalTokens,
    tokenUsage,
  };
}
