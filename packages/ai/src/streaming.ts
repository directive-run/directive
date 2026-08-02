/**
 * Agent Streaming - Token-by-token streaming with backpressure support
 *
 * Provides async iterators for streaming agent responses with guardrail evaluation
 * on partial output and configurable backpressure handling.
 *
 * @example
 * ```typescript
 * import { createAgentOrchestrator } from '@directive-run/ai';
 * import { createStreamingRunner } from '@directive-run/ai';
 *
 * const { stream, result } = orchestrator.runStream(agent, input);
 *
 * for await (const chunk of stream) {
 *   if (chunk.type === 'token') process.stdout.write(chunk.data);
 *   if (chunk.type === 'guardrail_triggered') handleGuardrail(chunk);
 * }
 *
 * const finalResult = await result;
 * ```
 */

import type { OrchestratorStreamChunk } from "./agent-orchestrator.js";
import type {
  AgentLike,
  GuardrailFn,
  Message,
  OutputGuardrailData,
  RunResult,
  StreamRestartReason,
  StreamingCallbackRunner,
} from "./types.js";

export type { StreamRestartReason } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

/** Default buffer size for streaming backpressure */
export const DEFAULT_BUFFER_SIZE = 1000;

/**
 * Brand identifying a {@link StreamConsumerError} across module realms.
 *
 * Read from the global symbol registry so an ESM copy and a CJS copy of this
 * package agree on it, which `instanceof` cannot.
 */
const STREAM_CONSUMER_ERROR = Symbol.for("directive.streamConsumerError");

/** Default interval (in tokens) between guardrail checks during streaming */
export const DEFAULT_GUARDRAIL_CHECK_INTERVAL = 50;

/** Default toxicity threshold for toxicity streaming guardrail */
export const DEFAULT_TOXICITY_THRESHOLD = 0.8;

// ============================================================================
// Shared Streaming Helpers
// ============================================================================

/**
 * `RunOptions.onToken` is annotated `=> void` so that the shape most callers
 * write – `(token) => buffer.push(token)` – stays assignable, but the adapters
 * await whatever it returns. Code that wraps a caller's callback reads it back
 * through this alias so it can hand the caller's promise along rather than
 * dropping it, which is what makes backpressure real.
 *
 * @internal
 */
export type TokenSink = (token: string) => unknown;

/** First code unit of the low-surrogate range. */
const LOW_SURROGATE_START = 0xdc00;
/** Last code unit of the low-surrogate range. */
const LOW_SURROGATE_END = 0xdfff;

/**
 * Keep the last `maxLength` code units of `text`, moving the cut forward by one
 * when it would land between the halves of a surrogate pair.
 *
 * `String.prototype.slice` counts UTF-16 code units, so a naive tail slice of
 * accumulated model output can begin on a low surrogate whose high half was
 * just discarded. The lone surrogate survives in the string and then breaks
 * everything downstream that re-encodes it – `JSON.stringify` to a plugin or to
 * devtools, and any regex guardrail run over the partial output.
 *
 * @internal
 */
export function sliceTailByCodePoint(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  let start = text.length - maxLength;
  const code = text.charCodeAt(start);
  if (code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END) {
    start++;
  }

  return text.slice(start);
}

/**
 * Chunk types an overflowing orchestrator stream may discard: content and
 * notifications, whose loss costs the consumer detail but never correctness.
 * `context_updated` is among them because it only names the facts that
 * changed – the current values are still readable from the system, so a
 * dropped notification loses nothing a consumer cannot recover.
 *
 * Everything else – `done`, `error`, `guardrail_triggered`,
 * `approval_required`, `approval_resolved`, `interrupted`, `stream_restart` –
 * carries control flow or ends the stream, and is never refused. Dropping
 * `done` would take the drop report down with it, dropping `approval_required`
 * would leave a tool call waiting out the full approval timeout for a question
 * the consumer was never asked, and dropping `stream_restart` would let two
 * generations of the same response concatenate on screen – which is the exact
 * defect the restart chunk exists to prevent.
 *
 * @internal
 */
export function isDroppableChunk(chunk: { type: string }): boolean {
  return (
    chunk.type === "token" ||
    chunk.type === "message" ||
    chunk.type === "progress" ||
    chunk.type === "tool_start" ||
    chunk.type === "tool_end" ||
    chunk.type === "context_updated"
  );
}

/**
 * A bounded chunk buffer that never refuses a control chunk and never scans.
 *
 * The cap applies to every chunk type; preference, not exemption, is what
 * separates them. At the cap a droppable chunk is refused. A control chunk is
 * always admitted, making room by evicting the newest droppable chunk still
 * buffered – so the beginning of a response survives and its tail is what goes
 * – or, when the buffer holds nothing droppable, by evicting the oldest chunk
 * of any kind. Old control information is the least costly thing to lose:
 * an approval the run is currently blocked on matters more than one already
 * superseded.
 *
 * Refusing a control chunk was the previous behavior once the buffer filled
 * with non-droppable chunks, and it cost more than the cap saved.
 *
 * Every operation is O(1) amortized. Consumed slots are tombstoned rather than
 * spliced, droppable slots are tracked in an ascending index list that is only
 * ever pushed to or popped from either end, and the backing array is compacted
 * once its spent prefix outgrows its live tail. The scan-plus-splice this
 * replaces cost O(n) per admission, which at a 10,000-chunk cap is milliseconds
 * per chunk on a stalled stream.
 *
 * @internal
 */
