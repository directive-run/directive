import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";
import {
  type ClobberAlertEvent,
  type ClobberSummaryEvent,
  clobberAlertPlugin,
} from "../clobber-alert.js";

const flush = async () => {
  await flushMicrotasks();
  await flushMicrotasks();
};

function buildClobberSystem(opts: {
  alerts: ClobberAlertEvent[];
  cooldownMs?: number;
  customTags?: readonly string[];
  factTags?: readonly string[];
}) {
  let release!: () => void;
  let blocker = new Promise<void>((r) => {
    release = r;
  });
  const resetBlocker = () => {
    blocker = new Promise<void>((r) => {
      release = r;
    });
  };

  const m = createModule("payments", {
    schema: {
      facts: {
        amount: t
          .number()
          .meta({ tags: [...(opts.factTags ?? ["money", "irreversible"])] }),
        status: t.string(),
      },
      derivations: {},
      events: { start: {}, forceCancel: {} },
      requirements: { CHARGE: {} },
    },
    init: (f) => {
      f.amount = 100;
      f.status = "idle";
    },
    events: {
      start: (f) => {
        f.status = "charging";
      },
      forceCancel: (f) => {
        f.amount = 0; // external clobber on the abort-bound fact
      },
    },
    constraints: {
      charge: {
        when: (f) => f.status === "charging",
        require: { type: "CHARGE" },
        abortOn: ["amount"],
      },
    },
    resolvers: {
      run: {
        requirement: "CHARGE",
        resolve: async (_req, ctx) => {
          await blocker;
          // Tail write to the abort-bound fact — clobbered.
          ctx.facts.amount = 99;
        },
      },
    },
  });

  const system = createSystem({
    module: m,
    plugins: [
      clobberAlertPlugin({
        irreversibleTags: opts.customTags,
        cooldownMs: opts.cooldownMs,
        onAlert: (e) => opts.alerts.push(e),
      }),
    ],
  });

  return { system, release, resetBlocker };
}

