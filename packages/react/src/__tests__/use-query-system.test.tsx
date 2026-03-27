// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useQuerySystem, useDerived } from "../index";

// ============================================================================
// Mock createQuerySystem — simulates @directive-run/query
// ============================================================================

function createMockQuerySystem(opts: {
  autoStart?: boolean;
  onDestroy?: () => void;
} = {}) {
  let running = false;
  const system = {
    isRunning: false,
    start: vi.fn(() => {
      running = true;
      system.isRunning = true;
    }),
    destroy: vi.fn(() => {
      running = false;
      system.isRunning = false;
      opts.onDestroy?.();
    }),
    facts: { userId: "" },
    queries: {
      user: {
        refetch: vi.fn(),
        invalidate: vi.fn(),
        cancel: vi.fn(),
        setData: vi.fn(),
      },
    },
    mutations: {
      update: {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        reset: vi.fn(),
      },
    },
    explain: vi.fn(() => "Query explanation"),
  };

  if (opts.autoStart !== false) {
    system.start();
  }

  return system;
}

// ============================================================================
// useQuerySystem
// ============================================================================

describe("useQuerySystem", () => {
  it("creates system from factory and returns it", () => {
    const mockSystem = createMockQuerySystem({ autoStart: false });
    const { result } = renderHook(() => useQuerySystem(() => mockSystem));

    expect(result.current).toBe(mockSystem);
  });

  it("starts system on mount if not already running", () => {
    const mockSystem = createMockQuerySystem({ autoStart: false });
    expect(mockSystem.isRunning).toBe(false);

    renderHook(() => useQuerySystem(() => mockSystem));

    expect(mockSystem.start).toHaveBeenCalled();
    expect(mockSystem.isRunning).toBe(true);
  });

  it("does not double-start if already running", () => {
    const mockSystem = createMockQuerySystem({ autoStart: true });
    expect(mockSystem.isRunning).toBe(true);

    renderHook(() => useQuerySystem(() => mockSystem));

    // start was called once by createMockQuerySystem, not again by hook
    expect(mockSystem.start).toHaveBeenCalledTimes(1);
  });

  it("destroys system on unmount", () => {
    const mockSystem = createMockQuerySystem({ autoStart: false });
    const { unmount } = renderHook(() => useQuerySystem(() => mockSystem));

    expect(mockSystem.destroy).not.toHaveBeenCalled();

    unmount();

    expect(mockSystem.destroy).toHaveBeenCalledTimes(1);
  });

  it("returns stable reference across re-renders", () => {
    const factory = vi.fn(() => createMockQuerySystem({ autoStart: false }));
    const { result, rerender } = renderHook(() => useQuerySystem(factory));

    const firstRef = result.current;

    rerender();
    rerender();
    rerender();

    // Factory called only once — system is stable via useRef
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(firstRef);
  });

  it("bound query handles are accessible", () => {
    const mockSystem = createMockQuerySystem({ autoStart: false });
    const { result } = renderHook(() => useQuerySystem(() => mockSystem));

    expect(result.current.queries.user.refetch).toBeTypeOf("function");
    expect(result.current.mutations.update.mutate).toBeTypeOf("function");
    expect(result.current.explain).toBeTypeOf("function");
  });

  it("bound handles work after mount", () => {
    const mockSystem = createMockQuerySystem({ autoStart: false });
    const { result } = renderHook(() => useQuerySystem(() => mockSystem));

    act(() => {
      result.current.queries.user.refetch();
    });
    expect(mockSystem.queries.user.refetch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.mutations.update.mutate({ id: "1" });
    });
    expect(mockSystem.mutations.update.mutate).toHaveBeenCalledWith({ id: "1" });
  });
});
