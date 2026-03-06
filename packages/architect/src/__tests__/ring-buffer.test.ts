import { describe, it, expect } from "vitest";
import { RingBuffer } from "../ring-buffer.js";

describe("RingBuffer", () => {
  it("throws on non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow("positive");
    expect(() => new RingBuffer(-1)).toThrow("positive");
  });

  it("tracks size and capacity", () => {
    const buf = new RingBuffer<number>(5);
    expect(buf.size).toBe(0);
    expect(buf.capacity).toBe(5);

    buf.push(1);
    buf.push(2);
    expect(buf.size).toBe(2);
  });

  it("push returns undefined when not full", () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.push(1)).toBeUndefined();
    expect(buf.push(2)).toBeUndefined();
    expect(buf.push(3)).toBeUndefined();
  });

  it("push returns evicted item when full", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    expect(buf.push(4)).toBe(1);
    expect(buf.push(5)).toBe(2);
    expect(buf.push(6)).toBe(3);
  });

  it("size stays at capacity after eviction", () => {
    const buf = new RingBuffer<number>(2);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size).toBe(2);
  });

  it("at() returns items by logical index", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");

    expect(buf.at(0)).toBe("a");
    expect(buf.at(1)).toBe("b");
    expect(buf.at(2)).toBe("c");
    expect(buf.at(3)).toBeUndefined();
    expect(buf.at(-1)).toBeUndefined();
  });

  it("at() returns correct items after wrap-around", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // evicts 1

    expect(buf.at(0)).toBe(2);
    expect(buf.at(1)).toBe(3);
    expect(buf.at(2)).toBe(4);
  });

  it("last() returns newest item", () => {
    const buf = new RingBuffer<number>(3);
    expect(buf.last()).toBeUndefined();

    buf.push(10);
    expect(buf.last()).toBe(10);

    buf.push(20);
    expect(buf.last()).toBe(20);

    buf.push(30);
    buf.push(40); // evicts 10
    expect(buf.last()).toBe(40);
  });

  it("toArray() returns items in insertion order", () => {
    const buf = new RingBuffer<number>(4);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    expect(buf.toArray()).toEqual([1, 2, 3]);

    buf.push(4);
    buf.push(5); // evicts 1

    expect(buf.toArray()).toEqual([2, 3, 4, 5]);
  });

  it("reversed() returns items newest first", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    expect(buf.reversed()).toEqual([3, 2, 1]);

    buf.push(4); // evicts 1
    expect(buf.reversed()).toEqual([4, 3, 2]);
  });

  it("clear() resets the buffer", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);

    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
    expect(buf.last()).toBeUndefined();
  });

  it("is iterable", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // evicts 1

    const items = [...buf];
    expect(items).toEqual([2, 3, 4]);
  });

  it("works with capacity 1", () => {
    const buf = new RingBuffer<string>(1);
    expect(buf.push("a")).toBeUndefined();
    expect(buf.push("b")).toBe("a");
    expect(buf.size).toBe(1);
    expect(buf.toArray()).toEqual(["b"]);
  });

  it("handles many wrap-arounds", () => {
    const buf = new RingBuffer<number>(3);
    for (let i = 0; i < 100; i++) {
      buf.push(i);
    }

    expect(buf.size).toBe(3);
    expect(buf.toArray()).toEqual([97, 98, 99]);
    expect(buf.last()).toBe(99);
    expect(buf.at(0)).toBe(97);
  });
});
