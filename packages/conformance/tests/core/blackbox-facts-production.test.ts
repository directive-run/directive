// Ported from packages/core/src/core/__tests__/blackbox-facts-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// biome-ignore lint/suspicious/noExplicitAny: facts are driven dynamically on purpose
type Any = any;

async function start(facts: Record<string, unknown>) {
  const mod = createModule("m", {
    schema: { facts: facts as Any },
    init: () => {},
  });
  const system = createSystem({ module: mod }) as Any;
  await system.start();

  return system;
}

describe("facts in production", () => {
  it("does not validate values", async () => {
    const system = await start({ n: t.number() });

    expect(() => {
      system.facts.n = "not a number";
    }).not.toThrow();
    expect(system.facts.n).toBe("not a number");
    await system.stop();
  });

  it("neither throws nor warns about unknown keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({ n: t.number() });

    expect(() => {
      system.facts.ghost = 1;
    }).not.toThrow();

    expect(system.facts.ghost).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    await system.stop();
  });

  it("does not warn about non-JSON values or nested mutation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await start({
      d: t.object<unknown>(),
      o: t.object<{ x: number }>(),
    });
    const original = { x: 1 };

    system.facts.d = new Date(1);
    system.facts.o = original;
    system.facts.o.x = 2;

    expect(warn).not.toHaveBeenCalled();
    expect(original.x).toBe(2);
    warn.mockRestore();
    await system.stop();
  });

  it("hands nested objects back as stored, and a Date stays a Date", async () => {
    const system = await start({
      d: t.object<unknown>(),
      o: t.object<{ x: number }>(),
    });
    const when = new Date(5);
    const stored = { x: 1 };

    system.facts.d = when;
    system.facts.o = stored;

    expect(system.facts.d).toBe(when);
    expect(system.facts.o).toBe(stored);
    expect(system.facts.d.getTime()).toBe(5);
    await system.stop();
  });

  it("still notifies, batches and deletes", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const fn = vi.fn();
    system.subscribe(["a"], fn);

    system.batch(() => {
      system.facts.a = 1;
      system.facts.a = 2;
      system.facts.b = 1;
    });
    delete system.facts.b;

    expect(fn).toHaveBeenCalledTimes(1);
    expect("b" in system.facts).toBe(false);
    expect(system.facts.$store.toObject()).toEqual({ a: 2 });
    await system.stop();
  });

  it("still ignores a write to a fact whose module was unregistered", async () => {
    const keep = createModule("keep", {
      schema: { facts: { k: t.number() } },
      init: () => {},
    });
    const gone = createModule("gone", {
      schema: { facts: { g: t.number() } },
      init: (f: Any) => {
        f.g = 1;
      },
    });
    const system = createSystem({ module: keep }) as Any;
    await system.start();
    system.registerModule(gone as never);
    const store = system.facts.$store;

    await system.unregisterModule("gone");
    store.set("g", 9);

    expect(store.has("g")).toBe(false);
    await system.stop();
  });
});
