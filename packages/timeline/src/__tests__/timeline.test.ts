// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "@directive-run/core";
import { flushAsync } from "@directive-run/core/testing";
import {
  clearAllTimelines,
  clearTimeline,
  deserializeTimeline,
  formatTimeline,
  getTimeline,
  recordTimeline,
  replayTimeline,
  serializeTimeline,
  setRegistryCap,
  withTimeline,
} from "../index.js";

interface CounterDeps {
  loadInitial: () => Promise<number>;
}

function buildCounter(deps: CounterDeps) {
  return createModule("counter", {
    schema: {
      facts: {
        count: t.number(),
        status: t.string<"idle" | "loading" | "ready">(),
      },
      events: {
        LOAD: {},
        INC: {},
      },
      requirements: {
        FETCH_INITIAL: {},
      },
    },
    init: (f) => {
      f.count = 0;
      f.status = "idle";
    },
    constraints: {
      load: {
        when: (f) => f.status === "loading",
        require: { type: "FETCH_INITIAL" },
      },
    },
    resolvers: {
      initialLoader: {
        requirement: "FETCH_INITIAL",
        resolve: async (_req, ctx) => {
          ctx.facts.count = await deps.loadInitial();
          ctx.facts.status = "ready";
        },
      },
    },
    events: {
      LOAD: (f) => {
        if (f.status === "idle") f.status = "loading";
      },
      INC: (f) => {
        f.count += 1;
      },
    },
  });
}

