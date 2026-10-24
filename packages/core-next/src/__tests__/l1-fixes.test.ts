import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../index.js";

afterEach(() => vi.restoreAllMocks());

describe("L1 fixes", () => {
  it("throws on a dangerous key in a module's events", () => {
    const events = Object.create(null);
    events.constructor = () => {};
    const mod = createModule("bad", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      events,
    } as any);

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
  });

  it("warns when a fact and a derivation share a name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("c", {
      schema: {
        facts: { shared: t.number() },
        derivations: { shared: t.number() },
        events: {},
        requirements: {},
      },
      derive: { shared: (f: any) => f.shared + 1 },
    } as any);
    createSystem({ module: mod });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exists as both a fact and a derivation"),
    );
  });

  it("_mode is single for module:", () => {
    const mod = createModule("m", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    } as any);

    expect((createSystem({ module: mod }) as any)._mode).toBe("single");
  });
});

describe("membership test on derived tracks", () => {
  // Every number asserted here is what the published 1.35 does with the same
  // module (probed side by side): a membership test follows its target and
  // never runs it.
  function make() {
    const seen: boolean[] = [];
    const errors: unknown[] = [];
    const runs = { base: 0 };
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), ok: t.boolean() },
        derivations: { base: t.number(), gate: t.boolean() },
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.n = 1;
        f.ok = true;
      },
      derive: {
        base: (f: any) => {
          runs.base++;
          if (!f.ok) {
            throw new Error("boom");
          }

          return f.n;
        },
        gate: (_f: any, d: any) => {
          const has = "base" in d;
          seen.push(has);

          return has;
        },
      },
    } as any);
    const system = createSystem({
      module: mod,
      plugins: [{ name: "errors", onError: (e: unknown) => errors.push(e) }],
    } as any) as any;

    return { system, seen, errors, runs };
  }

  it("`in derived` follows its target like a read", () => {
    const { system, seen } = make();
    system.start?.();
    expect(system.read("gate")).toBe(true);
    const n = seen.length;
    system.facts.n = 5;
    system.read("gate");

    expect(seen.length).toBe(n + 1);
  });

  it("`in derived` does not run its target", () => {
    const { system, seen, runs } = make();
    system.start?.();
    expect(runs.base).toBe(1);
    expect(system.read("gate")).toBe(true);
    system.facts.n = 5;

    expect(system.read("gate")).toBe(true);
    expect(seen.length).toBe(2);
    // The target went stale and the asker re-ran; only a read of the target
    // runs it.
    expect(runs.base).toBe(1);
    expect(system.read("base")).toBe(5);
    expect(runs.base).toBe(2);
    system.facts.n = 6;
    expect(system.read("gate")).toBe(true);
    expect(seen.length).toBe(3);
    expect(runs.base).toBe(2);
  });

  it("`in derived` leaves a target that throws to whoever reads it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { system, errors, runs } = make();
    system.start?.();
    system.facts.ok = false;

    expect(system.read("gate")).toBe(true);
    expect(runs.base).toBe(1);
    expect(errors).toHaveLength(0);
    expect(() => system.read("base")).toThrow("boom");
    expect(errors).toHaveLength(1);
    // A throwing derivation stays stale: the next read runs it again.
    expect(() => system.read("base")).toThrow("boom");
    expect(runs.base).toBe(3);
  });

  it("`in derived` is true for a derivation, itself included, and false for the rest", () => {
    const seen: unknown[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { base: t.number(), probe: t.any() },
        events: {},
        requirements: {},
      },
      derive: {
        base: (f: any) => f.n,
        probe: (_f: any, d: any) => {
          seen.push(
            "base" in d,
            "probe" in d,
            "n" in d,
            "nope" in d,
            "constructor" in d,
            "__proto__" in d,
            Symbol.iterator in d,
          );

          return 0;
        },
      },
    } as any);
    const system = createSystem({ module: mod }) as any;
    system.start?.();
    system.read("probe");

    expect(seen.slice(0, 7)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("derivations that test each other follow each other without looping", () => {
    const runs = { x: 0, y: 0 };
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { x: t.any(), y: t.any() },
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.n = 1;
      },
      derive: {
        x: (f: any, d: any) => {
          runs.x++;

          return [f.n, "y" in d, "x" in d];
        },
        y: (f: any, d: any) => {
          runs.y++;

          return [f.n, "x" in d];
        },
      },
    } as any);
    const system = createSystem({ module: mod }) as any;
    system.start?.();
    system.facts.n = 2;

    expect(system.read("x")).toEqual([2, true, true]);
    expect(system.read("y")).toEqual([2, true]);
    expect(runs).toEqual({ x: 2, y: 2 });
  });
});

describe("a derivation that loses its last reader", () => {
  // Every sequence asserted here is what the published 1.35 does with the same
  // module (probed side by side): a derivation keeps its cached value, and its
  // place in the invalidation walk, until it computes again. It does not
  // matter who stops reading it.
  function make(derive: Record<string, (f: any, d: any) => number>) {
    const log: string[] = [];
    const runs = { d1: 0 };
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { d0: t.number(), d1: t.number(), d2: t.number() },
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.a = 0;
        f.b = 0;
      },
      derive: {
        ...derive,
        d1: (f: any, d: any) => {
          runs.d1++;

          return derive.d1!(f, d);
        },
      },
    } as any);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "log",
          onDerivationCompute: (id: string) => log.push(`compute ${id}`),
          onDerivationInvalidate: (id: string) => log.push(`invalidate ${id}`),
        },
      ],
    } as any) as any;
    system.start?.();
    system.subscribe(["d1"], () => log.push("notify d1"));

    return { system, log, runs };
  }

  it("is not run again after the reader that held it threw before reaching it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { system, log, runs } = make({
      d0: (f) => {
        if (f.a === 1) {
          throw new Error("boom");
        }

        return f.a;
      },
      d1: (f) => f.b,
      // Reads d0, which throws, so it never gets to d1.
      d2: (_f, d) => d.d0 + d.d1,
    });
    expect(system.read("d2")).toBe(0);
    system.facts.a = 1;
    expect(() => system.read("d2")).toThrow("boom");
    log.length = 0;

    expect(system.read("d1")).toBe(0);
    expect(log).toEqual([]);
    expect(runs.d1).toBe(1);

    // It is still wired to its fact: a write reaches its subscribers.
    system.facts.b = 5;
    expect(log).toEqual(["invalidate d1", "notify d1"]);
    expect(system.read("d1")).toBe(5);
    expect(runs.d1).toBe(2);
  });

  it("still hears about a write after its only reader stopped reading it", () => {
    const { system, log, runs } = make({
      d0: (f) => f.a,
      d1: (f) => f.b,
      // Reads d1 only while a is 0.
      d2: (_f, d) => (d.d0 === 0 ? d.d1 : -1),
    });
    expect(system.read("d2")).toBe(0);
    system.facts.a = 1;
    expect(system.read("d2")).toBe(-1);
    log.length = 0;

    expect(system.read("d1")).toBe(0);
    expect(log).toEqual([]);
    expect(runs.d1).toBe(1);

    system.facts.b = 5;
    expect(log).toEqual(["invalidate d1", "notify d1"]);
    expect(system.read("d1")).toBe(5);
    expect(runs.d1).toBe(2);
  });
});
