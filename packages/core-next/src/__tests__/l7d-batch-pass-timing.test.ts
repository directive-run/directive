/**
 * L7 batch pass timing, found by the L7 gate's fuzz (api/batch.ts).
 *
 * A batch run's end asks for its pass at 1.35's depth: one tick after
 * executeBatch settles (`executeBatch(...).then(onResolutionComplete)`).
 * 1.35 lands a batch's error and its pass at one depth for both handlers,
 * so a with-results batch's pass no longer comes a tick late (it split a
 * single run's error from the pass 1.35 runs before it), and an
 * all-or-nothing batch's error no longer comes a tick early.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/** A system on `resolvers`, wanting `AB` (batched) and `A2` once `x` is 1. */
function build(resolvers: Record<string, unknown>, log: (s: string) => void) {
  const mod = createModule("a", {
    schema: {
      facts: { x: t.number() },
      derivations: {},
      events: {},
      requirements: { AB: { item: t.string() }, A2: {} },
    },
    init: (f: any) => {
      f.x = 0;
    },
    constraints: {
      cb: {
        when: (f: any) => f.x >= 1,
        require: () => [{ type: "AB", item: "0.0" }],
      },
      ...("r2" in resolvers
        ? {
            c2: { when: (f: any) => f.x >= 1, require: () => ({ type: "A2" }) },
          }
        : {}),
    },
    resolvers,
  } as never);
  const system = createSystem({
    module: mod,
    errorBoundary: { onResolverError: "skip" },
    plugins: [
      {
        name: "rec",
        onReconcileStart: () => log("pass"),
        onRequirementMet: (req: { id: string }) => log(`met ${req.id}`),
        onError: (error: Error) => log(`error ${error.message}`),
      },
    ],
  } as never) as any;
  system.start();

  return system;
}

const batch = { enabled: true, windowMs: 5, maxSize: 1 };

describe("a batch run's end asks for its pass at 1.35's depth", () => {
  it("a with-results batch's success and a single run's error in one tick share one pass", async () => {
    const log: string[] = [];
    const system = build(
      {
        rb: {
          requirement: "AB",
          key: (r: any) => r.item,
          batch: { ...batch, timeoutMs: 3 },
          resolveBatchWithResults: async (reqs: unknown[]) =>
            reqs.map(() => ({ success: true })),
        },
        r2: {
          requirement: "A2",
          timeout: 10,
          resolve: async () => {
            throw new Error("r2 fails");
          },
        },
      },
      (s) => log.push(s),
    );
    await advance(5);
    log.length = 0;
    system.facts.x = 1;
    await advance(30);

    // 1.35's order and count; 2.0 ran a second pass after the error.
    expect(log).toEqual(["pass", "met 0.0", "error r2 fails", "pass"]);
    system.destroy();
  });

  /**
   * Microtask depth, from the handler's call to the error and to the pass,
   * of each batch exit (1.35's, measured).
   */
  async function depth(handler: Record<string, unknown>) {
    let tick = -1;
    const at: Record<string, number> = {};
    const count = () => {
      tick = 0;
      const step = () => {
        if (++tick < 40) {
          Promise.resolve().then(step);
        }
      };
      Promise.resolve().then(step);
    };
    const record = (s: string) => {
      const key = s.split(" ")[0]!;
      if (tick >= 0 && !(key in at)) {
        at[key] = tick;
      }
    };
    const system = build(
      {
        rb: {
          requirement: "AB",
          key: (r: any) => r.item,
          batch,
          ...Object.fromEntries(
            Object.entries(handler).map(([name, fn]) => [
              name,
              (...args: unknown[]) => {
                count();

                return (fn as (...a: unknown[]) => unknown)(...args);
              },
            ]),
          ),
        },
      },
      record,
    );
    await advance(2);
    system.facts.x = 1;
    await advance(20);
    system.destroy();

    return at;
  }

  it("a with-results batch's pass lands where an all-or-nothing one's does", async () => {
    const results = await depth({
      resolveBatchWithResults: async (reqs: unknown[]) =>
        reqs.map(() => ({ success: true })),
    });
    const all = await depth({ resolveBatch: async () => {} });

    expect(results).toEqual({ met: 3, pass: 8 });
    expect(all).toEqual({ met: 3, pass: 8 });
  });

  it("a batch's error lands at one depth for both handlers, its pass two ticks later", async () => {
    const results = await depth({
      resolveBatchWithResults: async () => {
        throw new Error("whole");
      },
    });
    const all = await depth({
      resolveBatch: async () => {
        throw new Error("whole");
      },
    });

    expect(results).toEqual({ error: 8, pass: 10 });
    expect(all).toEqual({ error: 8, pass: 10 });
  });
});
