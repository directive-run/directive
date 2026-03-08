// @vitest-environment happy-dom
import { createModule, createSystem, t } from "@directive-run/core";
import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useSelector, useNamespacedSelector, shallowEqual } from "../index";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestSystem() {
  const mod = createModule("test", {
    schema: {
      facts: {
        count: t.number(),
        name: t.string(),
        x: t.number(),
        y: t.number(),
      },
      derivations: {
        doubled: t.number(),
        coords: t.object<{ x: number; y: number }>(),
      },
    },
    init: (facts) => {
      facts.count = 0;
      facts.name = "hello";
      facts.x = 0;
      facts.y = 0;
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      coords: (facts) => ({ x: facts.x as number, y: facts.y as number }),
    },
  });
  const system = createSystem({ module: mod });
  system.start();

  return system;
}

function createNamespacedSystem() {
  const auth = createModule("auth", {
    schema: {
      facts: { token: t.string() },
    },
    init: (facts) => {
      facts.token = "";
    },
  });
  const data = createModule("data", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
    },
    init: (facts) => {
      facts.count = 0;
    },
    derive: { doubled: (facts) => (facts.count as number) * 2 },
  });
  const system = createSystem({ modules: { auth, data } });
  system.start();

  return system;
}

// ---------------------------------------------------------------------------
// useSelector with SingleModuleSystem
// ---------------------------------------------------------------------------

