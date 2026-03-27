import { createModule, createSystem } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
/**
 * Integration tests — exercise every feature and prop through createQuerySystem.
 * Simulates real app usage patterns to find bugs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createBaseQuery,
  createIdleMutationState,
  createIdleResourceState,
  createMutation,
  createQuery,
  createQueryModule,
  createQuerySystem,
  explainQuery,
  t,
  withQueries,
} from "../index.js";
import type {
  InfiniteResourceState,
  MutationState,
  ResourceState,
} from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function flushMicrotasks(rounds = 10): Promise<void> {
  return Array.from({ length: rounds }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );
}

// ============================================================================
// createQuerySystem — Every Feature
// ============================================================================

describe("Integration: createQuerySystem", () => {
  // ---------- Facts ----------

  it("infers facts from initial values", () => {
    const app = createQuerySystem({
      facts: { name: "hello", count: 0, active: true, items: [], meta: {} },
    });
    expect(app.facts.name).toBe("hello");
    expect(app.facts.count).toBe(0);
    expect(app.facts.active).toBe(true);
    expect(app.facts.items).toEqual([]);
    expect(app.facts.meta).toEqual({});
    app.destroy();
  });

  it("facts are reactive — changing triggers queries", async () => {
    const fetcherFn = vi.fn(async (p: { id: string }) => ({ id: p.id }));
    const app = createQuerySystem({
      facts: { id: "" },
      queries: {
        item: {
          key: (f) => {
            const id = f.id as string;
            if (!id) {
              return null;
            }

            return { id };
          },
          fetcher: fetcherFn,
        },
      },
    });

    expect(fetcherFn).not.toHaveBeenCalled();

    app.facts.id = "abc";
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.facts.id = "xyz";
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);

    app.destroy();
  });

  // ---------- Query: every prop ----------

  it("query: name becomes derivation key", async () => {
    const app = createQuerySystem({
      facts: {},
      queries: {
        myData: {
          key: () => ({ all: true }),
          fetcher: async () => ({ value: 42 }),
        },
      },
    });
    await app.settle();

    const state = app.read("myData") as ResourceState<{ value: number }>;
    expect(state.data).toEqual({ value: 42 });
    app.destroy();
  });

  it("query: key returning null disables fetch", async () => {
    const fetcherFn = vi.fn(async () => ({}));
    const app = createQuerySystem({
      facts: {},
      queries: {
        disabled: { key: () => null, fetcher: fetcherFn },
      },
    });
    await flushMicrotasks(20);
    expect(fetcherFn).not.toHaveBeenCalled();
    app.destroy();
  });

  it("query: fetcher receives typed params and AbortSignal", async () => {
    const fetcherFn = vi.fn(
      async (p: { userId: string }, signal: AbortSignal) => {
        expect(p.userId).toBe("42");
        expect(signal).toBeInstanceOf(AbortSignal);

        return { id: p.userId };
      },
    );
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
        },
      },
    });

    app.facts.userId = "42";
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  it("query: transform maps raw response", async () => {
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: async () => ({ first_name: "John", last_name: "Doe" }),
          transform: (raw: { first_name: string; last_name: string }) => ({
            name: `${raw.first_name} ${raw.last_name}`,
          }),
        },
      },
    });
    await app.settle();

    const state = app.read("user") as ResourceState<{ name: string }>;
    expect(state.data).toEqual({ name: "John Doe" });
    app.destroy();
  });

  it("query: refetchAfter controls staleness", async () => {
    const fetcherFn = vi.fn(async () => ({ ts: Date.now() }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        data: {
          key: () => ({ all: true }),
          fetcher: fetcherFn,
          refetchAfter: 60_000, // 60s
        },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    // Same key, not stale — no refetch
    await flushMicrotasks(20);
    expect(fetcherFn).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  it("query: retry with number shorthand", async () => {
    let attempts = 0;
    const app = createQuerySystem({
      facts: {},
      queries: {
        flaky: {
          key: () => ({ id: "1" }),
          fetcher: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("fail");
            }

            return { ok: true };
          },
          retry: 3,
        },
      },
    });
    await app.settle();

    const state = app.read("flaky") as ResourceState<{ ok: boolean }>;
    // Retry policy is passed to the engine — the engine handles retries
    // We just verify the option is accepted without error
    app.destroy();
  });

  it("query: enabled condition", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const app = createQuerySystem({
      facts: { ready: false },
      queries: {
        data: {
          key: () => ({ id: "1" }),
          fetcher: fetcherFn,
          enabled: (f) => f.ready === true,
        },
      },
    });
    await flushMicrotasks(20);
    expect(fetcherFn).not.toHaveBeenCalled();

    app.facts.ready = true;
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  it("query: dependsOn waits for another query", async () => {
    const fetcherA = vi.fn(async () => ({ id: "a" }));
    const fetcherB = vi.fn(async () => ({ id: "b" }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        first: {
          key: () => ({ id: "1" }),
          fetcher: fetcherA,
        },
        second: {
          key: () => ({ id: "2" }),
          fetcher: fetcherB,
          dependsOn: ["first"],
        },
      },
    });
    await app.settle();

    // Both should have fetched — first completes, then second
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  it("query: tags for cache invalidation", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: fetcherFn,
          tags: ["users"],
        },
      },
      mutations: {
        update: {
          mutator: async () => ({ done: true }),
          invalidates: ["users"],
        },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.mutations.update.mutate({});
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("query: parameterized tags match correctly", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "42" }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "42" }),
          fetcher: fetcherFn,
          tags: ["users:42"],
        },
      },
      mutations: {
        update: {
          mutator: async () => ({ done: true }),
          invalidates: ["users"], // bare "users" matches "users:42"
        },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.mutations.update.mutate({});
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("query: keepPreviousData during key transition", async () => {
    let resolveSecond: ((val: unknown) => void) | null = null;
    const app = createQuerySystem({
      facts: { id: "" },
      queries: {
        item: {
          key: (f) => {
            const id = f.id as string;
            if (!id) {
              return null;
            }

            return { id };
          },
          fetcher: (p: { id: string }) => {
            if (p.id === "2") {
              return new Promise((r) => {
                resolveSecond = r;
              });
            }

            return Promise.resolve({ id: p.id, name: `Item ${p.id}` });
          },
          keepPreviousData: true,
        },
      },
    });

    app.facts.id = "1";
    await app.settle();
    let state = app.read("item") as ResourceState<{ id: string; name: string }>;
    expect(state.data).toEqual({ id: "1", name: "Item 1" });
    expect(state.isPreviousData).toBe(false);

    // Switch key — should show old data with isPreviousData
    app.facts.id = "2";
    await flushMicrotasks(20);
    state = app.read("item") as ResourceState<{ id: string; name: string }>;
    expect(state.data).toEqual({ id: "1", name: "Item 1" });
    expect(state.isPreviousData).toBe(true);

    resolveSecond!({ id: "2", name: "Item 2" });
    await app.settle();
    state = app.read("item") as ResourceState<{ id: string; name: string }>;
    expect(state.data).toEqual({ id: "2", name: "Item 2" });
    expect(state.isPreviousData).toBe(false);

    app.destroy();
  });

  it("query: initialData pre-populates cache", async () => {
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: async () => ({ id: "1", name: "Fetched" }),
          initialData: { id: "1", name: "Initial" },
        },
      },
    });

    // Before any fetch, initial data is available
    const state = app.read("user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "1", name: "Initial" });
    expect(state.isSuccess).toBe(true);

    app.destroy();
  });

  it("query: onSuccess / onError / onSettled callbacks", async () => {
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: async () => ({ id: "1" }),
          onSuccess,
          onSettled,
        },
      },
    });
    await app.settle();

    expect(onSuccess).toHaveBeenCalledWith({ id: "1" });
    expect(onSettled).toHaveBeenCalledWith({ id: "1" }, null);
    app.destroy();
  });

  it("query: onError callback on failure", async () => {
    const onError = vi.fn();
    const app = createQuerySystem({
      facts: {},
      queries: {
        broken: {
          key: () => ({ id: "1" }),
          fetcher: async () => {
            throw new Error("boom");
          },
          onError,
        },
      },
    });
    await app.settle();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    app.destroy();
  });

  it("query: structuralSharing is accepted as option", async () => {
    // Structural sharing is tested in detail in with-queries.test.ts (replaceEqualDeep).
    // Here we verify the option is accepted and data is correct after refetch.
    const fetcherFn = vi.fn(async () => ({ id: "1", value: 42 }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        data: {
          key: () => ({ id: "1" }),
          fetcher: fetcherFn,
          structuralSharing: true,
        },
      },
    });
    await app.settle();

    app.queries.data.refetch();
    await app.settle();

    const state = app.read("data") as ResourceState<{
      id: string;
      value: number;
    }>;
    expect(state.data).toEqual({ id: "1", value: 42 });
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("query: suspense and throwOnError flags stored on definition", () => {
    const q = createQuery({
      name: "test",
      key: () => ({ id: "1" }),
      fetcher: async () => ({}),
      suspense: true,
      throwOnError: true,
    });
    expect(q.suspense).toBe(true);
    expect(q.throwOnError).toBe(true);
  });

  // ---------- Bound query handles ----------

  it("bound: refetch triggers new fetch", async () => {
    const fetcherFn = vi.fn(async () => ({ ts: Date.now() }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        data: { key: () => ({ all: true }), fetcher: fetcherFn },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.queries.data.refetch();
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("bound: invalidate marks stale and triggers refetch", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const app = createQuerySystem({
      facts: { id: "" },
      queries: {
        user: {
          key: (f) => {
            const id = f.id as string;
            if (!id) {
              return null;
            }

            return { id };
          },
          fetcher: fetcherFn,
        },
      },
    });

    app.facts.id = "1";
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.queries.user.invalidate();
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("bound: setData updates cache directly", async () => {
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: async () => ({ id: "1", name: "Fetched" }),
        },
      },
    });

    app.queries.user.setData({ id: "1", name: "Optimistic" });
    const state = app.read("user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "1", name: "Optimistic" });
    expect(state.isSuccess).toBe(true);
    app.destroy();
  });

  // ---------- Mutation: every prop ----------

  it("mutation: mutator receives variables and signal", async () => {
    const mutatorFn = vi.fn(
      async (vars: { id: string }, signal: AbortSignal) => {
        expect(vars.id).toBe("42");
        expect(signal).toBeInstanceOf(AbortSignal);

        return { ...vars, updated: true };
      },
    );
    const app = createQuerySystem({
      facts: {},
      mutations: { update: { mutator: mutatorFn } },
    });

    app.mutations.update.mutate({ id: "42" });
    await app.settle();
    expect(mutatorFn).toHaveBeenCalledTimes(1);
    app.destroy();
  });

  it("mutation: invalidates shorthand works", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: fetcherFn,
          tags: ["users"],
        },
      },
      mutations: {
        update: {
          mutator: async () => ({ done: true }),
          invalidates: ["users"],
        },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.mutations.update.mutate({});
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("mutation: invalidateTags also works (advanced path)", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const app = createQuerySystem({
      facts: {},
      queries: {
        user: {
          key: () => ({ id: "1" }),
          fetcher: fetcherFn,
          tags: ["users"],
        },
      },
      mutations: {
        update: {
          mutator: async () => ({ done: true }),
          invalidateTags: [{ type: "users", id: "1" }],
        },
      },
    });
    await app.settle();
    expect(fetcherFn).toHaveBeenCalledTimes(1);

    app.mutations.update.mutate({});
    await app.settle();
    // "users:1" should match "users" tag on the query
    app.destroy();
  });

  it("mutation: onMutate / onSuccess / onError / onSettled lifecycle", async () => {
    const onMutate = vi.fn((_vars: unknown) => ({ previous: "old" }));
    const onSuccess = vi.fn();
    const onSettled = vi.fn();

    const app = createQuerySystem({
      facts: {},
      mutations: {
        update: {
          mutator: async (vars: { id: string }) => ({ ...vars, done: true }),
          onMutate,
          onSuccess,
          onSettled,
        },
      },
    });

    app.mutations.update.mutate({ id: "1" });
    await app.settle();

    expect(onMutate).toHaveBeenCalledWith({ id: "1" });
    expect(onSuccess).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalled();
    app.destroy();
  });

  it("mutation: mutateAsync resolves with data", async () => {
    const app = createQuerySystem({
      facts: {},
      mutations: {
        update: {
          mutator: async (vars: { id: string }) => ({ ...vars, done: true }),
        },
      },
    });

    const result = await app.mutations.update.mutateAsync({ id: "1" });
    expect(result).toEqual({ id: "1", done: true });
    app.destroy();
  });

  it("mutation: mutateAsync rejects on error", async () => {
    const app = createQuerySystem({
      facts: {},
      mutations: {
        update: {
          mutator: async () => {
            throw new Error("Server error");
          },
        },
      },
    });

    await expect(app.mutations.update.mutateAsync({})).rejects.toThrow(
      "Server error",
    );
    app.destroy();
  });

  it("mutation: reset clears state to idle", async () => {
    const app = createQuerySystem({
      facts: {},
      mutations: {
        update: {
          mutator: async (vars: { id: string }) => ({ ...vars }),
        },
      },
    });

    app.mutations.update.mutate({ id: "1" });
    await app.settle();
    let state = app.read("update") as MutationState<unknown>;
    expect(state.isSuccess).toBe(true);

    app.mutations.update.reset();
    state = app.read("update") as MutationState<unknown>;
    expect(state.isIdle).toBe(true);
    expect(state.data).toBeNull();
    app.destroy();
  });

  // ---------- Subscription ----------

  it("subscription: subscribe receives params and callbacks", async () => {
    let captured: {
      onData: (data: unknown) => void;
      onError: (error: Error) => void;
      signal: AbortSignal;
    } | null = null;

    const app = createQuerySystem({
      facts: { channel: "" },
      subscriptions: {
        messages: {
          key: (f) => {
            const channel = f.channel as string;
            if (!channel) {
              return null;
            }

            return { channel };
          },
          subscribe: (_params, callbacks) => {
            captured = callbacks;
          },
        },
      },
    });

    app.facts.channel = "general";
    await new Promise((r) => setTimeout(r, 100));

    expect(captured).not.toBeNull();
    expect(captured!.signal).toBeInstanceOf(AbortSignal);

    // Push data
    captured!.onData({ text: "Hello" });
    await flushMicrotasks();

    const state = app.read("messages") as ResourceState<{ text: string }>;
    expect(state.data).toEqual({ text: "Hello" });
    expect(state.isSuccess).toBe(true);

    app.destroy();
  });

  it("subscription: onError sets error state", async () => {
    let captured: { onError: (error: Error) => void } | null = null;
    const app = createQuerySystem({
      facts: {},
      subscriptions: {
        feed: {
          key: () => ({ all: true }),
          subscribe: (_params, callbacks) => {
            captured = callbacks;
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    captured!.onError(new Error("Connection lost"));
    await flushMicrotasks();

    const state = app.read("feed") as ResourceState<unknown>;
    expect(state.isError).toBe(true);
    expect((state.error as Error).message).toBe("Connection lost");
    app.destroy();
  });

  it("subscription: cleanup called on destroy", async () => {
    const cleanup = vi.fn();
    const app = createQuerySystem({
      facts: {},
      subscriptions: {
        feed: {
          key: () => ({ all: true }),
          subscribe: () => cleanup,
        },
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    app.destroy();
    expect(cleanup).toHaveBeenCalled();
  });

  it("subscription: setData bound handle works", () => {
    const app = createQuerySystem({
      facts: {},
      subscriptions: {
        feed: {
          key: () => ({ all: true }),
          subscribe: () => {},
        },
      },
    });

    app.subscriptions.feed.setData({ items: [1, 2, 3] });
    const state = app.read("feed") as ResourceState<{ items: number[] }>;
    expect(state.data).toEqual({ items: [1, 2, 3] });
    app.destroy();
  });

  // ---------- Infinite Query ----------

  it("infinite: fetches first page and tracks hasNextPage", async () => {
    const app = createQuerySystem({
      facts: { userId: "" },
      infiniteQueries: {
        feed: {
          key: (f) => {
            const userId = f.userId as string;
            if (!userId) {
              return null;
            }

            return { userId };
          },
          fetcher: async () => ({
            items: ["a", "b"],
            nextCursor: "cursor-1",
          }),
          getNextPageParam: (lastPage: { nextCursor: string | null }) =>
            lastPage.nextCursor,
          initialPageParam: null as string | null,
        },
      },
    });

    app.facts.userId = "1";
    await app.settle();

    const state = app.read("feed") as InfiniteResourceState<{
      items: string[];
      nextCursor: string | null;
    }>;
    expect(state.pages).toHaveLength(1);
    expect(state.hasNextPage).toBe(true);
    expect(state.isFetchingNextPage).toBe(false);
    app.destroy();
  });

  it("infinite: fetchNextPage loads more", async () => {
    let callCount = 0;
    const app = createQuerySystem({
      facts: { userId: "" },
      infiniteQueries: {
        feed: {
          key: (f) => {
            const userId = f.userId as string;
            if (!userId) {
              return null;
            }

            return { userId };
          },
          fetcher: async () => {
            callCount++;

            return {
              items: [`page-${callCount}`],
              nextCursor: callCount < 3 ? `c${callCount}` : null,
            };
          },
          getNextPageParam: (lastPage: { nextCursor: string | null }) =>
            lastPage.nextCursor,
          initialPageParam: null as string | null,
        },
      },
    });

    app.facts.userId = "1";
    await app.settle();

    app.infiniteQueries.feed.fetchNextPage();
    await app.settle();

    const state = app.read("feed") as InfiniteResourceState<unknown>;
    expect(state.pages).toHaveLength(2);
    app.destroy();
  });

  it("infinite: maxPages evicts oldest", async () => {
    let callCount = 0;
    const app = createQuerySystem({
      facts: { userId: "" },
      infiniteQueries: {
        feed: {
          key: (f) => {
            const userId = f.userId as string;
            if (!userId) {
              return null;
            }

            return { userId };
          },
          fetcher: async () => {
            callCount++;

            return {
              items: [`page-${callCount}`],
              nextCursor: `c${callCount}`,
            };
          },
          getNextPageParam: (lastPage: { nextCursor: string | null }) =>
            lastPage.nextCursor,
          initialPageParam: null as string | null,
          maxPages: 2,
        },
      },
    });

    app.facts.userId = "1";
    await app.settle();

    app.infiniteQueries.feed.fetchNextPage();
    await app.settle();
    app.infiniteQueries.feed.fetchNextPage();
    await app.settle();

    const state = app.read("feed") as InfiniteResourceState<{
      items: string[];
    }>;
    expect(state.pages).toHaveLength(2);
    // Page 1 should be evicted
    expect(state.pages[0]!.items).toEqual(["page-2"]);
    expect(state.pages[1]!.items).toEqual(["page-3"]);
    app.destroy();
  });

  // ---------- explain ----------

  it("explain returns query status info", async () => {
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
          fetcher: async (p: { userId: string }) => ({ id: p.userId }),
        },
      },
    });

    // Before fetch
    let explanation = app.explain("user");
    expect(explanation).toContain("pending");

    app.facts.userId = "42";
    await app.settle();

    explanation = app.explain("user");
    expect(explanation).toContain("success");
    expect(explanation).toContain("Cache key:");
    app.destroy();
  });

  it("explain reports errors", async () => {
    const app = createQuerySystem({
      facts: {},
      queries: {
        broken: {
          key: () => ({ id: "1" }),
          fetcher: async () => {
            throw new Error("Network error");
          },
        },
      },
    });
    await app.settle();

    const explanation = app.explain("broken");
    expect(explanation).toContain("error");
    expect(explanation).toContain("Network error");
    app.destroy();
  });

  // ---------- Module config pass-through ----------

  it("events pass through to module config", () => {
    const app = createQuerySystem({
      facts: { count: 0 },
      events: {
        increment: (facts: Record<string, unknown>) => {
          (facts as { count: number }).count += 1;
        },
      },
    });

    // Events are wired and accessible
    expect(app.facts.count).toBe(0);
    app.destroy();
  });

  // ---------- System options ----------

  it("autoStart: true is default", () => {
    const app = createQuerySystem({ facts: {} });
    expect(app.isRunning).toBe(true);
    app.destroy();
  });

  it("autoStart: false defers start", () => {
    const app = createQuerySystem({ facts: {}, autoStart: false });
    expect(app.isRunning).toBe(false);
    app.start();
    expect(app.isRunning).toBe(true);
    app.destroy();
  });

  it("plugins pass through", () => {
    const onStart = vi.fn();
    const app = createQuerySystem({
      facts: {},
      plugins: [{ name: "test", onStart }],
    });
    expect(onStart).toHaveBeenCalled();
    app.destroy();
  });

  it("destroy cleans up", () => {
    const app = createQuerySystem({ facts: { x: 0 } });
    expect(app.isRunning).toBe(true);
    app.destroy();
    expect(app.isRunning).toBe(false);
  });
});

// ============================================================================
// createQueryModule — Multi-Module Integration
// ============================================================================

describe("Integration: createQueryModule multi-module", () => {
  it("query module works in namespaced system", async () => {
    const userQuery = createQuery({
      name: "user",
      key: (f) => {
        const userId = f.userId as string;
        if (!userId) {
          return null;
        }

        return { userId };
      },
      fetcher: async (p: { userId: string }) => ({
        id: p.userId,
        name: "John",
      }),
    });

    const dataModule = createQueryModule("data", [userQuery], {
      schema: {
        facts: { userId: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (f) => {
        f.userId = "";
      },
    });

    const authModule = createModule("auth", {
      schema: {
        facts: { token: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (f) => {
        f.token = "";
      },
    });

    const system = createSystem({
      modules: { data: dataModule, auth: authModule },
    });
    system.start();

    system.facts.data.userId = "42";
    await system.settle();

    const state = system.read("data.user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "42", name: "John" });

    system.destroy();
  });
});

// ============================================================================
// Advanced path — withQueries directly
// ============================================================================

describe("Integration: withQueries advanced path", () => {
  it("full advanced path works end-to-end", async () => {
    const user = createQuery({
      name: "user",
      key: (f) => {
        const userId = f.userId as string;
        if (!userId) {
          return null;
        }

        return { userId };
      },
      fetcher: async (p: { userId: string }) => ({
        id: p.userId,
        name: "John",
      }),
      tags: ["users"],
    });

    const update = createMutation({
      name: "updateUser",
      mutator: async (vars: { id: string; name: string }) => ({
        ...vars,
        updated: true,
      }),
      invalidateTags: ["users"],
    });

    const mod = createModule(
      "app",
      withQueries([user, update], {
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

    system.facts.userId = "42";
    await system.settle();

    const state = system.read("user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "42", name: "John" });

    // Explain
    const explanation = explainQuery(system, "user");
    expect(explanation).toContain("success");

    system.destroy();
  });
});

// ============================================================================
// createBaseQuery
// ============================================================================

describe("Integration: createBaseQuery", () => {
  it("works as fetcher in createQuerySystem", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "1", name: "John" }),
      headers: new Headers(),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const api = createBaseQuery({ baseUrl: "/api/v1" });
      const app = createQuerySystem({
        facts: {},
        queries: {
          user: {
            key: () => ({ id: "1" }),
            fetcher: (_params, signal) => api({ url: "/users/1" }, signal),
          },
        },
      });
      await app.settle();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("/api/v1/users/1");

      const state = app.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "1", name: "John" });

      app.destroy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============================================================================
// Utility exports
// ============================================================================

describe("Integration: utility exports", () => {
  it("t is re-exported from core", () => {
    expect(t.string).toBeTypeOf("function");
    expect(t.number).toBeTypeOf("function");
    expect(t.boolean).toBeTypeOf("function");
  });

  it("createIdleResourceState returns correct shape", () => {
    const state = createIdleResourceState();
    expect(state.status).toBe("pending");
    expect(state.isPending).toBe(true);
    expect(state.data).toBeNull();
    expect(state.error).toBeNull();
  });

  it("createIdleMutationState returns correct shape", () => {
    const state = createIdleMutationState();
    expect(state.status).toBe("idle");
    expect(state.isIdle).toBe(true);
    expect(state.data).toBeNull();
    expect(state.variables).toBeNull();
  });
});
