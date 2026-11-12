import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

// The production half of the L8 RFC's U1 to U3 and U11. In development, reading
// a Date fact's methods throws (with or without history), so the development
// file cannot say that a Date, a Map and a Set come back as themselves through
// a navigation, and that the same facts leave an export as a string and two
// empty objects. Production can. Public API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Point {
  constructor(public x: number) {}
}

function counter() {
  return createModule("m", {
    schema: {
      facts: {
        n: t.number(),
        d: t.any(),
        m: t.any(),
        s: t.any(),
        mix: t.any(),
        cls: t.any(),
        email: t.any(),
        obj: t.any(),
      },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
      f.email = "a@b.c";
      f.obj = { v: 0 };
    },
  } as never);
}

async function begin(history: unknown = true) {
  const system = createSystem({
    module: counter(),
    history,
  } as never) as any;
  system.start();
  await system.settle();

  return system;
}

async function write(system: any, key: string, value: unknown) {
  system.facts[key] = value;
  await system.settle();
}

describe("a Date, a Map and a Set in production (U1, U2)", () => {
  it("come back as themselves through goBack when the whole record clones", async () => {
    const system = await begin();
    system.facts.d = new Date(1000);
    system.facts.m = new Map([["k", 1]]);
    system.facts.s = new Set([1]);
    await system.settle();
    await write(system, "n", 1);

    system.history.goBack();
    await system.settle();

    expect(system.history.currentIndex).toBe(1);
    expect(system.facts.d instanceof Date).toBe(true);
    expect(system.facts.d.getTime()).toBe(1000);
    expect(system.facts.m instanceof Map).toBe(true);
    expect(system.facts.m.get("k")).toBe(1);
    expect(system.facts.s instanceof Set).toBe(true);
    expect(system.facts.s.has(1)).toBe(true);
    system.destroy();
  });

  it("leave an export as an ISO string and two empty objects, and import writes those", async () => {
    const a = await begin();
    a.facts.d = new Date(1000);
    a.facts.m = new Map([["k", 1]]);
    a.facts.s = new Set([1]);
    a.facts.n = 1;
    await a.settle();
    const json = a.history.export();
    const last = JSON.parse(json).snapshots.at(-1).facts;

    expect(last.d).toBe("1970-01-01T00:00:01.000Z");
    expect(last.m).toEqual({});
    expect(last.s).toEqual({});
    // The exporting system's own facts are untouched.
    expect(a.facts.d instanceof Date).toBe(true);
    expect(a.facts.m instanceof Map).toBe(true);

    const b = await begin();
    b.history.import(json);
    await b.settle();

    expect(b.facts.n).toBe(1);
    expect(b.facts.d).toBe("1970-01-01T00:00:01.000Z");
    expect(b.facts.m instanceof Map).toBe(false);
    expect(b.facts.m).toEqual({});
    expect(b.facts.s instanceof Set).toBe(false);
    expect(b.facts.s).toEqual({});
    a.destroy();
    b.destroy();
  });

  it("a fact mixing a Date with a function falls to JSON: its Date is a string, while a Date in a fact that clones stays a Date", async () => {
    const system = await begin();
    system.facts.d = new Date(2000);
    system.facts.mix = { when: new Date(1000), cb: () => 1 };
    system.facts.cls = new Point(4);
    await system.settle();
    await write(system, "n", 1);

    system.history.goBack();
    await system.settle();

    expect(system.facts.mix).toEqual({ when: "1970-01-01T00:00:01.000Z" });
    expect("cb" in system.facts.mix).toBe(false);
    expect(system.facts.d instanceof Date).toBe(true);
    expect(system.facts.d.getTime()).toBe(2000);
    expect(system.facts.cls).toEqual({ x: 4 });
    expect(system.facts.cls instanceof Point).toBe(false);
    expect(Object.getPrototypeOf(system.facts.cls)).toBe(Object.prototype);
    system.destroy();
  });
});

describe("a stored snapshot is the same object the caller holds, in production (U3)", () => {
  it("a value changed through the snapshots list is what the next goTo restores", async () => {
    const system = await begin();
    await write(system, "n", 1);
    await write(system, "n", 2);
    const target = system.history.snapshots[1];
    target.facts.n = 99;

    system.history.goTo(target.id);
    await system.settle();

    expect(system.facts.n).toBe(99);
    expect(system.history.snapshots[1].facts.n).toBe(99);
    system.destroy();
  });

  it("a nested value edited in place on a restored fact edits the stored snapshot too", async () => {
    const system = await begin();
    await write(system, "obj", { v: 1 });
    await write(system, "obj", { v: 2 });
    system.history.goBack();
    await system.settle();
    const index = system.history.currentIndex;
    const stored = system.history.snapshots[index];

    system.facts.obj.v = 42;
    await system.settle();

    expect(system.facts.obj.v).toBe(42);
    expect(stored.facts.obj.v).toBe(42);
    system.destroy();
  });
});

describe("redactSnapshot and a navigation, in production (U11)", () => {
  it("a navigation writes the redacted value into the live fact", async () => {
    const system = await begin({
      maxSnapshots: 10,
      redactSnapshot: (facts: Record<string, unknown>) => ({
        ...facts,
        email: "[REDACTED]",
      }),
    });
    await write(system, "n", 1);
    await write(system, "n", 2);
    expect(system.facts.email).toBe("a@b.c");

    system.history.goBack();
    await system.settle();

    expect(system.facts.n).toBe(1);
    expect(system.facts.email).toBe("[REDACTED]");
    system.destroy();
  });
});
