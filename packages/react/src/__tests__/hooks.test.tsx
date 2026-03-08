// @vitest-environment happy-dom
import { createModule, createSystem, t } from "@directive-run/core";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useFact,
  useDerived,
  useDispatch,
  useEvents,
  useWatch,
} from "../index";
import type { SingleModuleSystem } from "@directive-run/core";

// ============================================================================
// Test Module Factory
// ============================================================================

const testSchema = {
  facts: {
    count: t.number(),
    name: t.string(),
    items: t.array<string>(),
  },
  derivations: {
    doubled: { _type: 0 as number },
    greeting: { _type: "" as string },
  },
  events: {
    increment: {},
    setName: { name: t.string() },
  },
  requirements: {},
};

function createTestSystem() {
  const mod = createModule("test", {
    schema: testSchema,
    init: (facts) => {
      facts.count = 0;
      facts.name = "hello";
      facts.items = [];
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
      greeting: (facts) => `Hi, ${facts.name}!`,
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setName: (facts, { name }: { name: string }) => {
        facts.name = name;
      },
    },
  });

  const system = createSystem({ module: mod });
  system.start();

  return system;
}

// ============================================================================
// useFact
// ============================================================================

describe("useFact", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads a single fact value", () => {
    const { result } = renderHook(() => useFact(system, "count"));

    expect(result.current).toBe(0);
  });

  it("updates when fact changes", () => {
    const { result } = renderHook(() => useFact(system, "count"));

    expect(result.current).toBe(0);

    act(() => {
      system.facts.count = 5;
    });

    expect(result.current).toBe(5);
  });

  it("reads string fact value", () => {
    const { result } = renderHook(() => useFact(system, "name"));

    expect(result.current).toBe("hello");
  });

  it("updates string fact when changed", () => {
    const { result } = renderHook(() => useFact(system, "name"));

    act(() => {
      system.facts.name = "world";
    });

    expect(result.current).toBe("world");
  });

  it("multi-key: reads multiple facts as object", () => {
    const { result } = renderHook(() =>
      useFact(system, ["count", "name"]),
    );

    expect(result.current).toEqual({ count: 0, name: "hello" });
  });

  it("multi-key: updates when any subscribed fact changes", () => {
    const { result } = renderHook(() =>
      useFact(system, ["count", "name"]),
    );

    expect(result.current).toEqual({ count: 0, name: "hello" });

    act(() => {
      system.facts.count = 10;
    });

    expect(result.current).toEqual({ count: 10, name: "hello" });

    act(() => {
      system.facts.name = "world";
    });

    expect(result.current).toEqual({ count: 10, name: "world" });
  });

  it("multi-key: does NOT re-render when unsubscribed fact changes", () => {
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;

      return useFact(system, ["count"]);
    });

    const countAfterInitial = renderCount;

    // Changing an unsubscribed fact ("name") should NOT cause re-render
    act(() => {
      system.facts.name = "changed";
    });

    expect(renderCount).toBe(countAfterInitial);

    // Changing a subscribed fact ("count") SHOULD cause re-render
    act(() => {
      system.facts.count = 99;
    });

    expect(renderCount).toBeGreaterThan(countAfterInitial);
    expect(result.current).toEqual({ count: 99 });
  });

  it("returns undefined for non-existent fact key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useFact(system, "nonexistent" as any),
    );

    expect(result.current).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("dev warning when fact key not in schema", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useFact(system, "bogus" as any));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fact not found"),
    );
    warnSpy.mockRestore();
  });

  it("dev warning when function passed instead of string", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // Also suppress the warn about fact not found
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useFact(system, (() => "count") as any));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("received a function"),
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("tracks multiple sequential updates correctly", () => {
    const { result } = renderHook(() => useFact(system, "count"));

    act(() => {
      system.facts.count = 1;
    });
    expect(result.current).toBe(1);

    act(() => {
      system.facts.count = 2;
    });
    expect(result.current).toBe(2);

    act(() => {
      system.facts.count = 3;
    });
    expect(result.current).toBe(3);
  });

  it("reads object-type facts (items array)", () => {
    const { result } = renderHook(() => useFact(system, "items"));

    expect(result.current).toEqual([]);

    act(() => {
      system.facts.items = ["a", "b"];
    });

    expect(result.current).toEqual(["a", "b"]);
  });

  it("multi-key: returns stable reference when values unchanged", () => {
    const { result, rerender } = renderHook(() =>
      useFact(system, ["count", "name"]),
    );

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });

  it("handles fact set to same value without extra re-render", () => {
    let renderCount = 0;

    renderHook(() => {
      renderCount++;

      return useFact(system, "count");
    });

    const countAfterInitial = renderCount;

    // Setting to the same value should not trigger re-render
    act(() => {
      system.facts.count = 0;
    });

    expect(renderCount).toBe(countAfterInitial);
  });

  it("reads initial fact value before any mutations", () => {
    const { result } = renderHook(() =>
      useFact(system, ["count", "name", "items"]),
    );

    expect(result.current).toEqual({
      count: 0,
      name: "hello",
      items: [],
    });
  });
});

