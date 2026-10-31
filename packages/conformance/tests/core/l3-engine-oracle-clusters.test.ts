// Ported from packages/core/src/core/__tests__/l3-engine-oracle-clusters.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Engine behaviour that the other L3 engine oracles leave unpinned. Black-box:
 * only what a user can see through createSystem.
 *
 * - Two abort-bound resolvers started by one pass are judged against the facts
 *   as they were when the pass dispatched them: the second may not silently
 *   overwrite what the first wrote.
 * - retry-later keeps a waiting constraint's retry and a waiting resolver's
 *   retry apart: each is retried as itself.
 * - `when()` stops asking its predicate once it has resolved.
 * - destroy() of a system with a resolver in flight: nothing is announced to a
 *   settlement listener afterwards.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("two abort-bound resolvers started by one pass", () => {
  it("the second may not overwrite the first's write to a fact they both bind", async () => {
    const signals: Record<string, AbortSignal> = {};
    const mod = createModule("bound", {
      schema: {
        facts: { go: t.boolean(), status: t.string() },
        derivations: {},
        events: {},
        requirements: { WRITE_A: {}, WRITE_B: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.status = "initial";
      },
      constraints: {
        a: {
          when: (facts: any) => facts.go,
          require: { type: "WRITE_A" },
          abortOn: ["status"],
        },
        b: {
          when: (facts: any) => facts.go,
          require: { type: "WRITE_B" },
          abortOn: ["status"],
        },
      },
      resolvers: {
        writeA: {
          requirement: "WRITE_A",
          resolve: async (_req: any, context: any) => {
            signals.a = context.signal;
            context.facts.status = "a";
          },
        },
        writeB: {
          requirement: "WRITE_B",
          resolve: async (_req: any, context: any) => {
            signals.b = context.signal;
            context.facts.status = "b";
          },
        },
      },
    } as never);
    const sys = createSystem({ module: mod } as never) as any;
    sys.start();
    await sys.settle();
    sys.facts.go = true;
    for (let i = 0; i < 5; i++) await flush();

    // Both ran; exactly one write landed and the other resolver yielded.
    expect(Object.keys(signals).sort()).toEqual(["a", "b"]);
    const aborted = Object.keys(signals).filter((k) => signals[k]!.aborted);
    expect(aborted).toHaveLength(1);
    const winner = aborted[0] === "a" ? "b" : "a";
    expect(sys.facts.status).toBe(winner);
    sys.destroy();
  });
});

describe("retry-later with a constraint and a resolver both waiting", () => {
  it("each is retried as itself: the throwing constraint is asked again", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let flakyAsked = 0;
    let loads = 0;
    const mod = createModule("pair", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {}, NEVER: {} },
      },
      init: (facts: any) => {
        facts.go = true;
      },
      constraints: {
        flaky: {
          when: () => {
            flakyAsked++;
            throw new Error("not yet");
          },
          require: { type: "NEVER" },
        },
        load: {
          when: (facts: any) => facts.go,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async () => {
            loads++;
            throw new Error("down");
          },
        },
      },
    } as never);
    const sys = createSystem({
      module: mod,
      errorBoundary: {
        onConstraintError: "retry-later",
        onResolverError: "retry-later",
        retryLater: { delayMs: 300 },
      },
    } as never) as any;
    sys.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(loads).toBe(1);
    const askedBefore = flakyAsked;
    await vi.advanceTimersByTimeAsync(400);
    expect(flakyAsked).toBeGreaterThan(askedBefore);
    sys.destroy();
  });
});

function counterSystem() {
  const mod = createModule("c", {
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

  return createSystem({ module: mod } as never) as any;
}

describe("when()", () => {
  it("stops asking its predicate once it has resolved", async () => {
    const sys = counterSystem();
    sys.start();
    let asked = 0;
    const done = sys.when((facts: any) => {
      asked++;
      return facts.n >= 1;
    });
    sys.facts.n = 1;
    await done;
    const askedAtResolve = asked;
    sys.facts.n = 2;
    sys.facts.n = 3;
    await flush();
    expect(asked).toBe(askedAtResolve);
    sys.destroy();
  });

  it("with a timeout, resolving first means it never rejects later", async () => {
    vi.useFakeTimers();
    const sys = counterSystem();
    sys.start();
    const outcome: string[] = [];
    const done = sys
      .when((facts: any) => facts.n >= 1, { timeout: 100 })
      .then(
        () => outcome.push("resolved"),
        () => outcome.push("rejected"),
      );
    sys.facts.n = 1;
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(outcome).toEqual(["resolved"]);
    sys.destroy();
  });
});

describe("destroy() with a resolver in flight", () => {
  it("a settlement listener hears nothing after destroy()", async () => {
    let release: () => void = () => {};
    const mod = createModule("slow", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { SLOW: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
      },
      constraints: {
        slow: {
          when: (facts: any) => facts.go && !facts.done,
          require: { type: "SLOW" },
        },
      },
      resolvers: {
        slow: {
          requirement: "SLOW",
          resolve: async (_req: any, context: any) => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            context.facts.done = true;
          },
        },
      },
    } as never);
    const sys = createSystem({ module: mod } as never) as any;
    sys.start();
    await sys.settle();
    sys.facts.go = true;
    await flush();
    let heard = 0;
    sys.onSettledChange(() => {
      heard++;
    });
    sys.destroy();
    const heardAtDestroy = heard;
    release();
    for (let i = 0; i < 5; i++) await flush();
    expect(heard).toBe(heardAtDestroy);
  });
});
