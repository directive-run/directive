/**
 * L6a: `restore()` (RFC L6 rows S2–S7, decisions (ag) and (ah)), pinned on
 * core-next in both modes. 1.35 parity in production; in development a
 * restore that throws writes nothing (ag), and a restore before
 * `initialize()` or a `hydrate()` still pending at `initialize()` warns
 * once (ah). The black-box oracle is in packages/conformance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Mode = "development" | "production";

export function restoreCases(lib: any, mode: Mode): void {
  const { createModule, createSystem, createSystemCore, t } = lib;
  const dev = mode === "development";
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const counter = () =>
    createModule("c", {
      schema: {
        facts: { n: t.number(), tags: t.array() },
        derivations: { label: t.string() },
        events: {},
        requirements: {},
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.tags = [];
      },
      derive: { label: (facts: any) => `${facts.n}/${facts.tags.length}` },
      events: {},
    });
  const spy = (heard: string[]) => ({
    name: "spy",
    onFactSet: (key: string) => heard.push(`set:${key}`),
    onFactsBatch: (changes: { key: string; origin: string }[]) =>
      heard.push(
        `batch:${changes.map((c) => `${c.key}/${c.origin}`).join(",")}`,
      ),
    onSnapshot: () => heard.push("snapshot"),
  });
  let warn: ReturnType<typeof vi.spyOn>;
  const warned = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe(`restore() (${mode})`, () => {
    it("writes snapshot.facts in one hydrate batch and nothing else", async () => {
      const heard: string[] = [];
      const system = createSystem({ module: counter(), plugins: [spy(heard)] });
      system.start();
      await tick();
      heard.length = 0;
      system.restore({ v: 2, version: 9, facts: { n: 3, tags: ["x"] } });
      expect(heard).toEqual(["batch:n/hydrate,tags/hydrate"]);
      expect(system.derive.label).toBe("3/1");
      expect(Object.keys(system.getSnapshot().facts).sort()).toEqual([
        "n",
        "tags",
      ]);
    });

    it("throws its three errors in both modes, writing nothing", () => {
      const system = createSystem({ module: counter() });
      system.start();
      expect(() => system.restore(null)).toThrow(
        "[Directive] restore() requires a valid snapshot object",
      );
      expect(() => system.restore({ facts: 1 })).toThrow(
        "[Directive] restore() snapshot must have a facts object",
      );
      expect(() =>
        system.restore(JSON.parse('{"facts":{"n":{"__proto__":{"x":1}}}}')),
      ).toThrow(/rejected: snapshot contains potentially dangerous keys/);
      expect(system.facts.n).toBe(0);
    });

    it(dev
      ? "checks every key before writing: a throwing restore writes nothing (ag)"
      : "writes an unknown key and a bad value unchecked, as 1.35", async () => {
      const heard: string[] = [];
      const system = createSystem({
        module: counter(),
        plugins: [spy(heard)],
      });
      system.start();
      await tick();
      heard.length = 0;
      const unknown = () =>
        system.restore({ facts: { n: 5, bogus: 1, tags: ["x"] } });
      const badValue = () =>
        system.restore({ facts: { n: 7, tags: "not-an-array" } });
      if (dev) {
        expect(unknown).toThrow('Unknown fact key: "bogus"');
        expect(badValue).toThrow(/Validation failed for "tags"/);
        expect([system.facts.n, system.derive.label, heard]).toEqual([
          0,
          "0/0",
          [],
        ]);
      } else {
        unknown();
        expect(system.getSnapshot().facts.bogus).toBe(1);
        badValue();
        expect(system.getSnapshot().facts.tags).toBe("not-an-array");
        expect(system.facts.n).toBe(7);
      }
    });

    it("takes a namespaced snapshot's flat keys, and (ag) holds there too", () => {
      const heard: string[] = [];
      const source = createSystem({ modules: { c: counter() } });
      source.start();
      source.facts.c.n = 42;
      const target = createSystem({
        modules: { c: counter() },
        plugins: [spy(heard)],
      });
      target.start();
      heard.length = 0;
      target.restore(source.getSnapshot());
      expect(heard).toEqual(["batch:c::n/hydrate,c::tags/hydrate"]);
      expect(target.facts.c.n).toBe(42);
      const bad = () => target.restore({ facts: { "c::n": 1, "c::bogus": 2 } });
      if (dev) {
        expect(bad).toThrow('Unknown fact key: "c::bogus"');
        expect(target.facts.c.n).toBe(42);
      } else {
        bad();
        expect(target.facts.c.n).toBe(1);
      }
    });

    it("an empty schema warns per unknown key once, as 1.35, and writes it", () => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = createSystem({
        module: createModule("e", {
          schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
        }),
      });
      system.start();
      system.restore({ facts: { z: 1 } });
      expect(system.getSnapshot().facts.z).toBe(1);
      expect(warned()).toEqual(
        dev ? ['[Directive] Unknown fact key: "z"'] : [],
      );
    });

    it("is not on the system core", () => {
      expect(createSystemCore({ module: counter() }).restore).toBeUndefined();
    });
  });

  describe(`(ah) warnings (${mode})`, () => {
    const before = /restore\(\) was called before initialize\(\)/;
    const pending = /initialize\(\) ran while a hydrate\(\) loader/;

    it("a restore before initialize() warns once; the init still wins", () => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = createSystem({ module: counter() });
      system.restore({ facts: { n: 9 } });
      system.restore({ facts: { n: 9 } });
      system.start();
      expect(system.facts.n).toBe(0);
      const hits = warned().filter((m: string) => before.test(m));
      expect(hits).toHaveLength(dev ? 1 : 0);
    });

    it("the lab's order (initialize, restore, start) keeps the value and does not warn", async () => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = createSystem({ module: counter() });
      system.initialize();
      system.restore({ facts: { n: 9 } });
      system.start();
      await tick();
      expect(system.facts.n).toBe(9);
      expect(warned()).toEqual([]);
    });

    it("a hydrate() still pending at initialize() warns once and is dropped", async () => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = createSystem({ module: counter() });
      const loading = system.hydrate(async () => ({ n: 11 }));
      system.initialize();
      await loading;
      system.start();
      expect(system.facts.n).toBe(0);
      const hits = warned().filter((m: string) => pending.test(m));
      expect(hits).toHaveLength(dev ? 1 : 0);
    });

    it("an awaited, a settled-in-time or a rejected hydrate() does not warn", async () => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const awaited = createSystem({ module: counter() });
      await awaited.hydrate(async () => ({ n: 11 }));
      awaited.start();
      expect(awaited.facts.n).toBe(11);
      // A sync loader has settled one microtask later, before this initialize.
      const inTime = createSystem({ module: counter() });
      const loading = inTime.hydrate(() => ({ n: 12 }));
      await Promise.resolve();
      inTime.initialize();
      await loading;
      expect(inTime.facts.n).toBe(12);
      const rejected = createSystem({ module: counter() });
      await expect(
        rejected.hydrate(async () => {
          throw new Error("load failed");
        }),
      ).rejects.toThrow("load failed");
      rejected.start();
      expect(warned()).toEqual([]);
    });
  });
}
