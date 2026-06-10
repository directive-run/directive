/**
 * R13-C1 regression test: the RFC 0009 async-lifecycle methods
 * (`stopAsync`, `destroyAsync`, `evict`) must be reachable from the
 * public `createSystem` boundary. Without this test, the engine can
 * implement the methods but the wrappers can silently fail to delegate,
 * and the entire DO-eviction recipe documented in `core/sources.md` is
 * unreachable from user code.
 */
import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const counterModule = createModule("counter", {
  schema: {
    facts: { n: t.number() },
    events: { INCREMENT: { by: t.number() } },
  },
  init: (f) => {
    f.n = 0;
  },
  events: {
    INCREMENT: (facts, payload) => {
      facts.n += payload.by;
    },
  },
});

describe("RFC 0009 async lifecycle — single-module createSystem", () => {
  it("system.stopAsync() exists, returns a Promise, and tears down without error", async () => {
    const system = createSystem({ module: counterModule });
    system.start();
    expect(typeof system.stopAsync).toBe("function");
    const result = system.stopAsync();
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(system.isRunning).toBe(false);
  });

  it("system.destroyAsync() exists and tears down without error", async () => {
    const system = createSystem({ module: counterModule });
    system.start();
    expect(typeof system.destroyAsync).toBe("function");
    await system.destroyAsync();
  });

  it("system.evict(undefined) awaits full teardown", async () => {
    const system = createSystem({ module: counterModule });
    system.start();
    expect(typeof system.evict).toBe("function");
    const result = system.evict();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("system.evict(deadline<=now) returns synchronously without throwing", async () => {
    const system = createSystem({ module: counterModule });
    system.start();
    // Deadline in the past — engine kicks off detached teardown with
    // swallow-catch and returns immediately.
    await system.evict(Date.now() - 1);
  });

  // R18 follow-up: concurrent / repeat evict() calls must not double-fire
  // onEvict. Cloudflare DO hibernation can call evict twice; non-idempotent
  // onEvict handlers (e.g. one that posts a "going away" broker message)
  // would double-fire without the engine's `state.isEvicting` gate.
  it("system.evict() is reentry-safe — onEvict fires once across concurrent calls", async () => {
    let onEvictCalls = 0;
    const moduleWithEvict = createModule("evictGate", {
      schema: { facts: { ok: t.boolean() } },
      init: (f) => {
        f.ok = true;
      },
      sources: {
        broker: {
          attach: () => () => {},
          onEvict: () => {
            onEvictCalls += 1;
          },
        },
      },
    });
    const system = createSystem({ module: moduleWithEvict });
    system.start();
    // Fire two evict() calls concurrently AND a third afterward. All
    // must observe the gate and become no-ops past the first.
    await Promise.all([system.evict(), system.evict()]);
    await system.evict();
    expect(onEvictCalls).toBe(1);
  });

  it("system.stopAsync() awaits an async source unsubscribe", async () => {
    let unsubscribed = false;
    const moduleWithSource = createModule("withSource", {
      schema: {
        facts: { last: t.string() },
        events: { TICK: { value: t.string() } },
      },
      init: (f) => {
        f.last = "";
      },
      events: {
        TICK: (facts, payload) => {
          facts.last = payload.value;
        },
      },
      sources: {
        ticker: {
          attach: () => {
            return async () => {
              // Simulate an external broker drop that needs a tick to
              // round-trip (Supabase removeChannel returns a Promise).
              await new Promise<void>((r) => setTimeout(r, 5));
              unsubscribed = true;
            };
          },
        },
      },
    });

    const system = createSystem({ module: moduleWithSource });
    system.start();
    await system.stopAsync();
    // Without await on the source's async unsubscribe, this would be
    // `false` (the broker drop hadn't completed when stopAsync resolved).
    expect(unsubscribed).toBe(true);
  });
});

describe("RFC 0009 async lifecycle — namespaced createSystem", () => {
  it("namespaced system.stopAsync() / destroyAsync() / evict() exist", async () => {
    const system = createSystem({
      modules: { counter: counterModule },
    });
    system.start();
    expect(typeof system.stopAsync).toBe("function");
    expect(typeof system.destroyAsync).toBe("function");
    expect(typeof system.evict).toBe("function");
    await system.evict();
  });
});
