// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createIdleResourceState, createQuery, withQueries } from "../index.js";
import type { ResourceState } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function flushMicrotasks(rounds = 10): Promise<void> {
  return Array.from({ length: rounds }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );
}

function createUserQuery(
  fetcherFn?: (
    params: { userId: string },
    signal: AbortSignal,
  ) => Promise<unknown>,
) {
  return createQuery({
    name: "user",
    key: (facts) => {
      const userId = facts.userId as string;
      if (!userId) {
        return null;
      }

      return { userId };
    },
    fetcher:
      fetcherFn ?? (async (params) => ({ id: params.userId, name: "John" })),
    refetchAfter: 30_000,
    tags: ["users"],
  });
}

function createTestModule(userQuery: ReturnType<typeof createQuery>) {
  return createModule(
    "test",
    withQueries([userQuery], {
      schema: {
        facts: { userId: t.string() },
        derivations: {},
        events: { setUserId: { value: t.string() } },
        requirements: {},
      } satisfies ModuleSchema,
      init: (facts) => {
        facts.userId = "";
      },
      events: {
        setUserId: (
          facts: Record<string, unknown>,
          { value }: { value: string },
        ) => {
          facts.userId = value;
        },
      },
    }),
  );
}

// ============================================================================
// createQuery
// ============================================================================

describe("createQuery", () => {
  describe("basic fetch", () => {
    it("returns a QueryDefinition with all fragments", () => {
      const query = createUserQuery();

      expect(query.name).toBe("user");
      expect(query.schema.facts).toBeDefined();
      expect(query.schema.derivations).toBeDefined();
      expect(query.requirements).toBeDefined();
      expect(query.constraints).toBeDefined();
      expect(query.resolvers).toBeDefined();
      expect(query.derive).toBeDefined();
      expect(query.init).toBeDefined();
    });

    it("fetches data when key becomes non-null", async () => {
      const fetcherFn = vi.fn(async (params: { userId: string }) => ({
        id: params.userId,
        name: "John",
      }));
      const query = createUserQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      // Key is null (userId = "") — no fetch
      await flushMicrotasks();
      expect(fetcherFn).not.toHaveBeenCalled();

      // Set userId — key becomes non-null, fetch fires
      system.facts.userId = "42";
      await system.settle();

      expect(fetcherFn).toHaveBeenCalledTimes(1);
      expect(fetcherFn).toHaveBeenCalledWith(
        { userId: "42" },
        expect.any(AbortSignal),
      );
    });

    it("populates ResourceState on success", async () => {
      const query = createUserQuery(async () => ({ id: "42", name: "John" }));
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "42";
      await system.settle();

      const state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.status).toBe("success");
      expect(state.data).toEqual({ id: "42", name: "John" });
      expect(state.isPending).toBe(false);
      expect(state.isFetching).toBe(false);
      expect(state.isSuccess).toBe(true);
      expect(state.isError).toBe(false);
      expect(state.error).toBeNull();
      expect(state.dataUpdatedAt).toBeGreaterThan(0);
    });

    it("populates ResourceState on error", async () => {
      const query = createUserQuery(async () => {
        throw new Error("Network error");
      });
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "42";
      await system.settle();

      const state = system.read("user") as ResourceState<unknown>;
      expect(state.status).toBe("error");
      expect(state.isError).toBe(true);
      expect(state.error).toBeInstanceOf(Error);
      expect((state.error as Error).message).toBe("Network error");
      expect(state.failureCount).toBe(1);
    });
  });

  describe("key changes", () => {
    it("refetches when key changes", async () => {
      const fetcherFn = vi.fn(async (params: { userId: string }) => ({
        id: params.userId,
        name: `User ${params.userId}`,
      }));
      const query = createUserQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      system.facts.userId = "2";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(2);
      expect(fetcherFn).toHaveBeenLastCalledWith(
        { userId: "2" },
        expect.any(AbortSignal),
      );
    });

    it("does not refetch when key is the same", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1", name: "John" }));
      const query = createUserQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      // Set to same value — no refetch
      system.facts.userId = "1";
      await flushMicrotasks();
      expect(fetcherFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("enabled + dependsOn", () => {
    it("skips fetch when key returns null", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1" }));
      const query = createQuery({
        name: "user",
        key: () => null,
        fetcher: fetcherFn,
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
      const fetcherFn = vi.fn(async () => ({ id: "1" }));
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: fetcherFn,
        enabled: () => false,
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
  });

  describe("transform", () => {
    it("transforms raw response before caching", async () => {
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({
          user_id: "1",
          first_name: "John",
          last_name: "Doe",
        }),
        transform: (raw) => ({
          id: raw.user_id,
          name: `${raw.first_name} ${raw.last_name}`,
        }),
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
      await system.settle();

      const state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "1", name: "John Doe" });
    });
  });

  describe("callbacks", () => {
    it("calls onSuccess on successful fetch", async () => {
      const onSuccess = vi.fn();
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1", name: "John" }),
        onSuccess,
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
      await system.settle();

      expect(onSuccess).toHaveBeenCalledWith({ id: "1", name: "John" });
    });

    it("calls onError on failed fetch", async () => {
      const onError = vi.fn();
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => {
          throw new Error("fail");
        },
        onError,
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
      await system.settle();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls onSettled on both success and error", async () => {
      const onSettled = vi.fn();
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1" }),
        onSettled,
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
      await system.settle();

      expect(onSettled).toHaveBeenCalledWith({ id: "1" }, null);
    });
  });

  describe("imperative handles", () => {
    it("refetch triggers a new fetch", async () => {
      const fetcherFn = vi.fn(async () => ({
        id: "1",
        count: fetcherFn.mock.calls.length,
      }));
      const query = createUserQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      // Manual refetch
      query.refetch(system.facts);
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(2);
    });

    it("setData updates cache directly", async () => {
      const query = createUserQuery();
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      // Set data without fetching
      query.setData(system.facts, { id: "42", name: "Optimistic" });

      const state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "42", name: "Optimistic" });
      expect(state.isSuccess).toBe(true);
    });

    it("invalidate marks data as stale and triggers refetch", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1", name: "John" }));
      const query = createUserQuery(fetcherFn);
      const mod = createTestModule(query);
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      query.invalidate(system.facts);
      await system.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("keepPreviousData", () => {
    it("shows previous key's data while fetching new key", async () => {
      let resolveSecond: ((val: unknown) => void) | null = null;
      const fetcherFn = vi.fn((params: { userId: string }) => {
        if (params.userId === "2") {
          return new Promise((r) => {
            resolveSecond = r;
          });
        }

        return Promise.resolve({
          id: params.userId,
          name: `User ${params.userId}`,
        });
      });

      const query = createQuery({
        name: "user",
        key: (facts) => {
          const userId = facts.userId as string;
          if (!userId) {
            return null;
          }

          return { userId };
        },
        fetcher: fetcherFn,
        keepPreviousData: true,
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
          init: (facts) => {
            facts.userId = "";
          },
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      // Fetch user 1
      system.facts.userId = "1";
      await system.settle();

      let state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "1", name: "User 1" });
      expect(state.isPreviousData).toBe(false);

      // Switch to user 2 — should show user 1's data as placeholder
      system.facts.userId = "2";
      await flushMicrotasks(20);

      state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "1", name: "User 1" });
      expect(state.isPreviousData).toBe(true);

      // Resolve user 2 fetch
      resolveSecond!({ id: "2", name: "User 2" });
      await system.settle();

      state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "2", name: "User 2" });
      expect(state.isPreviousData).toBe(false);
    });
  });

  describe("initialData", () => {
    it("populates cache with initial data", () => {
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1", name: "Fetched" }),
        initialData: { id: "1", name: "Initial" },
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

      const state = system.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.data).toEqual({ id: "1", name: "Initial" });
      expect(state.isSuccess).toBe(true);
    });
  });

  describe("suspense config", () => {
    it("stores suspense flag on the query definition", () => {
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1" }),
        suspense: true,
      });

      expect(query.suspense).toBe(true);
    });

    it("stores throwOnError flag on the query definition", () => {
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1" }),
        throwOnError: true,
      });

      expect(query.throwOnError).toBe(true);
    });

    it("defaults suspense and throwOnError to false", () => {
      const query = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: async () => ({ id: "1" }),
      });

      expect(query.suspense).toBe(false);
      expect(query.throwOnError).toBe(false);
    });
  });
});

