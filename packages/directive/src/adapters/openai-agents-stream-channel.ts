/**
 * Streaming Channel for Agent-to-Agent Communication
 *
 * Provides AsyncIterable-based streaming for large data transfers between agents.
 * Supports backpressure, buffering, and graceful termination.
 *
 * @example
 * ```typescript
 * import { createStreamChannel } from 'directive/openai-agents';
 *
 * // Producer side
 * const channel = createStreamChannel<string>({ bufferSize: 100 });
 *
 * // Send data
 * await channel.send('chunk 1');
 * await channel.send('chunk 2');
 * channel.end(); // Signal completion
 *
 * // Consumer side (async iteration)
 * for await (const chunk of channel) {
 *   console.log(chunk);
 * }
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/** Stream channel configuration */
export interface StreamChannelConfig {
	/** Maximum buffer size before backpressure is applied (default: 100) */
	bufferSize?: number;
	/** Channel name for debugging */
	name?: string;
}

/** Stream channel state */
export type StreamChannelState = "open" | "closed" | "error";

/** Stream channel instance */
export interface StreamChannel<T> extends AsyncIterable<T> {
	/** Send a value to the channel. Resolves when consumed or buffered. */
	send(value: T): Promise<void>;
	/** Signal that no more values will be sent */
	end(): void;
	/** Signal an error and terminate the stream */
	error(err: Error): void;
	/** Get the current state */
	getState(): StreamChannelState;
	/** Get the number of buffered items */
	bufferedCount(): number;
}

/** Bidirectional stream between two agents */
export interface BidirectionalStream<TSend, TReceive> {
	/** Send a value to the remote end */
	send(value: TSend): Promise<void>;
	/** Iterate over received values */
	receive: AsyncIterable<TReceive>;
	/** Close both directions */
	close(): void;
}

// ============================================================================
// Stream Channel Factory
// ============================================================================

/**
 * Create a stream channel for async data transfer.
 *
 * Implements proper backpressure: `send()` will pause when the buffer is full
 * and resume when the consumer catches up.
 *
 * @example
 * ```typescript
 * const channel = createStreamChannel<{ token: string }>();
 *
 * // Producer (e.g., LLM streaming response)
 * (async () => {
 *   for (const token of tokens) {
 *     await channel.send({ token });
 *   }
 *   channel.end();
 * })();
 *
 * // Consumer (e.g., downstream agent)
 * for await (const chunk of channel) {
 *   process.stdout.write(chunk.token);
 * }
 * ```
 */
