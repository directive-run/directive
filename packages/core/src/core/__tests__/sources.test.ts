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
    manager.attachAll(() => ({ accepted: true }));
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
        return () => {
          order.push(`detach:${name}`);
        };
      },
    });
    const manager = createSourcesManager({
      first: make("first"),
      second: make("second"),
      third: make("third"),
    });

    manager.attachAll(() => ({ accepted: true }));
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
    const dispatcher = vi.fn().mockReturnValue({ accepted: true });
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

    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);
    manager.cleanupAll();
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(0);

    // Second cycle: attach + cleanup again.
    manager.attachAll(() => ({ accepted: true }));
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
      manager.attachAll(() => ({ accepted: true }));
      manager.cleanupAll();
    }
    expect(manager.attachedCount()).toBe(0);
  });

  it("listDefinitions surfaces all registered sources with their moduleId and per-source telemetry", () => {
    const manager = createSourcesManager(
      {
        a: { attach: () => () => undefined, meta: { tag: "first" } },
        b: { attach: () => () => undefined },
      },
      { a: "mod-1", b: "mod-2" },
    );
    const rows = manager.listDefinitions();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "a",
      moduleId: "mod-1",
      meta: { tag: "first" },
      attached: false,
      publishCount: 0,
      lastPublishAt: null,
      errorCount: 0,
      lastError: null,
      attachedAt: null,
      detachedAt: null,
    });
    expect(rows[1]).toMatchObject({
      id: "b",
      moduleId: "mod-2",
      meta: undefined,
      attached: false,
      publishCount: 0,
    });
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
    manager.attachAll(() => ({ accepted: true }));
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(manager.attachedCount()).toBe(1);
  });

  it("registerDefinitions attaches immediately if the system is already running", () => {
    const attachSpy = vi.fn();
    const manager = createSourcesManager();
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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

    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));
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
    manager.attachAll(() => ({ accepted: true }));

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

  it("system.inspect().sources surfaces the declared sources with attachedSourceCount + per-source telemetry", () => {
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
          sources: Array<{
            id: string;
            moduleId: string;
            attached: boolean;
            publishCount: number;
            lastPublishAt: number | null;
            errorCount: number;
            lastError: unknown;
            attachedAt: number | null;
            detachedAt: number | null;
          }>;
          attachedSourceCount: number;
        };
      }
    ).inspect();
    expect(inspection.sources).toHaveLength(2);
    for (const row of inspection.sources) {
      expect(row.moduleId).toBe("inspected");
      expect(row.attached).toBe(true);
      expect(row.publishCount).toBe(0);
      expect(row.lastPublishAt).toBeNull();
      expect(row.errorCount).toBe(0);
      expect(row.lastError).toBeNull();
      expect(typeof row.attachedAt).toBe("number");
      expect(row.detachedAt).toBeNull();
    }
    expect(inspection.sources.map((row) => row.id)).toEqual(["a", "b"]);
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
            return () => {
              order.push("detach:a");
            };
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
            return () => {
              order.push("detach:b");
            };
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

  // R5 fix: BLOCKED_PROPS check on event names (parity with system.dispatch)
  it("dispatcher drops publishes whose event names walk the prototype chain", () => {
    const handler = vi.fn();
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("evil", {
      schema: {
        facts: { c: t.number() },
        events: { OK: {} },
      },
      init: (f) => {
        f.c = 0;
      },
      events: {
        OK: () => handler(),
      },
      sources: {
        attacker: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.start();
    expect(capturedRef.current).toBeTypeOf("function");
    // Each of these should silently no-op rather than dispatch into the engine.
    capturedRef.current?.("__proto__", { type: "OK" });
    capturedRef.current?.("constructor", {});
    capturedRef.current?.("prototype", {});
    capturedRef.current?.("", {});
    expect(handler).not.toHaveBeenCalled();
    // Legitimate publishes still work.
    capturedRef.current?.("OK", {});
    expect(handler).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  // R5 fix: dispatcher honors !state.isRunning between stop() and the next start()
  it("publishes between stop() and the next start() silently drop", () => {
    const handler = vi.fn();
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("paused", {
      schema: {
        facts: { c: t.number() },
        events: { TICK: {} },
      },
      init: (f) => {
        f.c = 0;
      },
      events: {
        TICK: () => handler(),
      },
      sources: {
        leak: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.start();
    capturedRef.current?.("TICK", {});
    expect(handler).toHaveBeenCalledTimes(1);
    system.stop();
    // External transport keeps firing the captured publish ref AFTER stop().
    capturedRef.current?.("TICK", {});
    capturedRef.current?.("TICK", {});
    expect(handler).toHaveBeenCalledTimes(1);
    system.destroy();
  });

  // R5 fix: per-record detached flag closes the in-flight re-registration race.
  // Exercised against the manager directly because the engine-level
  // registerModule path hits a schema collision when the same module id is
  // re-registered (covered by separate engine tests).
  it("manager: OLD source's captured publish ref no-ops after re-registration replaces the source", () => {
    const dispatched: Array<{
      id: string;
      moduleId: string;
      eventName: string;
    }> = [];
    const capturedOld: { current: SourcePublish | null } = { current: null };
    const manager = createSourcesManager(
      {
        racer: {
          attach: (publish) => {
            capturedOld.current = publish;
            return () => undefined;
          },
        },
      },
      { racer: "mod-1" },
    );
    manager.attachAll((id, moduleId, eventName) => {
      dispatched.push({ id, moduleId, eventName });
      return { accepted: true };
    });
    // Live publish through the OLD closure reaches the dispatcher.
    capturedOld.current?.("TICK", undefined);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({ id: "racer", moduleId: "mod-1", eventName: "TICK" });

    // Re-register the same source id with a different attach impl. The R3
    // registry swap unsubscribes the old definition; this R5 fix also flips
    // the per-record `detached` flag so the OLD `perSourcePublish` closure
    // no-ops even though the external transport still holds a reference.
    manager.registerDefinitions("mod-2", {
      racer: { attach: () => () => undefined },
    });

    // Stale external transport fires the OLD closure — should silently no-op
    // (the R3 fix unsubscribed the old definition; the R5 detached flag
    // silences the closure too).
    capturedOld.current?.("TICK", undefined);
    capturedOld.current?.("TICK", undefined);
    expect(dispatched).toHaveLength(1);
  });

  // R5 fix: Promise-shaped unsubscribe gets a targeted diagnostic.
  it("returning a Promise from attach() gets a Promise-specific error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const manager = createSourcesManager({
        bad: {
          // biome-ignore lint/suspicious/noExplicitAny: deliberate async attack
          attach: (async (_publish: SourcePublish) => () => undefined) as any,
        },
      });
      manager.attachAll(() => ({ accepted: true }));
      expect(errorSpy).toHaveBeenCalled();
      const recordedError = errorSpy.mock.calls[0]?.[0];
      const message =
        recordedError instanceof Error
          ? recordedError.message
          : String(recordedError);
      expect(message).toMatch(/Promise/);
      expect(message).toMatch(/attach\(\) must be synchronous/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // R5 fix: per-source counters track publishCount + lastPublishAt
  it("per-source counters bump on publish and surface via inspect()", async () => {
    const handler = vi.fn();
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("counted", {
      schema: {
        facts: { c: t.number() },
        events: { TICK: {} },
      },
      init: (f) => {
        f.c = 0;
      },
      events: {
        TICK: () => handler(),
      },
      sources: {
        timer: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.start();
    capturedRef.current?.("TICK", {});
    capturedRef.current?.("TICK", {});
    capturedRef.current?.("TICK", {});
    const inspection = (
      system as unknown as {
        inspect: () => {
          sources: Array<{
            id: string;
            publishCount: number;
            lastPublishAt: number | null;
          }>;
        };
      }
    ).inspect();
    const timerRow = inspection.sources.find((row) => row.id === "timer");
    expect(timerRow?.publishCount).toBe(3);
    expect(typeof timerRow?.lastPublishAt).toBe("number");
    system.destroy();
  });

  // R6 fix: drop telemetry on inspect().sources for rejected publishes.
  it("rejected publishes bump dropCount + lastDropReason on inspect()", () => {
    const handler = vi.fn();
    const capturedRef: { current: SourcePublish | null } = { current: null };
    const module = createModule("probed", {
      schema: {
        facts: { c: t.number() },
        events: { OK: {} },
      },
      init: (f) => {
        f.c = 0;
      },
      events: {
        OK: () => handler(),
      },
      sources: {
        probe: {
          attach: (publish) => {
            capturedRef.current = publish;
            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module });
    system.start();
    // Each of these should drop with a specific reason.
    capturedRef.current?.("__proto__", {});
    capturedRef.current?.("constructor", {});
    capturedRef.current?.("", {});
    capturedRef.current?.("OK", {});
    expect(handler).toHaveBeenCalledTimes(1);
    const inspection = (
      system as unknown as {
        inspect: () => {
          sources: Array<{
            id: string;
            publishCount: number;
            dropCount: number;
            lastDropReason: string | null;
            lastDropAt: number | null;
          }>;
        };
      }
    ).inspect();
    const probeRow = inspection.sources.find((row) => row.id === "probe");
    expect(probeRow?.publishCount).toBe(1);
    expect(probeRow?.dropCount).toBe(3);
    expect(probeRow?.lastDropReason).toBe("invalid-event-name");
    expect(typeof probeRow?.lastDropAt).toBe("number");
    system.destroy();
  });

  // R6 fix: onPublish plugin hook does NOT fire for engine-rejected publishes.
  it("onPublish only fires for accepted publishes (not for engine-rejected drops)", () => {
    const onPublish = vi.fn();
    const dispatch = vi
      .fn()
      .mockImplementation(
        (_id, _moduleId, eventName) => ({
          accepted: eventName === "OK",
          ...(eventName === "OK"
            ? {}
            : { reason: "blocked-event-name" as const }),
        }),
      );
    const captured: { current: SourcePublish | null } = { current: null };
    const manager = createSourcesManager(
      {
        s: {
          attach: (publish) => {
            captured.current = publish;
            return () => undefined;
          },
        },
      },
      { s: "mod" },
      { onPublish },
    );
    manager.attachAll(dispatch);
    captured.current?.("OK", {});
    captured.current?.("BAD", {});
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledWith("s", "mod", "OK");
  });

  // R6 fix: error.message truncation prevents unbounded payload leakage.
  it("lastError.message is truncated at SOURCE_ERROR_MESSAGE_MAX (256) chars", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const huge = "X".repeat(1024);
    const manager = createSourcesManager({
      attackerSource: {
        attach: () => {
          throw new Error(huge);
        },
      },
    });
    manager.attachAll(() => ({ accepted: true }));
    const rows = manager.listDefinitions();
    const row = rows.find((r) => r.id === "attackerSource");
    expect(row?.errorCount).toBe(1);
    // Truncated message has the 256-char prefix + a "[768 chars truncated]" marker.
    expect(row?.lastError?.message.length).toBeLessThan(huge.length);
    expect(row?.lastError?.message).toMatch(/chars truncated/);
    expect(row?.lastError?.message.startsWith("X".repeat(256))).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  // R7 fix: truncation applies at the manager boundary so plugins (audit-ledger,
  // logging) see a bounded `error.message` too — not just inspect().
  it("onError callback receives an Error whose message is truncated to SOURCE_ERROR_MESSAGE_MAX", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    const huge = "Z".repeat(2048);
    const manager = createSourcesManager(
      {
        leaky: {
          attach: () => {
            throw new Error(huge);
          },
        },
      },
      { leaky: "mod-x" },
      { onError },
    );
    manager.attachAll(() => ({ accepted: true }));
    expect(onError).toHaveBeenCalledTimes(1);
    const observedError = onError.mock.calls[0]?.[3];
    expect(observedError).toBeInstanceOf(Error);
    expect(observedError.message.length).toBeLessThan(huge.length);
    expect(observedError.message).toMatch(/chars truncated/);
    expect(observedError.message.startsWith("Z".repeat(256))).toBe(true);
    // Short errors pass through unchanged (no allocation overhead).
    consoleErrorSpy.mockRestore();
  });

  // RFC 0007: SourceDef.coalesce: "lastWriteWins" debounces same-event-name
  // publishes within a single microtask. Dropped publishes bump dropCount
  // + lastDropReason = "coalesced". The final payload wins.
  it("coalesce: lastWriteWins debounces same-event-name publishes per microtask", async () => {
    const dispatch = vi.fn().mockReturnValue({ accepted: true });
    const captured: { current: SourcePublish | null } = { current: null };
    const manager = createSourcesManager(
      {
        ticker: {
          attach: (publish) => {
            captured.current = publish;
            return () => undefined;
          },
          coalesce: "lastWriteWins",
        },
      },
      { ticker: "mod" },
    );
    manager.attachAll(dispatch);
    // Five publishes in one tick → ONE dispatch on next microtask.
    captured.current?.("TICK", { v: 1 });
    captured.current?.("TICK", { v: 2 });
    captured.current?.("TICK", { v: 3 });
    captured.current?.("TICK", { v: 4 });
    captured.current?.("TICK", { v: 5 });
    expect(dispatch).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Last payload wins.
    expect(dispatch).toHaveBeenCalledWith("ticker", "mod", "TICK", { v: 5 });
    // 4 raw publishes coalesced into 1.
    const row = manager.listDefinitions().find((r) => r.id === "ticker");
    expect(row?.publishCount).toBe(1);
    expect(row?.dropCount).toBe(4);
    expect(row?.lastDropReason).toBe("coalesced");
  });

  // Different event names debounce independently — a priceTick storm
  // does not drop a one-shot connected event.
  it("coalesce: lastWriteWins keys per-event-name (storm does not drop one-shots)", async () => {
    const dispatch = vi.fn().mockReturnValue({ accepted: true });
    const captured: { current: SourcePublish | null } = { current: null };
    const manager = createSourcesManager(
      {
        s: {
          attach: (publish) => {
            captured.current = publish;
            return () => undefined;
          },
          coalesce: "lastWriteWins",
        },
      },
      { s: "mod" },
    );
    manager.attachAll(dispatch);
    captured.current?.("PRICE_TICK", { v: 1 });
    captured.current?.("PRICE_TICK", { v: 2 });
    captured.current?.("CONNECTED", {});
    captured.current?.("PRICE_TICK", { v: 3 });
    expect(dispatch).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(2);
    const calls = dispatch.mock.calls.map(([, , eventName, payload]) => ({
      eventName,
      payload,
    }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { eventName: "PRICE_TICK", payload: { v: 3 } },
        { eventName: "CONNECTED", payload: {} },
      ]),
    );
  });

  // coalesce: "all" and undefined both behave like "none" — every publish
  // dispatches synchronously, no microtask deferral.
  it('coalesce: "all" and unset behave like "none" — every publish dispatches synchronously', () => {
    const dispatch = vi.fn().mockReturnValue({ accepted: true });
    const captured: { current: SourcePublish | null } = { current: null };
    const manager = createSourcesManager(
      {
        explicit: {
          attach: (publish) => {
            captured.current = publish;
            return () => undefined;
          },
          coalesce: "all",
        },
      },
      { explicit: "mod" },
    );
    manager.attachAll(dispatch);
    captured.current?.("E", { v: 1 });
    captured.current?.("E", { v: 2 });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  // RFC 0008: attach receives `reportError` as a second arg. Errors
  // routed through it fire onError with phase: "runtime" and bump
  // errorCount / lastError on the inspect row — same sinks as attach
  // and cleanup failures, distinct phase.
  it("RFC 0008: reportError routes mid-flight errors with phase: 'runtime'", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    let captured: ((err: Error) => void) | undefined;
    const manager = createSourcesManager(
      {
        ws: {
          attach: (_publish, reportError) => {
            captured = reportError;
            return () => undefined;
          },
        },
      },
      { ws: "wsmod" },
      { onError },
    );
    manager.attachAll(() => ({ accepted: true }));
    expect(typeof captured).toBe("function");
    // Simulate the source's underlying stream erroring mid-flight.
    (captured as unknown as (err: Error) => void)(new Error("socket closed"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      "ws",
      "wsmod",
      "runtime",
      expect.objectContaining({ message: expect.stringContaining("socket closed") }),
    );
    const row = manager.listDefinitions().find((r) => r.id === "ws");
    expect(row?.errorCount).toBe(1);
    expect(row?.lastError?.phase).toBe("runtime");
    expect(row?.lastError?.message).toContain("socket closed");
    consoleErrorSpy.mockRestore();
  });

  // After detach, reportError is a no-op — the source's transport may
  // still hold a reference, but the manager treats the source as gone.
  it("RFC 0008: reportError after detach is a silent no-op (matches publish-detached semantics)", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    let captured: ((err: Error) => void) | undefined;
    const manager = createSourcesManager(
      {
        ws: {
          attach: (_publish, reportError) => {
            captured = reportError;
            return () => undefined;
          },
        },
      },
      { ws: "wsmod" },
      { onError },
    );
    manager.attachAll(() => ({ accepted: true }));
    manager.cleanupAll();
    (captured as unknown as (err: Error) => void)(new Error("late"));
    // onError was NOT called for the post-detach runtime error.
    const runtimeCalls = onError.mock.calls.filter(
      ([, , phase]) => phase === "runtime",
    );
    expect(runtimeCalls.length).toBe(0);
    consoleErrorSpy.mockRestore();
  });

  // RFC 0009: cleanupAllAsync awaits Promise-returning unsubscribes
  // so external transports (Supabase channel.unsubscribe()) actually
  // complete before the caller continues. Sync cleanupAll fire-and-
  // forgets them (back-compat).
  it("RFC 0009: cleanupAllAsync awaits async unsubscribes; cleanupAll fire-and-forgets them", async () => {
    let unsubResolved = false;
    const manager = createSourcesManager(
      {
        s: {
          attach: () => async () => {
            await new Promise((r) => setTimeout(r, 10));
            unsubResolved = true;
          },
        },
      },
      { s: "mod" },
    );

    // First cycle: sync cleanupAll — Promise NOT awaited.
    manager.attachAll(() => ({ accepted: true }));
    manager.cleanupAll();
    expect(unsubResolved).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(unsubResolved).toBe(true); // resolved eventually

    // Second cycle: cleanupAllAsync — Promise IS awaited.
    unsubResolved = false;
    manager.attachAll(() => ({ accepted: true }));
    await manager.cleanupAllAsync();
    expect(unsubResolved).toBe(true);
  });

  // RFC 0009: evictAll fires every source's onEvict in registration
  // order. Errors are caught + reported as phase: "runtime".
  it("RFC 0009: evictAll fires onEvict in registration order, isolates failures", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();
    const order: string[] = [];
    const manager = createSourcesManager(
      {
        first: {
          attach: () => () => undefined,
          onEvict: async () => {
            await new Promise((r) => setTimeout(r, 5));
            order.push("evict:first");
          },
        },
        bad: {
          attach: () => () => undefined,
          onEvict: () => {
            order.push("evict:bad");
            throw new Error("eviction failed");
          },
        },
        last: {
          attach: () => () => undefined,
          onEvict: () => {
            order.push("evict:last");
          },
        },
      },
      { first: "mod-a", bad: "mod-b", last: "mod-c" },
      { onError },
    );

    manager.attachAll(() => ({ accepted: true }));
    await manager.evictAll();

    // Registration order — bad's throw doesn't block last.
    expect(order).toEqual(["evict:first", "evict:bad", "evict:last"]);
    const runtimeErrors = onError.mock.calls.filter(
      ([, , phase]) => phase === "runtime",
    );
    expect(runtimeErrors.length).toBe(1);
    expect(runtimeErrors[0]?.[0]).toBe("bad");
    consoleErrorSpy.mockRestore();
  });

  // RFC 0009: sources without onEvict are silently skipped — the new
  // hook is purely opt-in. A system with NO source declaring onEvict
  // sees evictAll resolve immediately.
  it("RFC 0009: evictAll is a no-op for sources without onEvict", async () => {
    const manager = createSourcesManager(
      {
        plain: { attach: () => () => undefined },
      },
      { plain: "mod" },
    );
    manager.attachAll(() => ({ accepted: true }));
    await expect(manager.evictAll()).resolves.toBeUndefined();
  });
});