export class ChunkBuffer<T extends { type: string }> {
  /** Backing store. A `undefined` slot is a chunk already taken or evicted. */
  private items: Array<T | undefined> = [];
  /** Lowest slot that may still hold a live chunk. */
  private head = 0;
  /** How many live chunks the buffer holds. */
  private count = 0;
  /** Ascending slot indices of live droppable chunks. */
  private droppable: number[] = [];
  /** Lowest live entry in {@link ChunkBuffer.droppable}. */
  private droppableHead = 0;

  constructor(private readonly maxSize: number) {}

  /** How many chunks are waiting to be read. */
  get size(): number {
    return this.count;
  }

  /**
   * Append `chunk`, and report how many chunks the buffer lost doing it
   * (0 or 1).
   */
  admit(chunk: T): number {
    if (this.count < this.maxSize) {
      this.append(chunk);

      return 0;
    }

    if (isDroppableChunk(chunk)) {
      return 1;
    }

    if (!this.evictNewestDroppable()) {
      this.shift();
    }
    this.append(chunk);

    return 1;
  }

  /** Take the oldest chunk, or `undefined` when the buffer is empty. */
  shift(): T | undefined {
    while (
      this.head < this.items.length &&
      this.items[this.head] === undefined
    ) {
      this.head++;
    }
    if (this.head >= this.items.length) {
      return undefined;
    }

    const chunk = this.items[this.head]!;
    this.items[this.head] = undefined;
    this.count--;
    if (this.droppable[this.droppableHead] === this.head) {
      this.droppableHead++;
    }
    this.head++;
    this.compact();

    return chunk;
  }

  /** Forget everything buffered. */
  clear(): void {
    this.items = [];
    this.head = 0;
    this.count = 0;
    this.droppable = [];
    this.droppableHead = 0;
  }

  private append(chunk: T): void {
    if (isDroppableChunk(chunk)) {
      this.droppable.push(this.items.length);
    }
    this.items.push(chunk);
    this.count++;
  }

  /** Evict the newest droppable chunk, reporting whether there was one. */
  private evictNewestDroppable(): boolean {
    if (this.droppable.length <= this.droppableHead) {
      return false;
    }
    const index = this.droppable.pop()!;
    this.items[index] = undefined;
    this.count--;

    return true;
  }

  /**
   * Drop the spent prefix once it is at least as long as the live tail, so a
   * long-running stream does not grow its backing array without bound. Copying
   * happens once per element across the buffer's life.
   */
  private compact(): void {
    if (this.head < 64 || this.head * 2 < this.items.length) {
      return;
    }
    const offset = this.head;
    this.items = this.items.slice(offset);
    this.head = 0;
    if (this.droppableHead > 0) {
      this.droppable = this.droppable.slice(this.droppableHead);
      this.droppableHead = 0;
    }
    for (let i = 0; i < this.droppable.length; i++) {
      this.droppable[i]! -= offset;
    }
  }
}

/**
 * A consumer-supplied callback threw while consuming a stream.
 *
 * Wrapping it names where the failure came from: a render crash in an
 * `onToken` callback is not a provider failure, so retry and fallback wrappers
 * stop rather than paying for the same response two more times to feed the
 * same broken consumer.
 */
export class StreamConsumerError extends Error {
  /**
   * The marker {@link isStreamConsumerError} actually reads.
   *
   * `instanceof` compares against one realm's class object, and this package
   * publishes both ESM and CJS builds: an application that loads the ESM entry
   * and a dependency that loads the CJS one hold two distinct
   * `StreamConsumerError` classes, so an error raised through one is invisible
   * to an `instanceof` check compiled against the other. The classification
   * silently inverts – a consumer's own crash is retried as a provider failure,
   * at full price, three more times. A registry symbol is the same value in
   * every realm, so the marker survives the boundary.
   */
  readonly [STREAM_CONSUMER_ERROR] = true;

