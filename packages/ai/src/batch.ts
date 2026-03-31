/**
 * P5: Batch Queue — Application-level batching for agent calls.
 *
 * Accumulates calls and flushes them in batches to reduce overhead.
 * Each `submit()` returns a promise that resolves when its individual call completes.
 * Batches execute calls in parallel up to a configurable concurrency limit.
 *
 * @module
 *
 * @example
 * ```typescript
 * import { createBatchQueue } from '@directive-run/ai';
 *
 * const queue = createBatchQueue(runner, {
 *   maxBatchSize: 20,
 *   maxWaitMs: 5000,
 *   concurrency: 5,
 * });
 *
 * // Submit calls — they batch automatically
 * const [r1, r2, r3] = await Promise.all([
 *   queue.submit(agent, "input 1"),
 *   queue.submit(agent, "input 2"),
 *   queue.submit(agent, "input 3"),
 * ]);
 *
 * // Force immediate flush
 * await queue.flush();
 *
 * // Clean up (flushes remaining calls)
 * await queue.destroy();
 * ```
 */

import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface BatchQueueConfig {
  /** Maximum number of calls per batch. @default 20 */
  maxBatchSize?: number;
  /** Maximum time to wait before flushing (ms). @default 5000 */
  maxWaitMs?: number;
  /** Number of calls to run in parallel within a batch. @default 5 */
  concurrency?: number;
}

export interface BatchQueue {
  /** Submit a call to the queue. Returns a promise that resolves when the call completes. */
  submit<T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>>;
  /** Flush all pending calls immediately. */
  flush(): Promise<void>;
  /** Get the number of pending calls. */
  readonly pending: number;
  /** Destroy the queue, flushing remaining calls. */
  destroy(): Promise<void>;
}

// ============================================================================
// Internal
// ============================================================================

interface QueuedCall {
  agent: AgentLike;
  input: string;
  options?: RunOptions;
  resolve: (result: RunResult<unknown>) => void;
  reject: (error: Error) => void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a batch queue for grouping agent calls.
 *
 * @example
 * ```typescript
 * const queue = createBatchQueue(runner, {
 *   maxBatchSize: 20,
 *   maxWaitMs: 5000,
 *   concurrency: 5,
 * });
 *
 * // Submit multiple calls — they batch automatically
 * const [result1, result2, result3] = await Promise.all([
 *   queue.submit(agent, "input 1"),
 *   queue.submit(agent, "input 2"),
 *   queue.submit(agent, "input 3"),
 * ]);
 *
 * // Clean up
 * await queue.destroy();
 * ```
 */
export function createBatchQueue(
  runner: AgentRunner,
  config: BatchQueueConfig = {},
): BatchQueue {
  const { maxBatchSize = 20, maxWaitMs = 5000, concurrency = 5 } = config;

  // Validate config
  if (!Number.isFinite(maxBatchSize) || maxBatchSize < 1) {
    throw new Error(
      "[Directive] createBatchQueue: maxBatchSize must be a positive finite number (>= 1).",
    );
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    throw new Error(
      "[Directive] createBatchQueue: maxWaitMs must be a non-negative finite number.",
    );
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(
      "[Directive] createBatchQueue: concurrency must be a positive finite number (>= 1).",
    );
  }

  const queue: QueuedCall[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let flushPromise: Promise<void> | null = null;

  function scheduleFlush(): void {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushInternal().catch(() => {
        // Errors are delivered to individual call promises
      });
    }, maxWaitMs);
  }

  function cancelTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  /** Execute calls with concurrency limit. */
  async function executeBatch(batch: QueuedCall[]): Promise<void> {
    let index = 0;

    async function runNext(): Promise<void> {
      while (index < batch.length) {
        const current = index++;
        const call = batch[current]!;

        try {
          const result = await runner(call.agent, call.input, call.options);
          call.resolve(result);
        } catch (err) {
          call.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    // Run up to `concurrency` workers
    const workers = Array.from(
      { length: Math.min(concurrency, batch.length) },
      () => runNext(),
    );
    await Promise.all(workers);
  }

  async function flushInternal(): Promise<void> {
    // Wait for any in-progress flush to complete first
    if (flushPromise) {
      await flushPromise;
    }

    if (queue.length === 0) {
      return;
    }

    cancelTimer();

    // Drain the queue
    const batch = queue.splice(0);

    flushPromise = executeBatch(batch).finally(() => {
      flushPromise = null;

      // If more calls came in during flush, schedule another
      if (queue.length > 0) {
        scheduleFlush();
      }
    });

    await flushPromise;
  }

  return {
    submit<T = unknown>(
      agent: AgentLike,
      input: string,
      options?: RunOptions,
    ): Promise<RunResult<T>> {
      if (destroyed) {
        return Promise.reject(
          new Error("[Directive] BatchQueue has been destroyed."),
        );
      }

      return new Promise<RunResult<T>>((resolve, reject) => {
        queue.push({
          agent,
          input,
          options,
          resolve: resolve as (result: RunResult<unknown>) => void,
          reject,
        });

        // Flush immediately if batch is full
        if (queue.length >= maxBatchSize) {
          cancelTimer();
          flushInternal().catch(() => {
            // Errors are delivered to individual call promises
          });
        } else {
          scheduleFlush();
        }
      });
    },

    async flush(): Promise<void> {
      await flushInternal();
    },

    get pending(): number {
      return queue.length;
    },

    async destroy(): Promise<void> {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelTimer();
      // Flush remaining calls
      if (queue.length > 0) {
        await flushInternal();
      }
    },
  };
}
