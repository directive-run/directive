// Ported from packages/core/src/core/__tests__/l2-resolvers-oracle-shape.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

// Black-box test at L2: a resolver definition must be a plain object. A
// function that happens to carry `requirement` and `resolve` properties is
// not a resolver, so its `resolve` never runs. 1.35 ignores such a
// definition; an engine may instead refuse it at construction. Either way the
// contract pinned here is the same: it is never called.

const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};

function build(requirement: unknown) {
  const resolve = vi.fn();
  const def = Object.assign(() => {}, { requirement, resolve });
  const mod = createModule("shape", {
    schema: {
      facts: { want: t.boolean() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.want = true;
    },
    constraints: {
      load: {
        when: (facts: any) => facts.want,
        require: { type: "LOAD" },
      },
    },
    resolvers: { fn: def },
  } as never);

  return { mod, resolve };
}

describe("a resolver definition that is a function, not an object", () => {
  it.each([
    ["a string requirement", "LOAD"],
    ["a predicate requirement", (req: { type: string }) => req.type === "LOAD"],
  ] as [string, unknown][])(
    "with %s: its resolve is never run",
    async (_label, requirement) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { mod, resolve } = build(requirement);
      let system: any;
      try {
        system = createSystem({ module: mod } as never);
        system.start();
        await flush();
      } catch {
        // Refusing the definition at construction also keeps the contract.
      }
      expect(resolve).not.toHaveBeenCalled();
      system?.destroy();
      vi.restoreAllMocks();
    },
  );
});