// ============================================================================
// withQueries
// ============================================================================

describe("withQueries", () => {
  it("merges multiple queries into a module config", () => {
    const q1 = createQuery({
      name: "users",
      key: () => ({ all: true }),
      fetcher: async () => [],
    });
    const q2 = createQuery({
      name: "posts",
      key: () => ({ all: true }),
      fetcher: async () => [],
    });

    const config = withQueries([q1, q2], {
      schema: {
        facts: { page: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });

    // User facts preserved
    expect(config.schema.facts.page).toBeDefined();
    // Query facts added
    expect(config.schema.facts._q_users_state).toBeDefined();
    expect(config.schema.facts._q_posts_state).toBeDefined();
    // Query derivations added
    expect(config.schema.derivations.users).toBeDefined();
    expect(config.schema.derivations.posts).toBeDefined();
  });

  it("merges init functions (queries first, then user)", () => {
    const initOrder: string[] = [];

    const q = createQuery({
      name: "data",
      key: () => ({ id: "1" }),
      fetcher: async () => ({}),
    });

    // Wrap the query's init to track order
    const originalInit = q.init;
    (q as any).init = (facts: any) => {
      originalInit(facts);
      initOrder.push("query");
    };

    const config = withQueries([q], {
      schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
      init: () => {
        initOrder.push("user");
      },
    });

    config.init({});
    expect(initOrder).toEqual(["query", "user"]);
  });
});

// ============================================================================
// createIdleResourceState
// ============================================================================

describe("createIdleResourceState", () => {
  it("returns a pending state with all fields", () => {
    const state = createIdleResourceState();

    expect(state.data).toBeNull();
    expect(state.error).toBeNull();
    expect(state.status).toBe("pending");
    expect(state.isPending).toBe(true);
    expect(state.isFetching).toBe(false);
    expect(state.isStale).toBe(false);
    expect(state.isSuccess).toBe(false);
    expect(state.isError).toBe(false);
    expect(state.isPreviousData).toBe(false);
    expect(state.dataUpdatedAt).toBeNull();
    expect(state.failureCount).toBe(0);
    expect(state.failureReason).toBeNull();
  });
});