export function createStreamChannel<T>(config: StreamChannelConfig = {}): StreamChannel<T> {
	const { bufferSize = 100 } = config;

	if (bufferSize < 1 || !Number.isFinite(bufferSize)) {
		throw new Error(`[Directive StreamChannel] bufferSize must be >= 1, got ${bufferSize}`);
	}

	const buffer: T[] = [];
	let state: StreamChannelState = "open";
	let streamError: Error | null = null;

	// Waiters for the consumer (when buffer is empty, consumer waits)
	let consumerWaiter: { resolve: (value: IteratorResult<T>) => void; reject: (err: Error) => void } | null = null;

	// Waiters for the producer (when buffer is full, producer waits)
	let producerWaiter: (() => void) | null = null;

	// Single-consumer guard
	let hasConsumer = false;

	function resolveConsumer(value: T): void {
		if (consumerWaiter) {
			const waiter = consumerWaiter;
			consumerWaiter = null;
			waiter.resolve({ value, done: false });
		}
	}

	function endConsumer(): void {
		if (consumerWaiter) {
			const waiter = consumerWaiter;
			consumerWaiter = null;
			waiter.resolve({ value: undefined as unknown as T, done: true });
		}
	}

	function errorConsumer(err: Error): void {
		if (consumerWaiter) {
			const waiter = consumerWaiter;
			consumerWaiter = null;
			hasConsumer = false;
			waiter.reject(err);
		}
	}

	function resolveProducer(): void {
		if (producerWaiter) {
			const waiter = producerWaiter;
			producerWaiter = null;
			waiter();
		}
	}

	const channel: StreamChannel<T> = {
		async send(value: T): Promise<void> {
			if (state !== "open") {
				throw new Error(
					`[Directive StreamChannel] Cannot send to ${state} channel${config.name ? ` "${config.name}"` : ""}`
				);
			}

			// If consumer is waiting, deliver directly
			if (consumerWaiter) {
				resolveConsumer(value);
				return;
			}

			// Apply backpressure if buffer is full (wait before adding)
			if (buffer.length >= bufferSize) {
				await new Promise<void>((resolve) => {
					producerWaiter = resolve;
				});
				// Re-check state after backpressure wait
				if (state !== "open") {
					throw new Error(
						`[Directive StreamChannel] Cannot send to ${state} channel${config.name ? ` "${config.name}"` : ""}`
					);
				}
				// If consumer became available during wait, deliver directly
				if (consumerWaiter) {
					resolveConsumer(value);
					return;
				}
			}

			// Buffer the value
			buffer.push(value);
		},

		end(): void {
			if (state !== "open") return;
			state = "closed";
			endConsumer();
		},

		error(err: Error): void {
			if (state !== "open") return;
			state = "error";
			streamError = err;
			errorConsumer(err);
			resolveProducer(); // Unblock any waiting producer
		},

		getState(): StreamChannelState {
			return state;
		},

		bufferedCount(): number {
			return buffer.length;
		},

		[Symbol.asyncIterator](): AsyncIterator<T> {
			if (hasConsumer) {
				throw new Error(
					"[Directive StreamChannel] Channel only supports a single consumer. " +
					"Create a separate channel for each consumer."
				);
			}
			hasConsumer = true;

			return {
				next(): Promise<IteratorResult<T>> {
					// Check for error
					if (state === "error" && streamError) {
						hasConsumer = false;
						return Promise.reject(streamError);
					}

					// Check buffer first
					if (buffer.length > 0) {
						const value = buffer.shift()!;
						resolveProducer(); // Unblock producer if waiting
						return Promise.resolve({ value, done: false });
					}

					// Check if stream is closed
					if (state === "closed") {
						hasConsumer = false;
						return Promise.resolve({ value: undefined as unknown as T, done: true });
					}

					// Wait for next value
					return new Promise((resolve, reject) => {
						consumerWaiter = { resolve, reject };
					});
				},

				return(): Promise<IteratorResult<T>> {
					state = "closed";
					buffer.length = 0;
					hasConsumer = false;
					resolveProducer();
					return Promise.resolve({ value: undefined as unknown as T, done: true });
				},
			};
		},
	};

	return channel;
}

// ============================================================================
// Bidirectional Stream
// ============================================================================

/**
 * Create a bidirectional stream channel for two-way communication between agents.
 *
 * @example
 * ```typescript
 * const { sideA, sideB } = createBidirectionalStream<string, string>();
 *
 * // Agent A sends and receives
 * await sideA.send('question?');
 * for await (const reply of sideA.receive) {
 *   console.log('A got:', reply);
 * }
 *
 * // Agent B receives and responds
 * for await (const msg of sideB.receive) {
 *   await sideB.send(`reply to: ${msg}`);
 * }
 * ```
 */
export function createBidirectionalStream<TA, TB>(
	config?: StreamChannelConfig
): { sideA: BidirectionalStream<TA, TB>; sideB: BidirectionalStream<TB, TA> } {
	const channelAtoB = createStreamChannel<TA>(config);
	const channelBtoA = createStreamChannel<TB>(config);

	return {
		sideA: {
			send: (value: TA) => channelAtoB.send(value),
			receive: channelBtoA,
			close() {
				channelAtoB.end();
				channelBtoA.end();
			},
		},
		sideB: {
			send: (value: TB) => channelBtoA.send(value),
			receive: channelAtoB,
			close() {
				channelAtoB.end();
				channelBtoA.end();
			},
		},
	};
}

