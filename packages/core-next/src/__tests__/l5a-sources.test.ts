/**
 * L5a: the sources part's 1.35 parity details (RFC L5 rows A1–A6, P1–P5,
 * V1–V4), pinned on core-next itself. The black-box oracle is in
 * packages/conformance; these pin what the review probes:
 *
 * - attach, evict and stop follow attach order, not declaration order: a
 *   gated source declared first is left to the gates, so the ungated ones
 *   attach first and the gated one after them (L5b), and stop detaches in
 *   reverse (each detach heard before its unsubscribe).
 * - an attach that returns a Promise is an attach error with no
 *   onSourceAttach, but its publish handle still dispatches, and since the
 *   source was never attached, stop never flips it to detached.
 * - the evict deadline is epoch milliseconds compared with Date.now(), never
 *   with the kernel clock's now(); only the time left goes to a clock timer,
 *   and the teardown timeouts are clock timers too (one scheduler).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withPlugins } from "../api/plugins.js";
import { t } from "../api/schema-builders.js";
import { withSources } from "../api/sources.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Publish = (name: string, payload?: unknown) => void;

function sourceModule(sources: Record<string, unknown>) {
  return createModule("m", {
    schema: {
      facts: { hits: t.number(), seeded: t.number(), open: t.boolean() },
      derivations: {},
      events: { poke: {}, seed: {} },
    },
    init: (facts: any) => {
      facts.hits = 0;
      facts.seeded = 0;
      facts.open = true;
    },
    events: {
      poke: (facts: any) => {
        facts.hits += 1;
      },
      seed: (facts: any, event: any) => {
        facts.seeded = event.n;
      },
    },
    sources,
  } as any);
}

function recorder() {
  const log: unknown[][] = [];
  const plugin = {
    name: "rec",
    onSourceAttach: (id: string) => log.push(["attach", id]),
    onSourcePublish: (id: string, _m: string, name: string) =>
      log.push(["publish", id, name]),
    onSourceDrop: (id: string, _m: string, name: string, reason: string) =>
      log.push(["drop", id, name, reason]),
    onSourceDetach: (id: string) => log.push(["detach", id]),
    onSourceError: (id: string, _m: string, phase: string) =>
      log.push(["error", id, phase]),
  };

  return { log, plugin };
}

describe("attach order", () => {
  const ordered = (order: string[]) => (name: string, gated: boolean) => ({
    ...(gated ? { active: (facts: any) => facts.open } : {}),
    attach: () => {
      order.push(`attach ${name}`);

      return () => {
        order.push(`unsubscribe ${name}`);
      };
    },
    onEvict: () => {
      order.push(`evict ${name}`);
    },
  });

  it("is ungated first, with a gated source declared first; stop detaches in reverse, each heard before its unsubscribe", async () => {
    const order: string[] = [];
    const source = ordered(order);
    const system = createSystem({
      module: sourceModule({
        g1: source("g1", true),
        u2: source("u2", false),
        u3: source("u3", false),
      }),
      plugins: [
        {
          name: "d",
          onSourceDetach: (id: string) => order.push(`detach ${id}`),
        },
      ],
    } as any);
    system.start();
    await system.settle();
    // g1 is the gates' to attach: after the ungated ones (review probe R1).
    expect(order).toEqual(["attach u2", "attach u3", "attach g1"]);
    order.length = 0;
    system.stop();
    expect(order).toEqual([
      "detach g1",
      "unsubscribe g1",
      "detach u3",
      "unsubscribe u3",
      "detach u2",
      "unsubscribe u2",
    ]);
    system.destroy();
  });

  it("is the order evict follows: onEvict in attach order, then the unsubscribes in reverse", async () => {
    const order: string[] = [];
    const source = ordered(order);
    const system = createSystem({
      module: sourceModule({
        g1: source("g1", true),
        u2: source("u2", false),
        u3: source("u3", false),
      }),
    } as any);
    system.start();
    await system.settle();
    order.length = 0;
    await (system as any).evict();
    expect(order).toEqual([
      "evict u2",
      "evict u3",
      "evict g1",
      "unsubscribe g1",
      "unsubscribe u3",
      "unsubscribe u2",
    ]);
  });

  it("starts again on stop then start, with fresh inspect counters", async () => {
    let attaches = 0;
    const handles: Publish[] = [];
    const system = createSystem({
      module: sourceModule({
        s: {
          attach: (publish: Publish) => {
            attaches += 1;
            handles.push(publish);

            return () => undefined;
          },
        },
      }),
    } as any);
    system.start();
    handles[0]!("poke");
    const row = () => (system.inspect().sources as any[])[0];
    expect(row().publishCount).toBe(1);
    system.stop();
    system.start();
    expect(attaches).toBe(2);
    expect(row()).toMatchObject({ attached: true, publishCount: 0 });
    // The first start's handle is detached: silent, and not counted.
    handles[0]!("poke");
    expect(row().publishCount).toBe(0);
    handles[1]!("poke");
    expect((system.facts as any).hits).toBe(2);
    system.destroy();
  });
});

describe("an attach that returns a Promise", () => {
  it("is an attach error with no onSourceAttach; its handle still publishes, and stop never detaches it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { log, plugin } = recorder();
    let handle: Publish | undefined;
    const system = createSystem({
      module: sourceModule({
        eager: {
          attach: (publish: Publish) => {
            handle = publish;

            return Promise.resolve(() => undefined);
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    expect(log).toEqual([["error", "eager", "attach"]]);
    handle!("poke");
    expect((system.facts as any).hits).toBe(1);
    expect(system.inspect().attachedSourceCount).toBe(0);
    log.length = 0;
    system.stop();
    // Never attached, so never detached: the guard refuses it, out loud.
    handle!("poke");
    expect(log).toEqual([["drop", "eager", "poke", "post-stop"]]);
    system.destroy();
    handle!("poke");
    expect(log.at(-1)).toEqual(["drop", "eager", "poke", "post-destroy"]);
  });
});

describe("a publish made inside attach at start", () => {
  it("is applied before start() returns (U5, ungated)", () => {
    const system = createSystem({
      module: sourceModule({
        seeder: {
          attach: (publish: Publish) => {
            publish("seed", { n: 7 });

            return () => undefined;
          },
        },
      }),
    } as any);
    system.start();
    expect((system.facts as any).seeded).toBe(7);
    system.destroy();
  });
});

describe("the evict deadline and the teardown timeouts", () => {
  const EPOCH = 1_700_000_000_000;

  /** A system on a virtual clock whose now() is 0, far from Date.now(). */
  function onClock(sources: Record<string, unknown>) {
    const clock = createVirtualClock(0);
    const { log, plugin } = recorder();
    const system = createSystemCore(
      { module: sourceModule(sources) } as any,
      [withSources, withPlugins([plugin as any])],
      { clock },
    ) as any;

    return { clock, log, system };
  }
  const hanging = {
    attach: () => () => new Promise(() => {}),
    onEvict: () => new Promise(() => {}),
    evictTimeoutMs: Number.POSITIVE_INFINITY,
  };

  it("is compared with Date.now(): a future one waits for the time left, on the kernel clock", async () => {
    vi.useFakeTimers({ now: EPOCH, toFake: ["Date"] });
    const { clock, system } = onClock({ h: hanging });
    system.start();
    let done = false;
    const evicting = system.evict(Date.now() + 100).then(() => {
      done = true;
    });
    await Promise.resolve();
    // Only the time left (100 ms) went to a timer, at clock time 100.
    expect(clock.nextDeadline()).toBe(100);
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    expect(done).toBe(false);
    clock.advanceTo(100);
    await evicting;
    expect(done).toBe(true);
  });

  it("is compared with Date.now(): one already past returns at once, though the clock's now() is far behind it", async () => {
    vi.useFakeTimers({ now: EPOCH, toFake: ["Date"] });
    const { clock, system } = onClock({ h: hanging });
    system.start();
    await system.evict(Date.now() - 1);
    expect(clock.nextDeadline()).toBeUndefined();
  });

  it("times a hanging unsubscribe on the kernel clock: stopAsync gives up at 5 s with a cleanup error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { clock, log, system } = onClock({
      h: { attach: () => () => new Promise(() => {}) },
    });
    system.start();
    let stopped = false;
    const stopping = system.stopAsync().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(clock.nextDeadline()).toBe(5000);
    clock.advanceTo(5000);
    await stopping;
    expect(stopped).toBe(true);
    expect(log).toContainEqual(["error", "h", "cleanup"]);
  });
});

describe("start() during evict()", () => {
  it("is ignored with a development warning; the system ends destroyed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: sourceModule({}) } as any) as any;
    const evicting = system.evict();
    system.start();
    await evicting;
    expect(system.isRunning).toBe(false);
    expect(warn.mock.calls.map(([m]) => m)).toContain(
      "[Directive] system.start() called during evict() — ignored. Re-create the system after destroyAsync() resolves.",
    );
  });
});
