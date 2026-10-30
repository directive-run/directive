// Ported from packages/core/src/core/__tests__/l8-system-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The later-feature options of createSystem (history L8, hydrate() L6) in
// production: what is asked for is kept, nothing is switched on by itself,
// and the development-only diagnostics stay silent
// (l8-system-oracle.test.ts is the development side).

afterEach(() => {
  vi.restoreAllMocks();
});

function counter(id: string) {
  return createModule(id, {
    schema: {
      facts: { count: t.number() },
      derivations: {},
      events: { inc: {} },
      requirements: {},
    },
    init: (facts: any) => {
      facts.count = 0;
    },
    events: {
      inc: (facts: any) => {
        facts.count += 1;
      },
    },
  } as never);
}

describe("history and hydrate() in production", () => {
  function historyOn(options: object): boolean {
    const system = createSystem({
      module: counter("c"),
      ...options,
    } as never) as any;
    system.start();
    const on = Boolean(system.history);
    system.destroy();

    return on;
  }

  it("zeroConfig keeps a history that was asked for, and does not turn one on by itself", () => {
    expect(historyOn({ zeroConfig: true, history: true })).toBe(true);
    expect(historyOn({ zeroConfig: true })).toBe(false);
    expect(historyOn({ history: true })).toBe(true);
  });

  it("hydrated data carrying a prototype-pollution key is skipped whole, quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({
      module: counter("c"),
      initialFacts: { count: 5 },
    } as never) as any;
    await system.hydrate(async () =>
      JSON.parse('{"count":9,"__proto__":{"polluted":true}}'),
    );
    system.start();

    expect(system.facts.count).toBe(5);
    expect(({} as any).polluted).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    system.destroy();
  });
});