  constructor(cause: unknown) {
    super(
      `[Directive] A stream consumer callback threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "StreamConsumerError";
    this.cause = cause;
  }
}

/**
 * Is this error – or anything it was thrown through – a consumer-side throw?
 *
 * Checked through `cause` because the runner wrappers see the error after the
 * adapter, the orchestrator and any user wrapper have had a chance to rethrow
 * it with context.
 */
export function isStreamConsumerError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (
      (current as Record<symbol, unknown>)[STREAM_CONSUMER_ERROR] === true &&
      current instanceof Error
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

let runnerIgnoredOnTokenWarned = false;

/** Did the run actually produce something the caller would have wanted deltas for? */
function hasNonEmptyOutput(output: unknown): boolean {
  if (output === undefined || output === null) {
    return false;
  }
  if (typeof output === "string") {
    return output.length > 0;
  }

  return true;
}

/**
 * Warn when a run asked for per-delta streaming, produced output, and delivered
 * no deltas at all. Silence in every other case: no request means nothing was
 * promised, deltas arriving means the runner streamed, and empty output means
 * there was nothing to stream.
 *
 * `requested` is a boolean rather than the callback itself because a caller can
 * ask for deltas without supplying one – `runStream(agent, input, { deltas:
 * true })` wants the chunks and nothing else.
 *
 * @internal
 */
export function reportIfRunnerIgnoredOnToken(
  agentName: string,
  requested: boolean,
  deltaCount: number,
  output: unknown,
): void {
  if (!requested || deltaCount > 0) {
    return;
  }
  if (!hasNonEmptyOutput(output)) {
    return;
  }
  warnRunnerIgnoredOnToken(agentName);
}

const RUNNER_IGNORED_ONTOKEN_HINT =
  "The runner does not support streaming: a runner built with createRunner needs a `streaming` config, and a hand-written runner has to call `options.onToken` itself. Wrappers (withRetry, withBudget, withFallback, withModelSelection, withStructuredOutput) forward `onToken` untouched, so the base runner is where to look. This warning is emitted once per process.";

/**
 * Warn once per process that a run asked for per-delta streaming and received
 * none. Asking for deltas – with `onToken` or `deltas: true` – is a request
 * rather than a guarantee, so a runner that cannot stream returns its ordinary
 * buffered result with no error, which is silent unless someone counts the
 * deltas that arrived.
 */
function warnRunnerIgnoredOnToken(agentName: string): void {
  if (runnerIgnoredOnTokenWarned) {
    return;
  }
  runnerIgnoredOnTokenWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[Directive] per-delta streaming was requested for "${agentName}" but the runner emitted no deltas – the response arrived as one buffered message. ${RUNNER_IGNORED_ONTOKEN_HINT}`,
  );
}

// ============================================================================
// Stream Event Types
// ============================================================================

/** Token chunk from streaming response */
export interface TokenChunk {
  type: "token";
  data: string;
  /**
   * Ordinal of this chunk within the current generation – how many `token`
   * chunks have been emitted since the stream started or since the last
   * {@link StreamRestartChunk}.
   *
   * This is **not** a token count. On the per-delta path it counts provider
   * deltas, and a delta is not a token: Anthropic emits multi-token deltas and
   * Gemini emits sentence-sized ones. On the whole-message path it counts
   * messages. For an authoritative count, read `result.tokenUsage` off the
   * awaited {@link RunResult}.
   */
  deltaCount: number;
  /**
   * Which generation of the response this chunk belongs to: 1 until the first
   * {@link StreamRestartChunk}, 2 after it, and so on.
   *
   * The same marker {@link StreamRestartChunk.generation} carries, repeated on
   * every token so a boundary the consumer never received is still detectable.
   * A `stream_restart` chunk is admitted ahead of any content chunk, but a
   * buffer saturated with control chunks can still cost one; a consumer that
   * keys rendered output by this field replaces the previous generation on the
   * next token either way, rather than concatenating two answers.
   */
  generation: number;
  /**
   * @deprecated Use {@link TokenChunk.deltaCount}, or `result.tokenUsage` for a
   * real token count. Kept because it is public API.
   *
   * On the per-delta path this equals `deltaCount`. On the whole-message path
   * it retains its historical value – a running `ceil(content.length / 4)`
   * estimate – so existing consumers see exactly what they saw before. Neither
   * form is a token count.
   */
  tokenCount: number;
}

/**
 * A new generation started, and everything emitted for the previous one is
 * void. The runner was re-invoked – an agent-level retry, a structured-output
 * schema retry, a fallback to another provider, or a self-healing reroute – so
 * the consumer is about to receive the whole response again from the
 * beginning.
 *
 * Discard everything rendered since the stream started or since the previous
 * `stream_restart`, whichever is later. The next `token` chunk restarts
 * `deltaCount` at 1.
 *
 * Emitted only when the caller requested per-delta streaming – `deltas: true`
 * or an `onToken` callback. Without that a generation is delivered as a single
 * whole-message chunk and there is nothing part-rendered to discard.
 */
export interface StreamRestartChunk {
  type: "stream_restart";
  /** What re-invoked the runner. */
  reason: StreamRestartReason;
  /**
   * Which generation is now starting: 2 for the first restart, 3 for the
   * second, and so on. An opaque marker for keying rendered output, not a
   * count of anything – chunks can be dropped under backpressure, so no count
   * of emitted chunks could be relied on to say how much to discard.
   */
  generation: number;
}

/** Tool execution started */
export interface ToolStartChunk {
  type: "tool_start";
  tool: string;
  toolCallId: string;
  arguments: string;
}

/** Tool execution completed */
export interface ToolEndChunk {
  type: "tool_end";
  tool: string;
  toolCallId: string;
  result: string;
}

/** Message added to conversation */
export interface MessageChunk {
  type: "message";
  message: Message;
}

/** Guardrail was triggered during streaming */
export interface GuardrailTriggeredChunk {
  type: "guardrail_triggered";
  guardrailName: string;
  reason: string;
  /** Partial output at the time of trigger */
  partialOutput: string;
  /** Whether the stream was stopped */
  stopped: boolean;
}

/** Progress update for UI feedback */
export interface ProgressChunk {
  type: "progress";
  phase: "starting" | "generating" | "tool_calling" | "finishing";
  /** Percentage complete (0-100), if known */
  percent?: number;
  /** Human-readable status message */
  message?: string;
}

/** Stream completed */
export interface DoneChunk {
  type: "done";
  totalTokens: number;
  duration: number;
  /**
   * Number of chunks dropped because the consumer fell behind and the buffer
   * filled. Zero means nothing was lost.
   */
  droppedTokens: number;
}

/** Error during streaming */
export interface ErrorChunk {
  type: "error";
  error: Error;
  /** Partial output before error */
  partialOutput?: string;
  /**
   * Number of chunks dropped because the consumer fell behind and the buffer
   * filled, for a run that ended in an error rather than reaching `done`.
   * Omitted by producers that do not buffer.
   */
  droppedTokens?: number;
}

/** Union of all stream chunk types */
export type StreamChunk =
  | TokenChunk
  | ToolStartChunk
  | ToolEndChunk
  | MessageChunk
  | GuardrailTriggeredChunk
  | ProgressChunk
  | DoneChunk
  | ErrorChunk
  | StreamRestartChunk;

// ============================================================================
// Streaming Run Types
// ============================================================================

/** Backpressure strategy when consumer is slow */
export type BackpressureStrategy =
  /** Drop tokens when buffer is full (lossy, fast) */
  | "drop"
  /** Block producer when buffer is full (lossless, may slow response) */
  | "block"
  /** Buffer all tokens (lossless, uses memory) */
  | "buffer";

/**
 * Options for a {@link StreamRunner} – the function {@link createStreamingRunner}
 * returns. These are **not** the options `orchestrator.runStream` accepts:
 * `backpressure` and `bufferSize` configure this wrapper's own buffer and have
 * no effect if passed to the orchestrator.
 */
export interface StreamRunOptions {
  /** Maximum turns before stopping */
  maxTurns?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Backpressure strategy. @default "buffer" */
  backpressure?: BackpressureStrategy;
  /** Buffer size for 'drop' and 'block' strategies. @default 1000 */
  bufferSize?: number;
  /** Evaluate guardrails every N tokens. @default 50 */
  guardrailCheckInterval?: number;
  /** Stop stream on guardrail trigger. @default true */
  stopOnGuardrail?: boolean | ((chunk: GuardrailTriggeredChunk) => boolean);
}

/** Stream run function type (mirrors OpenAI Agents streaming API) */
export type StreamRunner = <T = unknown>(
  agent: AgentLike,
  input: string,
  options?: StreamRunOptions,
) => StreamingRunResult<T>;

/** Result from a streaming run */
export interface StreamingRunResult<T = unknown> {
  /** Async iterator for streaming chunks */
  stream: AsyncIterable<StreamChunk>;
  /** Promise that resolves to the final result */
  result: Promise<RunResult<T>>;
  /** Abort the stream */
  abort: () => void;
}

// ============================================================================
// Streaming Guardrail Types
// ============================================================================

/** Streaming guardrail that evaluates partial output */
export interface StreamingGuardrail {
  /** Unique name for this guardrail */
  name: string;
  /** Check partial output (called every guardrailCheckInterval tokens) */
  check: (
    partialOutput: string,
    tokenCount: number,
  ) => StreamingGuardrailResult | Promise<StreamingGuardrailResult>;
  /** Whether to stop the stream on failure. @default true */
  stopOnFail?: boolean;
}

/** Result from a streaming guardrail check */
export interface StreamingGuardrailResult {
  passed: boolean;
  reason?: string;
  /** Severity level for UI display */
  severity?: "warning" | "error" | "critical";
  /** Warning message (guardrail passed but wants to emit a warning) */
  warning?: string;
}

// ============================================================================
// Stream Buffer Implementation
// ============================================================================

/** Internal buffer for managing backpressure */
class StreamBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  private strategy: BackpressureStrategy;
  private pullWaiters: Array<(value: T | null) => void> = [];
  private pushWaiters: Array<() => void> = []; // For block strategy - queue-based, not polling
  private closed = false;
  private droppedCount = 0;

