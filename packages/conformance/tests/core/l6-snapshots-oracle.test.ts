// Ported from packages/core/src/core/__tests__/l6-snapshots-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// L6 snapshots, restore and hydrate on 1.35, development build. Public API
// only. Each describe names the row of the L6 RFC's "Untested behaviours"
// table it pins (U1–U6, U14). Where an approved 2.0 change touches a row, only
// the part that change keeps is pinned here; the part it changes is a diff
// scenario, so the difference shows up as a named divergence.

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One module: a number, an array and a derivation that reads both. */
function counter() {
  return createModule("c", {
    schema: {
      facts: { n: t.number(), tags: t.array<string>() },
      derivations: { label: t.string() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.tags = ["a"];
    },
    derive: { label: (facts: any) => `${facts.n}/${facts.tags.length}` },
    events: {},
  } as any);
}

describe("a snapshot copies one level (U1)", () => {
  it("is the facts and version 1, and a scalar changed on it stays on it", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    const snapshot = system.getSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual(["facts", "version"]);
    expect(snapshot.version).toBe(1);
    expect(snapshot.facts.n).toBe(0);
    snapshot.facts.n = 99;
    expect(system.facts.n).toBe(0);
  });

  it("shares its nested values with the live facts, and nothing hears a change made through it", async () => {
    const heard: string[] = [];
    const system: any = createSystem({
      module: counter(),
      plugins: [
        {
          name: "spy",
          onFactSet: (key: string) => heard.push(`set:${key}`),
          onFactsBatch: () => heard.push("batch"),
        },
      ],
    });
    system.start();
    await tick();
    heard.length = 0;
    const snapshot = system.getSnapshot();
    snapshot.facts.tags.push("from-snapshot");
    await tick();
    expect([...system.facts.tags]).toEqual(["a", "from-snapshot"]);
    expect(heard).toEqual([]);
  });
});

describe("restore() reads only snapshot.facts (U3)", () => {
  it("restores the facts of an envelope and ignores every other field", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    system.restore({
      v: 2,
      schemaHash: "abc",
      schema: { c: 1 },
      version: 7,
      facts: { n: 3 },
    });
    expect(system.facts.n).toBe(3);
    expect([...system.facts.tags]).toEqual(["a"]);
    expect(Object.keys(system.getSnapshot().facts).sort()).toEqual([
      "n",
      "tags",
    ]);
  });
});

describe("restore() and the module init (U4)", () => {
  it("made before the system is initialized is overwritten by the init at start()", () => {
    const system: any = createSystem({ module: counter() });
    system.restore({ facts: { n: 9 } });
    expect(system.facts.n).toBe(9);
    system.start();
    expect(system.facts.n).toBe(0);
  });

  it("made after initialize() and before start() is kept", async () => {
    const system: any = createSystem({ module: counter() });
    system.initialize();
    expect(system.facts.n).toBe(0);
    system.restore({ facts: { n: 9 } });
    system.start();
    await tick();
    expect(system.facts.n).toBe(9);
  });

  it("made after destroy() still writes, and does not throw", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    system.destroy();
    expect(() => system.restore({ facts: { n: 4 } })).not.toThrow();
    expect(system.facts.n).toBe(4);
  });
});

describe("restore() checks each key in development (U2)", () => {
  // Which keys are already written when it throws is (ag), a diff scenario.
  it("throws naming an unknown key", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    expect(() =>
      system.restore({ facts: { n: 5, bogus: 1, tags: ["x"] } }),
    ).toThrow(/bogus/);
  });

  it("throws naming a key whose value fails its type", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    expect(() =>
      system.restore({ facts: { n: 7, tags: "not-an-array" } }),
    ).toThrow(/tags/);
  });
});

