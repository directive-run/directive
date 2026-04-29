import { describe, expect, it } from "vitest";
import { realClock, virtualClock, defaultClock } from "../clock.js";

describe("realClock", () => {
  it("now() reports a real wall-clock value", () => {
    const c = realClock();
    const before = Date.now();
    const now = c.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("setTimeout fires the callback after the delay", async () => {
    const c = realClock();
    let fired = false;
    c.setTimeout(() => {
      fired = true;
    }, 5);
    expect(fired).toBe(false);
    await new Promise((r) => globalThis.setTimeout(r, 30));
    expect(fired).toBe(true);
  });

  it("setTimeout returns a cancel handle", async () => {
    const c = realClock();
    let fired = false;
    const cancel = c.setTimeout(() => {
      fired = true;
    }, 5);
    cancel();
    await new Promise((r) => globalThis.setTimeout(r, 30));
    expect(fired).toBe(false);
  });

  it("does not expose advanceBy", () => {
    const c = realClock();
    expect(c.advanceBy).toBeUndefined();
  });
});

describe("virtualClock", () => {
  it("now() starts at the seeded value", () => {
    const c = virtualClock(1_000);
    expect(c.now()).toBe(1_000);
  });

  it("advanceBy() moves time forward", () => {
    const c = virtualClock(0);
    c.advanceBy?.(500);
    expect(c.now()).toBe(500);
    c.advanceBy?.(250);
    expect(c.now()).toBe(750);
  });

  it("setTimeout callback fires when advanceBy crosses its deadline", () => {
    const c = virtualClock(0);
    let fired = false;
    c.setTimeout(() => {
      fired = true;
    }, 100);
    c.advanceBy?.(50);
    expect(fired).toBe(false);
    c.advanceBy?.(60);
    expect(fired).toBe(true);
  });

  it("multiple callbacks fire in deadline order", () => {
    const c = virtualClock(0);
    const order: string[] = [];
    c.setTimeout(() => order.push("third"), 30);
    c.setTimeout(() => order.push("first"), 10);
    c.setTimeout(() => order.push("second"), 20);
    c.advanceBy?.(50);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("ties resolve in registration order", () => {
    const c = virtualClock(0);
    const order: string[] = [];
    c.setTimeout(() => order.push("a"), 10);
    c.setTimeout(() => order.push("b"), 10);
    c.setTimeout(() => order.push("c"), 10);
    c.advanceBy?.(20);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("now() reports the callback's deadline mid-flight", () => {
    const c = virtualClock(0);
    let nowAtFire = -1;
    c.setTimeout(() => {
      nowAtFire = c.now();
    }, 25);
    c.advanceBy?.(100);
    expect(nowAtFire).toBe(25);
    expect(c.now()).toBe(100);
  });

  it("cancel handle prevents firing", () => {
    const c = virtualClock(0);
    let fired = false;
    const cancel = c.setTimeout(() => {
      fired = true;
    }, 50);
    cancel();
    c.advanceBy?.(100);
    expect(fired).toBe(false);
  });

  it("advanceBy with no callbacks just moves time", () => {
    const c = virtualClock(0);
    c.advanceBy?.(1_000);
    expect(c.now()).toBe(1_000);
  });
});

describe("defaultClock", () => {
  it("returns a clock", () => {
    const c = defaultClock();
    expect(typeof c.now).toBe("function");
    expect(typeof c.setTimeout).toBe("function");
  });

  it("under VITEST it returns a virtual clock", () => {
    // VITEST=true is the default in this test environment
    const c = defaultClock();
    expect(typeof c.advanceBy).toBe("function");
  });
});
