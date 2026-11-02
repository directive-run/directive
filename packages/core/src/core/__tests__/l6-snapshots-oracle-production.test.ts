import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");
const { persistencePlugin } = await import("../../plugins/index.js");

// The production halves of the L6 pins (L6 RFC, "Untested behaviours" U1,
// U2, U8, U11, U12, U14). Production checks nothing a restore writes, keeps
// restore()'s three errors, and reads a Date fact as a Date. Public API only.

afterEach(() => {
  vi.restoreAllMocks();
});

function counter() {
  return createModule("c", {
    schema: {
      facts: { n: t.number(), tags: t.array<string>() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.tags = ["a"];
    },
    derive: {},
    events: {},
  } as any);
}

describe("restore() in production", () => {
  it("writes an unknown key and an ill-typed value unchecked (U2)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system: any = createSystem({ module: counter() });
    system.start();
    system.restore({ facts: { n: 5, bogus: 1, tags: ["x"] } });
    expect(system.facts.n).toBe(5);
    expect([...system.facts.tags]).toEqual(["x"]);
    expect(system.getSnapshot().facts.bogus).toBe(1);
    system.restore({ facts: { tags: "not-an-array" } });
    expect(system.facts.tags).toBe("not-an-array");
    expect(warn).not.toHaveBeenCalled();
  });

  it("still throws its three errors, and writes nothing (U14)", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    const carrier = Object.assign(() => undefined, { facts: { n: 5 } });
    expect(() => system.restore(carrier)).toThrow(/valid snapshot object/);
    expect(() => system.restore({ facts: "abc" })).toThrow(/facts object/);
    const nested = JSON.parse('{"facts":{"n":5,"o":{"__proto__":{"x":1}}}}');
    expect(() => system.restore(nested)).toThrow(/dangerous keys/);
    expect(system.facts.n).toBe(0);
    expect(Object.keys(system.getSnapshot().facts).sort()).toEqual([
      "n",
      "tags",
    ]);
  });
});

describe("a snapshot in production (U1)", () => {
  it("shares its nested values with the live facts", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    const snapshot = system.getSnapshot();
    snapshot.facts.tags.push("from-snapshot");
    expect([...system.facts.tags]).toEqual(["a", "from-snapshot"]);
    expect(snapshot.facts.tags).toBe(system.facts.tags);
  });
});

describe("the t.* corners in production (U11, U12)", () => {
  it("a refine and a type check do not run", () => {
    const system: any = createSystem({
      module: createModule("m", {
        schema: {
          facts: {
            c: t.number().refine((n: number) => n % 2 === 0, "must be even"),
            flag: t
              .boolean()
              .refine((v: boolean) => v === true, "must be true"),
            v: t.number().default(5),
          },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.c = 2;
          facts.flag = true;
        },
        derive: {},
        events: {},
      } as any),
    });
    system.start();
    system.facts.c = 3;
    system.facts.flag = false;
    expect(system.facts.c).toBe(3);
    expect(system.facts.flag).toBe(false);
    // Whether .default() fills v is row (al): 1.35 never applies a default,
    // in either build (it has no code that would), and 2.0 does. Not pinned
    // here; the diff scenarios "a .default(): a fact init leaves alone, one a
    // ??= init sets, one it sets to undefined (U11)" and "a .default() with
    // initialFacts: one they give, one they leave out (U11)" record the
    // difference (the diff runs development builds), and the L6 gate signs it.
    expect(Object.keys(system.getSnapshot().facts)).toEqual(
      expect.arrayContaining(["c", "flag"]),
    );
  });
});

describe("a Date fact in production (U8)", () => {
  it("reads as a Date, and the persistence plugin saves it as an ISO string", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    } as unknown as Storage;
    const system: any = createSystem({
      module: createModule("m", {
        schema: {
          facts: { when: t.date() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: () => {},
        derive: {},
        events: {},
      } as any),
      plugins: [persistencePlugin({ storage, key: "k", debounce: 0 })],
    });
    system.start();
    system.facts.when = new Date(5);
    expect(system.facts.when.getTime()).toBe(5);
    system.destroy();
    expect(JSON.parse(map.get("k") as string)).toEqual({
      when: "1970-01-01T00:00:00.005Z",
    });
  });
});