describe("useSelector (SingleModuleSystem)", () => {
  let system: ReturnType<typeof createTestSystem>;

  afterEach(() => {
    cleanup();
    system?.destroy();
  });

  it("selects a single fact", () => {
    system = createTestSystem();
    const { result } = renderHook(() => useSelector(system, (s) => s.count));

    expect(result.current).toBe(0);
  });

  it("updates when selected fact changes", () => {
    system = createTestSystem();
    const { result } = renderHook(() => useSelector(system, (s) => s.count));

    expect(result.current).toBe(0);

    act(() => {
      system.facts.count = 5;
    });

    expect(result.current).toBe(5);
  });

  it("does NOT update when an unselected fact changes", () => {
    system = createTestSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useSelector(system, (s) => s.count);
    });

    expect(result.current).toBe(0);
    const initialRenderCount = renderCount;

    act(() => {
      system.facts.name = "world";
    });

    // Render count should not have increased — name is not selected
    expect(renderCount).toBe(initialRenderCount);
    expect(result.current).toBe(0);
  });

  it("selects from derivations", () => {
    system = createTestSystem();
    const { result } = renderHook(() => useSelector(system, (s) => s.doubled));

    expect(result.current).toBe(0);

    act(() => {
      system.facts.count = 3;
    });

    expect(result.current).toBe(6);
  });

  it("selects combined facts + derivations", () => {
    system = createTestSystem();
    const { result } = renderHook(() =>
      useSelector(
        system,
        (s) => ({ count: s.count, doubled: s.doubled }),
        { count: 0, doubled: 0 },
        shallowEqual,
      ),
    );

    expect(result.current).toEqual({ count: 0, doubled: 0 });

    act(() => {
      system.facts.count = 4;
    });

    expect(result.current).toEqual({ count: 4, doubled: 8 });
  });

  it("uses default value when selector returns undefined", () => {
    system = createTestSystem();
    const { result } = renderHook(() =>
      useSelector(
        system,
        // biome-ignore lint/suspicious/noExplicitAny: testing undefined return
        (s) => (s as any).nonexistent,
        "fallback",
      ),
    );

    expect(result.current).toBe("fallback");
  });

  it("returns default value when system is null", () => {
    system = createTestSystem();
    const { result } = renderHook(() =>
      useSelector(
        null as ReturnType<typeof createTestSystem> | null,
        (s) => s.count,
        42,
      ),
    );

    expect(result.current).toBe(42);
  });

  it("re-renders when system becomes available (null -> system)", () => {
    system = createTestSystem();

    function useTestHook(sys: ReturnType<typeof createTestSystem> | null) {
      return useSelector(sys, (s) => s.count, -1);
    }

    const { result, rerender } = renderHook(
      ({ sys }) => useTestHook(sys),
      {
        initialProps: {
          sys: null as ReturnType<typeof createTestSystem> | null,
        },
      },
    );

    expect(result.current).toBe(-1);

    rerender({ sys: system });

    expect(result.current).toBe(0);
  });

  it("with shallowEqual prevents re-renders for equivalent objects", () => {
    system = createTestSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useSelector(
        system,
        (s) => ({ x: s.x, y: s.y }),
        { x: 0, y: 0 },
        shallowEqual,
      );
    });

    expect(result.current).toEqual({ x: 0, y: 0 });
    const afterFirstRender = renderCount;

    // Mutate an unrelated fact — the subscribe for x/y does not fire
    act(() => {
      system.facts.count = 99;
    });

    // shallowEqual should prevent re-render since x and y did not change
    expect(renderCount).toBe(afterFirstRender);
    expect(result.current).toEqual({ x: 0, y: 0 });
  });

  it("with Object.is (default) re-renders when a tracked primitive changes", () => {
    system = createTestSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      // Reads x (primitive), so Object.is correctly distinguishes 0 vs 99.
      return useSelector(system, (s) => s.x);
    });

    const afterFirstRender = renderCount;
    expect(result.current).toBe(0);

    // Mutate x — tracked key changes, Object.is sees 0 !== 99, re-renders.
    act(() => {
      system.facts.x = 99;
    });

    expect(renderCount).toBeGreaterThan(afterFirstRender);
    expect(result.current).toBe(99);
  });

  it("Object.is with same primitive value does NOT re-render", () => {
    system = createTestSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useSelector(system, (s) => s.x);
    });

    const afterFirstRender = renderCount;

    // Set x to same value — Object.is returns true, no re-render
    act(() => {
      system.facts.x = 0;
    });

    expect(renderCount).toBe(afterFirstRender);
    expect(result.current).toBe(0);
  });

  it("tracks new dependencies when selector accesses different keys", () => {
    system = createTestSystem();

    const { result, rerender } = renderHook(
      ({ useX }) => useSelector(system, (s) => (useX ? s.x : s.y)),
      { initialProps: { useX: true } },
    );

    expect(result.current).toBe(0);

    // Switch to reading y
    rerender({ useX: false });

    // Mutate y — should trigger update since selector now tracks y
    act(() => {
      system.facts.y = 10;
    });

    expect(result.current).toBe(10);
  });

  it("subscribes to everything when selector accesses no tracked keys", () => {
    system = createTestSystem();

    const { result } = renderHook(() =>
      useSelector(system, () => "static"),
    );

    expect(result.current).toBe("static");

    // With no tracked keys it subscribes to everything.
    // Any change fires the subscribe callback, but getSnapshot returns
    // the same "static" string, so the value is stable.
    act(() => {
      system.facts.count = 100;
    });

    expect(result.current).toBe("static");
  });

  it("returns cached value when equality check passes", () => {
    system = createTestSystem();

    const alwaysEqual = () => true;
    const { result } = renderHook(() =>
      useSelector(
        system,
        (s) => ({ count: s.count }),
        { count: -999 },
        alwaysEqual,
      ),
    );

    const firstValue = result.current;

    act(() => {
      system.facts.count = 42;
    });

    // Same reference because equality always returns true
    expect(result.current).toBe(firstValue);
  });

  it("handles multiple rapid updates", () => {
    system = createTestSystem();
    const { result } = renderHook(() => useSelector(system, (s) => s.count));

    act(() => {
      system.facts.count = 1;
      system.facts.count = 2;
      system.facts.count = 3;
    });

    expect(result.current).toBe(3);
  });

  it("reads derivations that depend on multiple facts", () => {
    system = createTestSystem();
    const { result } = renderHook(() =>
      useSelector(
        system,
        (s) => s.coords,
        { x: 0, y: 0 },
        shallowEqual,
      ),
    );

    expect(result.current).toEqual({ x: 0, y: 0 });

    act(() => {
      system.facts.x = 5;
      system.facts.y = 10;
    });

    expect(result.current).toEqual({ x: 5, y: 10 });
  });
});

