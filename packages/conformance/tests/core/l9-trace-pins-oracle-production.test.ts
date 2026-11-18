// Ported from packages/core/src/core/__tests__/l9-trace-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The production half of the L9 RFC's U7, U15 and U16. In production the
// 101st observer is still deaf and nothing says so (row bj, declined, keeps
// 1.35's silence), and a function-form `when` still has no data-form
// introspection. Public API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function counter() {
  return createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 0;
    },
  } as never);
}

describe("the 101st observer in production (U7; row bj, declined)", () => {
  it("hears nothing and nothing is printed; a freed place takes a new observer", async () => {
    const system = createSystem({ module: counter() } as never) as any;
    system.start();
    await system.settle();
    const offs = Array.from({ length: 100 }, () => system.observe(() => {}));
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const heard: string[] = [];
    const off = system.observe((event: any) => heard.push(event.type));

    expect(typeof off).toBe("function");
    system.facts.n = 1;
    await system.settle();
    expect(heard).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    offs[0]();
    const later: string[] = [];
    system.observe((event: any) => later.push(event.type));
    system.facts.n = 2;
    await system.settle();
    expect(later.length).toBeGreaterThan(0);
    system.destroy();
  });
});

/** The RFC's P21 module, function form. */
function lights() {
  return createModule("traffic", {
    schema: {
      facts: { phase: t.string(), elapsed: t.number() },
      derivations: {},
      events: {},
      requirements: { GO: {} },
    },
    init: (facts: any) => {
      facts.phase = "red";
      facts.elapsed = 0;
    },
    constraints: {
      go: {
        when: (facts: any) => facts.phase === "red" && facts.elapsed >= 30,
        require: { type: "GO" },
      },
    },
    resolvers: { go: { requirement: "GO", resolve: async () => {} } },
  } as never);
}

describe("a function-form when in production (U15, U16)", () => {
  it("has no whenSpec key, no whenExplain key and no Predicate clauses section", async () => {
    const system = createSystem({ module: lights() } as never) as any;
    const events: Record<string, unknown>[] = [];
    system.observe((event: any) => {
      if (event.type === "constraint.evaluate") {
        events.push(event);
      }
    });
    system.start();
    system.facts.elapsed = 30;
    await wait(20);

    const constraint = system
      .inspect()
      .constraints.find((c: any) => c.id === "go");
    expect(constraint).toBeDefined();
    expect("whenSpec" in constraint).toBe(false);
    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((event) => "whenExplain" in event)).toEqual([]);
    const unmet = system.inspect().unmet;
    expect(unmet.length).toBeGreaterThan(0);
    expect(system.explain(unmet[0].id)).not.toContain("Predicate clauses:");
    system.destroy();
  });
});
