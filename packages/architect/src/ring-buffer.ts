/**
 * Generic ring buffer with O(1) push and FIFO eviction.
 *
 * Used by audit log, outcome tracker, and adaptive context
 * to replace Array.shift() (O(n)) with constant-time eviction.
 */

export class RingBuffer<T> {
  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private count = 0;
  private readonly cap: number;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be positive");
    }

    this.cap = capacity;
    this.buffer = new Array(capacity);
  }

  /** Push an item. Returns the evicted item if buffer was full, otherwise undefined. */
  push(item: T): T | undefined {
    let evicted: T | undefined;

    if (this.count === this.cap) {
      evicted = this.buffer[this.head];
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.cap;
    } else {
      const insertAt = (this.head + this.count) % this.cap;
      this.buffer[insertAt] = item;
      this.count++;
    }

    return evicted;
  }

  /** Get item at logical index (0 = oldest). */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }

    return this.buffer[(this.head + index) % this.cap];
  }

  /** Get the last (newest) item. */
  last(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }

    return this.buffer[(this.head + this.count - 1) % this.cap];
  }

  /** Return items in insertion order (oldest first). */
  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.cap]!);
    }

    return result;
  }

  /** Return items in reverse order (newest first). */
  reversed(): T[] {
    const result: T[] = [];
    for (let i = this.count - 1; i >= 0; i--) {
      result.push(this.buffer[(this.head + i) % this.cap]!);
    }

    return result;
  }

  /** Clear all items. */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** Current number of items. */
  get size(): number {
    return this.count;
  }

  /** Maximum capacity. */
  get capacity(): number {
    return this.cap;
  }

  /** Iterate in insertion order. */
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.buffer[(this.head + i) % this.cap]!;
    }
  }
}
