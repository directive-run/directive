// Ported from packages/core/src/core/__tests__/l8-system-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for what createSystem does with the options of later
// features: history (L8) and hydrate() (L6). They sit apart from
// l3-system-oracle.test.ts, which keeps every test at L3, and they exist
// because the lines of system.ts that read those options are reached only
// through them. Public API only; a warning is asserted by whether it fires,
// never by what it says.

afterEach(() => {
  vi.restoreAllMocks();
});

/** A module with one numeric fact, starting at 0. */
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

function quietWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("zeroConfig and history", () => {
  /** Starts a system, reads whether history is on, and shuts it down. */
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

  it("turns history on in development when none is asked for, and leaves an explicit false alone", () => {
    quietWarn();

    expect(historyOn({})).toBe(false);
    expect(historyOn({ zeroConfig: true })).toBe(true);
    expect(historyOn({ zeroConfig: true, history: true })).toBe(true);
    expect(historyOn({ zeroConfig: true, history: false })).toBe(false);
  });
});

describe("history.snapshotModules in a namespaced system", () => {
  it("is quiet for entries that name a module of the system, and warns once for one that names none", () => {
    const warn = quietWarn();
    const known = createSystem({
      modules: { a: counter("a"), b: counter("b") },
      history: { snapshotModules: ["a", "b"] },
    } as never) as any;
    known.start();

    expect(warn).not.toHaveBeenCalled();

    const mixed = createSystem({
      modules: { a: counter("a") },
      history: { snapshotModules: ["a", "ghost"] },
    } as never) as any;
    mixed.start();

    expect(warn).toHaveBeenCalledTimes(1);

    known.destroy();
    mixed.destroy();
  });
});

describe("hydrate() data in a single-module system", () => {
  async function hydrated(data: string) {
    const system = createSystem({
      module: counter("c"),
      initialFacts: { count: 5 },
    } as never) as any;
    await system.hydrate(async () => JSON.parse(data));
    system.start();

    return system;
  }

  it("is applied over initialFacts when it is clean", async () => {
    quietWarn();
    const system = await hydrated('{"count":9}');

    expect(system.facts.count).toBe(9);

    system.destroy();
  });

  it("carrying a prototype-pollution key is skipped whole, with a warning in development", async () => {
    const warn = quietWarn();
    const system = await hydrated('{"count":9,"__proto__":{"polluted":true}}');

    expect(system.facts.count).toBe(5);
    expect(({} as any).polluted).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});
