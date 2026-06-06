/**
 * Tests for the `source` primitive — typed external event sources that
 * attach at `system.start()` and tear down at `system.stop()`.
 *
 * Covers the manager directly (unit) plus end-to-end integration with
 * `createSystem` so the engine wiring (publish → dispatch, lifecycle)
 * is exercised at the public-API boundary.
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { createSourcesManager } from "../sources.js";
import type { SourceDef, SourcePublish } from "../types/sources.js";

// ============================================================================
// Unit tests — `createSourcesManager`
// ============================================================================

describe("createSourcesManager", () => {
  it("attaches a single source on attachAll and detaches on cleanupAll", () => {
    const unsubscribe = vi.fn();
    const attach = vi.fn((_publish: SourcePublish) => unsubscribe);
    const manager = createSourcesManager({ s: { attach } });

    expect(manager.attachedCount()).toBe(0);
    manager.attachAll(() => undefined);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);

    manager.cleanupAll();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(0);
  });

  it("attaches multiple sources in registration order, detaches in reverse", () => {
    const order: string[] = [];
    const make = (name: string): SourceDef => ({
      attach: () => {
        order.push(`attach:${name}`);
        return () => order.push(`detach:${name}`);
      },
    });
    const manager = createSourcesManager({
      first: make("first"),
      second: make("second"),
      third: make("third"),
    });

    manager.attachAll(() => undefined);
    manager.cleanupAll();

    expect(order).toEqual([
      "attach:first",
      "attach:second",
      "attach:third",
      "detach:third",
      "detach:second",
      "detach:first",
    ]);
  });

  it("publish callback dispatches events into the supplied dispatcher with per-source attribution", () => {
    const dispatcher = vi.fn();
    const captured: SourcePublish[] = [];
    const manager = createSourcesManager(
      {
        s: {
          attach: (publish) => {
            captured.push(publish);
            // Synchronous publish during attach is allowed.
            publish("HELLO", { ok: true });
            return () => undefined;
          },
        },
      },
      { s: "module-X" },
    );

    manager.attachAll(dispatcher);
    expect(dispatcher).toHaveBeenCalledWith(
      "s",
      "module-X",
      "HELLO",
      { ok: true },
    );
    // Authoring code can also publish asynchronously via the captured
    // reference — assert the same reference is still callable.
    captured[0]?.("LATER", undefined);
    expect(dispatcher).toHaveBeenCalledWith(
      "s",
      "module-X",
      "LATER",
      undefined,
    );
  });

  it("isolates attach failures — one bad source does not block others", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const goodUnsubscribe = vi.fn();
    const manager = createSourcesManager({
      bad: {
        attach: () => {
          throw new Error("boom");
        },
      },
      good: {
        attach: () => goodUnsubscribe,
      },
    });

    manager.attachAll(() => undefined);
    // Bad source threw → never gets tracked. Good source attached normally.
    expect(manager.attachedCount()).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("rejects sources whose attach returns something other than a function", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const manager = createSourcesManager({
      // @ts-expect-error — author error: forgot to return cleanup
      forgot: { attach: () => undefined },
    });

    manager.attachAll(() => undefined);
    expect(manager.attachedCount()).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(
      consoleErrorSpy.mock.calls.some((call) =>
        String(call[0]?.message ?? call[0]).includes(
          'Source "forgot" did not return an unsubscribe function',
        ),
      ),
    ).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("isolates unsubscribe failures — one bad cleanup does not block others", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const orderedCleanups: string[] = [];
    const manager = createSourcesManager({
      first: {
        attach: () => () => {
          orderedCleanups.push("first");
        },
      },
      bad: {
        attach: () => () => {
          throw new Error("teardown-fail");
        },
      },
      last: {
        attach: () => () => {
          orderedCleanups.push("last");
        },
      },
    });

    manager.attachAll(() => undefined);
    manager.cleanupAll();
    // Reverse-order: last → bad (throws) → first. The throw is caught + logged.
    expect(orderedCleanups).toEqual(["last", "first"]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("cleanupAll is idempotent — second call is a no-op", () => {
    const unsubscribe = vi.fn();
    const manager = createSourcesManager({
      s: { attach: () => unsubscribe },
    });

    manager.attachAll(() => undefined);
    manager.cleanupAll();
    manager.cleanupAll();
    manager.cleanupAll();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("forwards attach + cleanup failures to the optional onError sink", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    const manager = createSourcesManager(
      {
        attachFail: {
          attach: () => {
            throw new Error("attach-boom");
          },
        },
        cleanFail: {
          attach: () => () => {
            throw new Error("cleanup-boom");
          },
        },
      },
      { attachFail: "mod-a", cleanFail: "mod-b" },
      { onError },
    );

    manager.attachAll(() => undefined);
    manager.cleanupAll();

    const phases = onError.mock.calls.map(
      ([id, moduleId, phase]) => ({ id, moduleId, phase }),
    );
    expect(phases).toEqual(
      expect.arrayContaining([
        { id: "attachFail", moduleId: "mod-a", phase: "attach" },
        { id: "cleanFail", moduleId: "mod-b", phase: "cleanup" },
      ]),
    );
    consoleErrorSpy.mockRestore();
  });

  // ==========================================================================
  // Round-1 fixes: lifecycle re-entry + observability + dynamic registration
  // ==========================================================================

  it("supports start→stop→start→stop lifecycle without leaking subscriptions", () => {
    const attachSpy = vi.fn();
    const cleanupSpy = vi.fn();
    const manager = createSourcesManager({
      cycler: {
        attach: () => {
          attachSpy();
          return cleanupSpy;
        },
      },
    });

    manager.attachAll(() => undefined);
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);
    manager.cleanupAll();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(0);

    // Second cycle: attach + cleanup again.
    manager.attachAll(() => undefined);
    expect(attachSpy).toHaveBeenCalledTimes(2);
    expect(manager.attachedCount()).toBe(1);
    manager.cleanupAll();
    expect(cleanupSpy).toHaveBeenCalledTimes(2);
    expect(manager.attachedCount()).toBe(0);
  });

  it("cleanupAll on an idle manager (never started) is a safe no-op", () => {
    const cleanup = vi.fn();
    const manager = createSourcesManager({
      idle: { attach: () => cleanup },
    });
    expect(() => manager.cleanupAll()).not.toThrow();
    expect(cleanup).not.toHaveBeenCalled();
    expect(manager.attachedCount()).toBe(0);
  });

  it("clears the attached array after cleanup so memory does not grow across cycles", () => {
    const manager = createSourcesManager({
      gc: { attach: () => () => undefined },
    });
    for (let i = 0; i < 100; i++) {
      manager.attachAll(() => undefined);
      manager.cleanupAll();
    }
    expect(manager.attachedCount()).toBe(0);
  });

  it("listDefinitions surfaces all registered sources with their moduleId", () => {
    const manager = createSourcesManager(
      {
        a: { attach: () => () => undefined, meta: { tag: "first" } },
        b: { attach: () => () => undefined },
      },
      { a: "mod-1", b: "mod-2" },
    );
    const rows = manager.listDefinitions();
    expect(rows).toEqual([
      { id: "a", moduleId: "mod-1", meta: { tag: "first" } },
      { id: "b", moduleId: "mod-2", meta: undefined },
    ]);
  });

  it("registerDefinitions adds new sources before start; they attach at start", () => {
    const attachSpy = vi.fn();
    const manager = createSourcesManager();
    manager.registerDefinitions("late-mod", {
      late: {
        attach: () => {
          attachSpy();
          return () => undefined;
        },
      },
    });
    expect(attachSpy).not.toHaveBeenCalled();
    manager.attachAll(() => undefined);
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);
  });

  it("registerDefinitions attaches immediately if the system is already running", () => {
    const attachSpy = vi.fn();
    const manager = createSourcesManager();
    manager.attachAll(() => undefined);
    expect(manager.attachedCount()).toBe(0);

    manager.registerDefinitions("dynamic-mod", {
      dyn: {
        attach: () => {
          attachSpy();
          return () => undefined;
        },
      },
    });
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);

    manager.cleanupAll();
    expect(manager.attachedCount()).toBe(0);
  });

  it("error messages name the module so multi-module collisions are debuggable", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const manager = createSourcesManager(
      {
        boom: {
          attach: () => {
            throw new Error("oops");
          },
        },
      },
      { boom: "game-engine" },
    );
    manager.attachAll(() => undefined);
    const matched = consoleErrorSpy.mock.calls.some((call) => {
      const head = call[0];
      return (
        typeof head === "string" &&
        head.includes('Module "game-engine"') &&
        head.includes('Source "boom"')
      );
    });
    expect(matched).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("error message on missing unsubscribe function names the module", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const manager = createSourcesManager(
      {
        // @ts-expect-error — author error
        forgot: { attach: () => undefined },
      },
      { forgot: "the-mod" },
    );
    manager.attachAll(() => undefined);
    const matched = consoleErrorSpy.mock.calls.some((call) => {
      const arg = call[0];
      const text =
        typeof arg === "string"
          ? arg
          : arg instanceof Error
            ? arg.message
            : "";
      return (
        text.includes('Module "the-mod"') &&
        text.includes('Source "forgot"') &&
        text.includes("did not return an unsubscribe function")
      );
    });
    expect(matched).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("attach that returns null / number / string is treated as missing cleanup", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const manager = createSourcesManager({
      // @ts-expect-error — null is not a function
      retNull: { attach: () => null },
      // @ts-expect-error — number is not a function
      retNumber: { attach: () => 0 },
      // @ts-expect-error — string is not a function
      retString: { attach: () => "no" },
    });
    manager.attachAll(() => undefined);
    expect(manager.attachedCount()).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // ==========================================================================
  // Round-2 fixes: per-source attribution + lifecycle callbacks
  // ==========================================================================

  it("onAttach fires ONLY for sources whose attach succeeded (not for those that threw)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onAttach = vi.fn();
    const manager = createSourcesManager(
      {
        good: { attach: () => () => undefined },
        bad: {
          attach: () => {
            throw new Error("boom");
          },
        },
      },
      { good: "mg", bad: "mb" },
      { onAttach },
    );

    manager.attachAll(() => undefined);
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach).toHaveBeenCalledWith("good", "mg");
    consoleErrorSpy.mockRestore();
  });

  it("onAttach does NOT fire for sources that return a non-function (forgotten cleanup)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onAttach = vi.fn();
    const manager = createSourcesManager(
      {
        // @ts-expect-error — author error
        forgot: { attach: () => undefined },
      },
      { forgot: "m1" },
      { onAttach },
    );
    manager.attachAll(() => undefined);
    expect(onAttach).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("onPublish fires with per-source attribution (not by event-name lookup)", () => {
    const onPublish = vi.fn();
    const manager = createSourcesManager(
      {
        // Two sources publishing the SAME event name — proves the manager
        // closure-wraps per-source so the engine knows which one fired.
        sourceA: {
          attach: (publish) => {
            publish("SHARED_EVENT", { from: "A" });
            return () => undefined;
          },
        },
        sourceB: {
          attach: (publish) => {
            publish("SHARED_EVENT", { from: "B" });
            return () => undefined;
          },
        },
      },
      { sourceA: "mod-A", sourceB: "mod-B" },
      { onPublish },
    );
    manager.attachAll(() => undefined);
    const calls = onPublish.mock.calls.map(([id, mod, evt]) => ({
      id,
      mod,
      evt,
    }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { id: "sourceA", mod: "mod-A", evt: "SHARED_EVENT" },
        { id: "sourceB", mod: "mod-B", evt: "SHARED_EVENT" },
      ]),
    );
  });

  it("onDetach fires in reverse-registration order before each unsubscribe", () => {
    const order: string[] = [];
    const manager = createSourcesManager(
      {
        first: {
          attach: () => () => {
            order.push("unsub:first");
          },
        },
        second: {
          attach: () => () => {
            order.push("unsub:second");
          },
        },
        third: {
          attach: () => () => {
            order.push("unsub:third");
          },
        },
      },
      { first: "m", second: "m", third: "m" },
      {
        onDetach: (id) => order.push(`detach:${id}`),
      },
    );
    manager.attachAll(() => undefined);
    manager.cleanupAll();
    expect(order).toEqual([
      "detach:third",
      "unsub:third",
      "detach:second",
      "unsub:second",
      "detach:first",
      "unsub:first",
    ]);
  });

  it("registerDefinitions during attached phase fires onAttach immediately for new sources", () => {
    const onAttach = vi.fn();
    const manager = createSourcesManager(
      {},
      {},
      { onAttach },
    );
    manager.attachAll(() => undefined);
    expect(onAttach).not.toHaveBeenCalled();

    manager.registerDefinitions("late-mod", {
      late: { attach: () => () => undefined },
    });
    expect(onAttach).toHaveBeenCalledTimes(1);
    expect(onAttach).toHaveBeenCalledWith("late", "late-mod");
  });

  it("re-registering an attached source unsubscribes the old one before attaching the new one", () => {
    // Hot-reload scenario: registerDefinitions called with a source id that is
    // already attached. The previous implementation would leave the old
    // subscription running AND silently drop the new definition (because the
    // `attachedDefinitionIds.has(id)` guard blocked re-attach). Fixed in R3.
    const onAttach = vi.fn();
    const onDetach = vi.fn();
    const oldUnsub = vi.fn();
    const newUnsub = vi.fn();
    const manager = createSourcesManager(
      {},
      {},
      { onAttach, onDetach },
    );
    manager.attachAll(() => undefined);

    manager.registerDefinitions("mod-v1", {
      hot: { attach: () => oldUnsub },
    });
    expect(onAttach).toHaveBeenCalledWith("hot", "mod-v1");
    expect(manager.attachedCount()).toBe(1);

    // Re-register the same source id with a NEW definition + new module.
    manager.registerDefinitions("mod-v2", {
      hot: { attach: () => newUnsub },
    });
    // The old definition was unmounted (detach event + unsubscribe call) AND
    // the new definition attached. Live count stays at 1, not 2.
    expect(oldUnsub).toHaveBeenCalledTimes(1);
    expect(onDetach).toHaveBeenCalledWith("hot", "mod-v1");
    expect(onAttach).toHaveBeenCalledWith("hot", "mod-v2");
    expect(manager.attachedCount()).toBe(1);

    // Cleanup tears down the NEW unsub (not the old one again).
    manager.cleanupAll();
    expect(newUnsub).toHaveBeenCalledTimes(1);
    expect(oldUnsub).toHaveBeenCalledTimes(1); // not double-called
  });
});

// ============================================================================
// Integration tests — observability via system.observe()
// ============================================================================

describe("source primitive — observability via system.observe()", () => {
  it("emits source.attach + source.publish + source.detach events with correct attribution", () => {
    const events: Array<{
      type: string;
      id?: string;
      moduleId?: string;
      eventName?: string;
    }> = [];
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("observed", {
      schema: {
        facts: { count: t.number() },
        events: { TICK: { delta: t.number() } },
      },
      init: (f) => {
        f.count = 0;
      },
      events: {
        TICK: (f, payload) => {
          f.count = f.count + payload.delta;
        },
      },
      sources: {
        ticker: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.observe((event) => {
      if (
        event.type === "source.attach" ||
        event.type === "source.publish" ||
        event.type === "source.detach"
      ) {
        const payload: {
          type: string;
          id?: string;
          moduleId?: string;
          eventName?: string;
        } = { type: event.type };
        if ("id" in event) payload.id = event.id;
        if ("moduleId" in event) payload.moduleId = event.moduleId;
        if ("eventName" in event)
          payload.eventName = (event as { eventName: string }).eventName;
        events.push(payload);
      }
    });

    system.start();
    capturedRef.current?.("TICK", { delta: 3 });
    system.stop();

    expect(events).toEqual([
      { type: "source.attach", id: "ticker", moduleId: "observed" },
      {
        type: "source.publish",
        id: "ticker",
        moduleId: "observed",
        eventName: "TICK",
      },
      { type: "source.detach", id: "ticker", moduleId: "observed" },
    ]);
  });

  it("emits source.error for sources that throw on attach (without firing source.attach)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const events: Array<{ type: string; id?: string; phase?: string }> = [];
    const module = createModule("err-mod", {
      schema: { facts: { ready: t.boolean() } },
      init: (f) => {
        f.ready = false;
      },
      sources: {
        bad: {
          attach: () => {
            throw new Error("attach failed");
          },
        },
      },
    });
    const system = createSystem({ module });
    system.observe((event) => {
      if (event.type === "source.attach" || event.type === "source.error") {
        const payload: { type: string; id?: string; phase?: string } = {
          type: event.type,
        };
        if ("id" in event) payload.id = event.id;
        if ("phase" in event)
          payload.phase = (event as { phase: string }).phase;
        events.push(payload);
      }
    });

    system.start();
    expect(events).toEqual([
      { type: "source.error", id: "bad", phase: "attach" },
    ]);
    consoleErrorSpy.mockRestore();
  });

  it("emits source.attach immediately when a module is registered after start", () => {
    const events: Array<{ type: string; id?: string; moduleId?: string }> = [];
    const baseModule = createModule("base", {
      schema: { facts: { v: t.number() } },
      init: (f) => {
        f.v = 0;
      },
    });
    const system = createSystem({ module: baseModule });
    system.observe((event) => {
      if (event.type === "source.attach") {
        events.push({
          type: event.type,
          id: event.id,
          moduleId: event.moduleId,
        });
      }
    });
    system.start();
    expect(events).toHaveLength(0);

    const lateModule = createModule("late", {
      schema: { facts: { w: t.number() } },
      init: (f) => {
        f.w = 0;
      },
      sources: {
        ticker: { attach: () => () => undefined },
      },
    });
    (
      system as unknown as {
        registerModule: (m: typeof lateModule) => void;
      }
    ).registerModule(lateModule);

    expect(events).toEqual([
      { type: "source.attach", id: "ticker", moduleId: "late" },
    ]);
  });

  it("system.inspect().sources surfaces the declared sources with attachedSourceCount", () => {
    const module = createModule("inspected", {
      schema: { facts: { v: t.number() } },
      init: (f) => {
        f.v = 0;
      },
      sources: {
        a: { attach: () => () => undefined },
        b: { attach: () => () => undefined },
      },
    });
    const system = createSystem({ module });
    system.start();
    const inspection = (
      system as unknown as {
        inspect: () => {
          sources: Array<{ id: string; moduleId: string }>;
          attachedSourceCount: number;
        };
      }
    ).inspect();
    expect(inspection.sources).toEqual([
      { id: "a", moduleId: "inspected", meta: undefined },
      { id: "b", moduleId: "inspected", meta: undefined },
    ]);
    expect(inspection.attachedSourceCount).toBe(2);
    system.stop();
  });

  it("post-destroy publish is a silent no-op (does not crash, does not dispatch)", () => {
    const handler = vi.fn();
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("ghost", {
      schema: {
        facts: { c: t.number() },
        events: { GHOST: {} },
      },
      init: (f) => {
        f.c = 0;
      },
      events: {
        GHOST: () => {
          handler();
        },
      },
      sources: {
        s: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.start();
    capturedRef.current?.("GHOST");
    expect(handler).toHaveBeenCalledTimes(1);

    system.destroy();
    // Stale publish reference is still callable but does NOT dispatch.
    expect(() => capturedRef.current?.("GHOST")).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects source ids that match BLOCKED_PROPS (prototype pollution defense)", () => {
    // `__proto__` via object literal is treated as the prototype setter not a
    // property key by JavaScript itself, so Object.keys() never sees it. The
    // BLOCKED_PROPS check defends against `constructor` and `prototype`,
    // which DO show up as enumerable keys.
    expect(() =>
      createSystem({
        module: createModule("attack-sys", {
          schema: { facts: { v: t.number() } },
          init: (f) => {
            f.v = 0;
          },
          sources: {
            constructor: { attach: () => () => undefined },
          },
        }),
      }),
    ).toThrowError(/dangerous key|Security/);

    expect(() =>
      createSystem({
        module: createModule("attack-sys-2", {
          schema: { facts: { v: t.number() } },
          init: (f) => {
            f.v = 0;
          },
          sources: {
            prototype: { attach: () => () => undefined },
          },
        }),
      }),
    ).toThrowError(/dangerous key|Security/);
  });
});

// ============================================================================
// Integration tests — `createSystem` with sources
// ============================================================================

describe("source primitive — end-to-end with createSystem", () => {
  it("source publish dispatches into the system's event handlers", () => {
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const handler = vi.fn();
    const module = createModule("test", {
      schema: {
        facts: { count: t.number() },
        events: { TICK: { delta: t.number() } },
      },
      init: (facts) => {
        facts.count = 0;
      },
      events: {
        TICK: (facts, payload) => {
          handler(payload);
          facts.count = facts.count + payload.delta;
        },
      },
      sources: {
        external: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();

    expect(capturedRef.current).not.toBeNull();
    capturedRef.current?.("TICK", { delta: 5 });
    // Engine augments the payload with the event `type` discriminator
    // before passing it to the handler — same shape as `system.events.TICK`.
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 5 }),
    );
    expect(system.facts.count).toBe(5);

    system.stop();
  });

  it("source unsubscribe runs at system.stop()", () => {
    const unsubscribe = vi.fn();
    const module = createModule("lifecycle", {
      schema: { facts: { ready: t.boolean() } },
      init: (facts) => {
        facts.ready = false;
      },
      sources: {
        s: { attach: () => unsubscribe },
      },
    });

    const system = createSystem({ module });
    system.start();
    expect(unsubscribe).not.toHaveBeenCalled();
    system.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("source unsubscribe runs at system.destroy() via stop()", () => {
    const unsubscribe = vi.fn();
    const module = createModule("destroy", {
      schema: { facts: { ready: t.boolean() } },
      init: (facts) => {
        facts.ready = false;
      },
      sources: {
        s: { attach: () => unsubscribe },
      },
    });

    const system = createSystem({ module });
    system.start();
    system.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("multiple modules can each declare sources; ordering is per-module flat", () => {
    const order: string[] = [];
    const moduleA = createModule("a", {
      schema: { facts: { v: t.number() } },
      init: (f) => {
        f.v = 0;
      },
      sources: {
        sourceA: {
          attach: () => {
            order.push("attach:a");
            return () => order.push("detach:a");
          },
        },
      },
    });
    const moduleB = createModule("b", {
      schema: { facts: { w: t.number() } },
      init: (f) => {
        f.w = 0;
      },
      sources: {
        sourceB: {
          attach: () => {
            order.push("attach:b");
            return () => order.push("detach:b");
          },
        },
      },
    });

    const system = createSystem({ modules: { a: moduleA, b: moduleB } });
    system.start();
    system.stop();

    expect(order).toEqual([
      "attach:a",
      "attach:b",
      "detach:b",
      "detach:a",
    ]);
  });

  it("source collision across modules throws at createSystem time", () => {
    const moduleA = createModule("a", {
      schema: { facts: { v: t.number() } },
      init: (f) => {
        f.v = 0;
      },
      sources: { shared: { attach: () => () => undefined } },
    });
    const moduleB = createModule("b", {
      schema: { facts: { w: t.number() } },
      init: (f) => {
        f.w = 0;
      },
      sources: { shared: { attach: () => () => undefined } },
    });

    expect(() =>
      createSystem({ modules: { a: moduleA, b: moduleB } }),
    ).toThrowError(/Definition collision: source "shared"/);
  });
});
