// @ts-nocheck
// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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

describe("useQuerySystem", () => {
  it("creates system from config and returns it", () => {
    const { result } = renderHook(() => useQuerySystem(config));

    expect(result.current).toBeDefined();
    expect(result.current).toHaveProperty("facts");
    expect(result.current).toHaveProperty("start");
    expect(result.current).toHaveProperty("destroy");
  });

  it("starts system on mount", () => {
    const { result } = renderHook(() => useQuerySystem(config));

    expect(result.current.isRunning).toBe(true);
  });

  it("destroys system on unmount", () => {
    const { result, unmount } = renderHook(() => useQuerySystem(config));

    const system = result.current;
    expect(system.isRunning).toBe(true);

    unmount();

    expect(system.isRunning).toBe(false);
  });

  it("returns stable reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useQuerySystem(config));

    const firstRef = result.current;

    rerender();
    rerender();
    rerender();

    expect(result.current).toBe(firstRef);
  });

  it("system has facts proxy", () => {
    const { result } = renderHook(() => useQuerySystem(config));

    expect(result.current.facts).toBeDefined();
    expect(result.current.facts.userId).toBe("");
  });
});
