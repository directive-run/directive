/**
 * L5c: the two owner-approved source leak fixes (rows (ad) and (ae),
 * 2026-11-01), pinned on core-next itself.
 *
 * - (ad) 1.35: a stop() inside a source's attach, during start's attach
 *   loop, leaves that source and every one after it attached and never
 *   unsubscribed; inspect reports them attached while stopped, and the next
 *   start attaches them again. 2.0: the stop ends the loop and the stopping
 *   source is detached as soon as its attach returns.
 * - (ae) 1.35: a gateLingerMs timer that fires while stopAsync() awaits an
 *   unsubscribe attaches a subscription nothing unsubscribes. 2.0: stopAsync
 *   clears the gate timers before its first await.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withInspect } from "../api/inspect.js";
import { withPlugins } from "../api/plugins.js";
import { t } from "../api/schema-builders.js";
import { withSources } from "../api/sources.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function module(sources: Record<string, unknown>) {
  return createModule("m", {
    schema: {
      facts: { open: t.boolean(), room: t.string() },
      derivations: {},
      events: {},
    },
    init: (facts: any) => {
      facts.open = true;
      facts.room = "a";
    },
    sources,
  } as any);
}

/** Plugin events and the subscriptions each source holds open. */
function recorder() {
  const log: string[] = [];
  const open = new Map<string, number>();
  const plugin = {
    name: "rec",
    onSourceAttach: (id: string) => log.push(`attach ${id}`),
    onSourceDetach: (id: string) => log.push(`detach ${id}`),
  };
  /** A source that logs its subscribe and unsubscribe; `then` runs inside attach. */
  const source = (id: string, then?: () => void) => ({
    attach: () => {
      log.push(`on ${id}`);
      open.set(id, (open.get(id) ?? 0) + 1);
      then?.();

      return () => {
        log.push(`off ${id}`);
        open.set(id, open.get(id)! - 1);
      };
    },
  });
  const live = () => [...open.values()].reduce((a, b) => a + b, 0);

  return { log, live, plugin, source };
}

const attachedRows = (system: any) =>
  system
    .inspect()
    .sources.filter((row: { attached: boolean }) => row.attached)
    .map((row: { id: string }) => row.id);

describe("(ad) a stop inside an attach during start", () => {
  for (const mode of ["stop", "stopAsync"] as const) {
    it(`${mode}(): ends the loop, leaves nothing attached, and the next start attaches each source once`, async () => {
      const { log, live, plugin, source } = recorder();
      let stopping: unknown;
      let first = true;
      const system: any = createSystem({
        module: module({
          s0: source("s0"),
          s1: source("s1", () => {
            if (first) {
              first = false;
              stopping = system[mode]();
            }
          }),
          s2: source("s2"),
          g: { active: (f: any) => f.open, ...source("g") },
        }),
        plugins: [plugin as any],
      } as any);
      system.start();
      await stopping;

      // The stop detaches s0; s1 goes when its attach returns; s2 and the
      // gate never attach. 1.35 leaves s1, s2 and g attached.
      expect(log).toEqual([
        "on s0",
        "attach s0",
        "on s1",
        "detach s0",
        "off s0",
        "attach s1",
        "detach s1",
        "off s1",
      ]);
      expect(system.isRunning).toBe(false);
      expect(live()).toBe(0);
      expect(system.inspect().attachedSourceCount).toBe(0);
      expect(attachedRows(system)).toEqual([]);

      log.length = 0;
      system.start();
      expect(log.filter((line) => line.startsWith("on "))).toEqual([
        "on s0",
        "on s1",
        "on s2",
        "on g",
      ]);
      expect(live()).toBe(4);
      expect(system.inspect().attachedSourceCount).toBe(4);
      system.destroy();
      expect(live()).toBe(0);
    });
  }

  it("inside a gated attach at start: ends the gate pass the same way", () => {
    const { log, live, plugin, source } = recorder();
    let first = true;
    const system: any = createSystem({
      module: module({
        u: source("u"),
        g1: {
          active: (f: any) => f.open,
          ...source("g1", () => {
            if (first) {
              first = false;
              system.stop();
            }
          }),
        },
        g2: { active: (f: any) => f.open, ...source("g2") },
      }),
      plugins: [plugin as any],
    } as any);
    system.start();

    expect(log).toEqual([
      "on u",
      "attach u",
      "on g1",
      "detach u",
      "off u",
      "attach g1",
      "detach g1",
      "off g1",
    ]);
    expect(live()).toBe(0);
    expect(system.inspect().attachedSourceCount).toBe(0);

    log.length = 0;
    system.start();
    expect(log.filter((line) => line.startsWith("on "))).toEqual([
      "on u",
      "on g1",
      "on g2",
    ]);
    expect(live()).toBe(3);
    system.destroy();
    expect(live()).toBe(0);
  });
});

describe("(ae) a linger pending at stopAsync", () => {
  it("is cleared before the first await, so nothing attaches during or after the stop", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clock = createVirtualClock(0);
    const { log, live, plugin, source } = recorder();
    const system = createSystemCore(
      {
        module: module({
          // Unsubscribed last (reverse attach order), in 200 ms.
          slow: {
            attach: () => () =>
              new Promise<void>((resolve) =>
                clock.setTimeout(() => {
                  log.push("off slow");
                  resolve();
                }, 200),
              ),
          },
          chat: {
            key: (f: any) => f.room,
            gateLingerMs: 100,
            attach: (_p: unknown, _r: unknown, ctx: { key: string }) =>
              source(`chat ${ctx.key}`).attach(),
          },
        }),
      } as any,
      [withSources, withInspect, withPlugins([plugin as any])],
      { clock },
    ) as any;
    system.start();
    system.facts.room = "b";
    await system.settle();
    // The re-key lingers: a stays attached until 100 ms.
    expect(clock.timers().map((timer) => timer.deadline)).toEqual([100]);

    const stopping = system.stopAsync();
    // Before the first await: the linger is gone (the one timer left is
    // the unsubscribe's own timeout).
    expect(clock.timers().map((timer) => timer.deadline)).not.toContain(100);
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    // Past the linger's deadline, while slow's unsubscribe is awaited.
    clock.advanceTo(150);
    clock.advanceTo(400);
    await stopping;

    // 1.35 attaches "chat b" at 100 ms and never unsubscribes it.
    expect(log).toEqual([
      "attach slow",
      "on chat a",
      "attach chat",
      "detach chat",
      "off chat a",
      "detach slow",
      "off slow",
    ]);
    expect(live()).toBe(0);
    expect(system.inspect().attachedSourceCount).toBe(0);
    expect(attachedRows(system)).toEqual([]);
    expect(clock.timers()).toEqual([]);

    log.length = 0;
    system.start();
    expect(log.filter((line) => line.startsWith("on "))).toEqual(["on chat b"]);
    expect(system.inspect().attachedSourceCount).toBe(2);
    system.destroy();
    expect(live()).toBe(0);
  });
});
