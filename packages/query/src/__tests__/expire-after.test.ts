// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import {
  createInfiniteQuery,
  createQuery,
  createQuerySystem,
  withQueries,
} from "../index.js";
import type { InfiniteResourceState, ResourceState } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createTestQuery(expireAfter: number) {
  return createQuery({
    name: "user",
    key: (f) => {
      const userId = f.userId as string;
      if (!userId) {
        return null;
      }

      return { userId };
    },
    fetcher: async (p) => ({ id: p.userId, name: "John" }),
    expireAfter,
  });
}

function createTestModule(query) {
  return createModule(
    "test",
    withQueries([query], {
      schema: {
        facts: { userId: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (f) => {
        f.userId = "";
      },
    }),
  );
}

// ============================================================================
// expireAfter – Query cache garbage collection
// ============================================================================

describe("expireAfter", () => {
  describe("createQuery", () => {
    it("clears cache after query goes idle", async () => {
      const query = createTestQuery(100); // 100ms expire
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      // Fetch data
      system.facts.userId = "1";
      await system.settle();
      let state = system.read("user") as ResourceState<unknown>;
      expect(state.isSuccess).toBe(true);
      expect(state.data).toEqual({ id: "1", name: "John" });

      // Go idle
      system.facts.userId = "";
      await wait(50);

      // Wait for expiry
      await wait(150);

      state = system.read("user") as ResourceState<unknown>;
      expect(state.isPending).toBe(true);
      expect(state.data).toBeNull();

      system.destroy();
    }, 10_000);

    it("cancels timer if query reactivates before expiry", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1" }));
      const query = createQuery({
        name: "user",
        key: (f) => {
          const userId = f.userId as string;
          if (!userId) {
            return null;
          }

          return { userId };
        },
        fetcher: fetcherFn,
        expireAfter: 200,
      });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      // Go idle
      system.facts.userId = "";
      await wait(50);

      // Reactivate before expiry
      system.facts.userId = "1";
      await system.settle();

      // Wait past original expiry
      await wait(300);

      // Data should still be there
      const state = system.read("user") as ResourceState<unknown>;
      expect(state.isSuccess).toBe(true);
      expect(state.data).toEqual({ id: "1" });

      system.destroy();
    }, 10_000);

    it("expireAfter: 0 disables GC", async () => {
      const query = createTestQuery(0);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      // Go idle
      system.facts.userId = "";
      await wait(200);

      // Data should still be cached
      const state = system.read("user") as ResourceState<unknown>;
      expect(state.data).toEqual({ id: "1", name: "John" });

      system.destroy();
    }, 10_000);

    it("after GC, re-enabling fetches fresh data", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "fresh" }));
      const query = createQuery({
        name: "user",
        key: (f) => {
          const userId = f.userId as string;
          if (!userId) {
            return null;
          }

          return { userId };
        },
        fetcher: fetcherFn,
        expireAfter: 100,
      });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      // First fetch
      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      // Go idle + wait for GC
      system.facts.userId = "";
      await wait(200);

      // Re-enable – should fetch fresh
      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(2);

      system.destroy();
    }, 10_000);
  });

  describe("createQuerySystem", () => {
    it("expireAfter works through createQuerySystem", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1" }));
      const app = createQuerySystem({
        facts: { userId: "" },
        queries: {
          user: {
            key: (f) => {
              const userId = f.userId as string;
              if (!userId) {
                return null;
              }

              return { userId };
            },
            fetcher: fetcherFn,
            expireAfter: 100,
          },
        },
      });

      app.facts.userId = "1";
      await app.settle();

      // Go idle + wait for expiry
      app.facts.userId = "";
      await wait(200);

      const state = app.read("user") as ResourceState<unknown>;
      expect(state.isPending).toBe(true);
      expect(state.data).toBeNull();

      app.destroy();
    }, 10_000);
  });

  describe("createInfiniteQuery", () => {
    it("expireAfter clears infinite query pages", async () => {
      const query = createInfiniteQuery({
        name: "feed",
        key: (f) => {
          const userId = f.userId as string;
          if (!userId) {
            return null;
          }

          return { userId };
        },
        fetcher: async () => ({ items: ["a"], nextCursor: null }),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialPageParam: null,
        expireAfter: 100,
      });

      const mod = createModule(
        "test",
        withQueries([query], {
          schema: {
            facts: { userId: t.string() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
          init: (f) => {
            f.userId = "";
          },
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      let state = system.read("feed") as InfiniteResourceState<unknown>;
      expect(state.pages).toHaveLength(1);

      // Go idle + wait for expiry
      system.facts.userId = "";
      await wait(200);

      state = system.read("feed") as InfiniteResourceState<unknown>;
      expect(state.isPending).toBe(true);
      expect(state.pages).toEqual([]);

      system.destroy();
    }, 10_000);
  });
});