// ============================================================================
// Stream Utilities
// ============================================================================

/**
 * Pipe one stream channel through a transform function into another.
 *
 * @example
 * ```typescript
 * const input = createStreamChannel<string>();
 * const output = createStreamChannel<number>();
 *
 * pipeThrough(input, output, (chunk) => chunk.length);
 * ```
 */
export async function pipeThrough<TIn, TOut>(
	source: AsyncIterable<TIn>,
	destination: StreamChannel<TOut>,
	transform: (value: TIn) => TOut | Promise<TOut>,
): Promise<void> {
	try {
		for await (const value of source) {
			const transformed = await transform(value);
			await destination.send(transformed);
		}
		destination.end();
	} catch (error) {
		destination.error(error instanceof Error ? error : new Error(String(error)));
	}
}

/**
 * Merge multiple async iterables into a single stream.
 * Values are emitted as soon as they arrive from any source.
 *
 * Note: The internal buffer is capped at 10,000 items. Values exceeding this
 * limit are dropped. For high-throughput scenarios, ensure the consumer keeps up
 * or use bounded `StreamChannel` sources.
 *
 * @example
 * ```typescript
 * const merged = mergeStreams(channel1, channel2, channel3);
 * for await (const value of merged) {
 *   console.log(value);
 * }
 * ```
 */
export function mergeStreams<T>(...sources: AsyncIterable<T>[]): AsyncIterable<T> {
	const MAX_BUFFER = 10000;

	return {
		[Symbol.asyncIterator](): AsyncIterator<T> {
			const buffer: T[] = [];
			let doneCount = 0;
			let waiter: ((value: IteratorResult<T>) => void) | null = null;
			let errorState: Error | null = null;
			let stopped = false;
			const sourceIterators: AsyncIterator<T>[] = [];

			function notifyWaiter(result: IteratorResult<T>): boolean {
				if (waiter) {
					const w = waiter;
					waiter = null;
					w(result);
					return true;
				}
				return false;
			}

			// Start consuming all sources
			for (const source of sources) {
				const iter = source[Symbol.asyncIterator]();
				sourceIterators.push(iter);
				(async () => {
					try {
						while (!stopped) {
							const result = await iter.next();
							if (result.done || stopped) break;
							if (!notifyWaiter({ value: result.value, done: false })) {
								if (buffer.length < MAX_BUFFER) {
									buffer.push(result.value);
								}
							}
						}
					} catch (error) {
						if (!stopped) {
							stopped = true;
							errorState = error instanceof Error ? error : new Error(String(error));
							notifyWaiter({ value: undefined as unknown as T, done: true });
						}
					}
					doneCount++;
					if (doneCount >= sources.length && !stopped) {
						notifyWaiter({ value: undefined as unknown as T, done: true });
					}
				})();
			}

			return {
				next(): Promise<IteratorResult<T>> {
					if (errorState) {
						return Promise.reject(errorState);
					}

					if (buffer.length > 0) {
						return Promise.resolve({ value: buffer.shift()!, done: false });
					}

					if (doneCount >= sources.length) {
						return Promise.resolve({ value: undefined as unknown as T, done: true });
					}

					return new Promise((resolve) => {
						waiter = resolve;
					});
				},

				return(): Promise<IteratorResult<T>> {
					stopped = true;
					buffer.length = 0;
					for (const iter of sourceIterators) {
						iter.return?.({ value: undefined as unknown as T, done: true });
					}
					if (waiter) {
						const w = waiter;
						waiter = null;
						w({ value: undefined as unknown as T, done: true });
					}
					return Promise.resolve({ value: undefined as unknown as T, done: true });
				},
			};
		},
	};
}