  constructor(
    strategy: BackpressureStrategy = "buffer",
    maxSize = DEFAULT_BUFFER_SIZE,
  ) {
    this.strategy = strategy;
    this.maxSize = maxSize;
  }

  async push(item: T): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    // If there's a pull waiter, send directly
    const pullWaiter = this.pullWaiters.shift();
    if (pullWaiter) {
      pullWaiter(item);
      return true;
    }

    // Handle based on strategy
    if (this.buffer.length >= this.maxSize) {
      switch (this.strategy) {
        case "drop":
          this.droppedCount++;
          return false;
        case "block":
          // Queue-based blocking (no polling) - wait for consumer to pull
          await new Promise<void>((resolve) => {
            this.pushWaiters.push(resolve);
          });
          if (this.closed) {
            return false;
          }
          break;
        case "buffer":
          // Just push anyway (may use lots of memory)
          break;
      }
    }

    this.buffer.push(item);
    return true;
  }

  async pull(): Promise<T | null> {
    // Notify a blocked producer that space is available
    const pushWaiter = this.pushWaiters.shift();
    if (pushWaiter) {
      pushWaiter();
    }

    if (this.buffer.length > 0) {
      return this.buffer.shift()!;
    }

    if (this.closed) {
      return null;
    }

    // Wait for next item
    return new Promise<T | null>((resolve) => {
      this.pullWaiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    // Resolve all waiting consumers with null
    for (const waiter of this.pullWaiters) {
      waiter(null);
    }
    this.pullWaiters = [];
    // Unblock all waiting producers
    for (const waiter of this.pushWaiters) {
      waiter();
    }
    this.pushWaiters = [];
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }
}

// ============================================================================
// Streaming Runner Implementation
// ============================================================================

/**
 * Create a streaming runner that wraps a base run function.
 * This is used internally by the orchestrator but can be used standalone.
 *
 * @param baseRunner - The underlying non-streaming runner
 * @param options - Configuration options
 */
export function createStreamingRunner(
  baseRunner: StreamingCallbackRunner,
  options: {
    streamingGuardrails?: StreamingGuardrail[];
  } = {},
): StreamRunner {
  const { streamingGuardrails = [] } = options;

  return <T>(
    agent: AgentLike,
    input: string,
    runOptions: StreamRunOptions = {},
  ): StreamingRunResult<T> => {
    const {
      signal,
      backpressure = "buffer",
      bufferSize = DEFAULT_BUFFER_SIZE,
      guardrailCheckInterval = DEFAULT_GUARDRAIL_CHECK_INTERVAL,
      stopOnGuardrail = true,
    } = runOptions;

    // Validate configuration
    if (
      guardrailCheckInterval <= 0 ||
      !Number.isFinite(guardrailCheckInterval)
    ) {
      throw new Error(
        `[Directive Streaming] guardrailCheckInterval must be a positive number, got ${guardrailCheckInterval}`,
      );
    }

    const buffer = new StreamBuffer<StreamChunk>(backpressure, bufferSize);
    const abortController = new AbortController();
    let partialOutput = "";
    let tokenCount = 0;
    let stopped = false;
    const startTime = Date.now();

    // Combine external abort signal with internal one (with proper cleanup)
    let abortHandler: (() => void) | undefined;
    if (signal) {
      abortHandler = () => abortController.abort();
      signal.addEventListener("abort", abortHandler);
    }

    // Cleanup function to prevent memory leaks
    const cleanup = () => {
      if (abortHandler && signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    // Check streaming guardrails
    async function checkGuardrails(): Promise<GuardrailTriggeredChunk | null> {
      for (const guardrail of streamingGuardrails) {
        try {
          const result = await guardrail.check(partialOutput, tokenCount);
          if (!result.passed) {
            const shouldStop = guardrail.stopOnFail !== false;
            const chunk: GuardrailTriggeredChunk = {
              type: "guardrail_triggered",
              guardrailName: guardrail.name,
              reason: result.reason ?? "Guardrail check failed",
              partialOutput,
              stopped: shouldStop,
            };

            await buffer.push(chunk);

            if (shouldStop) {
              const stopFn =
                typeof stopOnGuardrail === "function"
                  ? stopOnGuardrail
                  : () => stopOnGuardrail;
              if (stopFn(chunk)) {
                stopped = true;
                abortController.abort();
              }
            }

            return chunk;
          }
        } catch {
          // Guardrail errors during streaming are silently swallowed —
          // the guardrail result itself carries error info when applicable.
        }
      }
      return null;
    }

    // Run the agent and pipe to buffer
    const resultPromise = (async (): Promise<RunResult<T>> => {
      await buffer.push({
        type: "progress",
        phase: "starting",
        message: "Starting agent",
      });

      try {
        const result = await baseRunner(agent, input, {
          signal: abortController.signal,
          onToken: async (token) => {
            if (stopped) return;

            tokenCount++;
            partialOutput += token;

            await buffer.push({
              type: "token",
              data: token,
              deltaCount: tokenCount,
              // This wrapper invokes its base runner once and has no
              // re-invocation of its own to report, so every delta it emits
              // belongs to the first generation.
              generation: 1,
              tokenCount,
            });

            // Check guardrails periodically
            if (tokenCount % guardrailCheckInterval === 0) {
              await checkGuardrails();
            }
          },
          onToolStart: async (tool, id, args) => {
            await buffer.push({
              type: "progress",
              phase: "tool_calling",
              message: `Calling ${tool}`,
            });
            await buffer.push({
              type: "tool_start",
              tool,
              toolCallId: id,
              arguments: args,
            });
          },
          onToolEnd: async (tool, id, result) => {
            await buffer.push({
              type: "tool_end",
              tool,
              toolCallId: id,
              result,
            });
            await buffer.push({
              type: "progress",
              phase: "generating",
              message: "Continuing generation",
            });
          },
          onMessage: async (message) => {
            await buffer.push({ type: "message", message });
          },
        });

        // Final guardrail check
        await checkGuardrails();

        const duration = Date.now() - startTime;
        const droppedTokens = buffer.getDroppedCount();
        await buffer.push({
          type: "done",
          totalTokens: result.totalTokens,
          duration,
          droppedTokens,
        });

        buffer.close();
        return result as RunResult<T>;
      } catch (error) {
        const errorChunk: ErrorChunk = {
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          partialOutput: partialOutput || undefined,
          // A run that dropped chunks and then failed reported nothing about
          // the loss, because only `done` carried the figure.
          droppedTokens: buffer.getDroppedCount(),
        };
        await buffer.push(errorChunk);
        buffer.close();
        throw error;
      } finally {
        // Always cleanup abort signal listener to prevent memory leaks
        cleanup();
      }
    })();

    // Create async iterator
    const stream: AsyncIterable<StreamChunk> = {
      [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
        return {
          async next(): Promise<IteratorResult<StreamChunk>> {
            const chunk = await buffer.pull();
            if (chunk === null) {
              return { done: true, value: undefined };
            }
            return { done: false, value: chunk };
          },
        };
      },
    };

    return {
      stream,
      result: resultPromise,
      abort: () => abortController.abort(),
    };
  };
}

// ============================================================================
// Built-in Streaming Guardrails
// ============================================================================

/**
 * Create a streaming guardrail that detects toxic content.
 *
 * @example
 * ```typescript
 * const toxicityGuardrail = createToxicityStreamingGuardrail({
 *   threshold: 0.9,
 *   checkFn: async (text) => myToxicityModel.score(text),
 * });
 * ```
 */
export function createToxicityStreamingGuardrail(options: {
  /** Toxicity scoring function (returns 0-1) */
  checkFn: (text: string) => number | Promise<number>;
  /** Threshold above which content is flagged. @default 0.8 */
  threshold?: number;
  /** Stop the stream on detection. @default true */
  stopOnFail?: boolean;
}): StreamingGuardrail {
  const {
    checkFn,
    threshold = DEFAULT_TOXICITY_THRESHOLD,
    stopOnFail = true,
  } = options;

  return {
    name: "toxicity-streaming",
    stopOnFail,
    async check(partialOutput) {
      const score = await checkFn(partialOutput);
      if (score > threshold) {
        return {
          passed: false,
          reason: `Toxicity score ${score.toFixed(2)} exceeds threshold ${threshold}`,
          severity: "critical",
        };
      }
      return { passed: true };
    },
  };
}

/**
 * Create a streaming guardrail that limits output length.
 *
 * @example
 * ```typescript
 * const lengthGuardrail = createLengthStreamingGuardrail({
 *   maxTokens: 4000,
 *   warnAt: 3500,
 * });
 * ```
 */
export function createLengthStreamingGuardrail(options: {
  /** Maximum tokens before stopping */
  maxTokens: number;
  /** Warn at this token count (optional) */
  warnAt?: number;
  /** Stop the stream on max. @default true */
  stopOnFail?: boolean;
}): StreamingGuardrail {
  const { maxTokens, warnAt, stopOnFail = true } = options;

  // Per-instance flag: if this guardrail is shared across concurrent streams,
  // the warning fires only once globally. Create separate instances for independent warning per stream.
  let warned = false;

  return {
    name: "length-streaming",
    stopOnFail,
    check(_partialOutput, tokenCount) {
      if (tokenCount >= maxTokens) {
        return {
          passed: false,
          reason: `Output exceeded maximum length of ${maxTokens} tokens`,
          severity: "error",
        };
      }

      if (warnAt && tokenCount >= warnAt && !warned) {
        warned = true;

        return {
          passed: true,
          warning: `Approaching maximum length: ${tokenCount}/${maxTokens} tokens`,
          severity: "warning",
        };
      }

      return { passed: true };
    },
  };
}

/**
 * Create a streaming guardrail that detects patterns (regex-based).
 *
 * @example
 * ```typescript
 * const piiGuardrail = createPatternStreamingGuardrail({
 *   patterns: [
 *     { regex: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
 *     { regex: /\b\d{16}\b/, name: 'Credit Card' },
 *   ],
 *   stopOnFail: true,
 * });
 * ```
 */
export function createPatternStreamingGuardrail(options: {
  patterns: Array<{ regex: RegExp; name: string }>;
  stopOnFail?: boolean;
}): StreamingGuardrail {
  const { patterns, stopOnFail = true } = options;

  return {
    name: "pattern-streaming",
    stopOnFail,
    check(partialOutput) {
      for (const { regex, name } of patterns) {
        regex.lastIndex = 0;
        if (regex.test(partialOutput)) {
          return {
            passed: false,
            reason: `Detected ${name} pattern in output`,
            severity: "error",
          };
        }
      }
      return { passed: true };
    },
  };
}

/**
 * Combine multiple streaming guardrails into one.
 *
 * @example
 * ```typescript
 * const combined = combineStreamingGuardrails([
 *   createToxicityStreamingGuardrail({ ... }),
 *   createLengthStreamingGuardrail({ ... }),
 * ]);
 * ```
 */
export function combineStreamingGuardrails(
  guardrails: StreamingGuardrail[],
  options: { name?: string; stopOnFirstFail?: boolean } = {},
): StreamingGuardrail {
  const { name = "combined-streaming", stopOnFirstFail = true } = options;

  return {
    name,
    stopOnFail: stopOnFirstFail,
    async check(partialOutput, tokenCount) {
      const failures: string[] = [];
      for (const guardrail of guardrails) {
        const result = await guardrail.check(partialOutput, tokenCount);
        if (!result.passed) {
          if (stopOnFirstFail) {
            return {
              ...result,
              reason: `[${guardrail.name}] ${result.reason}`,
            };
          }
          failures.push(`[${guardrail.name}] ${result.reason ?? "failed"}`);
        }
      }
      if (failures.length > 0) {
        return { passed: false, reason: failures.join("; ") };
      }
      return { passed: true };
    },
  };
}

// ============================================================================
// Output Guardrail Adapter
// ============================================================================

/**
 * Convert a regular output guardrail to a streaming guardrail.
 * Useful for reusing existing guardrails in streaming context.
 *
 * @example
 * ```typescript
 * const streamingPII = adaptOutputGuardrail(
 *   "pii-streaming",
 *   createPIIGuardrail({ redact: false }),
 *   { checkInterval: 100 }
 * );
 * ```
 */
export function adaptOutputGuardrail(
  name: string,
  guardrail: GuardrailFn<OutputGuardrailData>,
  options: {
    /** Only run after this many tokens (optimization) */
    minTokens?: number;
    stopOnFail?: boolean;
  } = {},
): StreamingGuardrail {
  const { minTokens = 0, stopOnFail = true } = options;

  return {
    name,
    stopOnFail,
    async check(partialOutput, tokenCount) {
      if (tokenCount < minTokens) {
        return { passed: true };
      }

      const result = await guardrail(
        {
          output: partialOutput,
          agentName: "streaming",
          input: "",
          messages: [],
        },
        {
          agentName: "streaming",
          input: "",
          facts: {},
        },
      );

      return {
        passed: result.passed,
        reason: result.reason,
        severity: result.passed ? undefined : "error",
      };
    },
  };
}

// ============================================================================
// Stream Utilities
// ============================================================================

/**
 * Collect all tokens from a stream into a string.
 *
 * @example
 * ```typescript
 * const { stream, result } = orchestrator.runStream(agent, input);
 * const fullOutput = await collectTokens(stream);
 * ```
 */
export async function collectTokens(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    if (chunk.type === "token") {
      output += chunk.data;
    }
  }
  return output;
}

/**
 * Tap into a stream without consuming it.
 * Useful for logging or side effects.
 *
 * @example
 * ```typescript
 * const { stream } = orchestrator.runStream(agent, input);
 * const tapped = tapStream(stream, (chunk) => console.log(chunk));
 * for await (const chunk of tapped) { ... }
 * ```
 */
export async function* tapStream(
  stream: AsyncIterable<StreamChunk>,
  fn: (chunk: StreamChunk) => void | Promise<void>,
): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    await fn(chunk);
    yield chunk;
  }
}

