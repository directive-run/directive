// Ported from packages/core/src/core/__tests__/l12-plugins-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The production halves of the L12 RFC's U3 and U4 (l12-plugins-pins-
// oracle): the same snapshots and the same no-op watch, with no warning.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function logged(): number {
  return (
    vi.mocked(console.warn).mock.calls.length +
    vi.mocked(console.error).mock.calls.length
  );
}

function acct() {
  return createModule("acct", {
    schema: {
      facts: { name: t.string(), count: t.number(), plan: t.string() },
      derivations: { display: t.string(), boom: t.number(), none: t.any() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.name = "Ada";
      facts.count = 1;
      facts.plan = "free";
    },
    derive: {
      display: (facts: any) => `${facts.name} (${facts.count})`,
      boom: (facts: any) => {
        if (facts.count > 1) {
          throw new Error("boom");
        }

        return facts.count;
      },
      none: () => undefined,
    },
  } as never);
}

function started(): any {
  const system = createSystem({ module: acct() } as never) as any;
  system.start();

  return system;
}

describe("L12 probe pins (production)", () => {
  it("U3: a watch with nothing to watch returns a no-op, never calls and is silent", async () => {
    const system = started();
    const calls: unknown[] = [];
    const stop = system.watchDistributableSnapshot(
      { includeDerivations: [] },
      (snapshot: unknown) => calls.push(snapshot),
    );

    expect(typeof stop).toBe("function");
    system.facts.count = 5;
    await wait();
    expect(calls).toEqual([]);
    expect(logged()).toBe(0);
    stop();
    system.destroy();
  });

  it("U4: unknown keys are ignored silently", () => {
    const system = started();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display", "nope"],
      includeFacts: ["count", "missing"],
    });

    expect(snapshot.data).toEqual({ display: "Ada (1)", count: 1 });
    expect(logged()).toBe(0);
    system.destroy();
  });

  it("U4: a throwing derivation is left out silently", () => {
    const system = started();
    system.facts.count = 2;
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display", "boom"],
    });

    expect(snapshot.data).toEqual({ display: "Ada (2)" });
    expect(logged()).toBe(0);
    system.destroy();
  });

  it("U4: namespaced keys nest under their module", () => {
    const system = createSystem({ modules: { a: acct() } } as never) as any;
    system.start();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["a.display"],
      includeFacts: ["a.count"],
    });

    expect(snapshot.data).toEqual({ a: { display: "Ada (1)", count: 1 } });
    expect(logged()).toBe(0);
    system.destroy();
  });
});
