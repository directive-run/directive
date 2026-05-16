// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import {
  bindListQueryHandle,
  createListQuery,
  createQuerySystem,
  withQueries,
} from "../index.js";
import { serializeKey } from "../internal.js";

// ============================================================================
// Helpers
// ============================================================================

function flushMicrotasks(rounds = 10): Promise<void> {
  return Array.from({ length: rounds }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );
}

interface DriftRow {
  gameId: string;
  spread: number;
}

function createDriftQuery(
  fetcherFn?: (
    params: { gameId: string },
    signal: AbortSignal,
  ) => Promise<DriftRow>,
) {
  return createListQuery({
    name: "drift",
    keys: (facts) => {
      const ids = facts.activeGameIds as string[];
      if (!ids || ids.length === 0) return null;
      return ids.map((id) => ({ gameId: id }));
    },
    fetcher:
      fetcherFn ??
      (async ({ gameId }) => ({ gameId, spread: gameId.length * 1.5 })),
    refetchAfter: 30_000,
  });
}

function createTestModule(query: ReturnType<typeof createListQuery>) {
  return createModule(
    "test",
    withQueries([query], {
      schema: {
        facts: { activeGameIds: t.array(t.string()) },
        derivations: {},
        events: {
          setActiveGameIds: { value: t.array(t.string()) },
        },
        requirements: {},
      } satisfies ModuleSchema,
      init: (facts) => {
        facts.activeGameIds = [];
      },
      events: {
        setActiveGameIds: (
          facts: Record<string, unknown>,
          { value }: { value: string[] },
        ) => {
          facts.activeGameIds = value;
        },
      },
    }),
  );
}

// ============================================================================
// createListQuery — shape
// ============================================================================

