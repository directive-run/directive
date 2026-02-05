import { describe, expect, it } from "vitest";
import {
	createStreamChannel,
	createBidirectionalStream,
	pipeThrough,
	mergeStreams,
} from "../adapters/openai-agents-stream-channel.js";

describe("StreamChannel", () => {
	it("should send and receive values", async () => {
		const channel = createStreamChannel<string>();

		// Send then end in background
		(async () => {
			await channel.send("hello");
			await channel.send("world");
			channel.end();
		})();

		const values: string[] = [];
		for await (const value of channel) {
			values.push(value);
		}

		expect(values).toEqual(["hello", "world"]);
	});

	it("should start in open state", () => {
		const channel = createStreamChannel<number>();
		expect(channel.getState()).toBe("open");
	});

	it("should transition to closed on end()", () => {
		const channel = createStreamChannel<number>();
		channel.end();
		expect(channel.getState()).toBe("closed");
	});

	it("should transition to error on error()", () => {
		const channel = createStreamChannel<number>();
		channel.error(new Error("test"));
		expect(channel.getState()).toBe("error");
	});

	it("should reject sends on closed channel", async () => {
		const channel = createStreamChannel<number>();
		channel.end();

		await expect(channel.send(1)).rejects.toThrow("closed");
	});

	it("should track buffered count", async () => {
		const channel = createStreamChannel<number>({ bufferSize: 100 });

		// These won't block because buffer is large enough
		const p1 = channel.send(1);
		const p2 = channel.send(2);
		const p3 = channel.send(3);

		// Send resolves immediately when there's no consumer waiting and buffer has space
		// But since no consumer, values go to buffer
		await Promise.resolve(); // Let microtasks run

		expect(channel.bufferedCount()).toBe(3);

		// Consume one
		const iter = channel[Symbol.asyncIterator]();
		await iter.next();
		expect(channel.bufferedCount()).toBe(2);

		channel.end();
	});

	it("should apply backpressure when buffer is full", async () => {
		const channel = createStreamChannel<number>({ bufferSize: 2 });

		let sendResolved = false;

		// Fill the buffer
		await channel.send(1);
		await channel.send(2);

		// This send should block (buffer full)
		const blocked = channel.send(3).then(() => {
			sendResolved = true;
		});

		await new Promise((r) => setTimeout(r, 10));
		expect(sendResolved).toBe(false);

		// Consume one to unblock
		const iter = channel[Symbol.asyncIterator]();
		await iter.next();

		await blocked;
		expect(sendResolved).toBe(true);

		channel.end();
	});

	it("should handle direct delivery to waiting consumer", async () => {
		const channel = createStreamChannel<string>();

		// Start consuming (will wait for values)
		const consumed: string[] = [];
		const consuming = (async () => {
			for await (const value of channel) {
				consumed.push(value);
			}
		})();

		// Give consumer time to start waiting
		await new Promise((r) => setTimeout(r, 5));

		await channel.send("direct");
		channel.end();

		await consuming;
		expect(consumed).toEqual(["direct"]);
	});

	it("should propagate error to waiting consumer", async () => {
		const channel = createStreamChannel<string>();
		const testError = new Error("stream broke");

		const consuming = (async () => {
			const values: string[] = [];
			for await (const value of channel) {
				values.push(value);
			}
			return values;
		})();

		// Give consumer time to start waiting on next()
		await new Promise((r) => setTimeout(r, 5));

		channel.error(testError);

		await expect(consuming).rejects.toThrow("stream broke");
	});

	it("should throw when multiple simultaneous consumers are created", () => {
		const channel = createStreamChannel<number>();

		// First consumer
		const _iter1 = channel[Symbol.asyncIterator]();

		// Second consumer should throw
		expect(() => channel[Symbol.asyncIterator]()).toThrow("single consumer");
	});

	it("should throw when sending on errored channel", async () => {
		const channel = createStreamChannel<number>();
		channel.error(new Error("broken"));

		await expect(channel.send(1)).rejects.toThrow("error");
	});

	it("should throw on invalid bufferSize", () => {
		expect(() => createStreamChannel({ bufferSize: 0 })).toThrow("bufferSize must be >= 1");
		expect(() => createStreamChannel({ bufferSize: -5 })).toThrow("bufferSize must be >= 1");
		expect(() => createStreamChannel({ bufferSize: NaN })).toThrow("bufferSize must be >= 1");
	});

	it("should allow re-creating consumer after error rejects waiting consumer", async () => {
		const channel = createStreamChannel<number>();

		// Start consuming (will wait for next value)
		const iter1 = channel[Symbol.asyncIterator]();
		const nextPromise = iter1.next();

		// Give consumer time to start waiting
		await new Promise((r) => setTimeout(r, 5));

		// Error the channel - should reject the waiting consumer and reset hasConsumer
		channel.error(new Error("test error"));

		await expect(nextPromise).rejects.toThrow("test error");

		// After error rejected the consumer, we should be able to get a new iterator
		// (hasConsumer was reset in errorConsumer)
		const iter2 = channel[Symbol.asyncIterator]();
		// The channel is in error state, so next() should reject
		await expect(iter2.next()).rejects.toThrow("test error");
	});

	it("should transition to closed when consumer breaks out of loop", async () => {
		const channel = createStreamChannel<number>();

		// Send some values in the background
		(async () => {
			await channel.send(1);
			await channel.send(2);
			await channel.send(3);
		})();

		// Consume but break early
		for await (const value of channel) {
			if (value === 2) break;
		}

		expect(channel.getState()).toBe("closed");
	});

	it("should throw when send resumes after backpressure and channel is closed", async () => {
		const channel = createStreamChannel<number>({ bufferSize: 1 });

		// Fill the buffer
		await channel.send(1);

		// This send will block on backpressure (buffer full, no consumer)
		const blockedSend = channel.send(2);

		// Give time for the send to be waiting
		await new Promise((r) => setTimeout(r, 5));

		// Close the channel while the producer is waiting
		// error() calls resolveProducer(), so the blocked send will resume and re-check state
		channel.error(new Error("closed during backpressure"));

		await expect(blockedSend).rejects.toThrow("error");
	});
});