describe("restore() refuses a bad snapshot and writes nothing (U14)", () => {
  it("that is not an object, even one carrying a facts object", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    expect(() => system.restore(null)).toThrow(/valid snapshot object/);
    expect(() => system.restore("x")).toThrow(/valid snapshot object/);
    const carrier = Object.assign(() => undefined, { facts: { n: 5 } });
    expect(() => system.restore(carrier)).toThrow(/valid snapshot object/);
    expect(system.facts.n).toBe(0);
  });

  it("whose facts is missing or not an object", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    expect(() => system.restore({})).toThrow(/facts object/);
    expect(() => system.restore({ facts: null })).toThrow(/facts object/);
    expect(() => system.restore({ facts: "abc" })).toThrow(/facts object/);
    expect(Object.keys(system.getSnapshot().facts).sort()).toEqual([
      "n",
      "tags",
    ]);
  });

  it("that holds a prototype-polluting key, at any depth", () => {
    const system: any = createSystem({ module: counter() });
    system.start();
    const nested = JSON.parse('{"facts":{"n":5,"o":{"__proto__":{"x":1}}}}');
    expect(() => system.restore(nested)).toThrow(/dangerous keys/);
    const top = JSON.parse('{"facts":{"n":6,"__proto__":{"x":1}}}');
    expect(() => system.restore(top)).toThrow(/dangerous keys/);
    const ctor = JSON.parse('{"facts":{"n":7,"constructor":{"x":1}}}');
    expect(() => system.restore(ctor)).toThrow(/dangerous keys/);
    expect(system.facts.n).toBe(0);
    expect(({} as any).x).toBeUndefined();
  });
});

describe("restore() writes one batch, filed as loaded data (U14)", () => {
  it("plugins hear one onFactsBatch of hydrate writes, no onFactSet and no onSnapshot; derivations and effects follow", async () => {
    const heard: string[] = [];
    const origins: string[] = [];
    const seen: number[] = [];
    const module = createModule("c", {
      schema: {
        facts: { n: t.number(), tags: t.array<string>() },
        derivations: { label: t.string() },
        events: {},
        requirements: {},
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.tags = ["a"];
      },
      derive: { label: (facts: any) => `${facts.n}/${facts.tags.length}` },
      effects: {
        mirror: {
          run: (facts: any) => {
            seen.push(facts.n);
          },
        },
      },
      events: {},
    } as any);
    const system: any = createSystem({
      module,
      plugins: [
        {
          name: "spy",
          onFactSet: (key: string) => heard.push(`set:${key}`),
          onFactsBatch: (changes: Array<{ key: string; origin: string }>) => {
            heard.push(`batch:${changes.map((c) => c.key).join(",")}`);
            origins.push(...changes.map((c) => c.origin));
          },
          onSnapshot: () => heard.push("snapshot"),
        },
      ],
    });
    system.start();
    await tick();
    expect(system.derive.label).toBe("0/1");
    heard.length = 0;
    origins.length = 0;
    seen.length = 0;
    system.restore({ facts: { n: 3, tags: ["x", "y"] } });
    expect(heard).toEqual(["batch:n,tags"]);
    expect(origins).toEqual(["hydrate", "hydrate"]);
    expect(system.derive.label).toBe("3/2");
    await tick();
    expect(seen).toEqual([3]);
  });
});

describe("hydrate() (U5, U6)", () => {
  it("an awaited loader is applied at start", async () => {
    const system: any = createSystem({ module: counter() });
    await system.hydrate(async () => ({ n: 11 }));
    system.start();
    expect(system.facts.n).toBe(11);
  });

  it("a loader still pending at start() is never applied, not even after a stop and start (U5)", async () => {
    const system: any = createSystem({ module: counter() });
    const pending = system.hydrate(async () => ({ n: 11 }));
    system.start();
    await pending;
    await tick();
    expect(system.facts.n).toBe(0);
    system.stop();
    system.start();
    await tick();
    expect(system.facts.n).toBe(0);
  });

  it("a loader still pending at initialize() is never applied (U5)", async () => {
    const system: any = createSystem({ module: counter() });
    const pending = system.hydrate(async () => ({ n: 11 }));
    system.initialize();
    await pending;
    system.start();
    await tick();
    expect(system.facts.n).toBe(0);
  });

  it("a namespaced snapshot has flat keys: restore() takes them, hydrate() loads none (U6)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const make = (): any => createSystem({ modules: { c: counter() } });
    const source = make();
    source.start();
    source.facts.c.n = 42;
    const snapshot = source.getSnapshot();
    expect(Object.keys(snapshot.facts).sort()).toEqual(["c::n", "c::tags"]);

    const hydrated = make();
    await hydrated.hydrate(() => snapshot.facts);
    hydrated.start();
    expect(hydrated.facts.c.n).toBe(0);

    const restored = make();
    restored.start();
    restored.restore(snapshot);
    expect(restored.facts.c.n).toBe(42);
  });
});
