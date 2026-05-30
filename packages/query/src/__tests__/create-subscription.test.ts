// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createSubscription, withQueries } from "../index.js";
import type { ResourceState } from "../index.js";

// ============================================================================
// Helpers
// ============================================================================

function flushMicrotasks(rounds = 10): Promise<void> {
  return Array.from({ length: rounds }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );
}

// ============================================================================
// createSubscription
// ============================================================================

describe("createSubscription", () => {
  describe("basic subscription", () => {
    it("returns a SubscriptionDefinition with all fragments", () => {
      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: () => {},
      });

      expect(sub.name).toBe("price");
      expect(sub.schema.facts).toBeDefined();
      expect(sub.schema.derivations).toBeDefined();
      expect(sub.effects).toBeDefined();
      expect(sub.setData).toBeTypeOf("function");
    });

    it("starts in pending state", () => {
      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: () => {},
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      const state = system.read("price") as ResourceState<unknown>;
      expect(state.status).toBe("pending");
      expect(state.isPending).toBe(true);
    });

    it("calls subscribe when key is non-null", async () => {
      const subscribeFn = vi.fn();
      const sub = createSubscription({
        name: "price",
        key: (facts) => {
          const ticker = facts.ticker as string;
          if (!ticker) {
            return null;
          }

          return { ticker };
        },
        subscribe: subscribeFn,
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: { ticker: t.string() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
          init: (facts) => {
            facts.ticker = "";
          },
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      // No ticker — subscribe not called
      await flushMicrotasks();
      expect(subscribeFn).not.toHaveBeenCalled();

      // Set ticker — subscribe fires
      system.facts.ticker = "AAPL";
      await flushMicrotasks(20);

      expect(subscribeFn).toHaveBeenCalledTimes(1);
      expect(subscribeFn).toHaveBeenCalledWith(
        { ticker: "AAPL" },
        expect.objectContaining({
          onData: expect.any(Function),
          onError: expect.any(Function),
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("updates ResourceState when onData is called", async () => {
      let capturedCallbacks: { onData: (data: unknown) => void } | null = null;

      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: (_params, callbacks) => {
          capturedCallbacks = callbacks;
        },
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks(20);

      expect(capturedCallbacks).not.toBeNull();

      // Push data
      capturedCallbacks!.onData({ price: 150.25, ticker: "AAPL" });
      await flushMicrotasks();

      const state = system.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      expect(state.status).toBe("success");
      expect(state.data).toEqual({ price: 150.25, ticker: "AAPL" });
      expect(state.isSuccess).toBe(true);
      expect(state.dataUpdatedAt).toBeGreaterThan(0);
    });

    it("updates ResourceState when onError is called", async () => {
      let capturedCallbacks: { onError: (error: Error) => void } | null = null;

      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: (_params, callbacks) => {
          capturedCallbacks = callbacks;
        },
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks(20);

      capturedCallbacks!.onError(new Error("Connection lost"));
      await flushMicrotasks();

      const state = system.read("price") as ResourceState<unknown>;
      expect(state.status).toBe("error");
      expect(state.isError).toBe(true);
      expect((state.error as Error).message).toBe("Connection lost");
      expect(state.failureCount).toBe(1);
    });

    // Note: Multiple rapid onData calls within the same reconcile cycle
    // may batch. The subscription pattern works correctly in real usage
    // where push events arrive over time (WebSocket messages, SSE events).

    it("sets isComplete and stops fetching when onComplete is called", async () => {
      let capturedCallbacks: {
        onData: (data: unknown) => void;
        onComplete?: () => void;
      } | null = null;

      const sub = createSubscription({
        name: "price",
        // Realistic key shape: derive from facts so the effect picks up the
        // ticker as a tracked dep instead of falling through to the
        // "no-deps means run on any change" auto-track fallback.
        key: (facts) => {
          const ticker = facts.ticker as string | null;
          return ticker ? { ticker } : null;
        },
        subscribe: (_params, callbacks) => {
          capturedCallbacks = callbacks;
        },
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: { ticker: t.string<string | null>() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      system.facts.ticker = "AAPL";
      await flushMicrotasks(20);

      expect(capturedCallbacks).not.toBeNull();

      // Stream a chunk
      capturedCallbacks!.onData({ price: 150.25, ticker: "AAPL" });
      await flushMicrotasks();

      let state = system.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      expect(state.isSuccess).toBe(true);
      expect(state.isComplete).toBe(false);

      // Stream ends
      capturedCallbacks!.onComplete?.();
      await flushMicrotasks();

      state = system.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      // Final data preserved
      expect(state.data).toEqual({ price: 150.25, ticker: "AAPL" });
      // Status stays success; isComplete is the terminal signal
      expect(state.status).toBe("success");
      expect(state.isComplete).toBe(true);
      expect(state.isFetching).toBe(false);
      expect(state.isPending).toBe(false);
    });

    it("re-keying to null clears prev tracking and resets state to idle", async () => {
      const cleanup = vi.fn();
      let capturedCallbacks: { onData: (data: unknown) => void } | null = null;

      const sub = createSubscription({
        name: "price",
        key: (f) => {
          const ticker = f.ticker as string;
          return ticker ? { ticker } : null;
        },
        subscribe: (_params, callbacks) => {
          capturedCallbacks = callbacks;
          return cleanup;
        },
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: { ticker: t.string() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      system.facts.ticker = "AAPL";
      await flushMicrotasks(20);

      expect(capturedCallbacks).not.toBeNull();
      capturedCallbacks!.onData({ price: 1 });
      await flushMicrotasks();

      // Clear the trigger fact — key goes to null (empty string treated as "no key")
      system.facts.ticker = "";
      await flushMicrotasks(20);

      const idleState = system.read("price") as ResourceState<{
        price: number;
      }>;
      // Subscription cleanup fired and state reverted to idle
      expect(cleanup).toHaveBeenCalled();
      expect(idleState.isSuccess).toBe(false);
      expect(idleState.isComplete).toBe(false);
      expect(idleState.data).toBeNull();

      // Re-key to the same value as before establishes a fresh subscription
      // (prev-key bookkeeping was cleared so the early-return on equal-key
      // does NOT fire).
      capturedCallbacks = null;
      cleanup.mockClear();
      system.facts.ticker = "AAPL";
      await flushMicrotasks(20);
      expect(capturedCallbacks).not.toBeNull();
    });

    it("isComplete defaults to false in the idle state", async () => {
      const sub = createSubscription({
        name: "price",
        key: () => null,
        subscribe: () => undefined,
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks();

      const state = system.read("price") as ResourceState<unknown>;
      expect(state.isComplete).toBe(false);
    });

    it("calls cleanup when system is destroyed", async () => {
      const cleanup = vi.fn();
      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: () => cleanup,
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await flushMicrotasks(20);

      system.destroy();
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe("setData", () => {
    it("sets data directly on the subscription state", () => {
      const sub = createSubscription({
        name: "price",
        key: () => ({ ticker: "AAPL" }),
        subscribe: () => {},
      });
      const mod = createModule(
        "test",
        withQueries([sub], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      sub.setData(system.facts, { price: 100, ticker: "AAPL" });

      const state = system.read("price") as ResourceState<{
        price: number;
        ticker: string;
      }>;
      expect(state.data).toEqual({ price: 100, ticker: "AAPL" });
      expect(state.isSuccess).toBe(true);
    });
  });
});
