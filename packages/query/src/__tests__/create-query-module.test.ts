import { createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createMutation, createQuery, createQueryModule } from "../index.js";
import type { ResourceState } from "../index.js";

// ============================================================================
// createQueryModule
// ============================================================================

describe("createQueryModule", () => {
  it("returns a ModuleDef that works with createSystem", async () => {
    const user = createQuery({
      name: "user",
      key: () => ({ id: "1" }),
      fetcher: async () => ({ id: "1", name: "John" }),
    });

    const mod = createQueryModule("data", [user], {
      schema: {
        facts: {},
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
    });

    expect(mod.id).toBe("data");

    const system = createSystem({ module: mod });
    system.start();
    await system.settle();

    const state = system.read("user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "1", name: "John" });

    system.destroy();
  });

  it("works in a multi-module system", async () => {
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
    });

    const dataModule = createQueryModule("data", [user], {
      schema: {
        facts: { userId: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (facts) => {
        facts.userId = "";
      },
    });

    // Simple auth module (no queries)
    const { createModule } = await import("@directive-run/core");
    const authModule = createModule("auth", {
      schema: {
        facts: { token: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
      init: (facts) => {
        facts.token = "";
      },
    });

    const system = createSystem({
      modules: { data: dataModule, auth: authModule },
    });
    system.start();

    // Namespaced access
    system.facts.data.userId = "42";
    await system.settle();

    const state = system.read("data.user") as ResourceState<{
      id: string;
      name: string;
    }>;
    expect(state.data).toEqual({ id: "42", name: "John" });

    system.destroy();
  });

  it("accepts mutations alongside queries", async () => {
    const fetcherFn = vi.fn(async () => ({ id: "1" }));
    const user = createQuery({
      name: "user",
      key: () => ({ id: "1" }),
      fetcher: fetcherFn,
      tags: ["users"],
    });
    const update = createMutation({
      name: "update",
      mutator: async () => ({ done: true }),
      invalidateTags: ["users"],
    });

    const mod = createQueryModule("app", [user, update], {
      schema: {
        facts: {},
        derivations: {},
        events: {},
        requirements: {},
      } satisfies ModuleSchema,
    });

    const system = createSystem({ module: mod });
    system.start();
    await system.settle();

    expect(fetcherFn).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("detects duplicate names", () => {
    const q1 = createQuery({
      name: "dup",
      key: () => ({}),
      fetcher: async () => ({}),
    });
    const q2 = createQuery({
      name: "dup",
      key: () => ({}),
      fetcher: async () => ({}),
    });

    expect(() =>
      createQueryModule("app", [q1, q2], {
        schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
      }),
    ).toThrow(/already registered/);
  });
});
