// @vitest-environment happy-dom
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleDef } from "@directive-run/core";
import { renderHook, act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  useDirectiveRef,
  useDirective,
  DirectiveHydrator,
  useHydratedSystem,
  useFact,
} from "../index";

// ---------------------------------------------------------------------------
// Shared test module
// ---------------------------------------------------------------------------

const counterModule = createModule("counter", {
  schema: {
    facts: {
      count: t.number(),
      name: t.string(),
    },
    derivations: {
      doubled: t.number(),
    },
    events: {
      increment: {},
      setName: { name: t.string() },
    },
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
    facts.name = "test";
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  events: {
    increment: (facts) => {
      facts.count += 1;
    },
    setName: (facts, payload) => {
      facts.name = payload.name;
    },
  },
});

// ---------------------------------------------------------------------------
// useDirectiveRef
// ---------------------------------------------------------------------------

describe("useDirectiveRef", () => {
  it("creates a system from module def", () => {
    const { result } = renderHook(() => useDirectiveRef(counterModule));
    expect(result.current).toBeDefined();
    expect(typeof result.current.read).toBe("function");
  });

  it("system has correct initial facts", () => {
    const { result } = renderHook(() => useDirectiveRef(counterModule));
    const system = result.current;
    expect(system.facts.count).toBe(0);
    expect(system.facts.name).toBe("test");
  });

  it("system is started (can read facts)", () => {
    const { result } = renderHook(() => useDirectiveRef(counterModule));
    const system = result.current;
    // read() works on derivations
    expect(system.read("doubled")).toBe(0);
  });

  it("passes module directly (shorthand)", () => {
    const { result } = renderHook(() => useDirectiveRef(counterModule));
    const system = result.current;
    expect(system.facts.count).toBe(0);
    expect(system.read("doubled")).toBe(0);
  });

  it("passes module in config object", () => {
    const { result } = renderHook(() =>
      useDirectiveRef({ module: counterModule }),
    );
    const system = result.current;
    expect(system.facts.count).toBe(0);
    expect(system.read("doubled")).toBe(0);
  });

  it("with plugins config", () => {
    const onStartSpy = vi.fn();
    const testPlugin = {
      name: "test-plugin",
      onStart: onStartSpy,
    };

    const { result } = renderHook(() =>
      useDirectiveRef(counterModule, { plugins: [testPlugin] }),
    );

    expect(result.current).toBeDefined();
    expect(onStartSpy).toHaveBeenCalled();
  });

  it("with debug config", () => {
    const { result } = renderHook(() =>
      useDirectiveRef(counterModule, {
        debug: { timeTravel: true, maxSnapshots: 50 },
      }),
    );

    expect(result.current).toBeDefined();
    expect(result.current.facts.count).toBe(0);
  });

  it("with initialFacts override", () => {
    const { result } = renderHook(() =>
      useDirectiveRef(counterModule, {
        initialFacts: { count: 42, name: "overridden" },
      }),
    );
    const system = result.current;
    expect(system.facts.count).toBe(42);
    expect(system.facts.name).toBe("overridden");
  });

  it("destroys system on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useDirectiveRef(counterModule),
    );
    const system = result.current;
    const destroySpy = vi.spyOn(system, "destroy");

    unmount();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it("returns stable system reference across re-renders", () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount++;

      return useDirectiveRef(counterModule);
    });

    const firstSystem = result.current;
    rerender();
    const secondSystem = result.current;

    expect(renderCount).toBeGreaterThanOrEqual(2);
    expect(firstSystem).toBe(secondSystem);
  });

  it("with status: true returns { system, statusPlugin }", () => {
    const { result } = renderHook(() =>
      useDirectiveRef(counterModule, { status: true }),
    );

    expect(result.current).toHaveProperty("system");
    expect(result.current).toHaveProperty("statusPlugin");
    expect(result.current.system.facts.count).toBe(0);
  });

  it("status plugin is functional (can getStatus)", () => {
    const { result } = renderHook(() =>
      useDirectiveRef(counterModule, { status: true }),
    );

    const { statusPlugin } = result.current;
    expect(typeof statusPlugin.getStatus).toBe("function");
    expect(typeof statusPlugin.subscribe).toBe("function");

    // getStatus returns a status object for any requirement type
    const status = statusPlugin.getStatus("SOME_TYPE");
    expect(status).toHaveProperty("isLoading");
    expect(status).toHaveProperty("hasError");
  });
});

// ---------------------------------------------------------------------------
// useDirective
// ---------------------------------------------------------------------------