/**
 * Filter stream chunks by type.
 *
 * @example
 * ```typescript
 * const tokensOnly = filterStream(stream, ['token']);
 * ```
 */
export async function* filterStream<T extends StreamChunk["type"]>(
  stream: AsyncIterable<StreamChunk>,
  types: T[],
): AsyncIterable<Extract<StreamChunk, { type: T }>> {
  const typeSet = new Set(types);
  for await (const chunk of stream) {
    if (typeSet.has(chunk.type as T)) {
      yield chunk as Extract<StreamChunk, { type: T }>;
    }
  }
}

/**
 * Transform stream chunks.
 *
 * @example
 * ```typescript
 * const upperTokens = mapStream(stream, (chunk) => {
 *   if (chunk.type === 'token') return { ...chunk, data: chunk.data.toUpperCase() };
 *   return chunk;
 * });
 * ```
 */
export async function* mapStream<R>(
  stream: AsyncIterable<StreamChunk>,
  fn: (chunk: StreamChunk) => R | Promise<R>,
): AsyncIterable<R> {
  for await (const chunk of stream) {
    yield await fn(chunk);
  }
}

// ============================================================================
// Multiplexed Streaming (Parallel Agent Streams)
// ============================================================================

/** A multiplexed stream chunk tagged with the agent that produced it */
export interface MultiplexedStreamChunk {
  chunk: OrchestratorStreamChunk;
  agentId: string;
}

