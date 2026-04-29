// @vitest-environment happy-dom
import { createModule, createSystem, t } from "@directive-run/core";
import { renderHook, act } from "@testing-library/react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { useTickWhile } from "../index";

// ============================================================================
// Test Module
// ============================================================================

const tickSchema = {
  facts: {
    status: t.string(),
    ticks: t.number(),
  },
  derivations: {},
  events: {
    TICK: {},
    setStatus: { status: t.string() },
  },
  requirements: {},
};

function createTickSystem() {
  const mod = createModule("tickTest", {
    schema: tickSchema,
    init: (facts) => {
      facts.status = "idle";
      facts.ticks = 0;
    },
    events: {
      TICK: (facts) => {
        facts.ticks = facts.ticks + 1;
      },
      setStatus: (facts, { status }: { status: string }) => {
        facts.status = status;
      },
    },
  });

  const system = createSystem({ module: mod });
  system.start();
  return system;
}

// ============================================================================
// useTickWhile
// ============================================================================

describe("useTickWhile", () => {
  let system: ReturnType<typeof createTickSystem>;

  beforeEach(() => {
    vi.useFakeTimers();
    system = createTickSystem();
  });

  afterEach(() => {
    system.destroy();
    vi.useRealTimers();
  });

  it("fires events while predicate true", () => {
    renderHook(() =>
      useTickWhile(
        system,
        (sys) => sys.facts.status === "running",
        "TICK",
        100,
      ),
    );

    // Initially idle, no ticks should fire
    expect(system.facts.ticks).toBe(0);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(system.facts.ticks).toBe(0);

    // Flip to running — predicate true, ticks should start firing
    act(() => {
      system.events.setStatus({ status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(system.facts.ticks).toBe(3);
  });

  it("stops when predicate flips false", () => {
    renderHook(() =>
      useTickWhile(
        system,
        (sys) => sys.facts.status === "running",
        "TICK",
        100,
      ),
    );

    act(() => {
      system.events.setStatus({ status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(system.facts.ticks).toBe(2);

    // Flip to stopped — interval should clear
    act(() => {
      system.events.setStatus({ status: "stopped" });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(system.facts.ticks).toBe(2);
  });

  it("re-starts when predicate flips back true", () => {
    renderHook(() =>
      useTickWhile(
        system,
        (sys) => sys.facts.status === "running",
        "TICK",
        100,
      ),
    );

    // Run → stop → run cycle
    act(() => {
      system.events.setStatus({ status: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(system.facts.ticks).toBe(2);

    act(() => {
      system.events.setStatus({ status: "paused" });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(system.facts.ticks).toBe(2);

    act(() => {
      system.events.setStatus({ status: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(system.facts.ticks).toBe(5);
  });

  it("cleanup on unmount stops the interval", () => {
    const { unmount } = renderHook(() =>
      useTickWhile(
        system,
        (sys) => sys.facts.status === "running",
        "TICK",
        100,
      ),
    );

    act(() => {
      system.events.setStatus({ status: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(system.facts.ticks).toBe(2);

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(system.facts.ticks).toBe(2);
  });

  it("reflects intervalMs prop change", () => {
    const { rerender } = renderHook(
      ({ ms }: { ms: number }) =>
        useTickWhile(
          system,
          (sys) => sys.facts.status === "running",
          "TICK",
          ms,
        ),
      { initialProps: { ms: 100 } },
    );

    act(() => {
      system.events.setStatus({ status: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(system.facts.ticks).toBe(2);

    // Switch interval to 50ms — ticks should accelerate
    rerender({ ms: 50 });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // 250 / 50 = 5 additional ticks
    expect(system.facts.ticks).toBe(7);
  });

  it("does not fire if intervalMs is non-positive", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() =>
      useTickWhile(
        system,
        (sys) => sys.facts.status === "running",
        "TICK",
        0,
      ),
    );

    act(() => {
      system.events.setStatus({ status: "running" });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(system.facts.ticks).toBe(0);

    warn.mockRestore();
  });

  it("does not fire while predicate is false even at construction", () => {
    renderHook(() =>
      useTickWhile(
        system,
        () => false,
        "TICK",
        50,
      ),
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(system.facts.ticks).toBe(0);
  });
});
