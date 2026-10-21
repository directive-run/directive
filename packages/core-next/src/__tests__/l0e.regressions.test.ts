/**
 * L0e (the size rewrite of the system core, facts store, scheduler and real
 * clock): pins the orderings and guarantees the smaller implementations must
 * keep, where the conformance suite does not reach.
 */
import { describe, expect, it } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { createFacts, isRunawayError, listen } from "../api/facts.js";
import { t } from "../api/schema-builders.js";
import { createVirtualClock } from "../clock.js";
import type { KernelEvent } from "../kernel.js";
import {
  type SchedulerTarget,
  catcher,
  createScheduler,
} from "../scheduler.js";

describe("scheduler (Set-based queues)", () => {
  it("a target requested earlier in its own pass flushes once in that pass", () => {
    const s = createScheduler();
    const log: string[] = [];
    const b: SchedulerTarget = { flush: () => log.push("b") };
    const a: SchedulerTarget = {
      flush: () => {
        log.push("a");
        s.request("manual", b);
      },
    };
    s.register(a);
    s.register(b);
    s.request("manual", b);
    s.request("manual", a);
    s.flush("manual");
    // Registration order, and b's request from a's flush is met by b's
    // flush in the same pass.
    expect(log).toEqual(["a", "b"]);
  });

  it("a request from a target's own flush gets another pass", () => {
    const s = createScheduler();
    let runs = 0;
    const self: SchedulerTarget = {
      flush: () => {
        if (++runs < 3) {
          s.request("manual", self);
        }
      },
    };
    s.request("manual", self);
    s.flush("manual");
    expect(runs).toBe(3);
    expect(s.pending()).toBe(false);
  });

  it("past maxPasses it throws, drops the waiters, and later requests flush", () => {
    const s = createScheduler({ maxPasses: 5 });
    let runs = 0;
    let loop = true;
    const self: SchedulerTarget = {
      flush: () => {
        runs++;
        if (loop) {
          s.request("manual", self);
        }
      },
    };
    s.request("manual", self);
    expect(() => s.flush("manual")).toThrow(/manual lane did not settle/);
    expect(runs).toBe(5);
    expect(s.pending("manual")).toBe(false);
    loop = false;
    s.request("manual", self);
    s.flush("manual");
    expect(runs).toBe(6);
  });

  it("an unregistered target is dropped from every lane", () => {
    const s = createScheduler({ micro: () => {} });
    const target: SchedulerTarget = { flush: () => {} };
    s.request("micro", target);
    s.request("manual", target);
    expect(s.pending()).toBe(true);
    s.unregister(target);
    expect(s.pending()).toBe(false);
    // Registering again ranks it after every target seen so far.
    const other: SchedulerTarget = { flush: () => {} };
    expect(s.register(other)).toBe(1);
    expect(s.register(target)).toBe(2);
  });
});

describe("catcher", () => {
  it("runs every step and rethrows the first error once asked", () => {
    const guard = catcher();
    const ran: number[] = [];
    guard(() => {
      ran.push(1);
      throw new Error("first");
    });
    guard(() => {
      ran.push(2);
      throw new Error("second");
    });
    guard(() => ran.push(3));
    expect(ran).toEqual([1, 2, 3]);
    expect(() => guard()).toThrow("first");
    expect(() => catcher()()).not.toThrow();
  });
});

describe("facts store (shared listener helper)", () => {
  it("listen adds under each key and its remover takes the listener off", () => {
    const map = new Map<string, Set<() => void>>();
    let n = 0;
    const off = listen(map, ["a", "b"], () => n++);
    map.get("a")!.forEach((fn) => fn());
    map.get("b")!.forEach((fn) => fn());
    off();
    map.get("a")?.forEach((fn) => fn());
    expect(n).toBe(2);
  });

  it("key and catch-all listeners fire per write and stop when removed", () => {
    const { store } = createFacts({ schema: { a: t.number(), b: t.number() } });
    const log: string[] = [];
    const offA = store.subscribe(["a"], () => log.push("a"));
    const offAll = store.subscribeAll(() => log.push("*"));
    store.set("a", 1);
    store.set("b", 1);
    store.batch(() => {
      store.set("a", 2);
      store.set("b", 2);
    });
    offA();
    offAll();
    store.set("a", 3);
    expect(log).toEqual(["a", "*", "*", "a", "*"]);
  });

  it("a listener that keeps writing is cut after 100 rounds, as a runaway", () => {
    const { store } = createFacts({ schema: { a: t.number() } });
    store.subscribe(["a"], () => store.set("a", (store.get("a") ?? 0) + 1));
    let caught: unknown;
    try {
      store.set("a", 1);
    } catch (error) {
      caught = error;
    }
    expect(isRunawayError(caught)).toBe(true);
    expect(String(caught)).toMatch(/repeatedly mutating/);
  });
});

describe("system core", () => {
  it("invalidates depth first from each fact subscriber, as before", () => {
    const events: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number() },
        derivations: {
          x: t.number(),
          p: t.number(),
          q: t.number(),
          z: t.number(),
        },
      },
      init: (facts) => {
        facts.a = 0;
      },
      derive: {
        x: (facts) => facts.a + 1,
        p: (_facts, derived) => derived.x + 1,
        q: (_facts, derived) => derived.x + 2,
        z: (facts) => facts.a + 3,
      },
    });
    const system = createSystemCore({ module: mod }, [
      ({ kernel }) => {
        kernel.hooks.on((e: KernelEvent) => {
          if (e.at === "derivation.invalidate") {
            events.push(e.id as string);
          }
        });
      },
    ]);
    system.start();
    system.facts.a = 1;
    // a's subscribers in link order (x, z); below x, last linked first.
    expect(events).toEqual(["x", "q", "p", "z"]);
  });

  it("system timers belong to the system and go with destroy", async () => {
    const clock = createVirtualClock();
    const mod = createModule("m", {
      schema: { facts: { a: t.number() }, derivations: {} },
    });
    const system = createSystemCore({ module: mod }, [], { clock });
    system.start();
    const waiting = system.when((facts) => facts.a === 1, { timeout: 50 });
    expect(clock.timers()).toHaveLength(1);
    system.facts.a = 1;
    await waiting;
    expect(clock.timers()).toEqual([]);
    system.destroy();
  });

  it("DirectiveError keeps 1.35's own fields, in order", () => {
    const seen: unknown[] = [];
    const mod = createModule("m", {
      schema: { facts: { a: t.number() }, derivations: { bad: t.number() } },
      derive: {
        bad: () => {
          throw new Error("nope");
        },
      },
    });
    createSystemCore({ module: mod }, [
      ({ kernel }) => {
        kernel.hooks.on((e: KernelEvent) => {
          if (e.at === "error") {
            seen.push(e.error);
          }
        });
      },
    ]).start();
    const error = seen[0] as Record<string, unknown>;
    expect(error).toBeInstanceOf(Error);
    expect(Object.keys(error)).toEqual([
      "source",
      "sourceId",
      "context",
      "recoverable",
      "name",
    ]);
    expect(error).toMatchObject({
      name: "DirectiveError",
      message: "nope",
      source: "derivation",
      sourceId: "bad",
      recoverable: true,
    });
  });
});