/** Result from a parallel streaming operation */
export interface MultiplexedStreamResult<T = unknown> {
  stream: AsyncIterable<MultiplexedStreamChunk>;
  results: Promise<RunResult<unknown>[]>;
  merge: Promise<T>;
  abort: () => void;
  /** Number of chunks dropped due to buffer overflow */
  getDroppedCount: () => number;
}

/** Maximum buffer size for multiplexed streams */
const MAX_MULTIPLEX_BUFFER = 10_000;

/** A source stream with its agent ID */
interface TaggedSource {
  agentId: string;
  stream: AsyncIterable<OrchestratorStreamChunk>;
}

/**
 * Merge multiple async iterables into a single multiplexed stream,
 * tagging each chunk with its source agent ID.
 *
 * Race-based merge: pulls from all sources concurrently, emitting
 * chunks in arrival order. Error chunks from individual agents are
 * tagged and emitted (other agents continue).
 *
 * @example
 * ```typescript
 * const merged = mergeTaggedStreams([
 *   { agentId: "researcher", stream: researchStream },
 *   { agentId: "writer", stream: writerStream },
 * ]);
 *
 * for await (const { chunk, agentId } of merged) {
 *   console.log(`[${agentId}]`, chunk);
 * }
 * ```
 */
/** Result from mergeTaggedStreams */
export interface MergedTaggedStreamResult {
  stream: AsyncIterable<MultiplexedStreamChunk>;
  /** Number of chunks dropped due to buffer overflow */
  getDroppedCount: () => number;
}

