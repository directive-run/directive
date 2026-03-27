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
