/**
 * L2b: writer stamps, own-write satisfaction (through derivations),
 * supersede, retry on the kernel clock and rng, and settle after stop.
 *
 * The conformance suite pins the 1.35 rules; these pin what it cannot see:
 * a listener's nested write is never the run's, derivations are followed to
 * their facts in both directions, retries use only the kernel's clock and
 * rng, and a pending settle() hears stop().
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createRng, createVirtualClock } from "../clock.js";
import type { KernelOptions } from "../kernel.js";
import { createScheduler } from "../scheduler.js";

afterEach(() => vi.restoreAllMocks());

/** Let microtasks and the scheduler's flushes run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });

  return { promise, open };
}

function outcomes() {
  const log = { order: [] as string[], retries: [] as number[] };
  const plugin = {
    name: "outcomes",
    onResolverStart: () => log.order.push("start"),
    onResolverComplete: () => log.order.push("complete"),
    onResolverCancel: () => log.order.push("cancel"),
    onResolverError: () => log.order.push("error"),
  };

  return { log, plugin };
}

function build(
  definition: Record<string, unknown>,
  plugin: object,
  kernel: Partial<KernelOptions> = {},
) {
  const clock = createVirtualClock();
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number(), m: t.number(), want: t.boolean() },
      derivations: { a: t.number(), b: t.number() },
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
      f.m = 0;
      f.want = false;
    },
    // b reads a, a reads n and m: a derivation of a derivation.
    derive: {
      a: (f: any) => f.n + f.m,
      b: (_f: any, d: any) => d.a + 1,
    },
    ...definition,
  } as never);
  const system = createSystemCore(
    { module: mod } as never,
    [withReconcile, withPlugins([plugin as never])],
    { clock, scheduler: createScheduler(), ...kernel },
  ) as any;

  return { system, clock };
}

/** LOAD while `b` (through `a`, to n and m) is below 10. */
const throughDerivations = { when: (_f: any, d: any) => d.b < 10 };

describe("own-write satisfaction through derivations", () => {
  it("a run whose own write reaches the constraint through b → a → n is satisfied", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system } = build(
      {
        constraints: {
          load: { ...throughDerivations, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            resolve: async (_req: unknown, context: any) => {
              signal = context.signal;
              context.facts.n = 100;
              await g.promise;
            },
          },
        },
      },
      plugin,
    );
    system.start();
    await flush();
    await flush();
    expect(log.order).toEqual(["start"]);
    expect(signal?.aborted).toBe(false);
    expect(system.isSettled).toBe(false);
    g.open();
    await flush();
    expect(log.order).toEqual(["start", "complete"]);
    system.destroy();
  });

  it("an outside write to another input of the same derivation, in the same pass, cancels", async () => {
    const { log, plugin } = outcomes();
    let signal: AbortSignal | undefined;
    let outside = () => {};
    const { system } = build(
      {
        constraints: {
          load: { ...throughDerivations, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            resolve: async (_req: unknown, context: any) => {
              signal = context.signal;
              await Promise.resolve();
              context.facts.n = 100;
              // Same window: m is written by someone who is not the run.
              outside();
              await new Promise(() => {});
            },
          },
        },
      },
      plugin,
    );
    outside = () => {
      system.facts.m = 1;
    };
    system.start();
    await flush();
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(log.order).toEqual(["start", "cancel"]);
    system.destroy();
  });
});

