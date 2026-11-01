// Ported from packages/core/src/core/__tests__/nested-mutation-snapshot.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The in-place mutation check records what was read by reference and own
 * property descriptors, never by copying. A copy turned class instances into
 * plain objects (a false "changed in place" that closed gates in development),
 * ran getters, and cost a full structured clone of every value a gate read.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

class Money {
  constructor(public amount: number) {}
  get doubled(): number {
    return this.amount * 2;
  }
}

function gatedModule(
  init: (facts: Record<string, any>) => void,
  gate: (facts: Record<string, any>) => boolean,
  attached: string[],
) {
  return createModule("m", {
    schema: { facts: { filter: t.object<any>(), n: t.number() } },
    init: (facts) => {
      init(facts as Record<string, any>);
      facts.n = 0;
    },
    sources: {
      feed: {
        active: gate,
        attach: () => {
          attached.push("feed");

          return () => undefined;
        },
      },
    },
  });
}

describe("reading class instances", () => {
  it("a gate reading a fact that holds a class instance attaches", async () => {
    const attached: string[] = [];
    const system = createSystem({
      module: gatedModule(
        (facts) => {
          facts.filter = {
            ticker: "A",
            min: new Money(5),
            list: [new Money(1)],
            byId: new Map([["x", new Money(2)]]),
          };
        },
        (facts) => facts.filter.ticker === "A",
        attached,
      ),
    });
    system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();

    expect(attached).toEqual(["feed"]);
    expect(
      system.inspect().sources.find((s) => s.id === "feed")!.lastError,
    ).toBeNull();
    system.destroy();
  });

  it("a class instance's own field changed in place is still reported", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const attached: string[] = [];
    const system = createSystem({
      module: gatedModule(
        (facts) => {
          facts.filter = { min: new Money(5) };
        },
        (facts) => {
          facts.filter.min.amount += 1;

          return true;
        },
        attached,
      ),
    });
    system.start();
    await system.settle();

    expect(attached).toEqual([]);
    const row = system.inspect().sources.find((s) => s.id === "feed")!;
    expect(row.lastError?.message).toContain("filter.min.amount");
    system.destroy();
  });

  it("never runs a getter while recording", async () => {
    let calls = 0;
    const attached: string[] = [];
    const system = createSystem({
      module: gatedModule(
        (facts) => {
          const value = { ticker: "A" } as Record<string, unknown>;
          Object.defineProperty(value, "lazy", {
            enumerable: true,
            get: () => {
              calls++;

              return 1;
            },
          });
          facts.filter = value;
        },
        (facts) => facts.filter.ticker === "A",
        attached,
      ),
    });
    system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();

    expect(attached).toEqual(["feed"]);
    expect(calls).toBe(0);
    system.destroy();
  });
});

describe("cost", () => {
  it("a gate reading a large value stays cheap per write", async () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: i, v: i }));
    const attached: string[] = [];
    const system = createSystem({
      module: gatedModule(
        (facts) => {
          facts.filter = { rows };
        },
        (facts) => facts.filter.rows.length > 0,
        attached,
      ),
    });
    system.start();
    await system.settle();
    // The cost per write is measured over several rounds of writes and the
    // figure compared is the *fastest* round. A single round lets one burst of
    // contention from other work on the machine land in the one figure and push
    // it past the threshold — under parallel load the one-round version failed
    // now and then although nothing in the check had changed. Contention only
    // ever adds time, so the fastest round is the one least disturbed. A check
    // that walks the 10k rows makes every write slower, so it still moves the
    // minimum.
    const rounds = 7;
    const writes = 50;
    let perWrite = Number.POSITIVE_INFINITY;
    let value = 0;
    for (let round = 0; round < rounds; round++) {
      const started = performance.now();
      for (let i = 1; i <= writes; i++) {
        system.facts.n = ++value;
        await system.settle();
      }
      perWrite = Math.min(perWrite, (performance.now() - started) / writes);
    }

    expect(attached).toEqual(["feed"]);
    // Not a walk of 10k rows per write: the check gives up past its budget.
    expect(perWrite).toBeLessThan(0.5);
    system.destroy();
  });
});

describe("a gate that fails closed", () => {
  it("warns once in development when nothing else is listening", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const attached: string[] = [];
    const system = createSystem({
      module: gatedModule(
        (facts) => {
          facts.filter = {};
        },
        () => {
          throw new Error("gate boom");
        },
        attached,
      ),
    });
    system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();

    const messages = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => m.includes("gate boom"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"feed"');
    system.destroy();
  });
});
