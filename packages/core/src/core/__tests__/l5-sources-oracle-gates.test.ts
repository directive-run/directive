import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box rewrites of the gated, keyed, linger and coalesce cases in
// `sources.test.ts` (WHITE-BOX.md maps each one). A gate is evaluated after
// every pass, so each test writes a fact and settles. Public API only; the
// development warnings a failing gate prints are silenced, never asserted.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Publish = (eventName: string, payload?: unknown) => void;

/** A plugin that records the source hooks a test reads, in order. */
function recorder() {
  const log: unknown[][] = [];
  const plugin = {
    name: "sources-recorder",
    onSourceAttach: (id: string) => {
      log.push(["attach", id]);
    },
    onSourcePublish: (id: string, _moduleId: string, eventName: string) => {
      log.push(["publish", id, eventName]);
    },
    onSourceDrop: (
      id: string,
      _moduleId: string,
      eventName: string,
      reason: string,
    ) => {
      log.push(["drop", id, eventName, reason]);
    },
    onSourceDetach: (id: string) => {
      log.push(["detach", id]);
    },
    onSourceError: (id: string, moduleId: string, phase: string) => {
      log.push(["error", id, moduleId, phase]);
    },
  };

  return { log, plugin };
}

const kinds = (log: unknown[][], kind: string) =>
  log.filter((entry) => entry[0] === kind);

/**
 * Module `m`. Facts: `on` (boolean), `id` (string or null), `n` (number),
 * `other` (an unrelated number). Events: `tick` records its payload.
 */
function gatedModule(sources: Record<string, unknown>, seen: unknown[] = []) {
  return createModule("m", {
    schema: {
      facts: {
        on: t.boolean(),
        id: t.string().nullable(),
        n: t.number(),
        other: t.number(),
      },
      derivations: {},
      events: { tick: { v: t.number() }, connected: {} },
    },
    init: (facts: any) => {
      facts.on = false;
      facts.id = null;
      facts.n = 0;
      facts.other = 0;
    },
    events: {
      tick: (_facts: any, event: any) => {
        seen.push(["tick", event.v]);
      },
      connected: () => {
        seen.push(["connected"]);
      },
    },
    sources,
  } as any);
}

async function write(system: any, key: string, value: unknown) {
  system.facts[key] = value;
  await system.settle();
}