describe("BidirectionalStream", () => {
	it("should support two-way communication", async () => {
		const { sideA, sideB } = createBidirectionalStream<string, number>();

		const receivedByB: string[] = [];
		const receivedByA: number[] = [];

		// B consumes A's messages
		const consumeB = (async () => {
			for await (const msg of sideB.receive) {
				receivedByB.push(msg);
			}
		})();

		// A consumes B's messages
		const consumeA = (async () => {
			for await (const msg of sideA.receive) {
				receivedByA.push(msg);
			}
		})();

		await sideA.send("hello");
		await sideB.send(42);
		sideA.close();

		await consumeA;
		await consumeB;

		expect(receivedByB).toEqual(["hello"]);
		expect(receivedByA).toEqual([42]);
	});
});

describe("pipeThrough", () => {
	it("should transform and pipe stream values", async () => {
		const source = createStreamChannel<string>();
		const dest = createStreamChannel<number>();

		// Start piping
		const piping = pipeThrough(source, dest, (s) => s.length);

		// Send values
		await source.send("hi");
		await source.send("hello");
		source.end();

		await piping;

		const results: number[] = [];
		for await (const value of dest) {
			results.push(value);
		}

		expect(results).toEqual([2, 5]);
	});

	it("should pipe through an async transform", async () => {
		const source = createStreamChannel<number>();
		const dest = createStreamChannel<string>();

		// Async transform: simulate async work (e.g., fetch, computation)
		const piping = pipeThrough(source, dest, async (n) => {
			await new Promise((r) => setTimeout(r, 5));
			return `num:${n}`;
		});

		// Send values
		await source.send(1);
		await source.send(2);
		await source.send(3);
		source.end();

		await piping;

		const results: string[] = [];
		for await (const value of dest) {
			results.push(value);
		}

		expect(results).toEqual(["num:1", "num:2", "num:3"]);
	});

	it("should propagate throwing async transform to destination error", async () => {
		const source = createStreamChannel<number>();
		const dest = createStreamChannel<string>();

		const piping = pipeThrough(source, dest, async (n) => {
			if (n === 2) throw new Error("transform exploded");
			return `ok:${n}`;
		});

		await source.send(1);
		await source.send(2); // This triggers the throw
		source.end();

		await piping;

		expect(dest.getState()).toBe("error");

		const consuming = (async () => {
			const results: string[] = [];
			for await (const value of dest) {
				results.push(value);
			}
			return results;
		})();

		await expect(consuming).rejects.toThrow("transform exploded");
	});

	it("should propagate source error to destination", async () => {
		const source = createStreamChannel<string>();
		const dest = createStreamChannel<number>();

		const piping = pipeThrough(source, dest, (s) => s.length);

		// Send one value then error the source
		await source.send("ok");
		source.error(new Error("source failed"));

		await piping;

		// Destination should have received the error via dest.error()
		expect(dest.getState()).toBe("error");

		// Attempting to iterate should reject
		const consuming = (async () => {
			const results: number[] = [];
			for await (const value of dest) {
				results.push(value);
			}
			return results;
		})();

		await expect(consuming).rejects.toThrow("source failed");
	});
});