// ============================================================================
// useDerived
// ============================================================================

describe("useDerived", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("reads single derivation value", () => {
    const { result } = renderHook(() => useDerived(system, "doubled"));

    expect(result.current).toBe(0);
  });

  it("updates when underlying fact changes", () => {
    const { result } = renderHook(() => useDerived(system, "doubled"));

    expect(result.current).toBe(0);

    act(() => {
      system.facts.count = 5;
    });

    expect(result.current).toBe(10);
  });

  it("reads greeting derivation", () => {
    const { result } = renderHook(() => useDerived(system, "greeting"));

    expect(result.current).toBe("Hi, hello!");
  });

  it("greeting updates when name fact changes", () => {
    const { result } = renderHook(() => useDerived(system, "greeting"));

    act(() => {
      system.facts.name = "world";
    });

    expect(result.current).toBe("Hi, world!");
  });

  it("multi-key: reads multiple derivations as object", () => {
    const { result } = renderHook(() =>
      useDerived(system, ["doubled", "greeting"]),
    );

    expect(result.current).toEqual({
      doubled: 0,
      greeting: "Hi, hello!",
    });
  });

  it("multi-key: updates when any underlying fact changes", () => {
    const { result } = renderHook(() =>
      useDerived(system, ["doubled", "greeting"]),
    );

    act(() => {
      system.facts.count = 3;
    });

    expect(result.current).toEqual({
      doubled: 6,
      greeting: "Hi, hello!",
    });
  });

  it("multi-key: returns stable reference when values have not changed", () => {
    const { result, rerender } = renderHook(() =>
      useDerived(system, ["doubled", "greeting"]),
    );

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });

  it("multi-key: returns new reference when values change", () => {
    const { result } = renderHook(() =>
      useDerived(system, ["doubled", "greeting"]),
    );

    const first = result.current;

    act(() => {
      system.facts.count = 7;
    });

    const second = result.current;

    expect(first).not.toBe(second);
    expect(second).toEqual({ doubled: 14, greeting: "Hi, hello!" });
  });

  it("dev warning when derivation not found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Suppress React error boundary console.error from the throw
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // system.read() throws for unknown derivations, so the hook will error
    expect(() => {
      renderHook(() => useDerived(system, "nonexistent" as any));
    }).toThrow("Unknown derivation");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("derivation not found"),
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("dev warning when function passed instead of string", () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // system.read() throws for the stringified function as a key
    expect(() => {
      renderHook(() => useDerived(system, (() => "doubled") as any));
    }).toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("received a function"),
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ============================================================================
// useDispatch
// ============================================================================

describe("useDispatch", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns a dispatch function", () => {
    const { result } = renderHook(() => useDispatch(system));

    expect(typeof result.current).toBe("function");
  });

  it("dispatching events updates facts", () => {
    const { result: dispatchResult } = renderHook(() => useDispatch(system));
    const { result: factResult } = renderHook(() =>
      useFact(system, "count"),
    );

    expect(factResult.current).toBe(0);

    act(() => {
      dispatchResult.current({ type: "increment" });
    });

    expect(factResult.current).toBe(1);

    act(() => {
      dispatchResult.current({ type: "setName", name: "dispatch-test" });
    });

    const { result: nameResult } = renderHook(() =>
      useFact(system, "name"),
    );
    expect(nameResult.current).toBe("dispatch-test");
  });

  it("dispatch function is stable across renders", () => {
    const { result, rerender } = renderHook(() => useDispatch(system));

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });
});

