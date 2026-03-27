// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createMutation, createQuery, withQueries } from "../index.js";
import type { MutationState } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestMutation(
  mutatorFn?: (
    vars: { id: string; name: string },
    signal: AbortSignal,
  ) => Promise<unknown>,
  opts?: Partial<Parameters<typeof createMutation>[0]>,
) {
  return createMutation({
    name: "updateUser",
    mutator: mutatorFn ?? (async (vars) => ({ ...vars, updated: true })),
    ...opts,
  } as Parameters<typeof createMutation>[0]);
}

function createTestModule(mutation: ReturnType<typeof createMutation>) {
  return createModule(
    "test",
    withQueries([mutation], {
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
// createMutation
// ============================================================================

describe("createMutation", () => {
  describe("basic mutation", () => {
    it("returns a MutationDefinition with all fragments", () => {
      const mutation = createTestMutation();

      expect(mutation.name).toBe("updateUser");
      expect(mutation.schema.facts).toBeDefined();
      expect(mutation.schema.derivations).toBeDefined();
      expect(mutation.constraints).toBeDefined();
      expect(mutation.resolvers).toBeDefined();
      expect(mutation.mutate).toBeTypeOf("function");
      expect(mutation.mutateAsync).toBeTypeOf("function");
      expect(mutation.reset).toBeTypeOf("function");
    });

    it("starts in idle state", () => {
      const mutation = createTestMutation();
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      const state = system.read("updateUser") as MutationState<unknown>;
      expect(state.status).toBe("idle");
      expect(state.isIdle).toBe(true);
      expect(state.isPending).toBe(false);
      expect(state.data).toBeNull();
      expect(state.error).toBeNull();
    });

    it("executes mutation and reaches success state", async () => {
      const mutatorFn = vi.fn(async (vars: { id: string; name: string }) => ({
        ...vars,
        updated: true,
      }));
      const mutation = createTestMutation(mutatorFn);
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1", name: "John" });
      await system.settle();

      expect(mutatorFn).toHaveBeenCalledTimes(1);
      const state = system.read("updateUser") as MutationState<{
        id: string;
        name: string;
        updated: boolean;
      }>;
      expect(state.status).toBe("success");
      expect(state.isSuccess).toBe(true);
      expect(state.data).toEqual({ id: "1", name: "John", updated: true });
    });

    it("reaches error state on failure", async () => {
      const mutation = createTestMutation(async () => {
        throw new Error("Server error");
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1", name: "John" });
      await system.settle();

      const state = system.read("updateUser") as MutationState<unknown>;
      expect(state.status).toBe("error");
      expect(state.isError).toBe(true);
      expect(state.error).toBeInstanceOf(Error);
      expect((state.error as Error).message).toBe("Server error");
    });
  });

  describe("lifecycle callbacks", () => {
    it("calls onMutate before mutation", async () => {
      const onMutate = vi.fn((_vars) => ({ previous: "old" }));
      const mutation = createMutation({
        name: "updateUser",
        mutator: async (vars: { id: string }) => ({ ...vars }),
        onMutate,
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1" });
      await system.settle();

      expect(onMutate).toHaveBeenCalledWith({ id: "1" });
    });

    it("calls onSuccess with data and variables", async () => {
      const onSuccess = vi.fn();
      const mutation = createMutation({
        name: "updateUser",
        mutator: async (vars: { id: string }) => ({ ...vars, done: true }),
        onSuccess,
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1" });
      await system.settle();

      expect(onSuccess).toHaveBeenCalledWith(
        { id: "1", done: true },
        { id: "1" },
        undefined,
      );
    });

    it("calls onError with error and variables", async () => {
      const onError = vi.fn();
      const mutation = createMutation({
        name: "updateUser",
        mutator: async () => {
          throw new Error("fail");
        },
        onError,
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1" });
      await system.settle();

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        { id: "1" },
        undefined,
      );
    });

    it("calls onSettled on success", async () => {
      const onSettled = vi.fn();
      const mutation = createMutation({
        name: "updateUser",
        mutator: async (vars: { id: string }) => ({ ...vars }),
        onSettled,
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1" });
      await system.settle();

      expect(onSettled).toHaveBeenCalledWith(
        { id: "1" },
        null,
        { id: "1" },
        undefined,
      );
    });

    it("calls onSettled on error", async () => {
      const onSettled = vi.fn();
      const mutation = createMutation({
        name: "updateUser",
        mutator: async () => {
          throw new Error("fail");
        },
        onSettled,
      });
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1" });
      await system.settle();

      expect(onSettled).toHaveBeenCalledWith(
        undefined,
        expect.any(Error),
        { id: "1" },
        undefined,
      );
    });
  });

  describe("reset", () => {
    it("resets mutation state to idle", async () => {
      const mutation = createTestMutation();
      const mod = createTestModule(mutation);
      const system = createSystem({ module: mod });
      system.start();

      mutation.mutate(system.facts, { id: "1", name: "John" });
      await system.settle();

      let state = system.read("updateUser") as MutationState<unknown>;
      expect(state.isSuccess).toBe(true);

      mutation.reset(system.facts);
      state = system.read("updateUser") as MutationState<unknown>;
      expect(state.status).toBe("idle");
      expect(state.isIdle).toBe(true);
      expect(state.data).toBeNull();
    });
  });

  describe("tag invalidation", () => {
    it("refetches tagged queries after mutation success", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1", name: "John" }));
      const userQuery = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: fetcherFn,
        tags: ["users"],
      });

      const mutation = createMutation({
        name: "updateUser",
        mutator: async (vars: { id: string; name: string }) => ({
          ...vars,
          updated: true,
        }),
        invalidateTags: ["users"],
      });

      const mod = createModule(
        "test",
        withQueries([userQuery, mutation], {
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

      // First fetch from query
      expect(fetcherFn).toHaveBeenCalledTimes(1);

      // Run mutation — should trigger refetch of tagged query
      mutation.mutate(system.facts, { id: "1", name: "Updated" });
      await system.settle();

      // Query should have refetched due to tag invalidation
      expect(fetcherFn).toHaveBeenCalledTimes(2);
    });

    it("matches parameterized tags", async () => {
      const fetcherFn = vi.fn(async () => ({ id: "1", name: "John" }));
      const userQuery = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: fetcherFn,
        tags: ["users:1"],
      });

      const mutation = createMutation({
        name: "updateUser",
        mutator: async () => ({ updated: true }),
        invalidateTags: ["users"],
      });

      const mod = createModule(
        "test",
        withQueries([userQuery, mutation], {
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

      expect(fetcherFn).toHaveBeenCalledTimes(1);

      mutation.mutate(system.facts, {});
      await system.settle();

      // "users" invalidation should match "users:1" tag
      expect(fetcherFn).toHaveBeenCalledTimes(2);
    });

    it("does not refetch unrelated tagged queries", async () => {
      const userFetcher = vi.fn(async () => ({ id: "1" }));
      const postsFetcher = vi.fn(async () => []);

      const userQuery = createQuery({
        name: "user",
        key: () => ({ id: "1" }),
        fetcher: userFetcher,
        tags: ["users"],
      });
      const postsQuery = createQuery({
        name: "posts",
        key: () => ({ all: true }),
        fetcher: postsFetcher,
        tags: ["posts"],
      });

      const mutation = createMutation({
        name: "updateUser",
        mutator: async () => ({ updated: true }),
        invalidateTags: ["users"],
      });

      const mod = createModule(
        "test",
        withQueries([userQuery, postsQuery, mutation], {
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

      expect(userFetcher).toHaveBeenCalledTimes(1);
      expect(postsFetcher).toHaveBeenCalledTimes(1);

      mutation.mutate(system.facts, {});
      await system.settle();

      // Only user query should refetch
      expect(userFetcher).toHaveBeenCalledTimes(2);
      expect(postsFetcher).toHaveBeenCalledTimes(1);
    });
  });
});
