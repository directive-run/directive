// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope } from "vue";
import { useQuerySystem } from "../index";

// Uses real createQuerySystem from @directive-run/query (workspace devDep)
// Tests verify hook lifecycle (start, destroy, stable ref), not query behavior

const config = {
  facts: { userId: "" },
  queries: {
    user: {
      key: (f) => (f.userId ? { userId: f.userId } : null),
      fetcher: async (p) => ({ id: p.userId, name: "Test" }),
    },
  },
};

describe("useQuerySystem (Vue)", () => {
  it("creates and returns a system from config", () => {
    const scope = effectScope();

    let result: unknown;
    scope.run(() => {
      result = useQuerySystem(config);
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("facts");
    expect(result).toHaveProperty("start");
    expect(result).toHaveProperty("destroy");
    scope.stop();
  });

  it("starts system on creation", () => {
    const scope = effectScope();

    let result: any;
    scope.run(() => {
      result = useQuerySystem(config);
    });

    expect(result.isRunning).toBe(true);
    scope.stop();
  });

  it("destroys on scope dispose", () => {
    const scope = effectScope();

    let result: any;
    scope.run(() => {
      result = useQuerySystem(config);
    });

    expect(result.isRunning).toBe(true);
    scope.stop();
    expect(result.isRunning).toBe(false);
  });
});
