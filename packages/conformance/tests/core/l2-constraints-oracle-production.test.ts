// Ported from packages/core/src/core/__tests__/l2-constraints-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The L2 constraint rules that hold in production too, and the development
// warnings that production leaves out. Public API only.

afterEach(() => {
  vi.restoreAllMocks();
});

const req = (tag: string) => ({ type: "R", tag });

function build(constraints: Record<string, unknown>) {
  const started: string[] = [];
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: { R: { tag: t.string() } },
    },
    init: (facts: any) => {
      facts.n = 0;
    },
    constraints,
    resolvers: {
      r: {
        requirement: "R",
        resolve: async (r: any) => {
          started.push(r.tag);
        },
      },
    },
  } as never);

  return { system: createSystem({ module: mod } as never) as any, started };
}

describe("constraints in production", () => {
  it("ignores an `after` naming no constraint without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, started } = build({
      second: { after: ["missing"], when: () => true, require: req("second") },
    });
    system.start();
    await system.settle();
    expect(started).toEqual(["second"]);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("does not warn about an async constraint without deps", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, started } = build({
      loose: { async: true, when: async () => true, require: req("loose") },
    });
    system.start();
    await system.settle();
    expect(started).toEqual(["loose"]);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("does not warn when one constraint emits more than ten requirements", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, started } = build({
      many: {
        when: () => true,
        require: () => Array.from({ length: 12 }, (_, i) => req(`r${i}`)),
      },
    });
    system.start();
    await system.settle();
    expect(started).toHaveLength(12);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("does not warn about a when that returns a promise, and honours its answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, started } = build({
      promised: { when: () => Promise.resolve(true), require: req("p") },
    });
    system.start();
    await system.settle();
    expect(started).toEqual(["p"]);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("still rejects an `after` cycle when the system is created", () => {
    expect(() =>
      build({
        a: { after: ["b"], when: () => true, require: req("a") },
        b: { after: ["a"], when: () => true, require: req("b") },
      }),
    ).toThrow(/\ba\b[\s\S]*\bb\b|\bb\b[\s\S]*\ba\b/);
  });
});
