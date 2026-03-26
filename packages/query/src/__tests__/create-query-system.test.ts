import { describe, expect, it, vi } from "vitest";
import { createQuerySystem } from "../index.js";
import type { MutationState, ResourceState } from "../index.js";

// ============================================================================
// createQuerySystem
// ============================================================================

describe("createQuerySystem", () => {
  describe("basic setup", () => {
    it("creates a started system with query", async () => {
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
            fetcher: async (p: { userId: string }) => ({
              id: p.userId,
              name: "John",
            }),
          },
        },
      });

      // Should be auto-started
      app.facts.userId = "42";
      await app.settle();

      const state = app.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(state.status).toBe("success");
      expect(state.data).toEqual({ id: "42", name: "John" });

      app.destroy();
    });

    it("supports autoStart: false", () => {
      const app = createQuerySystem({
        facts: { count: 0 },
        autoStart: false,
      });

      // System is not started
      expect(app.isRunning).toBe(false);

      app.start();
      expect(app.isRunning).toBe(true);

      app.destroy();
    });

    it("works with empty config (no queries)", () => {
      const app = createQuerySystem({
        facts: { value: "hello" },
      });

      expect(app.facts.value).toBe("hello");

      app.destroy();
    });
  });

  describe("bound handles", () => {
    it("queries.user.refetch() works without passing facts", async () => {
      const fetcherFn = vi.fn(async () => ({
        id: "1",
        count: fetcherFn.mock.calls.length,
      }));
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

      app.facts.userId = "1";
      await app.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      // Bound refetch — no facts param
      app.queries.user.refetch();
      await app.settle();
      expect(fetcherFn).toHaveBeenCalledTimes(2);

      app.destroy();
    });

    it("mutations.update.mutate() works without passing facts", async () => {
      const mutatorFn = vi.fn(async (vars: { id: string }) => ({
        ...vars,
        done: true,
      }));
      const app = createQuerySystem({
        facts: {},
        mutations: {
          update: { mutator: mutatorFn },
        },
      });

      // Bound mutate — no facts param
      app.mutations.update.mutate({ id: "1" });
      await app.settle();

      const state = app.read("update") as MutationState<unknown>;
      expect(state.isSuccess).toBe(true);
      expect(state.data).toEqual({ id: "1", done: true });

      app.destroy();
    });

    it("mutations.update.mutateAsync() returns a promise", async () => {
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
  });

  describe("explain", () => {
    it("explain() method returns causal information", async () => {
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

      app.facts.userId = "42";
      await app.settle();

      const explanation = app.explain("user");
      expect(explanation).toContain('Query "user"');
      expect(explanation).toContain("success");

      app.destroy();
    });
  });

  describe("mutations with tag invalidation", () => {
    it("invalidates shorthand maps to invalidateTags", async () => {
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

      // Query should have refetched due to tag invalidation
      expect(fetcherFn).toHaveBeenCalledTimes(2);

      app.destroy();
    });
  });

  describe("subscriptions", () => {
    it("subscriptions work with bound setData handle", async () => {
      let capturedCallbacks: {
        onData: (data: unknown) => void;
        onError: (error: Error) => void;
      } | null = null;

      const app = createQuerySystem({
        facts: { ticker: "" },
        subscriptions: {
          price: {
            key: (f) => {
              const ticker = f.ticker as string;
              if (!ticker) {
                return null;
              }

              return { ticker };
            },
            subscribe: (_params, callbacks) => {
              capturedCallbacks = callbacks;
            },
          },
        },
      });

      app.facts.ticker = "AAPL";
      // Wait for subscription to connect
      await new Promise((r) => setTimeout(r, 100));

      expect(capturedCallbacks).not.toBeNull();

      // Push data via subscription callback
      capturedCallbacks!.onData({ price: 150.25, ticker: "AAPL" });
      await new Promise((r) => setTimeout(r, 50));

      const state = app.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      expect(state.status).toBe("success");
      expect(state.data).toEqual({ price: 150.25, ticker: "AAPL" });

      // Bound setData handle
      app.subscriptions.price.setData({ price: 200, ticker: "AAPL" });
      const updated = app.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      expect(updated.data).toEqual({ price: 200, ticker: "AAPL" });

      app.destroy();
    });
  });

  describe("infinite queries", () => {
    it("infinite queries work with inline config", async () => {
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
            fetcher: async (_params: {
              userId: string;
              pageParam: string | null;
            }) => {
              callCount++;

              return {
                items: [`page-${callCount}`],
                nextCursor: callCount < 3 ? `cursor-${callCount}` : null,
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

      const state = app.read("feed") as {
        pages: { items: string[]; nextCursor: string | null }[];
        hasNextPage: boolean;
        status: string;
      };
      expect(state.status).toBe("success");
      expect(state.pages).toHaveLength(1);
      expect(state.pages[0]!.items).toEqual(["page-1"]);
      expect(state.hasNextPage).toBe(true);

      app.destroy();
    });

    it("bound fetchNextPage() loads more pages", async () => {
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
            fetcher: async (_params: {
              userId: string;
              pageParam: string | null;
            }) => {
              callCount++;

              return {
                items: [`page-${callCount}`],
                nextCursor: callCount < 3 ? `cursor-${callCount}` : null,
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

      let state = app.read("feed") as {
        pages: { items: string[] }[];
        hasNextPage: boolean;
      };
      expect(state.pages).toHaveLength(1);
      expect(state.hasNextPage).toBe(true);

      // Use bound handle to load next page
      app.infiniteQueries.feed.fetchNextPage();
      await app.settle();

      state = app.read("feed") as typeof state;
      expect(state.pages).toHaveLength(2);
      expect(state.pages[1]!.items).toEqual(["page-2"]);

      app.destroy();
    });
  });

  describe("all types together", () => {
    it("queries + mutations + subscriptions in one system", async () => {
      let subCallbacks: { onData: (data: unknown) => void } | null = null;

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
            fetcher: async (p: { userId: string }) => ({
              id: p.userId,
              name: "John",
            }),
            tags: ["users"],
          },
        },
        mutations: {
          updateUser: {
            mutator: async (vars: { id: string; name: string }) => ({
              ...vars,
              updated: true,
            }),
            invalidates: ["users"],
          },
        },
        subscriptions: {
          notifications: {
            key: () => ({ all: true }),
            subscribe: (_params, callbacks) => {
              subCallbacks = callbacks;
            },
          },
        },
      });

      // Query
      app.facts.userId = "42";
      await app.settle();
      const userState = app.read("user") as ResourceState<{
        id: string;
        name: string;
      }>;
      expect(userState.data).toEqual({ id: "42", name: "John" });

      // Mutation
      app.mutations.updateUser.mutate({ id: "42", name: "Jane" });
      await app.settle();
      const mutState = app.read("updateUser") as MutationState<unknown>;
      expect(mutState.isSuccess).toBe(true);

      // Subscription
      await new Promise((r) => setTimeout(r, 100));
      expect(subCallbacks).not.toBeNull();
      subCallbacks!.onData({ message: "Hello" });
      await new Promise((r) => setTimeout(r, 50));
      const notifState = app.read("notifications") as ResourceState<{
        message: string;
      }>;
      expect(notifState.data).toEqual({ message: "Hello" });

      app.destroy();
    });
  });

  describe("destroy", () => {
    it("destroy works after auto-start", () => {
      const app = createQuerySystem({ facts: { x: 0 } });
      expect(app.isRunning).toBe(true);

      app.destroy();
      expect(app.isRunning).toBe(false);
    });
  });

  describe("system options pass through", () => {
    it("accepts plugins", () => {
      const onStart = vi.fn();
      const testPlugin = { name: "test-plugin", onStart };

      const app = createQuerySystem({
        facts: {},
        plugins: [testPlugin],
      });

      expect(onStart).toHaveBeenCalled();

      app.destroy();
    });
  });
});
