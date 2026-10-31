import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

// L3b: the one-outcome rule. 2.0 pins it: a run reports one outcome (complete,
// error or cancel) and nothing else, even when stop() is called from the hook
// that reports that outcome, before the run has left flight. 1.35 would emit
// an extra resolver.cancel there; that difference is owner candidate (t).

afterEach(() => {
  vi.restoreAllMocks();
});

/** Let every pending microtask (the resolver's awaits, the pass) run. */
const flush = async (turns = 40) => {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
};

type Outcomes = Record<string, string[]>;

/**
 * One resolver run for a raised requirement. Every resolver hook is recorded
 * per requirement id (one run each, nothing retries); `stopFrom` names the
 * hook that calls stop().
 */
function recorded(opts: {
  fail: boolean;
  stopFrom: "plugin.onResolverComplete" | "module.onResolverError";
}) {
  const outcomes: Outcomes = {};
  const record = (req: { id: string }, hook: string) => {
    (outcomes[req.id] ??= []).push(hook);
  };
  const stop = () => sys.stop();
  const mod = createModule("m", {
    schema: {
      facts: { x: t.number(), done: t.boolean() },
      requirements: { GO: {} },
    },
    init: (f: any) => {
      f.x = 0;
      f.done = false;
    },
    constraints: {
      c: {
        when: (f: any) => f.x > 0 && !f.done,
        require: { type: "GO" },
      },
    },
    resolvers: {
      r: {
        requirement: "GO",
        resolve: async (_req: unknown, ctx: any) => {
          await Promise.resolve();
          if (opts.fail) {
            throw new Error("boom");
          }
          ctx.facts.done = true;
        },
      },
    },
    hooks: {
      onResolverError: () => {
        if (opts.stopFrom === "module.onResolverError") {
          stop();
        }
      },
    },
  } as never);
  const sys: any = createSystem({
    module: mod,
    errorBoundary: { onResolverError: "skip" },
    plugins: [
      {
        name: "rec",
        onResolverStart: (_r: string, req: any) => record(req, "start"),
        onResolverComplete: (_r: string, req: any) => {
          record(req, "complete");
          if (opts.stopFrom === "plugin.onResolverComplete") {
            stop();
          }
        },
        onResolverError: (_r: string, req: any) => record(req, "error"),
        onResolverCancel: (_r: string, req: any) => record(req, "cancel"),
      },
    ],
  } as never);

  return { sys, outcomes };
}

describe("L3b one outcome per run (2.0's rule; 1.35 differs: candidate (t))", () => {
  it("stop() from onResolverComplete: the completed run reports no cancel", async () => {
    const { sys, outcomes } = recorded({
      fail: false,
      stopFrom: "plugin.onResolverComplete",
    });
    sys.start();
    await sys.settle();
    sys.facts.x = 1;
    await flush();

    // Exactly one run, and its one outcome is the complete.
    expect(Object.values(outcomes)).toEqual([["start", "complete"]]);
    sys.destroy();
  });

  it("stop() from a module's onResolverError: the errored run reports no cancel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, outcomes } = recorded({
      fail: true,
      stopFrom: "module.onResolverError",
    });
    sys.start();
    await sys.settle();
    sys.facts.x = 1;
    await flush();

    // Exactly one run, and its one outcome is the error.
    expect(Object.values(outcomes)).toEqual([["start", "error"]]);
    sys.destroy();
  });
});
