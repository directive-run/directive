// Ported from packages/core/src/core/__tests__/l3-system-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The development-only diagnostics of createSystem stay silent in production.
// Each case below warns when the same system is built in development
// (l3-system-oracle.test.ts); here none of them may.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const dep = {
  facts: { count: { _type: 0 } },
  derivations: {},
  events: {},
  requirements: {},
};

function counter(
  id: string,
  opts: { tick?: boolean; deps?: Record<string, unknown> } = {},
) {
  return createModule(id, {
    schema: {
      facts: { count: t.number() },
      derivations: {},
      events: { inc: {}, ...(opts.tick ? { tick: {} } : {}) },
      requirements: {},
    },
    init: (facts: any) => {
      facts.count = 0;
    },
    events: {
      inc: (facts: any) => {
        facts.count += 1;
      },
      ...(opts.tick
        ? {
            tick: (facts: any) => {
              facts.count += 1;
            },
          }
        : {}),
    },
    ...(opts.deps ? { crossModuleDeps: opts.deps } : {}),
  } as never);
}

describe("createSystem diagnostics in production", () => {
  it("a dependency on a module that does not exist, or on itself, is not reported", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSystem({
      modules: {
        a: counter("a", { deps: { ghost: dep } }),
        b: counter("b", { deps: { b: dep } }),
      },
      initOrder: "declaration",
    } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("tickMs with no tick handler is not reported, single or namespaced", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSystem({ module: counter("c"), tickMs: 100 } as never);
    createSystem({ modules: { c: counter("c") }, tickMs: 100 } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("crossModuleDeps ignored by a single module are not reported", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSystem({
      module: counter("c", { deps: { other: dep } }),
    } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("initialFacts for an unknown or blocked namespace are dropped without a report", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({
      modules: { a: counter("a") },
      initialFacts: JSON.parse(
        '{"__proto__":{"count":1},"ghost":{"count":2},"a":{"count":5}}',
      ),
    } as never) as any;
    system.start();

    expect(system.facts.a.count).toBe(5);
    expect(warn).not.toHaveBeenCalled();

    system.destroy();
  });

  it("a system that is never started is not reported", () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const single = createSystem({ module: counter("c") } as never);
    const named = createSystem({ modules: { c: counter("c") } } as never);
    vi.runOnlyPendingTimers();

    expect(warn).not.toHaveBeenCalled();

    single.destroy();
    named.destroy();
  });
});
