// Ported from packages/core/src/core/__tests__/l5-sources-oracle-ported.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * The `createSystem` cases of `sources.test.ts`, ported as they are: that file
 * also drives `createSourcesManager` from `/internals`, so conformance:v2
 * skips all of it. Titles and assertions are unchanged; WHITE-BOX.md maps the
 * file's other cases (L5-pre).
 */

import { createModule, createSystem, t } from "@directive-run/core";
import type { SourcePublish } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

describe("source primitive — public lifecycle and guards", () => {
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
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ delta: 5 }));
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

    expect(order).toEqual(["attach:a", "attach:b", "detach:b", "detach:a"]);
  });

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
});

describe("RFC 0012 — gated/keyed sources", () => {
  it("declaring BOTH key and active throws at registration", () => {
    // The `createSystem` half; the other half calls the manager directly.
    const module = createModule("dual", {
      schema: { facts: { on: t.boolean() } },
      init: (f) => {
        f.on = false;
      },
      sources: {
        s: {
          key: () => null,
          active: () => true,
          attach: () => () => undefined,
        },
      },
    });
    expect(() => createSystem({ module })).toThrow(/both/i);
  });

  it("a failing attach backs off instead of retrying on every reconcile", async () => {
    const attach = vi.fn(() => {
      throw new Error("still down");
    });
    const module = createModule("down", {
      schema: {
        facts: { on: t.boolean(), tick: t.number() },
        events: { ON: {}, TICK: {} },
      },
      init: (f) => {
        f.on = false;
        f.tick = 0;
      },
      events: {
        ON: (f) => {
          f.on = true;
        },
        TICK: (f) => {
          f.tick = f.tick + 1;
        },
      },
      sources: {
        s: { active: (f) => f.on === true, attach: () => attach() },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    system.events.ON();
    await system.settle();
    expect(attach).toHaveBeenCalledTimes(1);

    // Ten reconciles inside the first backoff window must not become ten
    // attach attempts — a transport that is down should not be hammered at
    // the rate a busy system happens to reconcile.
    for (let i = 0; i < 10; i++) {
      system.events.TICK();
      await system.settle();
    }
    expect(attach).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});
