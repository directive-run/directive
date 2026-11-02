/**
 * L5b: the sources part's gates, linger, retry and coalesce (RFC L5 rows
 * G1–G6, L1–L3, T1–T3, K1–K3), pinned on core-next itself, with the three
 * owner-approved candidates:
 *
 * - (ac) a failed gated attach retries when its backoff ends, on a kernel-
 *   clock timer owned by the system; stop and destroy clear it, so a test
 *   that runs every timer does not spin on a source that never attaches.
 * - (aa) a failed attach commits "detached": the retry after a failed re-key
 *   is a rising edge (no second linger window), and a return to the old key
 *   attaches at once.
 * - (ab) coalesced payloads still pending when the gate closes are
 *   `gate-closed` drops, heard after the detach; a stop stays silent.
 *
 * Also carried from the L5a review: gates are evaluated at start, and
 * module-scoped publish, the drop reasons and the cross-module warning get
 * core-next pins of their own (the conformance oracle had the only ones).
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

function gatedModule(sources: Record<string, unknown>) {
  return createModule("m", {
    schema: {
      facts: { open: t.boolean(), room: t.string(), other: t.number() },
      derivations: {},
      events: { tick: {}, poke: {} },
    },
    init: (facts: any) => {
      facts.open = true;
      facts.room = "a";
      facts.other = 0;
    },
    events: {
      tick: (facts: any) => {
        facts.other += 1;
      },
      poke: () => undefined,
    },
    sources,
  } as any);
}

function recorder() {
  const log: unknown[][] = [];
  const plugin = {
    name: "rec",
    onSourceAttach: (id: string) => log.push(["attach", id]),
    onSourceDrop: (id: string, _m: string, name: string, reason: string) =>
      log.push(["drop", id, name, reason]),
    onSourceDetach: (id: string) => log.push(["detach", id]),
    onSourceError: (id: string, _m: string, phase: string) =>
      log.push(["error", id, phase]),
  };

  return { log, plugin };
}

/** A system on a virtual clock, so every timer is data the test drives. */
function onClock(sources: Record<string, unknown>) {
  const clock = createVirtualClock(0);
  const { log, plugin } = recorder();
  const system = createSystemCore(
    { module: gatedModule(sources) } as any,
    [withSources, withPlugins([plugin as any])],
    { clock },
  ) as any;

  return { clock, log, system };
}

const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("gates at start", () => {
  it("evaluates every gate once at start: an open gate is attached when start() returns", () => {
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({
        g: { active: (f: any) => f.open, attach: () => () => undefined },
        u: { attach: () => () => undefined },
      }),
      plugins: [plugin as any],
    } as any) as any;
    system.start();

    // Ungated first, then the gate evaluated at start.
    expect(log).toEqual([
      ["attach", "u"],
      ["attach", "g"],
    ]);
    expect(system.inspect().attachedSourceCount).toBe(2);
    system.destroy();
  });
});

describe("(ac) the retry after a failed gated attach", () => {
  const down = (calls: string[]) => ({
    active: (f: any) => f.open,
    attach: () => {
      calls.push("attempt");
      throw new Error("down");
    },
  });

  it("runs when its backoff ends, on a kernel-clock timer the system owns, with no other write", () => {
    quiet();
    const calls: string[] = [];
    const { clock, system } = onClock({ s: down(calls) });
    system.start();
    expect(calls).toHaveLength(1);
    const [timer] = clock.timers();
    expect(timer?.deadline).toBe(250);
    expect(timer?.owner).not.toBe(0);

    clock.advanceTo(249);
    expect(calls).toHaveLength(1);
    clock.advanceTo(250);
    expect(calls).toHaveLength(2);
    // 250 ms doubling: the next attempt is 500 ms later.
    expect(clock.nextDeadline()).toBe(750);
    system.destroy();
  });

  it("is cleared at stop and at destroy", () => {
    quiet();
    const calls: string[] = [];
    const { clock, system } = onClock({ s: down(calls) });
    system.start();
    expect(clock.timers()).toHaveLength(1);
    system.stop();
    expect(clock.timers()).toHaveLength(0);

    system.start();
    expect(calls).toHaveLength(2);
    expect(clock.timers()).toHaveLength(1);
    system.destroy();
    expect(clock.timers()).toHaveLength(0);
    clock.advanceTo(60_000);
    expect(calls).toHaveLength(2);
  });

  it("lets vi.runAllTimers finish after stop or destroy, with a source that never attaches", () => {
    quiet();
    vi.useFakeTimers();
    for (const end of ["stop", "destroy"] as const) {
      const calls: string[] = [];
      const system = createSystem({
        module: gatedModule({ s: down(calls) }),
      } as any) as any;
      system.start();
      vi.advanceTimersByTime(250);
      // The retry ran on its own, at the end of the backoff.
      expect(calls).toHaveLength(2);
      system[end]();
      expect(() => vi.runAllTimers()).not.toThrow();
      expect(calls).toHaveLength(2);
      if (end === "stop") {
        system.destroy();
      }
    }
  });
});

