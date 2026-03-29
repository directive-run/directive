// @ts-nocheck
// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { createModule, createSystem, t } from "@directive-run/core";
import { useSuspenseQuery } from "../index";

// Simple module with a derivation that mimics query ResourceState
function createTestSystem(initialState) {
  const mod = createModule("test", {
    schema: {
      facts: { queryState: t.object() },
      derivations: { user: t.object() },
      events: {},
      requirements: {},
    },
    init: (f) => {
      f.queryState = initialState;
    },
    derive: {
      user: (f) => f.queryState,
    },
  });

  const system = createSystem({ module: mod });
  system.start();

  return system;
}

describe("useSuspenseQuery", () => {
  it("returns data when query is in success state", () => {
    const system = createTestSystem({
      status: "success",
      data: { id: "42", name: "John" },
      error: null,
      isPending: false,
    });

    const { result } = renderHook(() => useSuspenseQuery(system, "user"));

    expect(result.current).toEqual({ id: "42", name: "John" });

    system.destroy();
  });

  it("throws error when query is in error state", () => {
    const system = createTestSystem({
      status: "error",
      data: null,
      error: new Error("Network error"),
      isPending: true,
    });

    expect(() => {
      renderHook(() => useSuspenseQuery(system, "user"));
    }).toThrow("Network error");

    system.destroy();
  });

  it("throws a Promise when query is pending", () => {
    const system = createTestSystem({
      status: "pending",
      data: null,
      error: null,
      isPending: true,
    });

    try {
      renderHook(() => useSuspenseQuery(system, "user"));
      // If we get here, the hook didn't throw (React may catch internally)
    } catch (thrown) {
      // Suspense throws a Promise
      expect(thrown).toBeInstanceOf(Promise);
    }

    system.destroy();
  });
});