describe("an active gate", () => {
  it("attaches nothing before it first opens, attaches on its rising edge, and unsubscribes when it closes", async () => {
    const attach = vi.fn();
    const unsubscribe = vi.fn();
    const system = createSystem({
      module: gatedModule({
        s: {
          active: (facts: any) => facts.on === true,
          attach: (publish: Publish) => {
            attach(publish);

            return unsubscribe;
          },
        },
      }),
    } as any);
    system.start();
    await system.settle();
    expect(attach).not.toHaveBeenCalled();
    await write(system, "other", 1);
    expect(attach).not.toHaveBeenCalled();

    await write(system, "on", true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();

    await write(system, "on", false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    system.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("that returns a truthy non-boolean fails closed; exactly true attaches", async () => {
    const attach = vi.fn(() => () => undefined);
    const system = createSystem({
      module: gatedModule({
        s: {
          active: (facts: any) => (facts.n === 2 ? true : facts.n),
          attach,
        },
      }),
    } as any);
    system.start();
    await write(system, "n", 5);
    expect(attach).not.toHaveBeenCalled();
    await write(system, "n", 2);
    expect(attach).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  it("is the same as the key form that returns a fixed key when open and null when closed", async () => {
    const run = async (gate: Record<string, unknown>) => {
      const order: string[] = [];
      const system = createSystem({
        module: gatedModule({
          s: {
            ...gate,
            attach: () => {
              order.push("attach");

              return () => {
                order.push("detach");
              };
            },
          },
        }),
      } as any);
      system.start();
      await write(system, "on", false);
      await write(system, "on", true);
      await write(system, "other", 1);
      await write(system, "on", false);
      system.destroy();

      return order;
    };
    const active = await run({ active: (facts: any) => facts.on === true });
    const keyed = await run({
      key: (facts: any) => (facts.on === true ? "__on__" : null),
    });
    expect(active).toEqual(["attach", "detach"]);
    expect(keyed).toEqual(active);
  });

  it("drops a publish made through the handle after the gate closed, as gate-closed", async () => {
    const handles: Record<string, Publish> = {};
    const seen: unknown[] = [];
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule(
        {
          s: {
            active: (facts: any) => facts.on === true,
            attach: (publish: Publish) => {
              handles.s = publish;

              return () => undefined;
            },
          },
        },
        seen,
      ),
      plugins: [plugin],
    } as any);
    system.start();
    await write(system, "on", true);
    await write(system, "on", false);
    handles.s!("tick", { v: 1 });
    await system.settle();
    expect(seen).toEqual([]);
    expect(kinds(log, "drop")).toEqual([["drop", "s", "tick", "gate-closed"]]);
    expect(kinds(log, "publish")).toEqual([]);
    system.destroy();
  });
});

describe("an ungated source", () => {
  it("attaches once at start with no gate context, and fact writes never attach it again", async () => {
    const unsubscribe = vi.fn();
    const attach = vi.fn(
      (_publish: Publish, _reportError?: unknown, _ctx?: unknown) =>
        unsubscribe,
    );
    const system = createSystem({
      module: gatedModule({ s: { attach } }),
    } as any);
    system.start();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[2]).toBeUndefined();
    await write(system, "on", true);
    await write(system, "other", 1);
    expect(attach).toHaveBeenCalledTimes(1);
    system.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    system.destroy();
  });
});

describe("a key gate", () => {
  it("passes the key to attach, and a re-key tears the old subscription down before attaching the new one", async () => {
    const order: string[] = [];
    const system = createSystem({
      module: gatedModule({
        s: {
          key: (facts: any) => (facts.id ? `game:${facts.id}` : null),
          attach: (_publish: Publish, _reportError: unknown, ctx: any) => {
            order.push(`attach ${ctx?.key}`);

            return () => {
              order.push(`detach ${ctx?.key}`);
            };
          },
        },
      }),
    } as any);
    system.start();
    await write(system, "id", "42");
    await write(system, "id", "99");
    expect(order).toEqual([
      "attach game:42",
      "detach game:42",
      "attach game:99",
    ]);
    system.destroy();
  });

  it("gives a re-keyed source an empty coalesce buffer: the new key's first publish is not coalesced against the old key's", async () => {
    const handles: Record<string, Publish> = {};
    const seen: unknown[] = [];
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule(
        {
          s: {
            coalesce: "lastWriteWins",
            key: (facts: any) => facts.id,
            attach: (publish: Publish, _reportError: unknown, ctx: any) => {
              handles[ctx.key] = publish;
              if (ctx.key === "B") {
                publish("tick", { v: 2 });
              }

              return () => undefined;
            },
          },
        },
        seen,
      ),
      plugins: [plugin],
    } as any);
    system.start();
    await write(system, "id", "A");
    // The re-key is written first, then A publishes in the same tick: the
    // pass that re-keys runs before A's flush, and B seeds a publish of the
    // same event from its attach.
    (system.facts as any).id = "B";
    handles.A!("tick", { v: 1 });
    await system.settle();
    await system.settle();
    expect(seen).toEqual([["tick", 2]]);
    expect(
      kinds(log, "drop").filter((entry) => entry[3] === "coalesced"),
    ).toEqual([]);
    system.destroy();
  });

  it("that throws fails closed: the source detaches and the error is reported with phase gate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribe = vi.fn();
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({
        s: {
          key: (facts: any) => {
            if (facts.on) {
              throw new Error("gate boom");
            }

            return "k";
          },
          attach: () => unsubscribe,
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    await system.settle();
    expect(kinds(log, "attach")).toEqual([["attach", "s"]]);
    await write(system, "on", true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(kinds(log, "error")).toEqual([["error", "s", "m", "gate"]]);
    system.destroy();
  });

  it("that returns neither a string nor null fails closed with phase gate, and attaches nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const attach = vi.fn(() => () => undefined);
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule({
        s: { key: (facts: any) => (facts.on ? 42 : null), attach },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    await write(system, "on", true);
    expect(attach).not.toHaveBeenCalled();
    expect(kinds(log, "error")).toEqual([["error", "s", "m", "gate"]]);
    system.destroy();
  });
});

describe("gateLingerMs", () => {
  function lingering(gate: Record<string, unknown>) {
    const events: string[] = [];
    const system = createSystem({
      module: gatedModule({
        s: {
          ...gate,
          gateLingerMs: 100,
          attach: (_publish: Publish, _reportError: unknown, ctx: any) => {
            events.push(`attach ${ctx?.key}`);

            return () => {
              events.push(`detach ${ctx?.key}`);
            };
          },
        },
      }),
    } as any);
    system.start();

    return { events, system };
  }

  const active = { active: (facts: any) => facts.on === true };
  const keyed = { key: (facts: any) => (facts.id ? `game:${facts.id}` : null) };

  it("cancels the teardown when the gate opens again inside the window", async () => {
    vi.useFakeTimers();
    const { events, system } = lingering(active);
    await write(system, "on", true);
    await write(system, "on", false);
    expect(events).toEqual(["attach __on__"]);
    await vi.advanceTimersByTimeAsync(50);
    await write(system, "on", true);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual(["attach __on__"]);
    system.destroy();
  });

  it("tears down at the end of the window when the gate stays closed", async () => {
    vi.useFakeTimers();
    const { events, system } = lingering(active);
    await write(system, "on", true);
    await write(system, "on", false);
    expect(events).toEqual(["attach __on__"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(["attach __on__", "detach __on__"]);
    system.destroy();
  });

  it("defers a re-key's teardown and attach to the end of the window", async () => {
    vi.useFakeTimers();
    const { events, system } = lingering(keyed);
    await write(system, "id", "1");
    await write(system, "id", "2");
    expect(events).toEqual(["attach game:1"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(["attach game:1", "detach game:1", "attach game:2"]);
    system.destroy();
  });

  it("tears the committed key down at once when the key moves to a third value inside the window", async () => {
    vi.useFakeTimers();
    const { events, system } = lingering(keyed);
    await write(system, "id", "1");
    await write(system, "id", "2");
    await write(system, "id", "3");
    expect(events).toEqual(["attach game:1", "detach game:1", "attach game:3"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toEqual(["attach game:1", "detach game:1", "attach game:3"]);
    system.destroy();
  });

  it("is cleared by stop(): the source unsubscribes once at stop, and nothing fires when the window would have ended", async () => {
    vi.useFakeTimers();
    const { events, system } = lingering(active);
    await write(system, "on", true);
    await write(system, "on", false);
    system.stop();
    expect(events).toEqual(["attach __on__", "detach __on__"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toEqual(["attach __on__", "detach __on__"]);
    system.destroy();
  });
});

describe("coalesce", () => {
  function coalescing(coalesce: string | undefined, seen: unknown[]) {
    const handles: Record<string, Publish> = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: gatedModule(
        {
          s: {
            ...(coalesce ? { coalesce } : {}),
            attach: (publish: Publish) => {
              handles.s = publish;

              return () => undefined;
            },
          },
        },
        seen,
      ),
      plugins: [plugin],
    } as any);
    system.start();

    return { handles, log, system };
  }

  it("lastWriteWins dispatches only the last of a burst, after the current task, and each superseded publish is a coalesced drop", async () => {
    const seen: unknown[] = [];
    const { handles, log, system } = coalescing("lastWriteWins", seen);
    for (const v of [1, 2, 3, 4, 5]) {
      handles.s!("tick", { v });
    }
    expect(seen).toEqual([]);
    await system.settle();
    expect(seen).toEqual([["tick", 5]]);
    expect(kinds(log, "publish")).toEqual([["publish", "s", "tick"]]);
    expect(kinds(log, "drop")).toEqual(
      Array.from({ length: 4 }, () => ["drop", "s", "tick", "coalesced"]),
    );
    system.destroy();
  });

  it("lastWriteWins coalesces per event name, and flushes in first-publish order", async () => {
    const seen: unknown[] = [];
    const { handles, system } = coalescing("lastWriteWins", seen);
    handles.s!("tick", { v: 1 });
    handles.s!("tick", { v: 2 });
    handles.s!("connected", {});
    handles.s!("tick", { v: 3 });
    expect(seen).toEqual([]);
    await system.settle();
    expect(seen).toEqual([["tick", 3], ["connected"]]);
    system.destroy();
  });

  it('"all", and no coalesce option, dispatch every publish at once', () => {
    for (const coalesce of ["all", undefined]) {
      const seen: unknown[] = [];
      const { handles, system } = coalescing(coalesce, seen);
      handles.s!("tick", { v: 1 });
      handles.s!("tick", { v: 2 });
      expect(seen).toEqual([
        ["tick", 1],
        ["tick", 2],
      ]);
      system.destroy();
    }
  });
});