// ============================================================================
// useEvents
// ============================================================================

describe("useEvents", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("returns events object", () => {
    const { result } = renderHook(() => useEvents(system));

    expect(result.current).toBeDefined();
    expect(typeof result.current.increment).toBe("function");
    expect(typeof result.current.setName).toBe("function");
  });

  it("calling event method updates system", () => {
    const { result: eventsResult } = renderHook(() => useEvents(system));
    const { result: factResult } = renderHook(() =>
      useFact(system, "count"),
    );

    expect(factResult.current).toBe(0);

    act(() => {
      eventsResult.current.increment();
    });

    expect(factResult.current).toBe(1);

    act(() => {
      eventsResult.current.increment();
      eventsResult.current.increment();
    });

    expect(factResult.current).toBe(3);
  });

  it("events reference is stable across renders", () => {
    const { result, rerender } = renderHook(() => useEvents(system));

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });
});

// ============================================================================
// useWatch
// ============================================================================

describe("useWatch", () => {
  let system: ReturnType<typeof createTestSystem>;

  beforeEach(() => {
    system = createTestSystem();
  });

  afterEach(() => {
    system.destroy();
  });

  it("calls callback when watched fact changes", () => {
    const callback = vi.fn();

    renderHook(() => useWatch(system, "count", callback));

    act(() => {
      system.facts.count = 42;
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("passes new and previous values to callback", () => {
    const callback = vi.fn();

    renderHook(() => useWatch(system, "count", callback));

    act(() => {
      system.facts.count = 10;
    });

    expect(callback).toHaveBeenCalledWith(10, 0);

    act(() => {
      system.facts.count = 20;
    });

    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it("does NOT trigger React re-render (effect-only)", () => {
    let renderCount = 0;
    const callback = vi.fn();

    renderHook(() => {
      renderCount++;
      useWatch(system, "count", callback);
    });

    const countAfterInitial = renderCount;

    act(() => {
      system.facts.count = 100;
    });

    // useWatch should NOT cause re-renders; the callback fires
    // but the component itself should not re-render
    expect(callback).toHaveBeenCalled();
    expect(renderCount).toBe(countAfterInitial);
  });

  it("cleans up subscription on unmount", () => {
    const callback = vi.fn();

    const { unmount } = renderHook(() =>
      useWatch(system, "count", callback),
    );

    // Verify the watch is active
    act(() => {
      system.facts.count = 5;
    });
    expect(callback).toHaveBeenCalledTimes(1);

    // Unmount cleans up subscription
    unmount();

    // Changes after unmount should not fire the callback
    act(() => {
      system.facts.count = 99;
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("callback ref is always current (no stale closure)", () => {
    const calls: number[] = [];

    const { rerender } = renderHook(
      ({ cb }) => useWatch(system, "count", cb),
      {
        initialProps: {
          cb: (newVal: number) => {
            calls.push(newVal * 10);
          },
        },
      },
    );

    // Re-render with a different callback
    rerender({
      cb: (newVal: number) => {
        calls.push(newVal * 100);
      },
    });

    act(() => {
      system.facts.count = 3;
    });

    // The latest callback (x100) should have been used, not the original (x10)
    expect(calls).toEqual([300]);
  });
});
