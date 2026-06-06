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
      onError,
    );

    manager.attachAll(() => undefined);
    manager.cleanupAll();

    const phases = onError.mock.calls.map(([id, phase]) => ({ id, phase }));
    expect(phases).toEqual(
      expect.arrayContaining([
        { id: "attachFail", phase: "attach" },
        { id: "cleanFail", phase: "cleanup" },
      ]),
    );
    consoleErrorSpy.mockRestore();
  });
});

// ============================================================================
// Integration tests — `createSystem` with sources
// ============================================================================

describe("source primitive — end-to-end with createSystem", () => {
  it("source publish dispatches into the system's event handlers", () => {
    let captured: SourcePublish | null = null;
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
            captured = publish;
            return () => undefined;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();

    expect(captured).not.toBeNull();
    captured?.("TICK", { delta: 5 });
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
