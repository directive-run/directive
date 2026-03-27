// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createQuery, explainQuery, withQueries } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestSystem() {
  const query = createQuery({
    name: "user",
    key: (facts) => {
      const userId = facts.userId as string;
      if (!userId) {
        return null;
      }

      return { userId };
    },
    fetcher: async (params) => ({ id: params.userId, name: "John" }),
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

  return { system, query };
}

// ============================================================================
// explainQuery
// ============================================================================

describe("explainQuery", () => {
  it("reports uninitialized query", () => {
    const { system } = createTestSystem();
    const result = explainQuery(system, "nonexistent");

    expect(result).toContain("has not been initialized");
  });

  it("reports pending status when key is null", () => {
    const { system } = createTestSystem();
    const result = explainQuery(system, "user");

    expect(result).toContain('Query "user"');
    expect(result).toContain("pending");
    expect(result).toContain("null");
  });

  it("reports success status after fetch", async () => {
    const { system } = createTestSystem();
    system.facts.userId = "42";
    await system.settle();

    const result = explainQuery(system, "user");

    expect(result).toContain("success");
    expect(result).toContain("Cache key:");
    expect(result).toContain("Data age:");
  });

  it("reports error status after fetch failure", async () => {
    const query = createQuery({
      name: "user",
      key: () => ({ id: "1" }),
      fetcher: async () => {
        throw new Error("Network error");
      },
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

    const result = explainQuery(system, "user");

    expect(result).toContain("error");
    expect(result).toContain("Network error");
    expect(result).toContain("Failures: 1");
  });

  it("reports trigger reason when key is null (awaiting key)", () => {
    const { system } = createTestSystem();
    const result = explainQuery(system, "user");

    expect(result).toContain("awaiting key");
  });

  it("reports keepPreviousData when active", async () => {
    let resolveSecond: ((val: unknown) => void) | null = null;
    const query = createQuery({
      name: "user",
      key: (facts) => {
        const userId = facts.userId as string;
        if (!userId) {
          return null;
        }

        return { userId };
      },
      fetcher: (params) => {
        if (params.userId === "2") {
          return new Promise((r) => {
            resolveSecond = r;
          });
        }

        return Promise.resolve({ id: params.userId, name: "User" });
      },
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

    system.facts.userId = "1";
    await system.settle();

    // Switch key — keepPreviousData shows old data
    system.facts.userId = "2";
    // Wait for the resolver to start but not finish
    await new Promise((r) => setTimeout(r, 50));

    const result = explainQuery(system, "user");

    expect(result).toContain("previous data");

    // Cleanup
    resolveSecond?.({ id: "2", name: "User 2" });
    await system.settle();
  });

  it("handles non-existent system gracefully", () => {
    const fakeSystem = { facts: null };
    const result = explainQuery(fakeSystem, "user");

    expect(result).toContain("has not been initialized");
  });

  it("handles system with empty facts proxy", () => {
    const fakeSystem = { facts: {} };
    const result = explainQuery(fakeSystem, "user");

    expect(result).toContain("has not been initialized");
  });
});