describe("writer stamps", () => {
  it("a listener's write made in response to the run's write is not the run's", async () => {
    const { log, plugin } = outcomes();
    let signal: AbortSignal | undefined;
    const { system } = build(
      {
        constraints: {
          load: { when: (f: any) => f.m === 0, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            resolve: async (_req: unknown, context: any) => {
              signal = context.signal;
              await Promise.resolve();
              // Unbatched: the listener below writes m inside this write.
              context.facts.n = 1;
              await new Promise(() => {});
            },
          },
        },
      },
      plugin,
    );
    system.subscribe(["n"], () => {
      system.facts.m = system.facts.n;
    });
    system.start();
    await flush();
    await flush();
    expect(system.facts.m).toBe(1);
    // m changed, but only the listener wrote it: an ordinary retraction.
    expect(signal?.aborted).toBe(true);
    expect(log.order).toEqual(["start", "cancel"]);
    system.destroy();
  });

  it("a superseded run reports one outcome, cancel, and its late writes drop", async () => {
    const { log, plugin } = outcomes();
    const gates: Array<() => void> = [];
    const { system } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            resolve: async (_req: unknown, context: any) => {
              const run = gates.length;
              const g = gate();
              gates.push(g.open);
              if (run === 0) {
                context.facts.want = false;
              }
              await g.promise;
              context.facts.n = run === 0 ? -1 : 2;
            },
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    await flush();
    // Satisfied by its own write, then the requirement comes back.
    system.facts.want = true;
    await flush();
    expect(gates).toHaveLength(2);
    // The old run's cancel is reported before the new run starts.
    expect(log.order).toEqual(["start", "cancel", "start"]);
    gates[0]!();
    await flush();
    expect(system.facts.n).toBe(0);
    gates[1]!();
    await flush();
    expect(system.facts.n).toBe(2);
    expect(log.order).toEqual(["start", "cancel", "start", "complete"]);
    system.destroy();
  });
});

describe("retry on the kernel clock and rng", () => {
  function retrying(seed: number) {
    const times: number[] = [];
    const { log, plugin } = outcomes();
    const built = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            retry: {
              attempts: 4,
              backoff: "exponential",
              initialDelay: 100,
              maxDelay: 300,
              jitter: "full",
            },
            resolve: async () => {
              times.push(built.clock.now());
              throw new Error("again");
            },
          },
        },
      },
      plugin,
      { rng: createRng(seed) },
    );

    return { ...built, times, log };
  }

  async function run(seed: number) {
    const r = retrying(seed);
    vi.spyOn(console, "error").mockImplementation(() => {});
    r.system.start();
    r.system.facts.want = true;
    await flush();
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Each wait is one kernel-clock timer, owned by this system.
      const timers = r.clock.timers().filter((x) => x.kind === "retry");
      expect(timers).toHaveLength(1);
      waits.push(timers[0]!.deadline - r.clock.now());
      r.clock.advanceTo(timers[0]!.deadline);
      await flush();
    }
    r.system.destroy();

    return { ...r, waits };
  }

  it("is the same twice with one seed, and never asks Math.random", async () => {
    const random = vi.spyOn(Math, "random");
    const first = await run(7);
    const second = await run(7);
    expect(random).not.toHaveBeenCalled();
    expect(first.times).toHaveLength(4);
    expect(second.waits).toEqual(first.waits);
    expect(first.log.order).toEqual(["start", "error"]);
    // Full jitter within the clamped backoff: [1, min(100 · 2^(n-1), 300)].
    first.waits.forEach((wait, i) => {
      expect(wait).toBeGreaterThanOrEqual(1);
      expect(wait).toBeLessThanOrEqual(Math.min(100 * 2 ** i, 300));
    });
    expect((await run(8)).waits).not.toEqual(first.waits);
  });

  it("a retry wait does not fire until the kernel clock reaches it", async () => {
    const r = retrying(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    r.system.start();
    r.system.facts.want = true;
    await flush();
    await flush();
    expect(r.times).toHaveLength(1);
    const [timer] = r.clock.timers().filter((x) => x.kind === "retry");
    expect(timer).toBeDefined();
    expect(timer!.owner).not.toBe(0);
    await flush();
    expect(r.times).toHaveLength(1);
    r.clock.advanceTo(timer!.deadline);
    await flush();
    expect(r.times).toHaveLength(2);
    r.system.destroy();
  });
});

describe("settle() and stop()", () => {
  it("a pending settle() waits for a run in flight, then resolves after stop()", async () => {
    const { plugin } = outcomes();
    const { system } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            resolve: () => new Promise(() => {}),
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    let settled = false;
    void system.settle().then(() => {
      settled = true;
    });
    await flush();
    await flush();
    expect(settled).toBe(false);
    system.stop();
    await flush();
    expect(settled).toBe(true);
    system.destroy();
  });
});
