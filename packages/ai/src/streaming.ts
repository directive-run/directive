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

import type { AgentLike, Message, RunResult, GuardrailFn, OutputGuardrailData, StreamingCallbackRunner } from "./types.js";
import type { OrchestratorStreamChunk } from "./agent-orchestrator.js";

// ============================================================================
// Constants
// ============================================================================

/** Default buffer size for streaming backpressure */
export const DEFAULT_BUFFER_SIZE = 1000;

/** Default interval (in tokens) between guardrail checks during streaming */
export const DEFAULT_GUARDRAIL_CHECK_INTERVAL = 50;

/** Default toxicity threshold for toxicity streaming guardrail */
export const DEFAULT_TOXICITY_THRESHOLD = 0.8;


// ============================================================================
// Stream Event Types
// ============================================================================

/** Token chunk from streaming response */
export interface TokenChunk {
  type: "token";
  data: string;
  /** Running total of tokens received */
  tokenCount: number;
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
  /** Number of tokens dropped due to backpressure (only with 'drop' strategy) */
  droppedTokens: number;
}

/** Error during streaming */
export interface ErrorChunk {
  type: "error";
  error: Error;
  /** Partial output before error */
  partialOutput?: string;
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
  | ErrorChunk;

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

/** Streaming run options */
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
  options?: StreamRunOptions
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
  check: (partialOutput: string, tokenCount: number) => StreamingGuardrailResult | Promise<StreamingGuardrailResult>;
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

  constructor(strategy: BackpressureStrategy = "buffer", maxSize = DEFAULT_BUFFER_SIZE) {
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
  } = {}
): StreamRunner {
  const { streamingGuardrails = [] } = options;

  return <T>(
    agent: AgentLike,
    input: string,
    runOptions: StreamRunOptions = {}
  ): StreamingRunResult<T> => {
    const {
      signal,
      backpressure = "buffer",
      bufferSize = DEFAULT_BUFFER_SIZE,
      guardrailCheckInterval = DEFAULT_GUARDRAIL_CHECK_INTERVAL,
      stopOnGuardrail = true,
    } = runOptions;

    // Validate configuration
    if (guardrailCheckInterval <= 0 || !Number.isFinite(guardrailCheckInterval)) {
      throw new Error(
        `[Directive Streaming] guardrailCheckInterval must be a positive number, got ${guardrailCheckInterval}`
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
              const stopFn = typeof stopOnGuardrail === "function"
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
      await buffer.push({ type: "progress", phase: "starting", message: "Starting agent" });

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
              tokenCount,
            });

            // Check guardrails periodically
            if (tokenCount % guardrailCheckInterval === 0) {
              await checkGuardrails();
            }
          },
          onToolStart: async (tool, id, args) => {
            await buffer.push({ type: "progress", phase: "tool_calling", message: `Calling ${tool}` });
            await buffer.push({ type: "tool_start", tool, toolCallId: id, arguments: args });
          },
          onToolEnd: async (tool, id, result) => {
            await buffer.push({ type: "tool_end", tool, toolCallId: id, result });
            await buffer.push({ type: "progress", phase: "generating", message: "Continuing generation" });
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
  const { checkFn, threshold = DEFAULT_TOXICITY_THRESHOLD, stopOnFail = true } = options;

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
  options: { name?: string; stopOnFirstFail?: boolean } = {}
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
            return { ...result, reason: `[${guardrail.name}] ${result.reason}` };
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
  } = {}
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
        }
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
export async function collectTokens(stream: AsyncIterable<StreamChunk>): Promise<string> {
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
  fn: (chunk: StreamChunk) => void | Promise<void>
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
  types: T[]
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
  fn: (chunk: StreamChunk) => R | Promise<R>
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

export function mergeTaggedStreams(
  sources: TaggedSource[],
): MergedTaggedStreamResult {
  // Guard: empty sources would hang forever since no consumer calls finish()
  if (sources.length === 0) {
    const emptyStream: AsyncIterable<MultiplexedStreamChunk> = {
      [Symbol.asyncIterator]() {
        const done = { done: true as const, value: undefined as unknown as MultiplexedStreamChunk };

        return {
          async next() { return done; },
          async return() { return done; },
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

          return new Promise<IteratorResult<MultiplexedStreamChunk>>((resolve) => {
            waiters.push((item) => {
              if (item === null) {
                resolve({ done: true, value: undefined });
              } else {
                resolve({ done: false, value: item });
              }
            });
          });
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
