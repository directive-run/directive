import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

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

function build(requirement: unknown, withFunctionDef: boolean) {
  const fnResolve = vi.fn();
  const objResolve = vi.fn(async (_req: unknown, context: any) => {
    context.facts.want = false;
  });
  const fnDef = Object.assign(() => {}, { requirement, resolve: fnResolve });
  // A plain resolver for the same requirement, after the function: an engine
  // that dropped every resolver would fail here, not pass.
  const objDef = { requirement: "LOAD", resolve: objResolve };
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
    resolvers: withFunctionDef ? { fn: fnDef, obj: objDef } : { obj: objDef },
  } as never);

  return { mod, fnResolve, objResolve };
}

async function run(mod: unknown): Promise<boolean> {
  try {
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await flush();
    system.destroy();

    return true;
  } catch {
    // Refusing the function definition at construction also keeps the
    // contract.
    return false;
  }
}

describe("a resolver definition that is a function, not an object", () => {
  it.each([
    ["a string requirement", "LOAD"],
    ["a predicate requirement", (req: { type: string }) => req.type === "LOAD"],
  ] as [string, unknown][])(
    "with %s: its resolve is never run, and a plain resolver still is",
    async (_label, requirement) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const both = build(requirement, true);
      const built = await run(both.mod);
      expect(both.fnResolve).not.toHaveBeenCalled();
      if (built) {
        expect(both.objResolve).toHaveBeenCalledTimes(1);
      } else {
        const control = build(requirement, false);
        expect(await run(control.mod)).toBe(true);
        expect(control.objResolve).toHaveBeenCalledTimes(1);
      }
      vi.restoreAllMocks();
    },
  );
});
