import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSystem, createThrottle } from "../../adapter-utils.js";

// The L13 RFC's U12 (development): assertSystem throws for a missing system.
// The production half is l13-adapter-utils-pins-oracle-production.

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }

  return "did not throw";
}

describe("L13 probe pins: /adapter-utils assertSystem (development)", () => {
  it("U12: assertSystem throws for null and undefined, naming the hook and what it got", () => {
    expect(message(() => assertSystem("useFact", null))).toBe(
      "[Directive] useFact() requires a system instance as the first argument. Received null.",
    );
    expect(message(() => assertSystem("useSelector", undefined))).toBe(
      "[Directive] useSelector() requires a system instance as the first argument. Received undefined.",
    );
  });

  it("U12: assertSystem accepts anything else, including a falsy non-nullish value", () => {
    expect(() => assertSystem("h", {})).not.toThrow();
    expect(() => assertSystem("h", 0)).not.toThrow();
    expect(() => assertSystem("h", "")).not.toThrow();
    expect(() => assertSystem("h", false)).not.toThrow();
  });
});

describe("L13 review pins: /adapter-utils createThrottle on a real clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the first call runs at once, later calls inside the window trail with the latest arguments, and a call after the window runs at once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const calls: unknown[][] = [];
    const { throttled } = createThrottle(
      (...args: unknown[]) => calls.push(args),
      500,
    );

    throttled("a");
    expect(calls).toEqual([["a"]]);
    throttled("b");
    throttled("c");
    expect(calls).toEqual([["a"]]);
    vi.advanceTimersByTime(499);
    expect(calls).toEqual([["a"]]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([["a"], ["c"]]);
    // the trailing call restarted the window
    throttled("d");
    expect(calls).toEqual([["a"], ["c"]]);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([["a"], ["c"], ["d"]]);
    // idle for longer than the window: the next call is immediate again
    vi.advanceTimersByTime(1_000);
    throttled("e");
    expect(calls).toEqual([["a"], ["c"], ["d"], ["e"]]);
  });
});
