/**
 * SSE Transport — Wrap a streamable source into an HTTP Server-Sent Events
 * response.
 *
 * Framework-agnostic: uses the WinterCG `Response` constructor (Node 18+,
 * Deno, Bun, Cloudflare Workers, Next.js).
 *
 * @example
 * ```typescript
 * import {
 *   createSSETransport,
 *   createAgentOrchestrator,
 *   createStreamingRunner,
 * } from '@directive-run/ai';
 *
 * const transport = createSSETransport({
 *   maxResponseChars: 10_000,
 *   errorMessages: {
 *     INPUT_GUARDRAIL_FAILED: 'Your message was flagged by our safety filter.',
 *   },
 * });
 *
 * // Next.js route handler
 * export async function POST(req: Request) {
 *   const { message } = await req.json();
 *   return transport.toResponse(streamable, 'docs-qa', message);
 * }
 * ```
 */

// ============================================================================
// Structural types — describe only what SSE transport actually needs
// ============================================================================

/** Async iterable of string tokens with result promise and abort */
interface SSETokenStream extends AsyncIterable<string> {
  result: Promise<unknown>;
  abort(): void;
}

/** Any object with a .stream() method compatible with SSE transport */
interface SSEStreamable {
  stream(
    agentId: string,
    input: string,
    opts?: { signal?: AbortSignal },
  ): SSETokenStream;
}

// ============================================================================
// Types
// ============================================================================

export type SSEEvent =
  | { type: "text"; text: string }
  | { type: "truncated"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "heartbeat"; timestamp: number };

export interface SSETransportConfig {
  /** Truncate response after this many characters (default: Infinity) */
  maxResponseChars?: number;
  /** Message shown when response is truncated */
  truncationMessage?: string;
  /** Heartbeat interval in ms (default: 0 = disabled) */
  heartbeatIntervalMs?: number;
  /** Map error codes/types to user-facing messages */
  errorMessages?: Record<string, string> | ((error: unknown) => string);
  /** Extra headers merged into the SSE response */
  headers?: Record<string, string>;
}

export interface SSETransport {
  /** Create a full HTTP Response with SSE headers */
  toResponse(
    source: SSEStreamable,
    agentId: string,
    input: string,
    opts?: { signal?: AbortSignal },
  ): Response;
  /** Return just the ReadableStream (for Express/Koa `res.write()`) */
  toStream(
    source: SSEStreamable,
    agentId: string,
    input: string,
    opts?: { signal?: AbortSignal },
  ): ReadableStream<Uint8Array>;
}

// ============================================================================
// Factory
// ============================================================================

const DEFAULT_ERROR_MESSAGE =
  "AI service temporarily unavailable. Please try again.";

/**
 * Create an SSE transport that converts a token stream into Server-Sent Events.
 */
export function createSSETransport(
  config: SSETransportConfig = {},
): SSETransport {
  const {
    maxResponseChars = Number.POSITIVE_INFINITY,
    truncationMessage = "\n\n*[Response truncated]*",
    heartbeatIntervalMs = 0,
    errorMessages,
    headers: extraHeaders,
  } = config;

  if (maxResponseChars < 0) {
    throw new RangeError("maxResponseChars must be non-negative");
  }
  if (heartbeatIntervalMs < 0) {
    throw new RangeError("heartbeatIntervalMs must be non-negative");
  }

  function resolveErrorMessage(error: unknown): string {
    if (typeof errorMessages === "function") {
      try {
        return errorMessages(error);
      } catch {
        return DEFAULT_ERROR_MESSAGE;
      }
    }
    if (errorMessages && typeof errorMessages === "object") {
      const code =
        error != null &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : undefined;
      if (code && code in errorMessages) {
        return errorMessages[code]!;
      }
    }
    return DEFAULT_ERROR_MESSAGE;
  }

  function buildStream(
    source: SSEStreamable,
    agentId: string,
    input: string,
    opts?: { signal?: AbortSignal },
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    function frame(event: SSEEvent): Uint8Array {
      return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    }

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let tokenStream: SSETokenStream | null = null;

        try {
          // Heartbeat
          if (heartbeatIntervalMs > 0) {
            heartbeatTimer = setInterval(() => {
              try {
                controller.enqueue(frame({ type: "heartbeat", timestamp: Date.now() }));
              } catch {
                // Controller may be closed
              }
            }, heartbeatIntervalMs);
          }

          tokenStream = source.stream(agentId, input, {
            signal: opts?.signal,
          });

          let totalChars = 0;
          let sentDone = false;

          for await (const token of tokenStream) {
            totalChars += token.length;

            if (totalChars > maxResponseChars) {
              controller.enqueue(
                frame({ type: "truncated", text: truncationMessage }),
              );
              controller.enqueue(frame({ type: "done" }));
              sentDone = true;
              tokenStream.abort();
              break;
            }

            controller.enqueue(frame({ type: "text", text: token }));
          }

          // Wait for final result (tracks tokens, metrics, etc.)
          try {
            await tokenStream.result;
          } catch {
            // May have been aborted due to truncation
          }

          if (!sentDone) {
            controller.enqueue(frame({ type: "done" }));
          }
        } catch (err: unknown) {
          const message = resolveErrorMessage(err);
          controller.enqueue(frame({ type: "error", message }));
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          controller.close();
        }
      },
    });
  }

  const sseHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...extraHeaders,
  };

  return {
    toResponse(source, agentId, input, opts) {
      const stream = buildStream(source, agentId, input, opts);
      return new Response(stream, { headers: sseHeaders });
    },
    toStream(source, agentId, input, opts) {
      return buildStream(source, agentId, input, opts);
    },
  };
}
