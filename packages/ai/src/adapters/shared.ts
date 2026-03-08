/**
 * Shared utilities for streaming adapters.
 *
 * Extracts common SSE parsing, error handling, hook lifecycle, and response
 * building logic used across Anthropic, OpenAI, and Gemini streaming runners.
 */

import type {
  AdapterHooks,
  AgentLike,
  Message,
  TokenUsage,
} from "../types.js";

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
export function getSSEReader(
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
// SSE Stream Parser
// ============================================================================

/** Result from parsing a single SSE event (provider-specific). */
export interface SSEEventResult {
  /** Text token to append to output. */
  text?: string;
  /** Updated input token count (cumulative, not delta). */
  inputTokens?: number;
  /** Updated output token count (cumulative, not delta). */
  outputTokens?: number;
}

/**
 * Parse an SSE stream from a Response, calling `onToken` for each text chunk
 * and `parseEvent` for provider-specific event extraction.
 *
 * Handles buffering, `[DONE]` sentinels, malformed JSON, and reader cleanup.
 *
 * @param reader - The ReadableStream reader from the response body.
 * @param onToken - Callback for each text token (may be undefined).
 * @param parseEvent - Provider-specific function to extract text and tokens from a parsed SSE event.
 * @param adapterName - Adapter name for dev-mode warnings.
 * @returns The full text output and final token counts.
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken: ((token: string) => void) | undefined,
  parseEvent: (event: Record<string, unknown>) => SSEEventResult,
  adapterName: string,
): Promise<{ fullText: string; inputTokens: number; outputTokens: number }> {
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

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
        if (!line.startsWith("data: ")) {
          continue;
        }
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          continue;
        }

        try {
          const event = JSON.parse(data);
          const result = parseEvent(event);
          if (result.text) {
            fullText += result.text;
            onToken?.(result.text);
          }
          if (result.inputTokens !== undefined) {
            inputTokens = result.inputTokens;
          }
          if (result.outputTokens !== undefined) {
            outputTokens = result.outputTokens;
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            if (
              typeof process !== "undefined" &&
              process.env?.NODE_ENV === "development"
            ) {
              console.warn(
                `[Directive] Malformed SSE event from ${adapterName}:`,
                data,
              );
            }
          } else {
            throw parseErr;
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return { fullText, inputTokens, outputTokens };
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
