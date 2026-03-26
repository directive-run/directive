import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createInfiniteQuery, withQueries } from "../index.js";
import type { InfiniteResourceState } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function flushMicrotasks(rounds = 10): Promise<void> {
  return Array.from({ length: rounds }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );
}

interface Page {
  items: string[];
  nextCursor: string | null;
  prevCursor?: string | null;
}

function createPaginatedQuery(
  fetcherFn?: (
    params: { userId: string; pageParam: string | null },
    signal: AbortSignal,
  ) => Promise<Page>,
  opts?: Partial<Parameters<typeof createInfiniteQuery>[0]>,
) {
  return createInfiniteQuery({
    name: "feed",
    key: (facts) => {
      const userId = facts.userId as string;
      if (!userId) {
        return null;
      }

      return { userId };
    },
    fetcher:
      fetcherFn ??
      (async (params) => ({
        items: [`item-${params.pageParam ?? "0"}`],
        nextCursor:
          params.pageParam === "2"
            ? null
            : `${Number(params.pageParam ?? 0) + 1}`,
      })),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    ...opts,
  } as Parameters<typeof createInfiniteQuery>[0]);
}

function createTestModule(query: ReturnType<typeof createInfiniteQuery>) {
  return createModule(
    "test",
    withQueries([query], {
      schema: {
        facts: { userId: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (facts) => {
        facts.userId = "";
      },
    }),
  );
}

// ============================================================================
// createInfiniteQuery
// ============================================================================

describe("createInfiniteQuery", () => {
  describe("basic structure", () => {
    it("returns an InfiniteQueryDefinition with all fragments", () => {
      const query = createPaginatedQuery();

      expect(query.name).toBe("feed");
      expect(query.schema.facts).toBeDefined();
      expect(query.schema.derivations).toBeDefined();
      expect(query.constraints).toBeDefined();
      expect(query.resolvers).toBeDefined();
      expect(query.fetchNextPage).toBeTypeOf("function");
      expect(query.fetchPreviousPage).toBeTypeOf("function");
      expect(query.refetch).toBeTypeOf("function");
    });

    it("starts in pending state with empty pages", () => {
      const query = createPaginatedQuery();
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      const state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.status).toBe("pending");
      expect(state.isPending).toBe(true);
      expect(state.pages).toEqual([]);
      expect(state.pageParams).toEqual([]);
      expect(state.hasNextPage).toBe(false);
      expect(state.hasPreviousPage).toBe(false);
    });
  });

  describe("initial fetch", () => {
    it("fetches first page when key becomes non-null", async () => {
      const fetcherFn = vi.fn(
        async (params: { userId: string; pageParam: string | null }) => ({
          items: [`user-${params.userId}`],
          nextCursor: "cursor-1",
        }),
      );
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      // No userId — no fetch
      await flushMicrotasks();
      expect(fetcherFn).not.toHaveBeenCalled();

      // Set userId — fetch fires with initialPageParam
      system.facts.userId = "42";
      await system.settle();

      expect(fetcherFn).toHaveBeenCalledTimes(1);
      expect(fetcherFn).toHaveBeenCalledWith(
        { userId: "42", pageParam: null },
        expect.any(AbortSignal),
      );

      const state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.status).toBe("success");
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["user-42"]);
      expect(state.hasNextPage).toBe(true);
      expect(state.isFetchingNextPage).toBe(false);
    });

    it("skips fetch when key returns null", async () => {
      const fetcherFn = vi.fn(async () => ({ items: [], nextCursor: null }));
      const query = createInfiniteQuery({
        name: "feed",
        key: () => null,
        fetcher: fetcherFn,
        getNextPageParam: () => null,
        initialPageParam: null,
      });
      const mod = createModule(
        "test",
        withQueries([query], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks();

      expect(fetcherFn).not.toHaveBeenCalled();
    });

    it("skips fetch when enabled returns false", async () => {
      const fetcherFn = vi.fn(async () => ({ items: [], nextCursor: null }));
      const query = createInfiniteQuery({
        name: "feed",
        key: () => ({ id: "1" }),
        fetcher: fetcherFn,
        getNextPageParam: () => null,
        initialPageParam: null,
        enabled: () => false,
      } as Parameters<typeof createInfiniteQuery>[0]);
      const mod = createModule(
        "test",
        withQueries([query], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks();

      expect(fetcherFn).not.toHaveBeenCalled();
    });
  });

  describe("fetchNextPage", () => {
    it("appends the next page", async () => {
      let callCount = 0;
      const fetcherFn = vi.fn(
        async (_params: { userId: string; pageParam: string | null }) => {
          callCount++;

          return {
            items: [`page-${callCount}`],
            nextCursor: callCount < 3 ? `cursor-${callCount}` : null,
          };
        },
      );
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      expect(fetcherFn).toHaveBeenCalledTimes(1);
      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);
      expect(state.hasNextPage).toBe(true);

      // Fetch next page
      query.fetchNextPage(system.facts);
      await system.settle();

      expect(fetcherFn).toHaveBeenCalledTimes(2);
      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(2);
      expect(state.pages[1]!.items).toEqual(["page-2"]);
      expect(state.hasNextPage).toBe(true);

      // Fetch another
      query.fetchNextPage(system.facts);
      await system.settle();

      expect(fetcherFn).toHaveBeenCalledTimes(3);
      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(3);
      expect(state.hasNextPage).toBe(false);
    });

    it("does not fetch when hasNextPage is false", async () => {
      const fetcherFn = vi.fn(async () => ({
        items: ["only-page"],
        nextCursor: null,
      }));
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      const state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.hasNextPage).toBe(false);

      // Try fetching next — should be a no-op
      query.fetchNextPage(system.facts);
      await flushMicrotasks(20);
      expect(fetcherFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchPreviousPage", () => {
    it("prepends the previous page when getPreviousPageParam is provided", async () => {
      let callCount = 0;
      const fetcherFn = vi.fn(
        async (_params: { userId: string; pageParam: string | null }) => {
          callCount++;

          return {
            items: [`page-${callCount}`],
            nextCursor: null,
            prevCursor: callCount === 1 ? "prev-cursor" : null,
          };
        },
      );

      const query = createInfiniteQuery({
        name: "feed",
        key: (facts) => {
          const userId = facts.userId as string;
          if (!userId) {
            return null;
          }

          return { userId };
        },
        fetcher: fetcherFn,
        getNextPageParam: () => null,
        getPreviousPageParam: (firstPage) =>
          (firstPage as Page).prevCursor ?? null,
        initialPageParam: null as string | null,
      } as Parameters<typeof createInfiniteQuery>[0]);

      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);
      expect(state.hasPreviousPage).toBe(true);

      // Fetch previous page
      query.fetchPreviousPage(system.facts);
      await system.settle();

      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(2);
      // New page prepended
      expect(state.pages[0]!.items).toEqual(["page-2"]);
      expect(state.pages[1]!.items).toEqual(["page-1"]);
    });
  });

  describe("maxPages", () => {
    it("evicts oldest pages when fetching next exceeds maxPages", async () => {
      let callCount = 0;
      const fetcherFn = vi.fn(async () => {
        callCount++;

        return {
          items: [`page-${callCount}`],
          nextCursor: `cursor-${callCount}`,
        };
      });

      const query = createPaginatedQuery(fetcherFn, { maxPages: 2 });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      // Page 1
      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);

      // Page 2
      query.fetchNextPage(system.facts);
      await system.settle();
      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(2);

      // Page 3 — should evict page 1
      query.fetchNextPage(system.facts);
      await system.settle();
      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(2);
      expect(state.pages[0]!.items).toEqual(["page-2"]);
      expect(state.pages[1]!.items).toEqual(["page-3"]);
    });
  });

  describe("key changes", () => {
    it("resets pages when key changes", async () => {
      const fetcherFn = vi.fn(
        async (params: { userId: string; pageParam: string | null }) => ({
          items: [`user-${params.userId}`],
          nextCursor: "c1",
        }),
      );
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["user-1"]);

      // Change key — should reset and refetch
      system.facts.userId = "2";
      await system.settle();

      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["user-2"]);
      expect(fetcherFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("refetch", () => {
    it("refetches the initial page, resetting accumulated pages", async () => {
      let callCount = 0;
      const fetcherFn = vi.fn(async () => {
        callCount++;

        return {
          items: [`call-${callCount}`],
          nextCursor: "c1",
        };
      });
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      // Fetch next to accumulate pages
      query.fetchNextPage(system.facts);
      await system.settle();

      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(2);

      // Refetch — resets back to 1 page
      query.refetch(system.facts);
      await system.settle();

      state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["call-3"]);
    });
  });

  describe("error handling", () => {
    it("sets error state on initial fetch failure", async () => {
      const query = createPaginatedQuery(async () => {
        throw new Error("Network error");
      });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      const state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.status).toBe("error");
      expect(state.isError).toBe(true);
      expect((state.error as Error).message).toBe("Network error");
      expect(state.failureCount).toBe(1);
    });

    it("preserves existing pages on next-page fetch failure", async () => {
      let callCount = 0;
      const fetcherFn = vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Page 2 failed");
        }

        return {
          items: [`page-${callCount}`],
          nextCursor: "c1",
        };
      });
      const query = createPaginatedQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      let state = system.read("feed") as InfiniteResourceState<Page>;
      expect(state.pages).toHaveLength(1);

      // Next page fails
      query.fetchNextPage(system.facts);
      await system.settle();

      state = system.read("feed") as InfiniteResourceState<Page>;
      // Pages preserved
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["page-1"]);
      expect(state.failureCount).toBe(1);
      expect(state.isFetchingNextPage).toBe(false);
    });
  });

  describe("callbacks", () => {
    it("calls onSuccess with all pages", async () => {
      const onSuccess = vi.fn();
      const query = createPaginatedQuery(undefined, { onSuccess });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      expect(onSuccess).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ items: expect.any(Array) }),
        ]),
      );
    });

    it("calls onError on fetch failure", async () => {
      const onError = vi.fn();
      const query = createPaginatedQuery(
        async () => {
          throw new Error("fail");
        },
        { onError },
      );
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls onSettled on both success and error", async () => {
      const onSettled = vi.fn();
      const query = createPaginatedQuery(undefined, { onSettled });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      expect(onSettled).toHaveBeenCalledWith(expect.any(Array), null);
    });
  });
});