describe("@directive-run/timeline", () => {
  afterEach(() => clearAllTimelines());

  it("records system.observe events into a timeline", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    recordTimeline(sys, { id: "rec-basic" });

    sys.start();
    sys.events.LOAD();
    await flushAsync();

    const timeline = getTimeline("rec-basic");
    expect(timeline).toBeDefined();
    expect(timeline!.frames.length).toBeGreaterThan(0);

    const kinds = timeline!.frames.map((f) => f.event.type);
    // We should see at least: system.start, fact.change(s), resolver.start,
    // resolver.complete somewhere in the chain.
    expect(kinds).toContain("system.start");
    expect(kinds).toContain("fact.change");
    expect(kinds).toContain("resolver.start");
    expect(kinds).toContain("resolver.complete");

    sys.destroy();
  });

  it("captures fact.change with prev/next values", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 42 }),
    });
    recordTimeline(sys, { id: "fact-prev-next" });

    sys.start();
    sys.events.LOAD();
    await flushAsync();

    const timeline = getTimeline("fact-prev-next")!;
    const factChanges = timeline.frames
      .filter((f) => f.event.type === "fact.change")
      .map((f) => f.event as { type: "fact.change"; key: string; prev: unknown; next: unknown });

    const countChange = factChanges.find((c) => c.key === "count" && c.next === 42);
    expect(countChange).toBeDefined();
    expect(countChange!.prev).toBe(0);

    sys.destroy();
  });

  it("formatTimeline renders a multi-line trace", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 1 }),
    });
    const t1 = recordTimeline(sys, { id: "fmt" });

    sys.start();
    sys.events.LOAD();
    await flushAsync();
    sys.events.INC();

    const out = formatTimeline(t1, { color: false });
    expect(out).toContain("Timeline 'fmt'");
    expect(out).toContain("system.start");
    expect(out).toContain("fact.change");
    expect(out).toContain("count");
    // Multi-line:
    expect(out.split("\n").length).toBeGreaterThan(5);

    sys.destroy();
  });

  it("formatTimeline truncates long timelines via maxFrames", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 0 }),
    });
    const t1 = recordTimeline(sys, { id: "trunc" });

    sys.start();
    sys.events.LOAD();
    await flushAsync();
    for (let i = 0; i < 50; i++) sys.events.INC();
    await flushAsync();

    const out = formatTimeline(t1, { color: false, maxFrames: 5 });
    expect(out).toContain("more frame");
    expect(out).toContain("elided");

    sys.destroy();
  });

  it("formatTimeline supports include filter", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 0 }),
    });
    const t1 = recordTimeline(sys, { id: "filter" });

    sys.start();
    sys.events.LOAD();
    await flushAsync();

    const out = formatTimeline(t1, {
      color: false,
      include: ["fact.change"],
    });
    expect(out).toContain("fact.change");
    expect(out).not.toContain("resolver.start");
    expect(out).not.toContain("system.start");

    sys.destroy();
  });

  it("recording is idempotent — same id replaces previous", async () => {
    const sys1 = createSystem({
      module: buildCounter({ loadInitial: async () => 1 }),
    });
    recordTimeline(sys1, { id: "dup" });
    sys1.start();
    sys1.events.LOAD();
    await flushAsync();
    sys1.destroy();

    const sys2 = createSystem({
      module: buildCounter({ loadInitial: async () => 99 }),
    });
    recordTimeline(sys2, { id: "dup" }); // overwrites
    sys2.start();
    sys2.events.LOAD();
    await flushAsync();

    const timeline = getTimeline("dup")!;
    const lastCount = timeline.frames
      .filter((f) => f.event.type === "fact.change")
      .map((f) => f.event as { key: string; next: unknown })
      .filter((c) => c.key === "count")
      .pop()?.next;
    expect(lastCount).toBe(99);

    sys2.destroy();
  });

  it("clearTimeline drops a timeline + halts further recording", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 0 }),
    });
    recordTimeline(sys, { id: "to-clear" });
    sys.start();

    expect(getTimeline("to-clear")).toBeDefined();
    clearTimeline("to-clear");
    expect(getTimeline("to-clear")).toBeUndefined();

    sys.destroy();
  });

  it("withTimeline auto-stops on resolve and on throw", async () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 5 }),
    });

    await withTimeline("with-ok", sys, async () => {
      sys.start();
      sys.events.LOAD();
      await flushAsync();
    });
    expect(getTimeline("with-ok")?.frames.length).toBeGreaterThan(0);

    const sys2 = createSystem({
      module: buildCounter({ loadInitial: async () => 0 }),
    });
    await expect(
      withTimeline("with-throw", sys2, async () => {
        sys2.start();
        throw new Error("oops");
      }),
    ).rejects.toThrow("oops");
    // Recording happened up to the throw; timeline still in registry.
    expect(getTimeline("with-throw")?.frames.length).toBeGreaterThan(0);

    sys.destroy();
    sys2.destroy();
  });

  it("formatTimeline handles undefined input", () => {
    expect(formatTimeline(undefined)).toBe("(no timeline)");
  });

  it("R1 sec M3: registry evicts oldest entries past the cap", () => {
    setRegistryCap(3);
    try {
      const systems: ReturnType<typeof createSystem>[] = [];
      for (let i = 0; i < 5; i++) {
        const sys = createSystem({
          module: buildCounter({ loadInitial: async () => i }),
        });
        sys.start();
        recordTimeline(sys, { id: `cap-${i}` });
        systems.push(sys);
      }
      // First two should be evicted; last three retained.
      expect(getTimeline("cap-0")).toBeUndefined();
      expect(getTimeline("cap-1")).toBeUndefined();
      expect(getTimeline("cap-2")).toBeDefined();
      expect(getTimeline("cap-3")).toBeDefined();
      expect(getTimeline("cap-4")).toBeDefined();
      systems.forEach((s) => s.destroy());
    } finally {
      setRegistryCap(500);
    }
  });

  it("R1 sec M3: setRegistryCap rejects invalid values", () => {
    expect(() => setRegistryCap(0)).toThrow();
    expect(() => setRegistryCap(-1)).toThrow();
    expect(() => setRegistryCap(Number.NaN)).toThrow();
    expect(() => setRegistryCap(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("R1.A serialize/deserialize round-trips via JSON", () => {
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "serialize-rt" });
    sys.start();
    sys.events.LOAD();
    // Don't await flush — keep this sync to avoid timing nondeterminism.
    sys.events.INC();
    sys.events.INC();

    const serialized = serializeTimeline(t1);
    const json = JSON.stringify(serialized);
    const parsed = deserializeTimeline(JSON.parse(json));
    expect(parsed.version).toBe(1);
    expect(parsed.id).toBe("serialize-rt");
    expect(parsed.startedAtMs).toBe(t1.startedAtMs);
    expect(parsed.frames.length).toBe(t1.frames.length);
    sys.destroy();
  });

  it("R1.A deserialize rejects invalid input", () => {
    expect(() => deserializeTimeline(null)).toThrow(/expected object/);
    expect(() =>
      deserializeTimeline({ version: 99, id: "x", startedAtMs: 0, frames: [] }),
    ).toThrow(/unsupported version/);
    expect(() =>
      deserializeTimeline({ version: 1, id: 123, startedAtMs: 0, frames: [] }),
    ).toThrow(/id must be a string/);
    expect(() =>
      deserializeTimeline({ version: 1, id: "x", startedAtMs: 0, frames: "no" }),
    ).toThrow(/frames must be an array/);
  });

  it("R1.A replayTimeline re-dispatches recorded MUTATE-shaped fact changes", async () => {
    // Build a synthetic timeline frame stream that looks like what
    // @directive-run/mutator would emit: a fact.change on
    // pendingMutation transitioning null → { kind, payload, status:
    // 'pending', error: null }.
    const synthetic = {
      version: 1 as const,
      id: "synthetic-replay",
      startedAtMs: 0,
      frames: [
        {
          ts: 1,
          event: {
            type: "fact.change" as const,
            key: "pendingMutation",
            prev: null,
            next: {
              kind: "increment",
              payload: { by: 5 },
              status: "pending",
              error: null,
            },
          },
        },
      ],
    };

    const dispatched: Array<{ type: string; [key: string]: unknown }> = [];
    const stubSystem = {
      dispatch: (e: { type: string; [key: string]: unknown }) => {
        dispatched.push(e);
      },
    };

    await replayTimeline(synthetic, stubSystem);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe("MUTATE");
    expect(dispatched[0]?.kind).toBe("increment");
    expect(dispatched[0]?.payload).toEqual({ by: 5 });
  });

  it("R1.A replayTimeline skips non-dispatchable frames by default", async () => {
    const synthetic = {
      version: 1 as const,
      id: "synthetic-skip",
      startedAtMs: 0,
      frames: [
        // system.start has no dispatch surface — should skip
        { ts: 0, event: { type: "system.start" as const } },
        // reconcile.start — internal lifecycle, skip
        { ts: 1, event: { type: "reconcile.start" as const } },
        // resolver.complete — caused by, not dispatched
        {
          ts: 2,
          event: {
            type: "resolver.complete" as const,
            resolver: "x",
            requirementId: "r1",
            duration: 5,
          },
        },
      ],
    };

    const dispatched: unknown[] = [];
    await replayTimeline(synthetic, { dispatch: (e) => dispatched.push(e) });
    expect(dispatched).toHaveLength(0);
  });

  it("R1.A replayTimeline { dispatchable: false } walks every frame", async () => {
    const synthetic = {
      version: 1 as const,
      id: "synthetic-walk",
      startedAtMs: 0,
      frames: [
        { ts: 0, event: { type: "system.start" as const } },
        {
          ts: 1,
          event: {
            type: "fact.change" as const,
            key: "pendingMutation",
            prev: null,
            next: {
              kind: "x",
              payload: {},
              status: "pending",
              error: null,
            },
          },
        },
      ],
    };

    const dispatched: unknown[] = [];
    await replayTimeline(
      synthetic,
      { dispatch: (e) => dispatched.push(e) },
      { dispatchable: false },
    );
    // Even with dispatchable: false, system.start has no
    // reconstructed dispatch payload (returns null), so only the
    // pendingMutation frame produces a dispatch.
    expect(dispatched).toHaveLength(1);
  });
});