/**
 * Merge multiple tagged async iterables into a single multiplexed stream.
 *
 * @param sources - Array of tagged source streams to merge.
 * @returns A merged stream result with a `getDroppedCount` accessor.
 */
export function mergeTaggedStreams(
  sources: TaggedSource[],
): MergedTaggedStreamResult {
  // Guard: empty sources would hang forever since no consumer calls finish()
  if (sources.length === 0) {
    const emptyStream: AsyncIterable<MultiplexedStreamChunk> = {
      [Symbol.asyncIterator]() {
        const done = {
          done: true as const,
          value: undefined as unknown as MultiplexedStreamChunk,
        };

        return {
          async next() {
            return done;
          },
          async return() {
            return done;
          },
        };
      },
    };

    return { stream: emptyStream, getDroppedCount: () => 0 };
  }

  const buffer: MultiplexedStreamChunk[] = [];
  const waiters: Array<(item: MultiplexedStreamChunk | null) => void> = [];
  let activeSources = sources.length;
  let closed = false;
  let droppedCount = 0;

  function push(item: MultiplexedStreamChunk): void {
    if (closed) {
      return;
    }

    const waiter = waiters.shift();
    if (waiter) {
      waiter(item);

      return;
    }

    if (buffer.length < MAX_MULTIPLEX_BUFFER) {
      buffer.push(item);
    } else {
      droppedCount++;
    }
  }

  function finish(): void {
    activeSources--;
    if (activeSources <= 0) {
      closed = true;
      for (const waiter of waiters) {
        waiter(null);
      }
      waiters.length = 0;
    }
  }

  // Start consumers for each source
  for (const source of sources) {
    (async () => {
      try {
        for await (const chunk of source.stream) {
          push({ chunk, agentId: source.agentId });
        }
      } catch (error) {
        // Emit error as a tagged chunk
        push({
          chunk: {
            type: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          },
          agentId: source.agentId,
        });
      } finally {
        finish();
      }
    })();
  }

  const stream: AsyncIterable<MultiplexedStreamChunk> = {
    [Symbol.asyncIterator](): AsyncIterator<MultiplexedStreamChunk> {
      return {
        async next(): Promise<IteratorResult<MultiplexedStreamChunk>> {
          if (buffer.length > 0) {
            return { done: false, value: buffer.shift()! };
          }

          if (closed) {
            return { done: true, value: undefined };
          }

          return new Promise<IteratorResult<MultiplexedStreamChunk>>(
            (resolve) => {
              waiters.push((item) => {
                if (item === null) {
                  resolve({ done: true, value: undefined });
                } else {
                  resolve({ done: false, value: item });
                }
              });
            },
          );
        },

        return(): Promise<IteratorResult<MultiplexedStreamChunk>> {
          // Stop accepting new chunks
          closed = true;
          buffer.length = 0;
          for (const waiter of waiters) {
            waiter(null);
          }
          waiters.length = 0;

          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };

  return {
    stream,
    getDroppedCount: () => droppedCount,
  };
}