// ---------------------------------------------------------------------------
// useSelector with NamespacedSystem
// ---------------------------------------------------------------------------

describe("useSelector (NamespacedSystem)", () => {
  let system: ReturnType<typeof createNamespacedSystem>;

  afterEach(() => {
    cleanup();
    system?.destroy();
  });

  it("selects from a namespaced system", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useSelector(system, (s) => s.facts.auth.token),
    );

    expect(result.current).toBe("");
  });

  it("updates when namespaced fact changes", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useSelector(system, (s) => s.facts.data.count),
    );

    expect(result.current).toBe(0);

    act(() => {
      system.facts.data.count = 7;
    });

    expect(result.current).toBe(7);
  });

  it("uses default value when selector returns undefined", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useSelector(
        system,
        // biome-ignore lint/suspicious/noExplicitAny: testing undefined return
        (s) => (s as any).facts?.missing?.key,
        "default-ns",
      ),
    );

    expect(result.current).toBe("default-ns");
  });

  it("reads from namespaced derivations", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useSelector(system, (s) => s.derive.data.doubled),
    );

    expect(result.current).toBe(0);

    act(() => {
      system.facts.data.count = 5;
    });

    expect(result.current).toBe(10);
  });

  it("does NOT update when unrelated namespace changes (equality)", () => {
    system = createNamespacedSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useSelector(
        system,
        (s) => s.facts.data.count,
        0,
        (a, b) => a === b,
      );
    });

    expect(result.current).toBe(0);
    const afterRender = renderCount;

    act(() => {
      system.facts.auth.token = "abc123";
    });

    // The namespaced useSelector subscribes to all modules via wildcard,
    // so it fires on auth changes, but the equality check prevents
    // a new render since the selected value (data.count) did not change.
    expect(result.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useNamespacedSelector
// ---------------------------------------------------------------------------

describe("useNamespacedSelector", () => {
  let system: ReturnType<typeof createNamespacedSystem>;

  afterEach(() => {
    cleanup();
    system?.destroy();
  });

  it("selects with explicit keys", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useNamespacedSelector(
        system,
        ["auth.token"],
        (s) => s.facts.auth.token,
      ),
    );

    expect(result.current).toBe("");
  });

  it("updates when subscribed key changes", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useNamespacedSelector(
        system,
        ["data.count"],
        (s) => s.facts.data.count,
      ),
    );

    expect(result.current).toBe(0);

    act(() => {
      system.facts.data.count = 42;
    });

    expect(result.current).toBe(42);
  });

  it("does NOT update when unsubscribed key changes", () => {
    system = createNamespacedSystem();
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useNamespacedSelector(
        system,
        ["data.count"],
        (s) => s.facts.data.count,
      );
    });

    expect(result.current).toBe(0);
    const afterRender = renderCount;

    // Change auth.token — not subscribed
    act(() => {
      system.facts.auth.token = "new-token";
    });

    expect(renderCount).toBe(afterRender);
    expect(result.current).toBe(0);
  });

  it("selector ref is always current (no stale closure)", () => {
    system = createNamespacedSystem();
    let multiplier = 1;

    const { result, rerender } = renderHook(() =>
      useNamespacedSelector(
        system,
        ["data.count"],
        (s) => s.facts.data.count * multiplier,
      ),
    );

    expect(result.current).toBe(0);

    act(() => {
      system.facts.data.count = 5;
    });

    expect(result.current).toBe(5);

    // Update the closure variable and rerender
    multiplier = 10;
    rerender();

    // The new selector (with multiplier=10) should be picked up
    expect(result.current).toBe(50);
  });

  it("supports wildcard subscriptions", () => {
    system = createNamespacedSystem();
    const { result } = renderHook(() =>
      useNamespacedSelector(
        system,
        ["data.*"],
        (s) => s.derive.data.doubled,
      ),
    );

    expect(result.current).toBe(0);

    act(() => {
      system.facts.data.count = 3;
    });

    expect(result.current).toBe(6);
  });
});
