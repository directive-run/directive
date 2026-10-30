import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests (L0): when a subscriber to a derivation is told, and how
// notifications are delivered. Facts, derivations, subscribe and read only;
// no plugins, constraints, effect deps or runtime registration.

function build(derive: Record<string, any>) {
  const derivations: Record<string, any> = {};
  for (const k of Object.keys(derive)) {
    derivations[k] = t.any();
  }
  const mod = createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number() },
      derivations,
    } as never,
    init: (f: any) => {
      f.a = 1;
      f.b = 2;
    },
    derive: derive as never,
  });
  const system = createSystem({ module: mod } as never) as any;
  system.start();

  return system;
}

describe("telling a subscriber a derivation moved", () => {
  it("is done once per fresh-to-stale change, however many writes follow before it is read", () => {
    const system = build({
      sum: (f: any) => f.a + f.b,
      doubled: (_f: any, d: any) => d.sum * 2,
    });
    void system.derive.doubled;
    const heard: string[] = [];
    // Neither listener reads, so both derivations stay stale after a write.
    system.subscribe(["sum"], () => {
      heard.push("sum");
    });
    system.subscribe(["doubled"], () => {
      heard.push("doubled");
    });

    system.facts.a = 10;
    expect(heard.slice().sort()).toEqual(["doubled", "sum"]);
    heard.length = 0;

    // Both are still stale: there is no new change to announce.
    system.facts.b = 20;
    system.facts.a = 11;
    expect(heard).toEqual([]);

    // Reading makes them fresh, and the next write is a new change.
    expect(system.derive.doubled).toBe(62);
    system.facts.a = 12;
    expect(heard.slice().sort()).toEqual(["doubled", "sum"]);
    expect(system.derive.doubled).toBe(64);
  });

  it("reaches a subscriber to the end of a chain only when the chain was fresh", () => {
    const system = build({
      one: (f: any) => f.a + 1,
      two: (_f: any, d: any) => d.one + 1,
      three: (_f: any, d: any) => d.two + 1,
    });
    void system.derive.three;
    let heard = 0;
    system.subscribe(["three"], () => {
      heard++;
    });

    system.facts.a = 5;
    expect(heard).toBe(1);
    system.facts.a = 6;
    expect(heard).toBe(1);
    expect(system.read("three")).toBe(9);
    system.facts.a = 7;
    expect(heard).toBe(2);
  });

  it("never re-enters a listener: a batch it commits is announced after it returns", () => {
    const system = build({ sum: (f: any) => f.a + f.b });
    void system.derive.sum;
    let running = 0;
    let deepest = 0;
    let calls = 0;
    system.subscribe(["sum"], () => {
      calls++;
      running++;
      deepest = Math.max(deepest, running);
      // Fresh again, so the batch below is a new change to announce.
      void system.derive.sum;
      if (calls === 1) {
        system.batch(() => {
          system.facts.b = 50;
        });
      }
      running--;
    });

    system.facts.a = 2;

    expect(calls).toBe(2);
    expect(deepest).toBe(1);
    expect(system.derive.sum).toBe(52);
  });

  it("stops a listener that keeps making its own derivation stale, and drops what was queued", () => {
    const system = build({ sum: (f: any) => f.a + f.b });
    void system.derive.sum;
    const runaway = 10_000;
    let looping = true;
    let calls = 0;
    system.subscribe(["sum"], () => {
      calls++;
      // Fresh again, so each batch below is a new change to announce. The
      // cap is the test's own, so an engine that never stops this still ends.
      void system.derive.sum;
      if (looping && calls < runaway) {
        system.batch(() => {
          system.facts.a = system.facts.a + 1;
        });
      }
    });

    let error: unknown;
    try {
      system.facts.b = 5;
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(runaway);

    // The derivation is stale and the announcement the stopped pass had
    // queued is gone: a later write does not deliver it.
    const stopped = calls;
    looping = false;
    system.facts.b = 7;
    expect(calls).toBe(stopped);
    expect(system.derive.sum).toBe(system.facts.a + 7);
  });
});