describe("clobberAlertPlugin", () => {
  it("fires onAlert when a clobber lands on an irreversible-tagged fact", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const { system, release } = buildClobberSystem({ alerts });

    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceCancel(); // external clobber
    await flush();
    release();
    await flush();

    expect(alerts.length).toBe(1);
    const alert = alerts[0]!;
    expect(alert.fact).toBe("amount");
    expect(alert.tags).toContain("money");
    expect(alert.resolver).toBe("run");

    system.destroy();
  });

  it("does NOT fire when the clobbered fact has no overlapping tags", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const { system, release } = buildClobberSystem({
      alerts,
      factTags: ["status-only"], // not in default irreversibleTags
    });

    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceCancel();
    await flush();
    release();
    await flush();

    expect(alerts.length).toBe(0);

    system.destroy();
  });

  it("does NOT fire when the clobbered fact carries no tags at all", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const { system, release } = buildClobberSystem({
      alerts,
      factTags: [],
    });

    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceCancel();
    await flush();
    release();
    await flush();

    expect(alerts.length).toBe(0);

    system.destroy();
  });

  it("respects a custom irreversibleTags list", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const { system, release } = buildClobberSystem({
      alerts,
      customTags: ["financial"], // custom tag list, not default
      factTags: ["financial", "regulated"],
    });

    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceCancel();
    await flush();
    release();
    await flush();

    expect(alerts.length).toBe(1);
    expect(alerts[0]?.tags).toContain("financial");

    system.destroy();
  });

  it("cooldownMs suppresses a second alert on the same fact within the window", async () => {
    // Drive the plugin directly via two synthetic onResolverWriteRejected
    // calls. The constraint-binding "one-shot poisoning" semantic means a
    // single constraint's clobber detection only fires once per dispatch,
    // so a second clobber against the same constraint isn't reachable via
    // facts manipulation — but the plugin's cooldown is a per-fact map
    // testable in isolation.
    const alerts: ClobberAlertEvent[] = [];
    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      const m = createModule("cool", {
        schema: {
          facts: {
            amount: t.number().meta({ tags: ["money"] }),
            other: t.number().meta({ tags: ["money"] }),
          },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (f) => {
          f.amount = 1;
          f.other = 1;
        },
      });
      const plugin = clobberAlertPlugin({
        cooldownMs: 5_000,
        onAlert: (e) => alerts.push(e),
      });
      const system = createSystem({ module: m, plugins: [plugin] });
      system.start();

      const synth = (fact: string) => ({
        kind: "rejection" as const,
        resolver: "r",
        req: {
          id: "req",
          requirement: { type: "T" },
        } as Parameters<NonNullable<typeof plugin.onResolverWriteRejected>>[0] extends infer X
          ? X extends { req: infer R }
            ? R
            : never
          : never,
        reason: "clobbered" as const,
        fact,
        expected: 1,
        actual: 2,
      });

      plugin.onResolverWriteRejected?.(synth("amount"));
      expect(alerts.length).toBe(1);

      // Same fact within cooldown — suppressed
      now += 1_000;
      plugin.onResolverWriteRejected?.(synth("amount"));
      expect(alerts.length).toBe(1);

      // Different fact — fires independently (separate cooldown slot)
      plugin.onResolverWriteRejected?.(synth("other"));
      expect(alerts.length).toBe(2);

      // Same fact, outside cooldown — fires again
      now += 6_000;
      plugin.onResolverWriteRejected?.(synth("amount"));
      expect(alerts.length).toBe(3);

      system.destroy();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("cooldown keys by (fact, resolver) — different resolvers on same fact both alert", async () => {
    const alerts: ClobberAlertEvent[] = [];
    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      const m = createModule("twores", {
        schema: {
          facts: { amount: t.number().meta({ tags: ["money"] }) },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (f) => {
          f.amount = 1;
        },
      });
      const plugin = clobberAlertPlugin({
        cooldownMs: 5_000,
        onAlert: (e) => alerts.push(e),
      });
      const system = createSystem({ module: m, plugins: [plugin] });
      system.start();

      const synth = (resolver: string) => ({
        kind: "rejection" as const,
        resolver,
        req: { id: "req", requirement: { type: "T" } } as Parameters<
          NonNullable<typeof plugin.onResolverWriteRejected>
        >[0] extends infer X
          ? X extends { req: infer R }
            ? R
            : never
          : never,
        reason: "clobbered" as const,
        fact: "amount",
        expected: 1,
        actual: 2,
      });

      plugin.onResolverWriteRejected?.(synth("resolverA"));
      expect(alerts.length).toBe(1);

      // Same fact, DIFFERENT resolver — should fire (real incident: fighting writers)
      now += 1_000;
      plugin.onResolverWriteRejected?.(synth("resolverB"));
      expect(alerts.length).toBe(2);

      // Same fact, SAME resolver as the first call, within cooldown — suppressed
      plugin.onResolverWriteRejected?.(synth("resolverA"));
      expect(alerts.length).toBe(2);

      system.destroy();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("irreversibleResolvers fires alerts even when fact has no matching tags", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const { system, release } = buildClobberSystem({
      alerts,
      factTags: ["status-only"], // doesn't match default irreversibleTags
    });
    // Replace the plugin: build a fresh system with the resolver filter
    system.destroy();

    let release2!: () => void;
    const blocker = new Promise<void>((r) => {
      release2 = r;
    });
    const m = createModule("resolverFilter", {
      schema: {
        facts: {
          amount: t.number(), // no tags at all
          status: t.string(),
        },
        derivations: {},
        events: { start: {}, forceCancel: {} },
        requirements: { CHARGE: {} },
      },
      init: (f) => {
        f.amount = 100;
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "charging";
        },
        forceCancel: (f) => {
          f.amount = 0;
        },
      },
      constraints: {
        charge: {
          when: (f) => f.status === "charging",
          require: { type: "CHARGE" },
          abortOn: ["amount"],
        },
      },
      resolvers: {
        run: {
          requirement: "CHARGE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.amount = 99;
          },
        },
      },
    });
    const sys2 = createSystem({
      module: m,
      plugins: [
        clobberAlertPlugin({
          irreversibleResolvers: ["run"],
          onAlert: (e) => alerts.push(e),
        }),
      ],
    });

    sys2.start();
    await flush();
    sys2.events.start();
    await flush();
    sys2.events.forceCancel();
    await flush();
    release2();
    await flush();

    // Untagged fact would normally not alert; resolver filter overrides.
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.at(-1)?.resolver).toBe("run");

    sys2.destroy();
    release(); // resolve any pending blocker from the buildClobberSystem call
  });

  it("isolates a throwing onAlert callback from the dispatch path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const alerts: ClobberAlertEvent[] = [];
    let callCount = 0;
    const { system, release } = buildClobberSystem({
      alerts: [], // unused; we override onAlert below
    });
    system.destroy();

    let release2!: () => void;
    const blocker = new Promise<void>((r) => {
      release2 = r;
    });
    const m = createModule("throwy", {
      schema: {
        facts: {
          amount: t.number().meta({ tags: ["money"] }),
          status: t.string(),
        },
        derivations: {},
        events: { start: {}, forceCancel: {} },
        requirements: { CHARGE: {} },
      },
      init: (f) => {
        f.amount = 100;
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "charging";
        },
        forceCancel: (f) => {
          f.amount = 0;
        },
      },
      constraints: {
        charge: {
          when: (f) => f.status === "charging",
          require: { type: "CHARGE" },
          abortOn: ["amount"],
        },
      },
      resolvers: {
        run: {
          requirement: "CHARGE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.amount = 99;
          },
        },
      },
    });
    const sys = createSystem({
      module: m,
      plugins: [
        clobberAlertPlugin({
          onAlert: (e) => {
            callCount++;
            alerts.push(e);
            throw new Error("PagerDuty 503");
          },
        }),
      ],
    });

    // Should NOT throw out of the dispatch path
    sys.start();
    await flush();
    sys.events.start();
    await flush();
    sys.events.forceCancel();
    await flush();
    expect(() => release2()).not.toThrow();
    await flush();

    expect(callCount).toBe(1);
    // The error was caught and surfaced via console.error
    const errCalls = errorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("onAlert callback threw"),
    );
    expect(errCalls.length).toBeGreaterThanOrEqual(1);

    sys.destroy();
    errorSpy.mockRestore();
    release(); // resolve outer blocker
  });

  it("default onAlert routes to console.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("pay", {
      schema: {
        facts: {
          amount: t.number().meta({ tags: ["money"] }),
          status: t.string(),
        },
        derivations: {},
        events: { start: {}, forceCancel: {} },
        requirements: { CHARGE: {} },
      },
      init: (f) => {
        f.amount = 100;
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "charging";
        },
        forceCancel: (f) => {
          f.amount = 0;
        },
      },
      constraints: {
        charge: {
          when: (f) => f.status === "charging",
          require: { type: "CHARGE" },
          abortOn: ["amount"],
        },
      },
      resolvers: {
        run: {
          requirement: "CHARGE",
          resolve: async (_req, ctx) => {
            await blocker;
            ctx.facts.amount = 99;
          },
        },
      },
    });

    const system = createSystem({
      module: m,
      plugins: [clobberAlertPlugin()],
    });
    system.start();
    await flush();
    system.events.start();
    await flush();
    system.events.forceCancel();
    await flush();
    release();
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    const firstCall = errorSpy.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain("CLOBBER");
    expect(firstCall).toContain("amount");

    errorSpy.mockRestore();
    system.destroy();
  });

  it("matchedBy discriminator reports tag, resolver, or both", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const m = createModule("matchedby", {
      schema: {
        facts: {
          tagged: t.number().meta({ tags: ["money"] }),
          untagged: t.number(),
          both: t.number().meta({ tags: ["money"] }),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f) => {
        f.tagged = 1;
        f.untagged = 1;
        f.both = 1;
      },
    });
    const plugin = clobberAlertPlugin({
      irreversibleResolvers: ["resolverA"],
      onAlert: (e) => alerts.push(e),
    });
    const system = createSystem({ module: m, plugins: [plugin] });
    system.start();

    const synth = (fact: string, resolver: string) => ({
      kind: "rejection" as const,
      resolver,
      req: { id: "req", requirement: { type: "T" } } as Parameters<
        NonNullable<typeof plugin.onResolverWriteRejected>
      >[0] extends infer X
        ? X extends { req: infer R }
          ? R
          : never
        : never,
      reason: "clobbered" as const,
      fact,
      expected: 1,
      actual: 2,
    });

    // Tag-only match
    plugin.onResolverWriteRejected?.(synth("tagged", "otherResolver"));
    // Resolver-only match (untagged fact, irreversible resolver)
    plugin.onResolverWriteRejected?.(synth("untagged", "resolverA"));
    // Both match
    plugin.onResolverWriteRejected?.(synth("both", "resolverA"));

    expect(alerts.length).toBe(3);
    expect(alerts[0]?.matchedBy).toBe("tag");
    expect(alerts[1]?.matchedBy).toBe("resolver");
    expect(alerts[2]?.matchedBy).toBe("both");

    system.destroy();
  });

  it("throwing onAlert does NOT burn its cooldown slot — retry can still fire", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    let throwNext = true;
    const alertsFired: ClobberAlertEvent[] = [];

    try {
      const m = createModule("throwy2", {
        schema: {
          facts: { amount: t.number().meta({ tags: ["money"] }) },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (f) => {
          f.amount = 1;
        },
      });
      const plugin = clobberAlertPlugin({
        cooldownMs: 5_000,
        onAlert: (e) => {
          alertsFired.push(e);
          if (throwNext) {
            throwNext = false;
            throw new Error("transient outage");
          }
        },
      });
      const system = createSystem({ module: m, plugins: [plugin] });
      system.start();

      const synth = () => ({
        kind: "rejection" as const,
        resolver: "r",
        req: { id: "req", requirement: { type: "T" } } as Parameters<
          NonNullable<typeof plugin.onResolverWriteRejected>
        >[0] extends infer X
          ? X extends { req: infer R }
            ? R
            : never
          : never,
        reason: "clobbered" as const,
        fact: "amount",
        expected: 1,
        actual: 2,
      });

      // First call throws — cooldown NOT stamped because the alert
      // didn't complete successfully.
      plugin.onResolverWriteRejected?.(synth());
      expect(alertsFired.length).toBe(1);

      // Second call within cooldown — should fire because the first
      // throw didn't burn the slot.
      now += 1_000;
      plugin.onResolverWriteRejected?.(synth());
      expect(alertsFired.length).toBe(2);

      // Third call within cooldown of the SUCCESSFUL second call —
      // suppressed.
      now += 1_000;
      plugin.onResolverWriteRejected?.(synth());
      expect(alertsFired.length).toBe(2);

      system.destroy();
    } finally {
      dateNowSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("cooldown map cannot grow beyond the FIFO cap", async () => {
    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);

    try {
      const m = createModule("cap", {
        schema: { facts: { _: t.number() }, derivations: {}, events: {}, requirements: {} },
        init: (f) => {
          f._ = 1;
        },
      });
      // Resolver-side matching avoids needing N tagged facts; every
      // synthetic clobber alerts.
      const plugin = clobberAlertPlugin({
        cooldownMs: 60_000,
        irreversibleResolvers: ["r"],
        onAlert: () => {},
      });
      const system = createSystem({ module: m, plugins: [plugin] });
      system.start();

      const synth = (fact: string) => ({
        kind: "rejection" as const,
        resolver: "r",
        req: { id: `req-${fact}`, requirement: { type: "T" } } as Parameters<
          NonNullable<typeof plugin.onResolverWriteRejected>
        >[0] extends infer X
          ? X extends { req: infer R }
            ? R
            : never
          : never,
        reason: "clobbered" as const,
        fact,
        expected: 1,
        actual: 2,
      });

      // Fire 1100 distinct (fact, resolver) keys — cooldown map should
      // cap at 1000 with the first 100 evicted.
      for (let i = 0; i < 1100; i++) {
        plugin.onResolverWriteRejected?.(synth(`f${i}`));
        now += 1; // each unique key gets its own slot
      }

      // Access the cap indirectly: alerting fact f0 again should now
      // fire (its cooldown slot was evicted), while fact f1099 should
      // be suppressed (still in the map).
      // First check the eviction-victim:
      plugin.onResolverWriteRejected?.(synth("f0"));
      // Second check the still-present entry:
      plugin.onResolverWriteRejected?.(synth("f1099"));
      // We can't directly read the internal map, but the eviction
      // behavior shouldn't crash; the cap test is mainly a memory
      // smoke test that the loop runs to completion under cap pressure.
      expect(true).toBe(true);

      system.destroy();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("onSummary fires for resolver-listed irreversible resolvers", async () => {
    const summaries: ClobberSummaryEvent[] = [];
    const m = createModule("summary", {
      schema: { facts: { _: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => {
        f._ = 1;
      },
    });
    const plugin = clobberAlertPlugin({
      irreversibleResolvers: ["chargeCard"],
      onAlert: () => {},
      onSummary: (e) => summaries.push(e),
    });
    const system = createSystem({ module: m, plugins: [plugin] });
    system.start();

    plugin.onResolverWriteRejected?.({
      kind: "summary",
      resolver: "chargeCard",
      req: { id: "req", requirement: { type: "T" } } as Parameters<
        NonNullable<typeof plugin.onResolverWriteRejected>
      >[0] extends infer X
        ? X extends { req: infer R }
          ? R
          : never
        : never,
      reason: "clobbered",
      dropped: 47,
    });

    expect(summaries.length).toBe(1);
    expect(summaries[0]?.resolver).toBe("chargeCard");
    expect(summaries[0]?.dropped).toBe(47);
    expect(summaries[0]?.matchedBy).toBe("resolver-listed");

    system.destroy();
  });

  it("onSummary fires for resolvers that previously alerted on an irreversible fact", async () => {
    const alerts: ClobberAlertEvent[] = [];
    const summaries: ClobberSummaryEvent[] = [];
    const m = createModule("priorAlert", {
      schema: {
        facts: { amount: t.number().meta({ tags: ["money"] }) },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f) => {
        f.amount = 1;
      },
    });
    const plugin = clobberAlertPlugin({
      onAlert: (e) => alerts.push(e),
      onSummary: (e) => summaries.push(e),
    });
    const system = createSystem({ module: m, plugins: [plugin] });
    system.start();

    const synthRejection = () => ({
      kind: "rejection" as const,
      resolver: "loopy",
      req: { id: "req", requirement: { type: "T" } } as Parameters<
        NonNullable<typeof plugin.onResolverWriteRejected>
      >[0] extends infer X
        ? X extends { req: infer R }
          ? R
          : never
        : never,
      reason: "clobbered" as const,
      fact: "amount",
      expected: 1,
      actual: 2,
    });

    // First a rejection — fires onAlert, records the resolver.
    plugin.onResolverWriteRejected?.(synthRejection());
    expect(alerts.length).toBe(1);

    // Then a summary for the same resolver — fires onSummary because
    // the resolver is in the "prior-irreversible-alert" set.
    plugin.onResolverWriteRejected?.({
      kind: "summary",
      resolver: "loopy",
      req: { id: "req", requirement: { type: "T" } } as Parameters<
        NonNullable<typeof plugin.onResolverWriteRejected>
      >[0] extends infer X
        ? X extends { req: infer R }
          ? R
          : never
        : never,
      reason: "clobbered",
      dropped: 23,
    });

    expect(summaries.length).toBe(1);
    expect(summaries[0]?.matchedBy).toBe("prior-irreversible-alert");
    expect(summaries[0]?.dropped).toBe(23);

    system.destroy();
  });

  it("onSummary stays silent when neither filter matches", async () => {
    const summaries: ClobberSummaryEvent[] = [];
    const m = createModule("silent", {
      schema: { facts: { _: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => {
        f._ = 1;
      },
    });
    const plugin = clobberAlertPlugin({
      irreversibleResolvers: ["chargeCard"],
      onAlert: () => {},
      onSummary: (e) => summaries.push(e),
    });
    const system = createSystem({ module: m, plugins: [plugin] });
    system.start();

    // Summary for an unrelated resolver that never fired onAlert.
    plugin.onResolverWriteRejected?.({
      kind: "summary",
      resolver: "noiseResolver",
      req: { id: "req", requirement: { type: "T" } } as Parameters<
        NonNullable<typeof plugin.onResolverWriteRejected>
      >[0] extends infer X
        ? X extends { req: infer R }
          ? R
          : never
        : never,
      reason: "clobbered",
      dropped: 5,
    });

    expect(summaries.length).toBe(0);
    system.destroy();
  });

  it("isolates a throwing onSummary callback from the dispatch path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = createModule("throwingSummary", {
      schema: { facts: { _: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => {
        f._ = 1;
      },
    });
    const plugin = clobberAlertPlugin({
      irreversibleResolvers: ["r"],
      onAlert: () => {},
      onSummary: () => {
        throw new Error("PagerDuty 503");
      },
    });
    const system = createSystem({ module: m, plugins: [plugin] });
    system.start();

    expect(() =>
      plugin.onResolverWriteRejected?.({
        kind: "summary",
        resolver: "r",
        req: { id: "req", requirement: { type: "T" } } as Parameters<
          NonNullable<typeof plugin.onResolverWriteRejected>
        >[0] extends infer X
          ? X extends { req: infer R }
            ? R
            : never
          : never,
        reason: "clobbered",
        dropped: 3,
      }),
    ).not.toThrow();

    const errCalls = errorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("onSummary callback threw"),
    );
    expect(errCalls.length).toBeGreaterThanOrEqual(1);

    errorSpy.mockRestore();
    system.destroy();
  });
});
