// @vitest-environment happy-dom
/**
 * Tests for `useFactWithDefault` (RFC-2).
 *
 * Replaces the `useFact(sys, k) ?? deps.initializeX()` pattern, which
 * produces a fresh identity on every render where the fact is null and
 * breaks downstream memoization.
 */
import { createModule, createSystem, t } from "@directive-run/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFactWithDefault } from "../index";

// ============================================================================
// Test Module Factory
// ============================================================================

interface MarkedCells {
  cells: Set<string>;
}

const schema = {
  facts: {
    markedCells: t.object<MarkedCells>().nullable(),
    counter: t.number(),
  },
  derivations: {},
  events: {
    setMarked: { value: t.object<MarkedCells>().nullable() },
    increment: {},
  },
  requirements: {},
};

function makeSystem() {
  const mod = createModule("rfc2", {
    schema,
    init: (f) => {
      f.markedCells = null;
      f.counter = 0;
    },
    events: {
      setMarked: (f, { value }) => {
        f.markedCells = value;
      },
      increment: (f) => {
        f.counter = (f.counter as number) + 1;
      },
    },
  });

  const system = createSystem({ module: mod });
  system.start();
  return system;
}

// ============================================================================
// Tests
// ============================================================================

describe("useFactWithDefault (RFC-2)", () => {
  let system: ReturnType<typeof makeSystem>;

  beforeEach(() => {
    system = makeSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns stable identity across renders while the fact is null", () => {
    const factory = vi.fn(() => ({ cells: new Set<string>() }));

    const { result, rerender } = renderHook(() =>
      useFactWithDefault(system, "markedCells", factory),
    );

    const first = result.current;
    rerender();
    const second = result.current;
    rerender();
    const third = result.current;

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("calls the factory at most once per system instance (across many renders)", () => {
    const factory = vi.fn(() => ({ cells: new Set<string>() }));

    const { rerender } = renderHook(() =>
      useFactWithDefault(system, "markedCells", factory),
    );

    for (let i = 0; i < 10; i++) {
      rerender();
    }

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("returns the fact value once it transitions from null to non-null", () => {
    const factory = vi.fn(() => ({ cells: new Set<string>(["default"]) }));

    const { result } = renderHook(() =>
      useFactWithDefault(system, "markedCells", factory),
    );

    // Initially null → factory result.
    expect(result.current).toEqual({ cells: new Set(["default"]) });

    // Transition to non-null.
    const real = { cells: new Set(["a", "b"]) };
    act(() => {
      system.facts.markedCells = real;
    });

    expect(result.current).toBe(real);
  });

  it("reuses the cached factory result when the fact returns to null (factory is NOT re-run)", () => {
    const factory = vi.fn(() => ({ cells: new Set<string>(["initial"]) }));

    const { result } = renderHook(() =>
      useFactWithDefault(system, "markedCells", factory),
    );

    const initialDefault = result.current;
    expect(factory).toHaveBeenCalledTimes(1);

    // Set non-null.
    const real = { cells: new Set(["a"]) };
    act(() => {
      system.facts.markedCells = real;
    });
    expect(result.current).toBe(real);

    // Set back to null.
    act(() => {
      system.facts.markedCells = null;
    });

    expect(result.current).toBe(initialDefault);
    // Factory was NOT re-run.
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("re-runs the factory when the system argument is swapped", () => {
    const factory = vi.fn(() => ({ cells: new Set<string>() }));

    const system2 = makeSystem();
    try {
      const { result, rerender } = renderHook(
        ({ s }) => useFactWithDefault(s, "markedCells", factory),
        { initialProps: { s: system } },
      );

      const firstDefault = result.current;
      expect(factory).toHaveBeenCalledTimes(1);

      // Swap to a different system instance.
      rerender({ s: system2 });

      const secondDefault = result.current;
      expect(factory).toHaveBeenCalledTimes(2);
      expect(secondDefault).not.toBe(firstDefault);
    } finally {
      system2.destroy();
    }
  });

  it("identity stability does NOT depend on unrelated fact changes", () => {
    // Regression guard: a re-render triggered by a sibling fact must not
    // produce a fresh default identity.
    const factory = vi.fn(() => ({ cells: new Set<string>() }));

    const { result } = renderHook(() => {
      // Subscribe to counter so this hook re-renders on every increment.
      // (Use the same useFactWithDefault for the marked cells.)
      const _counter = system.facts.counter;
      void _counter;
      return useFactWithDefault(system, "markedCells", factory);
    });

    const first = result.current;

    act(() => {
      system.events.increment();
    });
    act(() => {
      system.events.increment();
    });

    expect(result.current).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("survives the natural failure mode of `useFact ?? factory()`", () => {
    // Sanity check: in the legacy pattern, identity changes every render.
    // This test asserts that useFactWithDefault DOES NOT have that problem.
    const seen = new Set<unknown>();
    const factory = () => ({ cells: new Set<string>() });

    const { result, rerender } = renderHook(() =>
      useFactWithDefault(system, "markedCells", factory),
    );

    seen.add(result.current);
    for (let i = 0; i < 5; i++) {
      rerender();
      seen.add(result.current);
    }

    // Identity stable → only one entry observed.
    expect(seen.size).toBe(1);
  });
});