describe("(aa) a failed attach commits detached", () => {
  function rooms(calls: string[], down: Set<string>) {
    return {
      key: (f: any) => f.room,
      gateLingerMs: 100,
      attach: (_p: Publish, _r: unknown, ctx: { key: string }) => {
        calls.push(`attach ${ctx.key}`);
        if (down.has(ctx.key)) {
          throw new Error(`room ${ctx.key} down`);
        }

        return () => calls.push(`detach ${ctx.key}`);
      },
    };
  }

  it("so the retry of a failed re-key is a rising edge: no second linger window", async () => {
    quiet();
    const calls: string[] = [];
    const down = new Set(["b"]);
    const { clock, system } = onClock({ chat: rooms(calls, down) });
    system.start();
    system.facts.room = "b";
    await system.settle();
    // The re-key lingers: a stays until the window ends.
    expect(calls).toEqual(["attach a"]);
    clock.advanceTo(100);
    expect(calls).toEqual(["attach a", "detach a", "attach b"]);
    down.delete("b");
    // The backoff ends at 350 and the retry attaches at once: 1.35 would
    // treat it as another re-key and wait one more window.
    clock.advanceTo(350);
    expect(calls).toEqual(["attach a", "detach a", "attach b", "attach b"]);
    system.destroy();
  });

  it("and a return to the old key attaches at once", async () => {
    quiet();
    const calls: string[] = [];
    const { clock, system } = onClock({ chat: rooms(calls, new Set(["b"])) });
    system.start();
    system.facts.room = "b";
    await system.settle();
    clock.advanceTo(100);
    expect(calls).toEqual(["attach a", "detach a", "attach b"]);
    system.facts.room = "a";
    await system.settle();
    // 1.35 cancels a linger here and leaves the source dark.
    expect(calls).toEqual(["attach a", "detach a", "attach b", "attach a"]);
    // The retry owed for b went with the attach under a: nothing is armed.
    expect(clock.timers()).toHaveLength(0);
    system.destroy();
  });
});

describe("(ab) coalesced payloads pending at a gate close", () => {
  function coalesced(handle: { publish?: Publish }) {
    return {
      active: (f: any) => f.open,
      coalesce: "lastWriteWins",
      attach: (publish: Publish) => {
        handle.publish = publish;

        return () => undefined;
      },
    };
  }

  it("count gate-closed drops, heard after the detach", async () => {
    const handle: { publish?: Publish } = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({ s: coalesced(handle) }),
      plugins: [plugin as any],
    } as any) as any;
    system.start();
    log.length = 0;
    system.facts.open = false;
    handle.publish!("tick");
    handle.publish!("tick");
    await system.settle();
    await Promise.resolve();

    expect(log).toEqual([
      ["drop", "s", "tick", "coalesced"],
      ["detach", "s"],
      ["drop", "s", "tick", "gate-closed"],
    ]);
    const row = system.inspect().sources[0];
    expect(row.dropCount).toBe(2);
    expect(row.lastDropReason).toBe("gate-closed");
    expect(system.facts.other).toBe(0);
    system.destroy();
  });

  it("stay silent when a stop detached the source", async () => {
    const handle: { publish?: Publish } = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({ s: coalesced(handle) }),
      plugins: [plugin as any],
    } as any) as any;
    system.start();
    log.length = 0;
    handle.publish!("tick");
    handle.publish!("tick");
    system.stop();
    await Promise.resolve();
    await Promise.resolve();

    expect(log).toEqual([
      ["drop", "s", "tick", "coalesced"],
      ["detach", "s"],
    ]);
    expect(system.facts.other).toBe(0);
    system.destroy();
  });
});

describe("publish (carried from the L5a review)", () => {
  it("names every drop reason, and counts each", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    quiet();
    const live: { publish?: Publish } = {};
    const failed: { publish?: Publish } = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({
        ok: {
          attach: (publish: Publish) => {
            live.publish = publish;

            return () => undefined;
          },
        },
        // A failed attach: its handle stays live through stop and destroy.
        bad: {
          attach: (publish: Publish) => {
            failed.publish = publish;

            return undefined;
          },
        },
      }),
      plugins: [plugin as any],
    } as any) as any;
    system.start();
    log.length = 0;
    live.publish!("");
    live.publish!("__proto__");
    live.publish!("nope");
    live.publish!("tick");
    system.stop();
    failed.publish!("tick");
    system.destroy();
    failed.publish!("tick");

    expect(log.filter((e) => e[0] === "drop")).toEqual([
      ["drop", "ok", "", "invalid-event-name"],
      ["drop", "ok", "__proto__", "blocked-event-name"],
      ["drop", "ok", "nope", "unknown-event"],
      ["drop", "bad", "tick", "post-stop"],
      ["drop", "bad", "tick", "post-destroy"],
    ]);
    expect(system.facts.other).toBe(1);
  });

  it("is module-scoped in a namespaced system, and warns once per source of a cross-module name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle: { publish?: Publish } = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      modules: {
        a: gatedModule({
          feed: {
            attach: (publish: Publish) => {
              handle.publish = publish;

              return () => undefined;
            },
          },
        }),
      },
      plugins: [plugin as any],
    } as any) as any;
    system.start();
    handle.publish!("tick");
    expect(system.facts.a.other).toBe(1);
    handle.publish!("a::tick");
    handle.publish!("b::tick");
    expect(system.facts.a.other).toBe(1);

    expect(log.filter((e) => e[0] === "drop")).toEqual([
      ["drop", "a::feed", "a::tick", "cross-module-event"],
      ["drop", "a::feed", "b::tick", "cross-module-event"],
    ]);
    const messages = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => m.includes("cross-module-event"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Drop the "a::" prefix: publish("tick")');
    system.destroy();
  });
});

describe("a namespaced gate (G6)", () => {
  it("reads its own module's facts by bare name", async () => {
    const calls: string[] = [];
    const system = createSystem({
      modules: {
        a: gatedModule({
          g: {
            active: (f: any) => f.open,
            attach: () => {
              calls.push("attach");

              return () => calls.push("detach");
            },
          },
        }),
      },
    } as any) as any;
    system.start();
    expect(calls).toEqual(["attach"]);
    system.facts.a.open = false;
    await system.settle();
    expect(calls).toEqual(["attach", "detach"]);
    system.destroy();
  });
});
