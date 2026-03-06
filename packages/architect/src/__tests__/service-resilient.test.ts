import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireServiceHooks, executeWithRetry, type ResilientHookConfig } from "../service.js";
import type { ArchitectAnalysis, ArchitectAction, AuditEntry } from "../types.js";

describe("resilient service hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // executeWithRetry
  // ===========================================================================

  describe("executeWithRetry", () => {
    it("succeeds on first attempt", async () => {
      const handler = vi.fn();
      const config: ResilientHookConfig<string> = { handler };

      await executeWithRetry("payload", config);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("payload");
    });

    it("retries with exponential backoff", async () => {
      let attempts = 0;
      const handler = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Fail #${attempts}`);
        }
      });

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 3, baseDelayMs: 100, jitter: 0 },
      };

      const promise = executeWithRetry("test", config);

      // First attempt fails immediately
      expect(handler).toHaveBeenCalledTimes(1);

      // Advance past first retry delay (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(100);
      expect(handler).toHaveBeenCalledTimes(2);

      // Advance past second retry delay (100ms * 2^1 = 200ms)
      await vi.advanceTimersByTimeAsync(200);
      expect(handler).toHaveBeenCalledTimes(3);

      await promise;
    });

    it("calls dead letter after exhausting all attempts", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("always fails"));
      const deadLetter = vi.fn();

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 2, baseDelayMs: 50, jitter: 0 },
        onDeadLetter: deadLetter,
      };

      const promise = executeWithRetry("dead", config);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(50);
      await promise;

      expect(handler).toHaveBeenCalledTimes(2);
      expect(deadLetter).toHaveBeenCalledTimes(1);
      expect(deadLetter).toHaveBeenCalledWith("dead", expect.any(Error), 2);
    });

    it("filter prevents delivery", async () => {
      const handler = vi.fn();

      const config: ResilientHookConfig<number> = {
        handler,
        filter: (n) => n > 10,
      };

      // Filter blocks — but executeWithRetry doesn't check filter directly
      // Filter is applied in wrapHook. executeWithRetry always calls handler.
      await executeWithRetry(5, config);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("timeout aborts slow handlers", async () => {
      const handler = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60_000)),
      );
      const deadLetter = vi.fn();

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 1, jitter: 0 },
        timeoutMs: 100,
        onDeadLetter: deadLetter,
      };

      const promise = executeWithRetry("slow", config);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(150);
      await promise;

      expect(deadLetter).toHaveBeenCalledTimes(1);
      expect(deadLetter.mock.calls[0]![1].message).toContain("timed out");
    });

    it("dead letter error does not crash", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("fail"));
      const deadLetter = vi.fn().mockImplementation(() => {
        throw new Error("dead letter also fails");
      });

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 1, jitter: 0 },
        onDeadLetter: deadLetter,
      };

      // Should not throw
      await executeWithRetry("test", config);

      expect(deadLetter).toHaveBeenCalledTimes(1);
    });

    it("uses fixed strategy when configured", async () => {
      let callCount = 0;
      const handler = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error("fail");
        }
      });

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 3, baseDelayMs: 100, strategy: "fixed", jitter: 0 },
      };

      const promise = executeWithRetry("test", config);

      // Fixed: every retry uses baseDelayMs
      await vi.advanceTimersByTimeAsync(100);
      expect(handler).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(100);
      expect(handler).toHaveBeenCalledTimes(3);

      await promise;
    });

    it("uses linear strategy when configured", async () => {
      let callCount = 0;
      const handler = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error("fail");
        }
      });

      const config: ResilientHookConfig<string> = {
        handler,
        retry: { maxAttempts: 3, baseDelayMs: 100, strategy: "linear", jitter: 0 },
      };

      const promise = executeWithRetry("test", config);

      // Linear: attempt 1 delay = 100ms * 1 = 100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(handler).toHaveBeenCalledTimes(2);

      // Linear: attempt 2 delay = 100ms * 2 = 200ms
      await vi.advanceTimersByTimeAsync(200);
      expect(handler).toHaveBeenCalledTimes(3);

      await promise;
    });

    it("respects maxDelayMs cap", async () => {
      let callCount = 0;
      const handler = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new Error("fail");
        }
      });

      const config: ResilientHookConfig<string> = {
        handler,
        retry: {
          maxAttempts: 3,
          baseDelayMs: 1000,
          maxDelayMs: 500,
          strategy: "exponential",
          jitter: 0,
        },
      };

      const promise = executeWithRetry("test", config);

      // Even though exponential would compute 1000ms, it's capped at 500ms
      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(3);

      await promise;
    });
  });

  // ===========================================================================
  // wireServiceHooks — backward compatibility
  // ===========================================================================

  describe("wireServiceHooks backward compat", () => {
    it("raw function hooks work unchanged", () => {
      const analysisHandler = vi.fn();
      const actionHandler = vi.fn();

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: {
          onAnalysis: analysisHandler,
          onAction: actionHandler,
        },
        subscribe,
      });

      // Simulate events
      const analysisEvent = { analysis: { trigger: "demand", actions: [] } };
      handlers.get("analysis-complete")!(analysisEvent);

      expect(analysisHandler).toHaveBeenCalledTimes(1);

      const actionEvent = { action: { id: "test", tool: "observe_system" } };
      handlers.get("applied")!(actionEvent);

      expect(actionHandler).toHaveBeenCalledTimes(1);
    });

    it("raw function errors are swallowed", () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error("hook crash");
      });

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, h: (...args: unknown[]) => void) => {
        handlers.set(event, h);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: { onAnalysis: handler },
        subscribe,
      });

      // Should not throw
      expect(() => handlers.get("analysis-complete")!({ analysis: {} })).not.toThrow();
    });
  });

  // ===========================================================================
  // wireServiceHooks — resilient hooks
  // ===========================================================================

  describe("wireServiceHooks resilient hooks", () => {
    it("resilient hook with filter prevents delivery", async () => {
      const handler = vi.fn();

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, h: (...args: unknown[]) => void) => {
        handlers.set(event, h);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: {
          onAnalysis: {
            handler,
            filter: (analysis) => analysis.trigger === "error",
          },
        },
        subscribe,
      });

      // Trigger with non-matching filter
      handlers.get("analysis-complete")!({
        analysis: { trigger: "demand" },
      });

      // Give async processing time
      await vi.advanceTimersByTimeAsync(10);

      expect(handler).not.toHaveBeenCalled();
    });

    it("resilient hook with filter allows matching payloads", async () => {
      const handler = vi.fn();

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, h: (...args: unknown[]) => void) => {
        handlers.set(event, h);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: {
          onAnalysis: {
            handler,
            filter: (analysis) => analysis.trigger === "error",
          },
        },
        subscribe,
      });

      // Trigger with matching filter
      handlers.get("analysis-complete")!({
        analysis: { trigger: "error" },
      });

      await vi.advanceTimersByTimeAsync(10);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("mixed raw + resilient hooks work together", async () => {
      const rawHandler = vi.fn();
      const resilientHandler = vi.fn();

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, h: (...args: unknown[]) => void) => {
        handlers.set(event, h);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: {
          onAnalysis: rawHandler,
          onAction: {
            handler: resilientHandler,
            retry: { maxAttempts: 2 },
          },
        },
        subscribe,
      });

      handlers.get("analysis-complete")!({ analysis: { trigger: "demand" } });
      handlers.get("applied")!({ action: { id: "a1", tool: "observe_system" } });

      await vi.advanceTimersByTimeAsync(10);

      expect(rawHandler).toHaveBeenCalledTimes(1);
      expect(resilientHandler).toHaveBeenCalledTimes(1);
    });

    it("resilient hooks retry on failure", async () => {
      let callCount = 0;
      const handler = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new Error("transient failure");
        }
      });

      const handlers = new Map<string, (...args: unknown[]) => void>();
      const subscribe = (event: string, h: (...args: unknown[]) => void) => {
        handlers.set(event, h);

        return () => handlers.delete(event);
      };

      wireServiceHooks({
        hooks: {
          onError: {
            handler,
            retry: { maxAttempts: 3, baseDelayMs: 50, jitter: 0 },
          },
        },
        subscribe,
      });

      handlers.get("error")!({ error: new Error("system error") });

      // Advance past retry
      await vi.advanceTimersByTimeAsync(100);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });
});
