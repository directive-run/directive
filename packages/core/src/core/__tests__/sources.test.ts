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

  it("publish callback dispatches events into the supplied publisher", () => {
    const publisher = vi.fn();
    const captured: SourcePublish[] = [];
    const manager = createSourcesManager({
      s: {
        attach: (publish) => {
          captured.push(publish);
          // Synchronous publish during attach is allowed.
          publish("HELLO", { ok: true });
          return () => undefined;
        },
      },
    });

    manager.attachAll(publisher);
    expect(publisher).toHaveBeenCalledWith("HELLO", { ok: true });
    // Authoring code can also publish asynchronously via the captured
    // reference — assert the same reference is still callable.
    captured[0]?.("LATER", undefined);
    expect(publisher).toHaveBeenCalledWith("LATER", undefined);
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
      onError,
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
