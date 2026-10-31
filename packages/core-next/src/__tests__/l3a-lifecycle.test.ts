import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const counter = (id = "c", hooks?: Record<string, () => void>) =>
  createModule(id, {
    schema: { facts: { count: t.number() }, events: { tick: {} } },
    init: (facts: any) => {
      facts.count = 0;
    },
    events: {
      tick: (facts: any) => {
        facts.count += 1;
      },
    },
    ...(hooks ? { hooks } : {}),
  } as never);

describe("L3a readiness (S1)", () => {
  it("isReady turns true after the first pass ends, not at its start or its end record", async () => {
    const seen: string[] = [];
    const sys: any = createSystem({
      module: counter(),
      plugins: [
        {
          name: "watch",
          onReconcileStart: () => seen.push(`start:${sys.isReady}`),
          onReconcileEnd: () => seen.push(`end:${sys.isReady}`),
        },
      ],
    } as never);
    expect(sys.isReady).toBe(false);
    sys.start();
    expect(sys.isReady).toBe(false);
    await sys.settle();
    expect(seen.slice(0, 2)).toEqual(["start:false", "end:false"]);
    expect(sys.isReady).toBe(true);
    // A restart keeps it: readiness is reached once.
    sys.stop();
    expect(sys.isReady).toBe(true);
    sys.destroy();
  });

  it("whenReady() is one shared promise while waiting, and rejects before start()", async () => {
    const sys: any = createSystem({ module: counter() } as never);
    await expect(sys.whenReady()).rejects.toThrow("before start()");
    sys.start();
    const first = sys.whenReady();
    expect(sys.whenReady()).toBe(first);
    await first;
    expect(sys.isReady).toBe(true);
    await expect(sys.whenReady()).resolves.toBeUndefined();
    sys.destroy();
  });
});

describe("L3a module hooks (S2)", () => {
  it("modules in init order, before the plugins, at create, start, stop and destroy", async () => {
    const order: string[] = [];
    const hooks = (ns: string) => ({
      onInit: () => order.push(`${ns}.onInit`),
      onStart: () => order.push(`${ns}.onStart`),
      onStop: () => order.push(`${ns}.onStop`),
    });
    const sys: any = createSystem({
      modules: { a: counter("a", hooks("a")), b: counter("b", hooks("b")) },
      plugins: [
        {
          name: "p",
          onInit: () => {
            order.push("p.onInit");
          },
          onStart: () => order.push("p.onStart"),
          onStop: () => order.push("p.onStop"),
          onDestroy: () => order.push("p.onDestroy"),
        },
      ],
    } as never);
    expect(order).toEqual(["p.onInit", "a.onInit", "b.onInit"]);
    sys.start();
    sys.start();
    await sys.settle();
    sys.stop();
    sys.start();
    await sys.destroyAsync();
    await sys.destroyAsync();
    expect(order.slice(3)).toEqual([
      "a.onStart",
      "b.onStart",
      "p.onStart",
      "a.onStop",
      "b.onStop",
      "p.onStop",
      "a.onStart",
      "b.onStart",
      "p.onStart",
      "a.onStop",
      "b.onStop",
      "p.onStop",
      "p.onDestroy",
    ]);
  });

  // 1.35's sequence, microtask by microtask (probed on both engines): the
  // run ends inside the call; the cleanups, onStop and the stop event follow
  // one microtask later; stopAsync resolves at microtask 3, and destroyAsync
  // announces onDestroy at microtask 3 and resolves at microtask 5.
  for (const how of ["stopAsync", "destroyAsync"] as const) {
    for (const form of ["single", "namespaced"] as const) {
      it(`${how} (${form}) tears down in 1.35's microtask order`, async () => {
        const log: string[] = [];
        const mod = (id: string) =>
          createModule(id, {
            schema: { facts: { count: t.number() }, events: {} },
            init: (facts: any) => {
              facts.count = 0;
            },
            effects: {
              e: {
                run: (facts: any) => {
                  void facts.count;

                  return () => log.push(`${id}.cleanup`);
                },
              },
            },
            hooks: { onStop: () => log.push(`${id}.onStop`) },
          } as never);
        const plugins = [
          {
            name: "p",
            onStop: () => log.push("p.onStop"),
            onDestroy: () => log.push("p.onDestroy"),
          },
        ];
        const sys: any = createSystem(
          (form === "single"
            ? { module: mod("a"), plugins }
            : { modules: { a: mod("a"), b: mod("b") }, plugins }) as never,
        );
        sys.start();
        await sys.settle();
        let done = false;
        sys[how]().then(() => {
          done = true;
        });
        log.push(`call running=${sys.isRunning}`);
        for (let i = 1; i <= 6; i++) {
          await Promise.resolve();
          log.push(`mt${i}${done ? " done" : ""}`);
        }
        const teardown =
          form === "single"
            ? ["a.cleanup", "a.onStop", "p.onStop"]
            : ["a.cleanup", "b.cleanup", "a.onStop", "b.onStop", "p.onStop"];
        expect(log).toEqual(
          how === "stopAsync"
            ? [
                "call running=false",
                ...teardown,
                "mt1",
                "mt2",
                "mt3 done",
                "mt4 done",
                "mt5 done",
                "mt6 done",
              ]
            : [
                "call running=false",
                ...teardown,
                "mt1",
                "mt2",
                "mt3",
                "p.onDestroy",
                "mt4",
                "mt5",
                "mt6 done",
              ],
        );
      });
    }
  }
});

