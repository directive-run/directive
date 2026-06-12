/**
 * regression test: the RFC 0009 async-lifecycle methods
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

  // follow-up: concurrent / repeat evict() calls must not double-fire
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

  // follow-up: if the inner evict work rejects, `state.isEvicting`
  // must be cleared in `finally` so the host can call `evict()` again
  // after recovery. Without try/finally, a one-time rejection would
  // permanently latch the gate.
  it("system.evict() clears isEvicting on inner-work rejection (R19)", async () => {
    let onEvictCalls = 0;
    const moduleWithRejectingEvict = createModule("evictReject", {
      schema: { facts: { ok: t.boolean() } },
      init: (f) => {
        f.ok = true;
      },
      sources: {
        broker: {
          attach: () => () => {},
          onEvict: () => {
            onEvictCalls += 1;
            throw new Error("simulated onEvict failure");
          },
        },
      },
    });
    const system = createSystem({ module: moduleWithRejectingEvict });
    system.start();
    // First evict: source throws inside onEvict; sourcesManager logs +
    // the composite work resolves (sourcesManager isolates per-source
    // errors). Even when a source THROWS (and the manager swallows),
    // the gate's clear-on-finally path runs. Verify a second evict
    // proceeds (one onEvict invocation per call, not zero).
    await system.evict();
    expect(onEvictCalls).toBe(1);
    // After the first evict, destroyAsync has marked the system
    // destroyed; the second call should be a no-op via the
    // isDestroyed check, NOT via a latched isEvicting flag. Either
    // way, calling again must not throw.
    await system.evict();
    expect(onEvictCalls).toBe(1);
  });

  // follow-up: `system.start()` refuses to start during an evict()
  // in flight, and after destroy. Cloudflare DO failover scenario.
  it("system.start() is a no-op when isEvicting or isDestroyed (R19)", async () => {
    const system = createSystem({ module: counterModule });
    system.start();
    await system.evict();
    // System is now destroyed.
    expect(system.isRunning).toBe(false);
    system.start();
    // Still NOT running — start() is rejected because the system is
    // destroyed; the engine refuses to revive a torn-down system.
    expect(system.isRunning).toBe(false);
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
