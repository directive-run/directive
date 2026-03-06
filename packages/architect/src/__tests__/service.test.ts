import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wireServiceHooks } from "../service.js";
import type { AuditEntry } from "../types.js";

describe("wireServiceHooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("wires analysis events", () => {
    const onAnalysis = vi.fn();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {
        delete handlers[event];
      };
    });

    wireServiceHooks({
      hooks: { onAnalysis },
      subscribe,
    });

    expect(subscribe).toHaveBeenCalledWith("analysis-complete", expect.any(Function));

    // Simulate event (ArchitectEvent shape: { type, timestamp, analysis })
    handlers["analysis-complete"]!({ type: "analysis-complete", timestamp: Date.now(), analysis: { trigger: "demand", actions: [], tokensUsed: 50 } });

    expect(onAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "demand" }),
    );
  });

  it("wires action events", () => {
    const onAction = vi.fn();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {
        delete handlers[event];
      };
    });

    wireServiceHooks({
      hooks: { onAction },
      subscribe,
    });

    handlers["applied"]!({ type: "applied", timestamp: Date.now(), action: { id: "act-1", tool: "create_constraint" } });

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "act-1" }),
    );
  });

  it("wires error events", () => {
    const onError = vi.fn();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {
        delete handlers[event];
      };
    });

    wireServiceHooks({
      hooks: { onError },
      subscribe,
    });

    const error = new Error("test error");
    handlers["error"]!({ type: "error", timestamp: Date.now(), error });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("wires kill events", () => {
    const onKill = vi.fn();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {
        delete handlers[event];
      };
    });

    wireServiceHooks({
      hooks: { onKill },
      subscribe,
    });

    handlers["killed"]!({ type: "killed", timestamp: Date.now(), killResult: { killed: true, reason: "emergency" } });

    expect(onKill).toHaveBeenCalledWith(
      expect.objectContaining({ killed: true }),
    );
  });

  it("polls audit log for new entries", () => {
    const onAudit = vi.fn();
    const entries: AuditEntry[] = [];

    wireServiceHooks({
      hooks: { onAudit },
      subscribe: vi.fn(() => () => {}),
      getAuditLog: () => entries,
      auditPollInterval: 1000,
    });

    // Add entries after wiring
    entries.push({
      id: "entry-1",
      timestamp: Date.now(),
      type: "action-applied",
      hash: "abc",
    } as AuditEntry);

    vi.advanceTimersByTime(1000);

    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "entry-1" }),
    );
  });

  it("does not re-emit already seen audit entries", () => {
    const onAudit = vi.fn();
    const entries: AuditEntry[] = [
      {
        id: "entry-0",
        timestamp: Date.now(),
        type: "action-applied",
        hash: "pre",
      } as AuditEntry,
    ];

    wireServiceHooks({
      hooks: { onAudit },
      subscribe: vi.fn(() => () => {}),
      getAuditLog: () => entries,
      auditPollInterval: 1000,
    });

    // Advance — no new entries
    vi.advanceTimersByTime(1000);

    expect(onAudit).not.toHaveBeenCalled();

    // Now add one
    entries.push({
      id: "entry-1",
      timestamp: Date.now(),
      type: "action-applied",
      hash: "new",
    } as AuditEntry);

    vi.advanceTimersByTime(1000);

    expect(onAudit).toHaveBeenCalledTimes(1);
  });

  it("cleans up all subscriptions on unsubscribe", () => {
    const unsubs: Array<() => void> = [];

    const subscribe = vi.fn((_event: string, _handler: (...args: unknown[]) => void) => {
      const unsub = vi.fn();
      unsubs.push(unsub);

      return unsub;
    });

    const cleanup = wireServiceHooks({
      hooks: {
        onAnalysis: vi.fn(),
        onAction: vi.fn(),
        onError: vi.fn(),
      },
      subscribe,
    });

    expect(unsubs).toHaveLength(3);

    cleanup();

    for (const unsub of unsubs) {
      expect(unsub).toHaveBeenCalled();
    }
  });

  it("clears audit timer on cleanup", () => {
    const entries: AuditEntry[] = [];
    const onAudit = vi.fn();

    const cleanup = wireServiceHooks({
      hooks: { onAudit },
      subscribe: vi.fn(() => () => {}),
      getAuditLog: () => entries,
      auditPollInterval: 1000,
    });

    cleanup();

    // Add entries after cleanup
    entries.push({
      id: "entry-1",
      timestamp: Date.now(),
      type: "action-applied",
      hash: "late",
    } as AuditEntry);

    vi.advanceTimersByTime(5000);

    expect(onAudit).not.toHaveBeenCalled();
  });

  it("swallows sync errors from hooks", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {};
    });

    wireServiceHooks({
      hooks: {
        onAnalysis: () => {
          throw new Error("hook crash");
        },
      },
      subscribe,
    });

    // Should not throw
    expect(() => handlers["analysis-complete"]!({ type: "analysis-complete", analysis: { trigger: "demand" } })).not.toThrow();
  });

  it("swallows async errors from hooks", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {};
    });

    wireServiceHooks({
      hooks: {
        onAnalysis: async () => {
          throw new Error("async hook crash");
        },
      },
      subscribe,
    });

    // Should not throw
    expect(() => handlers["analysis-complete"]!({ type: "analysis-complete", analysis: { trigger: "demand" } })).not.toThrow();
  });

  it("only subscribes to hooks that are provided", () => {
    const subscribe = vi.fn(() => () => {});

    wireServiceHooks({
      hooks: { onError: vi.fn() },
      subscribe,
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("extracts fields from ArchitectEvent shape", () => {
    const onAnalysis = vi.fn();
    const onAction = vi.fn();
    const onKill = vi.fn();
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const subscribe = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;

      return () => {};
    });

    wireServiceHooks({
      hooks: { onAnalysis, onAction, onKill },
      subscribe,
    });

    // Pass ArchitectEvent objects — hooks should extract the relevant field
    handlers["analysis-complete"]!({ type: "analysis-complete", timestamp: 1, analysis: { trigger: "demand", actions: [] } });
    expect(onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ trigger: "demand" }));

    handlers["applied"]!({ type: "applied", timestamp: 1, action: { id: "a1", tool: "observe_system" } });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));

    handlers["killed"]!({ type: "killed", timestamp: 1, killResult: { removed: 0 } });
    expect(onKill).toHaveBeenCalledWith(expect.objectContaining({ removed: 0 }));
  });
});
