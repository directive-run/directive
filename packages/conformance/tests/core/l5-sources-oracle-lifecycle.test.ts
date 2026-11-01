// Ported from packages/core/src/core/__tests__/l5-sources-oracle-lifecycle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box rewrites of the `createSourcesManager` cases in
// `sources.test.ts` (WHITE-BOX.md maps each one), plus the L5-pre pins U5,
// U7 and U8 (packages/core-next/docs/rfc-l5-sources.md). A source is declared
// on a module's `sources:` key and observed through its own callbacks and the
// plugin source hooks. Public API only; logged text is never asserted.

afterEach(() => {
  vi.restoreAllMocks();
});

type Publish = (eventName: string, payload?: unknown) => void;

/** A plugin that records every source hook it hears, in order. */
function recorder() {
  const log: unknown[][] = [];
  const plugin = {
    name: "sources-recorder",
    onSourceAttach: (id: string, moduleId: string) => {
      log.push(["attach", id, moduleId]);
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
    onSourceDetach: (id: string, moduleId: string) => {
      log.push(["detach", id, moduleId]);
    },
    onSourceError: (
      id: string,
      moduleId: string,
      phase: string,
      error: unknown,
    ) => {
      log.push(["error", id, moduleId, phase, (error as Error).message]);
    },
  };

  return { log, plugin };
}

const kinds = (log: unknown[][], kind: string) =>
  log.filter((entry) => entry[0] === kind);

/** Module `m`: `poke` counts into `hits`, `seed` writes `seeded`. */
function sourceModule(sources: Record<string, unknown>) {
  return createModule("m", {
    schema: {
      facts: { hits: t.number(), seeded: t.number(), open: t.boolean() },
      derivations: {},
      events: { poke: {}, seed: { n: t.number() } },
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

describe("sources follow attach order", () => {
  it("at stop, with a gated source declared first: attach is ungated first, and each detach is heard before its unsubscribe, in reverse", async () => {
    const order: string[] = [];
    const source = (name: string, gated: boolean) => ({
      ...(gated ? { active: (facts: any) => facts.open } : {}),
      attach: () => {
        order.push(`attach ${name}`);

        return () => {
          order.push(`unsubscribe ${name}`);
        };
      },
    });
    const plugin = {
      name: "detach-order",
      onSourceDetach: (id: string) => {
        order.push(`detach ${id}`);
      },
    };
    const system = createSystem({
      module: sourceModule({
        g1: source("g1", true),
        u2: source("u2", false),
        u3: source("u3", false),
      }),
      plugins: [plugin],
    } as any);
    system.start();
    await system.settle();
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

  it("at evict, with a gated source declared first: onEvict runs in attach order, then the unsubscribes in reverse", async () => {
    const order: string[] = [];
    const source = (name: string, gated: boolean) => ({
      ...(gated ? { active: (facts: any) => facts.open } : {}),
      attach: () => () => {
        order.push(`unsubscribe ${name}`);
      },
      onEvict: () => {
        order.push(`evict ${name}`);
      },
    });
    const system = createSystem({
      module: sourceModule({
        g1: source("g1", true),
        u2: source("u2", false),
        u3: source("u3", false),
      }),
    } as any);
    system.start();
    await system.settle();
    await system.evict();
    expect(order).toEqual([
      "evict u2",
      "evict u3",
      "evict g1",
      "unsubscribe g1",
      "unsubscribe u3",
      "unsubscribe u2",
    ]);
  });
});

describe("an attach that does not return an unsubscribe function", () => {
  it("is an attach error naming its module, and the source is never attached or detached (undefined, null, a number, a string)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of [undefined, null, 0, "no"]) {
      const { log, plugin } = recorder();
      const system = createSystem({
        module: sourceModule({ forgot: { attach: () => value } }),
        plugins: [plugin],
      } as any);
      system.start();
      expect(kinds(log, "attach")).toEqual([]);
      expect(kinds(log, "error").map((entry) => entry.slice(0, 4))).toEqual([
        ["error", "forgot", "m", "attach"],
      ]);

      system.stop();
      expect(kinds(log, "detach")).toEqual([]);
      system.destroy();
    }
  });

  it("is an attach error that names the Promise when attach returns one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { log, plugin } = recorder();
    const system = createSystem({
      module: sourceModule({
        eager: { attach: async () => () => undefined },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const errors = kinds(log, "error");
    expect(errors.map((entry) => entry.slice(0, 4))).toEqual([
      ["error", "eager", "m", "attach"],
    ]);
    expect(String(errors[0]?.[4])).toMatch(/Promise/);
    expect(kinds(log, "attach")).toEqual([]);
    system.destroy();
  });

  it("leaves the publish handle live: a publish through it still dispatches and is heard, with no attach (U8)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handles: Record<string, Publish> = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: sourceModule({
        s: {
          attach: (publish: Publish) => {
            handles.s = publish;

            return Promise.resolve(() => undefined);
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    await system.settle();
    handles.s!("poke");
    await system.settle();
    expect((system.facts as any).hits).toBe(1);
    expect(kinds(log, "publish")).toEqual([["publish", "s", "poke"]]);
    expect(kinds(log, "attach")).toEqual([]);
    system.destroy();
  });
});

describe("a source's unsubscribe at stop", () => {
  it("that throws is a cleanup error, and the other sources still unsubscribe, in reverse", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubscribed: string[] = [];
    const { log, plugin } = recorder();
    const system = createSystem({
      module: sourceModule({
        first: { attach: () => () => unsubscribed.push("first") },
        bad: {
          attach: () => () => {
            throw new Error("teardown failed");
          },
        },
        last: { attach: () => () => unsubscribed.push("last") },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    system.stop();
    expect(unsubscribed).toEqual(["last", "first"]);
    expect(kinds(log, "error").map((entry) => entry.slice(0, 4))).toEqual([
      ["error", "bad", "m", "cleanup"],
    ]);
    system.destroy();
  });

  it("runs once: a second stop(), and destroy() after stop(), unsubscribe nothing more", () => {
    let unsubscribed = 0;
    const system = createSystem({
      module: sourceModule({
        s: {
          attach: () => () => {
            unsubscribed += 1;
          },
        },
      }),
    } as any);
    system.start();
    system.stop();
    system.stop();
    system.destroy();
    expect(unsubscribed).toBe(1);
  });

  it("never runs on a system that was never started, and nothing attaches", () => {
    let attached = 0;
    let unsubscribed = 0;
    const system = createSystem({
      module: sourceModule({
        idle: {
          attach: () => {
            attached += 1;

            return () => {
              unsubscribed += 1;
            };
          },
        },
      }),
    } as any);
    system.stop();
    system.destroy();
    expect(attached).toBe(0);
    expect(unsubscribed).toBe(0);
  });
});

describe("stop then start", () => {
  it("attaches the source again, and each cycle unsubscribes once and publishes into the running system", async () => {
    const handles: Record<string, Publish> = {};
    const { log, plugin } = recorder();
    let attached = 0;
    let unsubscribed = 0;
    const system = createSystem({
      module: sourceModule({
        cycler: {
          attach: (publish: Publish) => {
            attached += 1;
            handles.cycler = publish;

            return () => {
              unsubscribed += 1;
            };
          },
        },
      }),
      plugins: [plugin],
    } as any);
    for (let cycle = 1; cycle <= 3; cycle++) {
      system.start();
      expect(attached).toBe(cycle);
      handles.cycler!("poke");
      await system.settle();
      expect((system.facts as any).hits).toBe(cycle);
      system.stop();
      expect(unsubscribed).toBe(cycle);
    }
    expect(kinds(log, "attach")).toHaveLength(3);
    expect(kinds(log, "detach")).toHaveLength(3);
    system.destroy();
    expect(unsubscribed).toBe(3);
  });
});

describe("a publish", () => {
  it("is attributed to the source that made it, when two sources publish the same event", () => {
    const { log, plugin } = recorder();
    const system = createSystem({
      module: sourceModule({
        sourceA: {
          attach: (publish: Publish) => {
            publish("poke");

            return () => undefined;
          },
        },
        sourceB: {
          attach: (publish: Publish) => {
            publish("poke");

            return () => undefined;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    expect(kinds(log, "publish")).toEqual([
      ["publish", "sourceA", "poke"],
      ["publish", "sourceB", "poke"],
    ]);
    expect((system.facts as any).hits).toBe(2);
    system.destroy();
  });

  it("made inside attach at start is applied before start() returns, for an ungated and a gated source (U5)", () => {
    for (const gate of [{}, { active: (facts: any) => facts.open }]) {
      const system = createSystem({
        module: sourceModule({
          seeder: {
            ...gate,
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
    }
  });
});

describe("reportError", () => {
  it("reports a runtime error to plugins while attached, and does nothing after detach", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { log, plugin } = recorder();
    let reportError: ((error: Error) => void) | undefined;
    const system = createSystem({
      module: sourceModule({
        ws: {
          attach: (_publish: Publish, report: (error: Error) => void) => {
            reportError = report;

            return () => undefined;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    reportError!(new Error("socket closed"));
    const errors = kinds(log, "error");
    expect(errors.map((entry) => entry.slice(0, 4))).toEqual([
      ["error", "ws", "m", "runtime"],
    ]);
    expect(String(errors[0]?.[4])).toContain("socket closed");

    system.stop();
    reportError!(new Error("late"));
    expect(kinds(log, "error")).toHaveLength(1);
    system.destroy();
  });
});

describe("a source error's message", () => {
  it("reaches plugins cut to its first 256 characters", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const huge = "Z".repeat(2048);
    const { log, plugin } = recorder();
    const system = createSystem({
      module: sourceModule({
        leaky: {
          attach: () => {
            throw new Error(huge);
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    const message = String(kinds(log, "error")[0]?.[4]);
    expect(message.length).toBeLessThan(huge.length);
    expect(message.startsWith("Z".repeat(256))).toBe(true);
    expect(message.startsWith("Z".repeat(257))).toBe(false);
    system.destroy();
  });
});
