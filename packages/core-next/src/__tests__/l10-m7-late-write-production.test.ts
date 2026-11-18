/**
 * Row (cd) in production: the retired resolver's write is dropped, and
 * nothing is logged (l10-m7-late-write.test.ts has development's side).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

vi.mock("#is-development", () => ({ default: false }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Any = any;

const host = () =>
  createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts: Any) => {
      facts.n = 1;
    },
  } as never);
/**
 * marker 1 starts a run that waits `ms` (ignoring its signal), then hands
 * back its context so the test writes when it likes. A replacement
 * (marker 2) starts a run only if `again`.
 */
const leaky = (marker: number, ms: number, out: { ctx?: Any }, again = false) =>
  createModule("leaky", {
    schema: {
      facts: { pending: t.boolean(), written: t.number() },
      requirements: { WORK: {} },
    },
    init: (facts: Any) => {
      facts.pending = marker === 1 || again;
      facts.written = 0;
    },
    constraints: {
      needsWork: { when: (f: Any) => f.pending, require: { type: "WORK" } },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        resolve: async (_req: Any, context: Any) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          out.ctx = context;
          context.facts.pending = false;
        },
      },
    },
  } as never);

const setup = async (ms: number) => {
  vi.useFakeTimers();
  const out: { ctx?: Any } = {};
  const system = createSystem({
    modules: { m: host(), leaky: leaky(1, ms, out) },
  } as never) as Any;
  system.start();
  await vi.advanceTimersByTimeAsync(0);
  let done = false;
  const going = system.unregisterModule("leaky").then(() => {
    done = true;
  });

  return { system, out, going, done: () => done };
};

describe("production: row (cd)", () => {
  it("a run that outlived the 10 s drain: its write is dropped, with no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { system, out, going } = await setup(15_000);
    await vi.advanceTimersByTimeAsync(10_010);
    await going;
    system.registerModule("leaky", leaky(2, 0, {}));
    await vi.advanceTimersByTimeAsync(5_000);
    out.ctx.facts.written = 1;
    expect(system.facts.leaky.written).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });
});