describe("useDirective", () => {
  it("returns system, dispatch, events, facts, derived", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count", "name"],
        derived: ["doubled"],
      }),
    );

    expect(result.current).toHaveProperty("system");
    expect(result.current).toHaveProperty("dispatch");
    expect(result.current).toHaveProperty("events");
    expect(result.current).toHaveProperty("facts");
    expect(result.current).toHaveProperty("derived");
  });

  it("facts contain selected fact values", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count", "name"],
      }),
    );

    expect(result.current.facts.count).toBe(0);
    expect(result.current.facts.name).toBe("test");
  });

  it("derived contain selected derivation values", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        derived: ["doubled"],
      }),
    );

    expect(result.current.derived.doubled).toBe(0);
  });

  it("subscribe-all mode (no keys specified): reads all facts and derivations", () => {
    const { result } = renderHook(() => useDirective(counterModule));

    // All facts should be present
    expect(result.current.facts).toHaveProperty("count");
    expect(result.current.facts).toHaveProperty("name");
    expect((result.current.facts as Record<string, unknown>).count).toBe(0);
    expect((result.current.facts as Record<string, unknown>).name).toBe(
      "test",
    );

    // All derivations should be present
    expect(result.current.derived).toHaveProperty("doubled");
    expect((result.current.derived as Record<string, unknown>).doubled).toBe(0);
  });

  it("selective mode: only subscribes to specified keys", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
        derived: ["doubled"],
      }),
    );

    expect(result.current.facts).toHaveProperty("count");
    expect(result.current.derived).toHaveProperty("doubled");
    // "name" is not included in the selection
    expect(result.current.facts).not.toHaveProperty("name");
  });

  it("dispatch updates the system", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
        derived: ["doubled"],
      }),
    );

    act(() => {
      result.current.dispatch({ type: "increment" });
    });

    expect(result.current.facts.count).toBe(1);
    expect(result.current.derived.doubled).toBe(2);
  });

  it("events object is functional", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
      }),
    );

    expect(typeof result.current.events.increment).toBe("function");

    act(() => {
      result.current.events.increment();
    });

    expect(result.current.facts.count).toBe(1);
  });

  it("with status: true returns statusPlugin in result", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
        status: true,
      }),
    );

    expect(result.current).toHaveProperty("statusPlugin");
    const withStatus = result.current as { statusPlugin: unknown };
    expect(withStatus.statusPlugin).toBeDefined();
    expect(typeof (withStatus.statusPlugin as { getStatus: unknown }).getStatus).toBe("function");
  });

  it("facts update reactively when underlying system changes", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
      }),
    );

    expect(result.current.facts.count).toBe(0);

    act(() => {
      result.current.events.increment();
    });

    expect(result.current.facts.count).toBe(1);

    act(() => {
      result.current.events.increment();
    });

    expect(result.current.facts.count).toBe(2);
  });

  it("derived update reactively when underlying facts change", () => {
    const { result } = renderHook(() =>
      useDirective(counterModule, {
        facts: ["count"],
        derived: ["doubled"],
      }),
    );

    expect(result.current.derived.doubled).toBe(0);

    act(() => {
      result.current.events.increment();
    });

    expect(result.current.derived.doubled).toBe(2);

    act(() => {
      result.current.events.increment();
    });

    expect(result.current.derived.doubled).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// DirectiveHydrator + useHydratedSystem
// ---------------------------------------------------------------------------

describe("DirectiveHydrator + useHydratedSystem", () => {
  function TestComponent({ module }: { module: ModuleDef<any> }) {
    const system = useHydratedSystem(module);
    const count = useFact(system, "count");
    const name = useFact(system, "name");

    return (
      <div>
        <span data-testid="count">{count}</span>
        <span data-testid="name">{name}</span>
      </div>
    );
  }

  it("DirectiveHydrator provides snapshot context", () => {
    const snapshot = {
      data: { count: 99, name: "hydrated" },
      createdAt: Date.now(),
    };

    const { container } = render(
      <DirectiveHydrator snapshot={snapshot}>
        <TestComponent module={counterModule} />
      </DirectiveHydrator>,
    );

    expect(container).toBeDefined();
    expect(screen.getByTestId("count").textContent).toBe("99");
  });

  it("useHydratedSystem creates system with hydrated facts", () => {
    const snapshot = {
      data: { count: 10, name: "from-server" },
      createdAt: Date.now(),
    };

    render(
      <DirectiveHydrator snapshot={snapshot}>
        <TestComponent module={counterModule} />
      </DirectiveHydrator>,
    );

    expect(screen.getByTestId("count").textContent).toBe("10");
    expect(screen.getByTestId("name").textContent).toBe("from-server");
  });

  it("hydrated facts override module init values", () => {
    // Module init sets count=0, name="test"
    // Snapshot overrides to count=55, name="override"
    const snapshot = {
      data: { count: 55, name: "override" },
      createdAt: Date.now(),
    };

    render(
      <DirectiveHydrator snapshot={snapshot}>
        <TestComponent module={counterModule} />
      </DirectiveHydrator>,
    );

    expect(screen.getByTestId("count").textContent).toBe("55");
    expect(screen.getByTestId("name").textContent).toBe("override");
  });

  it("works without snapshot (falls back to init)", () => {
    // Render without DirectiveHydrator — useHydratedSystem falls back to init values
    function StandaloneComponent() {
      const system = useHydratedSystem(counterModule);
      const count = useFact(system, "count");
      const name = useFact(system, "name");

      return (
        <div>
          <span data-testid="count">{count}</span>
          <span data-testid="name">{name}</span>
        </div>
      );
    }

    render(<StandaloneComponent />);

    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("name").textContent).toBe("test");
  });

  it("merges config.initialFacts with snapshot data", () => {
    const snapshot = {
      data: { count: 77 },
      createdAt: Date.now(),
    };

    // Component that passes initialFacts config to useHydratedSystem
    function MergeTestComponent() {
      const system = useHydratedSystem(counterModule, {
        initialFacts: { name: "from-config" },
      });
      const count = useFact(system, "count");
      const name = useFact(system, "name");

      return (
        <div>
          <span data-testid="count">{count}</span>
          <span data-testid="name">{name}</span>
        </div>
      );
    }

    render(
      <DirectiveHydrator snapshot={snapshot}>
        <MergeTestComponent />
      </DirectiveHydrator>,
    );

    // Snapshot data (count=77) should override config.initialFacts
    // because useHydratedSystem spreads snapshot.data AFTER config.initialFacts
    expect(screen.getByTestId("count").textContent).toBe("77");
    // name comes from config.initialFacts since snapshot.data didn't include it
    expect(screen.getByTestId("name").textContent).toBe("from-config");
  });
});