describe("L3a timers on the kernel clock (S7, C1, C2)", () => {
  it("the tick is a repeating, owned timer of kind tick; destroy() leaves no owned timer", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = createVirtualClock();
    const sys: any = createSystemCore(
      { module: counter(), tickMs: 100 } as never,
      [],
      { clock },
    );
    sys.start();
    const owned = () => clock.timers().filter((timer) => timer.owner !== 0);
    // (r): the never-started check is the system's too, until it fires.
    expect(owned().map((timer) => timer.kind)).toEqual(["dev", "tick"]);
    clock.advanceTo(300);
    expect(owned().map((timer) => timer.kind)).toEqual(["tick"]);
    expect(sys.facts.count).toBe(3);
    sys.stop();
    expect(owned()).toEqual([]);
    sys.start();
    expect(owned()).toHaveLength(1);
    sys.destroy();
    expect(owned()).toEqual([]);
    clock.advanceTo(1000);
    expect(sys.facts.count).toBe(3);
  });

  it("(r) approved: destroy() cancels the never-started warning (1.35 warns anyway)", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = createVirtualClock();
    const sys: any = createSystemCore({ module: counter() } as never, [], {
      clock,
    });
    // Owned by the system, so the kernel's dispose clears it.
    expect(clock.timers()).toMatchObject([{ kind: "dev" }]);
    expect(clock.timers()[0]!.owner).not.toBe(0);
    sys.destroy();
    expect(clock.timers()).toEqual([]);
    clock.advanceTo(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("(r): a system created and neither started nor destroyed still warns, once", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = createVirtualClock();
    const kept: any = createSystemCore({ module: counter() } as never, [], {
      clock,
    });
    const gone: any = createSystemCore({ module: counter() } as never, [], {
      clock,
    });
    gone.destroy();
    clock.advanceTo(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "start() was never called",
    );
    clock.advanceTo(100);
    expect(warn).toHaveBeenCalledTimes(1);
    kept.destroy();
  });

  it("(r): destroyAsync() cancels it too", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = createVirtualClock();
    const sys: any = createSystemCore({ module: counter() } as never, [], {
      clock,
    });
    await sys.destroyAsync();
    clock.advanceTo(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("NODE_ENV=test sets no never-started timer at all", () => {
    vi.stubEnv("NODE_ENV", "test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = createVirtualClock();
    const sys: any = createSystemCore({ module: counter() } as never, [], {
      clock,
    });
    expect(clock.timers()).toEqual([]);
    sys.destroy();
    clock.advanceTo(10);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("L3a initialFacts and hydrate (S5)", () => {
  it("apply after the inits in one batch, before the first pass; hydrate wins", async () => {
    const batches: unknown[] = [];
    const sys: any = createSystem({
      modules: { a: counter("a"), b: counter("b") },
      initialFacts: { a: { count: 5 }, b: { count: 7 } },
      plugins: [{ name: "p", onFactsBatch: (c: unknown) => batches.push(c) }],
    } as never);
    await sys.hydrate(() => ({ b: { count: 9 } }));
    sys.start();
    expect(sys.facts.a.count).toBe(5);
    expect(sys.facts.b.count).toBe(9);
    // Two module inits, then one batch holding initialFacts and hydrate's.
    expect(batches).toHaveLength(3);
    await expect(sys.hydrate(() => ({}))).rejects.toThrow("before start()");
    sys.destroy();
  });
});