describe("mergeStreams", () => {
	it("should merge multiple streams", async () => {
		const ch1 = createStreamChannel<number>();
		const ch2 = createStreamChannel<number>();

		// Send values and close
		(async () => {
			await ch1.send(1);
			await ch1.send(2);
			ch1.end();
		})();

		(async () => {
			await ch2.send(10);
			await ch2.send(20);
			ch2.end();
		})();

		const merged = mergeStreams(ch1, ch2);
		const results: number[] = [];

		for await (const value of merged) {
			results.push(value);
		}

		// All values should be present (order may vary due to async)
		expect(results.sort((a, b) => a - b)).toEqual([1, 2, 10, 20]);
	});

	it("should surface error when one source errors", async () => {
		const ch1 = createStreamChannel<number>();
		const ch2 = createStreamChannel<number>();

		// ch1 sends one value then errors
		(async () => {
			await ch1.send(1);
			ch1.error(new Error("ch1 exploded"));
		})();

		// ch2 sends normally
		(async () => {
			await ch2.send(10);
			ch2.end();
		})();

		const merged = mergeStreams(ch1, ch2);

		const consuming = (async () => {
			const results: number[] = [];
			for await (const value of merged) {
				results.push(value);
			}
			return results;
		})();

		await expect(consuming).rejects.toThrow("ch1 exploded");
	});

	it("should immediately complete with zero sources", async () => {
		const merged = mergeStreams<number>();
		const results: number[] = [];

		for await (const value of merged) {
			results.push(value);
		}

		expect(results).toEqual([]);
	});

	it("should handle early consumer break without hanging", async () => {
		const ch1 = createStreamChannel<number>();
		const ch2 = createStreamChannel<number>();

		// Send values continuously in the background
		(async () => {
			for (let i = 0; i < 100; i++) {
				try {
					await ch1.send(i);
				} catch {
					break;
				}
			}
		})();

		(async () => {
			for (let i = 100; i < 200; i++) {
				try {
					await ch2.send(i);
				} catch {
					break;
				}
			}
		})();

		const merged = mergeStreams(ch1, ch2);
		const results: number[] = [];

		// Consume but break after receiving a few values
		for await (const value of merged) {
			results.push(value);
			if (results.length >= 3) break;
		}

		// Should have received exactly the number we asked for
		expect(results.length).toBe(3);

		// Clean up source channels
		ch1.end();
		ch2.end();
	});
});
