// @vitest-environment happy-dom
import {
  createModule,
  createSystem,
  createRequirementStatusPlugin,
  t,
} from "@directive-run/core";
import type { Plugin } from "@directive-run/core";
import { renderHook, act } from "@testing-library/react";
import React, { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  useRequirementStatus,
  useSuspenseRequirement,
  useOptimisticUpdate,
} from "../index";

// ============================================================================
// Helpers
// ============================================================================

/** Deferred promise for controlling resolver timing */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Creates a system with the status plugin and a configurable resolver.
 * The resolver blocks on `gate` so tests can control timing.
 */
function createSystemWithStatus(
  resolverFn?: (
    req: { type: string },
    context: { facts: { count: number; ready: boolean } },
  ) => Promise<void>,
) {
  const statusPlugin = createRequirementStatusPlugin();
  const mod = createModule("test", {
    schema: {
      facts: { count: t.number(), ready: t.boolean() },
      requirements: { LOAD_DATA: {} },
    },
    init: (facts) => {
      facts.count = 0;
      facts.ready = false;
    },
    constraints: {
      needsData: {
        when: (facts) => !facts.ready,
        require: { type: "LOAD_DATA" },
      },
    },
    resolvers: {
      loadData: {
        requirement: "LOAD_DATA",
        resolve:
          resolverFn ??
          (async (_req, context) => {
            context.facts.ready = true;
          }),
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
  const system = createSystem({
    module: mod,
    plugins: [statusPlugin.plugin as Plugin<any>],
  });

  return { system, statusPlugin, mod };
}

/**
 * Creates a system with two requirement types for multi-type tests.
 */
function createMultiTypeSystem(
  resolverA?: (
    req: { type: string },
    context: { facts: { a: boolean; b: boolean } },
  ) => Promise<void>,
  resolverB?: (
    req: { type: string },
    context: { facts: { a: boolean; b: boolean } },
  ) => Promise<void>,
) {
  const statusPlugin = createRequirementStatusPlugin();
  const mod = createModule("multi", {
    schema: {
      facts: { a: t.boolean(), b: t.boolean() },
      requirements: { LOAD_A: {}, LOAD_B: {} },
    },
    init: (facts) => {
      facts.a = false;
      facts.b = false;
    },
    constraints: {
      needsA: {
        when: (facts) => !facts.a,
        require: { type: "LOAD_A" },
      },
      needsB: {
        when: (facts) => !facts.b,
        require: { type: "LOAD_B" },
      },
    },
    resolvers: {
      loadA: {
        requirement: "LOAD_A",
        resolve:
          resolverA ??
          (async (_req, context) => {
            context.facts.a = true;
          }),
      },
      loadB: {
        requirement: "LOAD_B",
        resolve:
          resolverB ??
          (async (_req, context) => {
            context.facts.b = true;
          }),
      },
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
  const system = createSystem({
    module: mod,
    plugins: [statusPlugin.plugin as Plugin<any>],
  });

  return { system, statusPlugin };
}

// ============================================================================
// useRequirementStatus
// ============================================================================

describe("useRequirementStatus", () => {
  describe("single type", () => {
    it("returns status for a requirement type", async () => {
      const gate = deferred();
      const { system, statusPlugin } = createSystemWithStatus(
        async (_req, context) => {
          await gate.promise;
          context.facts.ready = true;
        },
      );
      system.start();

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      // Should have a status object
      expect(result.current).toBeDefined();
      expect(typeof result.current.pending).toBe("number");
      expect(typeof result.current.isLoading).toBe("boolean");

      // Clean up
      await act(async () => {
        gate.resolve();
        await system.settle();
      });
      system.destroy();
    });

    it("status has correct shape (pending, inflight, failed, isLoading, hasError, lastError)", async () => {
      const { system, statusPlugin } = createSystemWithStatus();

      // Before start: no requirements yet
      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      const status = result.current;
      expect(status).toHaveProperty("pending");
      expect(status).toHaveProperty("inflight");
      expect(status).toHaveProperty("failed");
      expect(status).toHaveProperty("isLoading");
      expect(status).toHaveProperty("hasError");
      expect(status).toHaveProperty("lastError");

      expect(typeof status.pending).toBe("number");
      expect(typeof status.inflight).toBe("number");
      expect(typeof status.failed).toBe("number");
      expect(typeof status.isLoading).toBe("boolean");
      expect(typeof status.hasError).toBe("boolean");

      system.start();
      await system.settle();
      system.destroy();
    });

    it("updates reactively when requirement status changes", async () => {
      const gate = deferred();
      const { system, statusPlugin } = createSystemWithStatus(
        async (_req, context) => {
          await gate.promise;
          context.facts.ready = true;
        },
      );

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      // Before start: nothing pending
      expect(result.current.isLoading).toBe(false);
      expect(result.current.pending).toBe(0);

      // Start the system — constraint fires, requirement becomes pending/inflight
      await act(async () => {
        system.start();
        // Give the reconciler a tick to process
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(result.current.isLoading).toBe(true);

      // Resolve — requirement completes
      await act(async () => {
        gate.resolve();
        await system.settle();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.pending).toBe(0);
      expect(result.current.inflight).toBe(0);

      system.destroy();
    });

    it("returns stable reference when status has not changed", async () => {
      const { system, statusPlugin } = createSystemWithStatus();
      system.start();
      await system.settle();

      const { result, rerender } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      const first = result.current;
      rerender();
      const second = result.current;

      // Same reference — the getSnapshot memoization should prevent new objects
      expect(first).toBe(second);

      system.destroy();
    });

    it("isLoading reflects pending requirements", async () => {
      const gate = deferred();
      const { system, statusPlugin } = createSystemWithStatus(
        async (_req, context) => {
          await gate.promise;
          context.facts.ready = true;
        },
      );

      system.start();
      // Wait for the reconciler to pick up the constraint
      await new Promise((r) => setTimeout(r, 50));

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        gate.resolve();
        await system.settle();
      });

      expect(result.current.isLoading).toBe(false);

      system.destroy();
    });

    it("after resolution isLoading is false", async () => {
      const { system, statusPlugin } = createSystemWithStatus();
      system.start();
      await system.settle();

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, "LOAD_DATA"),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.pending).toBe(0);
      expect(result.current.inflight).toBe(0);
      expect(result.current.hasError).toBe(false);

      system.destroy();
    });
  });

  describe("multi type", () => {
    it("returns record of statuses for multiple types", async () => {
      const gateA = deferred();
      const gateB = deferred();
      const { system, statusPlugin } = createMultiTypeSystem(
        async (_req, context) => {
          await gateA.promise;
          context.facts.a = true;
        },
        async (_req, context) => {
          await gateB.promise;
          context.facts.b = true;
        },
      );
      system.start();
      await new Promise((r) => setTimeout(r, 50));

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, ["LOAD_A", "LOAD_B"]),
      );

      const statuses = result.current;
      if (!statuses.LOAD_A || !statuses.LOAD_B) {
        throw new Error("Missing statuses");
      }
      expect(statuses).toHaveProperty("LOAD_A");
      expect(statuses).toHaveProperty("LOAD_B");
      expect(statuses.LOAD_A.isLoading).toBe(true);
      expect(statuses.LOAD_B.isLoading).toBe(true);

      await act(async () => {
        gateA.resolve();
        gateB.resolve();
        await system.settle();
      });

      system.destroy();
    });

    it("updates when any tracked type changes", async () => {
      const gateA = deferred();
      const gateB = deferred();
      const { system, statusPlugin } = createMultiTypeSystem(
        async (_req, context) => {
          await gateA.promise;
          context.facts.a = true;
        },
        async (_req, context) => {
          await gateB.promise;
          context.facts.b = true;
        },
      );
      system.start();
      await new Promise((r) => setTimeout(r, 50));

      const { result } = renderHook(() =>
        useRequirementStatus(statusPlugin, ["LOAD_A", "LOAD_B"]),
      );

      const statuses = result.current;
      if (!statuses.LOAD_A || !statuses.LOAD_B) {
        throw new Error("Missing statuses");
      }
      expect(statuses.LOAD_A.isLoading).toBe(true);
      expect(statuses.LOAD_B.isLoading).toBe(true);

      // Resolve only A
      await act(async () => {
        gateA.resolve();
        await new Promise((r) => setTimeout(r, 100));
      });

      const updated = result.current;
      if (!updated.LOAD_A || !updated.LOAD_B) {
        throw new Error("Missing statuses");
      }
      expect(updated.LOAD_A.isLoading).toBe(false);
      // B is still loading
      expect(updated.LOAD_B.isLoading).toBe(true);

      await act(async () => {
        gateB.resolve();
        await system.settle();
      });

      const final = result.current;
      if (!final.LOAD_A || !final.LOAD_B) {
        throw new Error("Missing statuses");
      }
      expect(final.LOAD_A.isLoading).toBe(false);
      expect(final.LOAD_B.isLoading).toBe(false);

      system.destroy();
    });
  });
});

// ============================================================================
// useSuspenseRequirement
// ============================================================================

describe("useSuspenseRequirement", () => {
  it("throws promise when status is loading (suspends)", async () => {
    const gate = deferred();
    const { system, statusPlugin } = createSystemWithStatus(
      async (_req, context) => {
        await gate.promise;
        context.facts.ready = true;
      },
    );
    system.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(statusPlugin.getStatus("LOAD_DATA").isLoading).toBe(true);

    // Render a component that uses useSuspenseRequirement inside a Suspense boundary
    function Inner() {
      const status = useSuspenseRequirement(statusPlugin, "LOAD_DATA");

      return <div data-testid="status">{String(status.isLoading)}</div>;
    }

    render(
      <Suspense fallback={<div data-testid="fallback">loading</div>}>
        <Inner />
      </Suspense>,
    );

    // Should show fallback because the hook throws a promise (suspends)
    expect(screen.getByTestId("fallback")).toBeDefined();
    expect(screen.getByTestId("fallback").textContent).toBe("loading");

    // Resolve and let the suspense boundary re-render
    await act(async () => {
      gate.resolve();
      await system.settle();
      // Give React time to re-render after suspense resolves
      await new Promise((r) => setTimeout(r, 100));
    });

    // After resolution, should show the actual status
    expect(screen.getByTestId("status").textContent).toBe("false");

    system.destroy();
  });

  it("returns status when not loading", async () => {
    const { system, statusPlugin } = createSystemWithStatus();
    system.start();
    await system.settle();

    // After settlement, LOAD_DATA should not be loading
    const { result } = renderHook(() =>
      useSuspenseRequirement(statusPlugin, "LOAD_DATA"),
    );

    expect(result.current).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasError).toBe(false);

    system.destroy();
  });

  it("throws error when status has error", async () => {
    const testError = new Error("resolver failed");

    // Create a system where the constraint won't re-trigger after error:
    // use a flag that the resolver sets before throwing so the constraint
    // won't produce a new requirement on next evaluation.
    const statusPlugin = createRequirementStatusPlugin();
    const mod = createModule("err-test", {
      schema: {
        facts: { ready: t.boolean(), attempted: t.boolean() },
        requirements: { LOAD_DATA: {} },
      },
      init: (facts) => {
        facts.ready = false;
        facts.attempted = false;
      },
      constraints: {
        needsData: {
          when: (facts) => !facts.ready && !facts.attempted,
          require: { type: "LOAD_DATA" },
        },
      },
      resolvers: {
        loadData: {
          requirement: "LOAD_DATA",
          resolve: async (_req, context) => {
            context.facts.attempted = true;
            throw testError;
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
    const system = createSystem({
      module: mod,
      plugins: [statusPlugin.plugin as Plugin<any>],
    });
    system.start();
    await system.settle().catch(() => {});
    // Wait for error to propagate through plugin
    await new Promise((r) => setTimeout(r, 100));

    expect(statusPlugin.getStatus("LOAD_DATA").hasError).toBe(true);

    let caughtError: Error | null = null;

    class ErrorCatcher extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean }
    > {
      constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
      }

      static getDerivedStateFromError(error: Error) {
        caughtError = error;

        return { hasError: true };
      }

      render() {
        if (this.state.hasError) {
          return <div data-testid="error">error caught</div>;
        }

        return this.props.children;
      }
    }

    function Inner() {
      const status = useSuspenseRequirement(statusPlugin, "LOAD_DATA");

      return <div>{String(status.isLoading)}</div>;
    }

    render(
      <ErrorCatcher>
        <Inner />
      </ErrorCatcher>,
    );

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toBe("resolver failed");

    system.destroy();
  });

  it("multi type: throws when any type is loading (suspends)", async () => {
    const gateA = deferred();
    const gateB = deferred();
    const { system, statusPlugin } = createMultiTypeSystem(
      async (_req, context) => {
        await gateA.promise;
        context.facts.a = true;
      },
      async (_req, context) => {
        await gateB.promise;
        context.facts.b = true;
      },
    );
    system.start();
    await new Promise((r) => setTimeout(r, 50));

    function Inner() {
      useSuspenseRequirement(statusPlugin, [
        "LOAD_A",
        "LOAD_B",
      ]);

      return <div data-testid="resolved">done</div>;
    }

    render(
      <Suspense fallback={<div data-testid="fallback">loading</div>}>
        <Inner />
      </Suspense>,
    );

    // Should show fallback because at least one type is loading
    expect(screen.getByTestId("fallback")).toBeDefined();

    await act(async () => {
      gateA.resolve();
      gateB.resolve();
      await system.settle();
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.getByTestId("resolved").textContent).toBe("done");

    system.destroy();
  });

  it("multi type: throws first error found", async () => {
    const errorA = new Error("A failed");

    // Create a system where the failing constraint won't re-trigger
    const statusPlugin = createRequirementStatusPlugin();
    const mod = createModule("multi-err", {
      schema: {
        facts: {
          a: t.boolean(),
          b: t.boolean(),
          attemptedA: t.boolean(),
        },
        requirements: { LOAD_A: {}, LOAD_B: {} },
      },
      init: (facts) => {
        facts.a = false;
        facts.b = false;
        facts.attemptedA = false;
      },
      constraints: {
        needsA: {
          when: (facts) => !facts.a && !facts.attemptedA,
          require: { type: "LOAD_A" },
        },
        needsB: {
          when: (facts) => !facts.b,
          require: { type: "LOAD_B" },
        },
      },
      resolvers: {
        loadA: {
          requirement: "LOAD_A",
          resolve: async (_req, context) => {
            context.facts.attemptedA = true;
            throw errorA;
          },
        },
        loadB: {
          requirement: "LOAD_B",
          resolve: async (_req, context) => {
            context.facts.b = true;
          },
        },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: Plugin generic variance
    const system = createSystem({
      module: mod,
      plugins: [statusPlugin.plugin as Plugin<any>],
    });
    system.start();
    await system.settle().catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    expect(statusPlugin.getStatus("LOAD_A").hasError).toBe(true);

    let caughtError: Error | null = null;

    class ErrorCatcher extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean }
    > {
      constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
      }

      static getDerivedStateFromError(error: Error) {
        caughtError = error;

        return { hasError: true };
      }

      render() {
        if (this.state.hasError) {
          return <div>error</div>;
        }

        return this.props.children;
      }
    }

    function Inner() {
      useSuspenseRequirement(statusPlugin, ["LOAD_A", "LOAD_B"]);

      return <div>ok</div>;
    }

    render(
      <ErrorCatcher>
        <Inner />
      </ErrorCatcher>,
    );

    expect(caughtError).toBeInstanceOf(Error);
    expect(caughtError!.message).toBe("A failed");

    system.destroy();
  });
});

// ============================================================================
// useOptimisticUpdate
// ============================================================================

describe("useOptimisticUpdate", () => {
  it("returns mutate, isPending, error, rollback", () => {
    const { system, statusPlugin } = createSystemWithStatus();
    system.start();

    const { result } = renderHook(() =>
      useOptimisticUpdate(system, statusPlugin, "LOAD_DATA"),
    );

    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
    expect(result.current).toHaveProperty("error");
    expect(result.current).toHaveProperty("rollback");
    expect(typeof result.current.mutate).toBe("function");
    expect(typeof result.current.rollback).toBe("function");

    system.destroy();
  });

  it("mutate applies optimistic update immediately", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    const { result } = renderHook(() => useOptimisticUpdate(system));

    await act(async () => {
      result.current.mutate(() => {
        system.facts.count = 42;
      });
    });

    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  it("isPending is true after mutate", async () => {
    const gate = deferred();
    const { system, statusPlugin } = createSystemWithStatus(
      async (_req, context) => {
        await gate.promise;
        context.facts.ready = true;
      },
    );
    system.start();
    await new Promise((r) => setTimeout(r, 50));

    const { result } = renderHook(() =>
      useOptimisticUpdate(system, statusPlugin, "LOAD_DATA"),
    );

    await act(async () => {
      result.current.mutate(() => {
        system.facts.count = 99;
      });
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      gate.resolve();
      await system.settle();
    });

    system.destroy();
  });

  it("rollback restores previous state", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    const { result } = renderHook(() => useOptimisticUpdate(system));

    const originalCount = system.facts.count;

    await act(async () => {
      result.current.mutate(() => {
        system.facts.count = 999;
      });
    });

    expect(system.facts.count).toBe(999);

    await act(async () => {
      result.current.rollback();
    });

    expect(system.facts.count).toBe(originalCount);

    system.destroy();
  });

  it("mutate runs updateFn in system.batch", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    const batchSpy = vi.spyOn(system, "batch");

    const { result } = renderHook(() => useOptimisticUpdate(system));

    const updateFn = () => {
      system.facts.count = 10;
    };

    await act(async () => {
      result.current.mutate(updateFn);
    });

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy).toHaveBeenCalledWith(updateFn);

    batchSpy.mockRestore();
    system.destroy();
  });

  it("error is null initially", () => {
    const { system, statusPlugin } = createSystemWithStatus();
    system.start();

    const { result } = renderHook(() =>
      useOptimisticUpdate(system, statusPlugin, "LOAD_DATA"),
    );

    expect(result.current.error).toBeNull();

    system.destroy();
  });

  it("manual rollback works even without status plugin", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    // No statusPlugin or requirementType — purely manual optimistic update
    const { result } = renderHook(() => useOptimisticUpdate(system));

    const originalCount = system.facts.count;

    await act(async () => {
      result.current.mutate(() => {
        system.facts.count = 500;
      });
    });

    expect(system.facts.count).toBe(500);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      result.current.rollback();
    });

    expect(system.facts.count).toBe(originalCount);
    expect(result.current.isPending).toBe(false);

    system.destroy();
  });

  it("rollback resets isPending and error", async () => {
    const { system } = createSystemWithStatus();
    system.start();
    await system.settle();

    const { result } = renderHook(() => useOptimisticUpdate(system));

    await act(async () => {
      result.current.mutate(() => {
        system.facts.count = 123;
      });
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      result.current.rollback();
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();

    system.destroy();
  });
});