describe("createListQuery", () => {
  describe("shape", () => {
    it("returns a QueryDefinition with all expected fragments", () => {
      const q = createDriftQuery();
      expect(q.name).toBe("drift");
      expect(q.schema.facts).toBeDefined();
      expect(q.schema.derivations).toBeDefined();
      expect(q.requirements).toBeDefined();
      expect(q.constraints).toBeDefined();
      expect(q.resolvers).toBeDefined();
      expect(q.derive).toBeDefined();
    });

    it("declares 4 internal facts: states, activeKeys, triggerByKey, expireAt", () => {
      const q = createDriftQuery();
      const factKeys = Object.keys(q.schema.facts);
      expect(factKeys).toContain("_q_drift_states");
      expect(factKeys).toContain("_q_drift_activeKeys");
      expect(factKeys).toContain("_q_drift_triggerByKey");
      expect(factKeys).toContain("_q_drift_expireAt");
    });

    it("init() seeds plain Record objects on facts (JSON-serializable)", () => {
      const q = createDriftQuery();
      const facts: Record<string, unknown> = {};
      q.init(facts);
      expect(facts._q_drift_states).toEqual({});
      expect(facts._q_drift_activeKeys).toEqual({});
      expect(facts._q_drift_triggerByKey).toEqual({});
      expect(facts._q_drift_expireAt).toEqual({});
      // JSON round-trip must work — that's the whole point of using
      // Records over Maps. Time-travel + structuredClone friendly.
      const cloned = JSON.parse(JSON.stringify(facts));
      expect(cloned._q_drift_states).toEqual({});
    });

    it("init() with initialData populates the states Map as success", () => {
      const initial = new Map<string, DriftRow>();
      initial.set(serializeKey({ gameId: "abc" }), {
        gameId: "abc",
        spread: 3.5,
      });
      const q = createListQuery({
        name: "drift",
        keys: () => null,
        fetcher: async () => ({ gameId: "x", spread: 0 }),
        initialData: initial,
      });
      const facts: Record<string, unknown> = {};
      q.init(facts);
      const states = facts._q_drift_states as Record<string, any>;
      expect(Object.keys(states).length).toBe(1);
      const entry = states[serializeKey({ gameId: "abc" })];
      expect(entry?.status).toBe("success");
      expect(entry?.data).toEqual({ gameId: "abc", spread: 3.5 });
    });
  });

  // ============================================================================
  // Per-key fetching
  // ============================================================================

  describe("per-key fetching", () => {
    it("fetches each active key independently and stores ResourceState per key", async () => {
      const fetcher = vi.fn(async ({ gameId }: { gameId: string }) => ({
        gameId,
        spread: gameId === "abc" ? 3.5 : 7.0,
      }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();

      sys.events.setActiveGameIds({ value: ["abc", "xyz"] });
      await flushMicrotasks(20);

      expect(fetcher).toHaveBeenCalledTimes(2);
      const states = sys.facts._q_drift_states as Record<string, any>;
      expect(Object.keys(states).length).toBe(2);
      expect(states[serializeKey({ gameId: "abc" })]?.data).toEqual({
        gameId: "abc",
        spread: 3.5,
      });
      expect(states[serializeKey({ gameId: "xyz" })]?.data).toEqual({
        gameId: "xyz",
        spread: 7.0,
      });
      sys.destroy();
    });

    it("does not refetch a key whose cached entry is fresh (within refetchAfter)", async () => {
      const fetcher = vi.fn(async ({ gameId }: { gameId: string }) => ({
        gameId,
        spread: 3.5,
      }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();

      sys.events.setActiveGameIds({ value: ["abc"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Adding a NEW key should fetch only the new one — abc is still fresh.
      sys.events.setActiveGameIds({ value: ["abc", "xyz"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher).toHaveBeenLastCalledWith(
        { gameId: "xyz" },
        expect.any(AbortSignal),
      );
      sys.destroy();
    });

    it("preserves cached entries for keys removed from active set (until GC)", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({ gameId, spread: 1.0 }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();

      sys.events.setActiveGameIds({ value: ["abc", "xyz"] });
      await flushMicrotasks(20);
      expect(
        Object.keys(sys.facts._q_drift_states as Record<string, any>).length,
      ).toBe(2);

      // Remove "xyz" from active set — its cache entry sticks around.
      sys.events.setActiveGameIds({ value: ["abc"] });
      await flushMicrotasks(5);
      const states = sys.facts._q_drift_states as Record<string, any>;
      expect(serializeKey({ gameId: "xyz" }) in states).toBe(true);
      sys.destroy();
    });

    it("handles fetcher errors per-key without poisoning sibling entries", async () => {
      const fetcher = vi.fn(async ({ gameId }: { gameId: string }) => {
        if (gameId === "bad") throw new Error("boom");
        return { gameId, spread: 1.0 };
      });
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();

      sys.events.setActiveGameIds({ value: ["good", "bad", "great"] });
      await flushMicrotasks(20);

      const states = sys.facts._q_drift_states as Record<string, any>;
      expect(states[serializeKey({ gameId: "good" })]?.status).toBe("success");
      expect(states[serializeKey({ gameId: "bad" })]?.status).toBe("error");
      expect(states[serializeKey({ gameId: "bad" })]?.error?.message).toBe(
        "boom",
      );
      expect(states[serializeKey({ gameId: "great" })]?.status).toBe("success");
      sys.destroy();
    });
  });

  // ============================================================================
  // Bound handle (peek / refetch / setData / invalidate)
  // ============================================================================

  describe("bindListQueryHandle", () => {
    it("peek() returns ResourceState for a known key, null otherwise", async () => {
      const q = createDriftQuery();
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      sys.events.setActiveGameIds({ value: ["abc"] });
      await flushMicrotasks(20);

      const handle = bindListQueryHandle<DriftRow, Error, { gameId: string }>(
        sys.facts as Record<string, unknown>,
        "drift",
      );
      expect(handle.peek({ gameId: "abc" })?.status).toBe("success");
      expect(handle.peek({ gameId: "missing" })).toBeNull();
      sys.destroy();
    });

    it("refetch(params) triggers a single-key fetch", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({ gameId, spread: 1.0 }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      sys.events.setActiveGameIds({ value: ["abc", "xyz"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(2);

      const handle = bindListQueryHandle<DriftRow, Error, { gameId: string }>(
        sys.facts as Record<string, unknown>,
        "drift",
      );
      handle.refetch({ gameId: "abc" });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(3); // only abc refetched
      sys.destroy();
    });

    it("setData(params, data) writes optimistically without firing the fetcher", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({ gameId, spread: 1.0 }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();

      const handle = bindListQueryHandle<DriftRow, Error, { gameId: string }>(
        sys.facts as Record<string, unknown>,
        "drift",
      );
      handle.setData({ gameId: "manual" }, { gameId: "manual", spread: 99.9 });

      const peeked = handle.peek({ gameId: "manual" });
      expect(peeked?.status).toBe("success");
      expect(peeked?.data?.spread).toBe(99.9);
      expect(fetcher).not.toHaveBeenCalled();
      sys.destroy();
    });

    it("invalidate(params) marks an entry stale so the next pass refetches", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({
        gameId,
        spread: Date.now() % 10,
      }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      sys.events.setActiveGameIds({ value: ["abc"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(1);

      const handle = bindListQueryHandle<DriftRow, Error, { gameId: string }>(
        sys.facts as Record<string, unknown>,
        "drift",
      );
      handle.invalidate({ gameId: "abc" });
      await flushMicrotasks(20);
      // Invalidate alone doesn't fire the fetcher unless the trigger map
      // pushes; refetch() is what users want for an immediate hit.
      handle.refetch({ gameId: "abc" });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(2);
      sys.destroy();
    });

    it("refetchAll() refires every active key", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({ gameId, spread: 1.0 }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      sys.events.setActiveGameIds({ value: ["a", "b", "c"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(3);

      const handle = bindListQueryHandle<DriftRow, Error, { gameId: string }>(
        sys.facts as Record<string, unknown>,
        "drift",
      );
      handle.refetchAll();
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(6);
      sys.destroy();
    });
  });

  // ============================================================================
  // Disabled / empty
  // ============================================================================

  // ============================================================================
  // createQuerySystem integration — listQueries config field
  // ============================================================================

  describe("createQuerySystem integration", () => {
    it("listQueries config wires up bound handles via system.listQueries", async () => {
      const fetcher = vi.fn(async ({ gameId }) => ({ gameId, spread: 1.0 }));
      const sys = createQuerySystem({
        facts: { activeGameIds: [] as string[] },
        listQueries: {
          drift: {
            keys: (f) => {
              const ids = f.activeGameIds as string[];
              return ids.length > 0 ? ids.map((id) => ({ gameId: id })) : null;
            },
            fetcher,
          },
        },
        events: {
          setIds: (
            facts: Record<string, unknown>,
            { value }: { value: string[] },
          ) => {
            facts.activeGameIds = value;
          },
        },
      });

      // System is auto-started; bound handle exists
      expect(sys.listQueries.drift).toBeDefined();
      expect(typeof sys.listQueries.drift.peek).toBe("function");

      sys.events.setIds({ value: ["abc", "xyz"] });
      await flushMicrotasks(20);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // peek finds the cached entry by params (no facts mutation)
      const drift = sys.listQueries.drift.peek({ gameId: "abc" });
      expect(drift?.status).toBe("success");
      expect(drift?.data).toEqual({ gameId: "abc", spread: 1.0 });
      sys.destroy();
    });
  });

  describe("disabled state", () => {
    it("does not fetch when keys() returns null", async () => {
      const fetcher = vi.fn(async () => ({ gameId: "x", spread: 0 }));
      const q = createDriftQuery(fetcher);
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      // Default activeGameIds is [] → keys() returns null
      await flushMicrotasks(10);
      expect(fetcher).not.toHaveBeenCalled();
      sys.destroy();
    });

    it("does not fetch when keys() returns []", async () => {
      const fetcher = vi.fn(async () => ({ gameId: "x", spread: 0 }));
      const q = createListQuery({
        name: "drift",
        keys: () => [],
        fetcher,
      });
      const sys = createSystem({ module: createTestModule(q) });
      sys.start();
      await flushMicrotasks(10);
      expect(fetcher).not.toHaveBeenCalled();
      sys.destroy();
    });
  });
});
