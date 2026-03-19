import { describe, expect, it, vi } from "vitest";
import { loggingPlugin } from "../logging.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
  };
}

function mockRequirement(id = "req-1", type = "FETCH") {
  return { id, requirement: { type } };
}

function mockReconcileResult(
  overrides: Partial<{
    unmet: unknown[];
    inflight: unknown[];
    completed: unknown[];
    canceled: unknown[];
  }> = {},
) {
  return {
    unmet: [],
    inflight: [],
    completed: [],
    canceled: [],
    ...overrides,
  };
}

function mockSnapshot(id = 1, trigger = "manual") {
  return { id, timestamp: Date.now(), facts: {}, trigger };
}

function mockDirectiveError(
  source = "resolver" as const,
  sourceId = "myResolver",
  message = "something broke",
) {
  return { source, sourceId, message };
}

// ============================================================================
// Plugin Identity
// ============================================================================

describe("loggingPlugin", () => {
  it("returns a plugin named 'logging'", () => {
    const plugin = loggingPlugin();

    expect(plugin.name).toBe("logging");
  });

  // ============================================================================
  // Default Behavior
  // ============================================================================

  describe("default behavior", () => {
    it("logs at info level with [Directive] prefix using console", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger });

      plugin.onStart!({} as never);

      expect(logger.info).toHaveBeenCalledWith("[Directive] start");
    });

    it("suppresses debug-level events at default info level", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger });

      plugin.onInit!();

      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Level Filtering
  // ============================================================================

  describe("level filtering", () => {
    it("level=debug logs debug events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onInit!();

      expect(logger.debug).toHaveBeenCalledWith("[Directive] init");
    });

    it("level=debug logs info events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onStart!({} as never);

      expect(logger.info).toHaveBeenCalledWith("[Directive] start");
    });

    it("level=debug logs warn events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onResolverRetry!("r1", mockRequirement() as never, 2);

      expect(logger.warn).toHaveBeenCalled();
    });

    it("level=debug logs error events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onError!(mockDirectiveError() as never);

      expect(logger.error).toHaveBeenCalled();
    });

    it("level=info suppresses debug events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "info" });

      plugin.onInit!();
      plugin.onFactSet!("key", "val", undefined);
      plugin.onDerivationCompute!("d1", 42, ["key"]);

      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("level=info allows info, warn, and error events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "info" });

      plugin.onStart!({} as never);
      plugin.onResolverRetry!("r1", mockRequirement() as never, 2);
      plugin.onError!(mockDirectiveError() as never);

      expect(logger.info).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("level=warn suppresses debug and info events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "warn" });

      plugin.onInit!();
      plugin.onStart!({} as never);
      plugin.onRequirementMet!(mockRequirement() as never, "resolver-1");

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("level=warn allows warn and error events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "warn" });

      plugin.onResolverRetry!("r1", mockRequirement() as never, 2);
      plugin.onConstraintError!("c1", new Error("bad"));

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("level=error suppresses debug, info, and warn events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "error" });

      plugin.onInit!();
      plugin.onStart!({} as never);
      plugin.onResolverRetry!("r1", mockRequirement() as never, 2);

      expect(logger.debug).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("level=error allows error events", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "error" });

      plugin.onError!(mockDirectiveError() as never);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Custom Filter
  // ============================================================================

  describe("custom filter", () => {
    it("receives event name and suppresses when returning false", () => {
      const logger = createMockLogger();
      const filter = vi.fn().mockReturnValue(false);
      const plugin = loggingPlugin({ logger, level: "debug", filter });

      plugin.onInit!();

      expect(filter).toHaveBeenCalledWith("init");
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("allows events when returning true", () => {
      const logger = createMockLogger();
      const filter = vi.fn().mockReturnValue(true);
      const plugin = loggingPlugin({ logger, level: "debug", filter });

      plugin.onInit!();

      expect(filter).toHaveBeenCalledWith("init");
      expect(logger.debug).toHaveBeenCalled();
    });

    it("receives dotted event names for fact hooks", () => {
      const logger = createMockLogger();
      const filter = vi.fn().mockReturnValue(true);
      const plugin = loggingPlugin({ logger, level: "debug", filter });

      plugin.onFactSet!("key", "val", undefined);

      expect(filter).toHaveBeenCalledWith("fact.set");
    });
  });

  // ============================================================================
  // Custom Logger
  // ============================================================================

  describe("custom logger", () => {
    it("calls the custom logger instead of console", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onInit!();
      plugin.onStart!({} as never);
      plugin.onResolverRetry!("r1", mockRequirement() as never, 2);
      plugin.onError!(mockDirectiveError() as never);

      expect(logger.debug).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Custom Prefix
  // ============================================================================

  describe("custom prefix", () => {
    it("prepends custom prefix to log messages", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, prefix: "[MyApp]" });

      plugin.onStart!({} as never);

      expect(logger.info).toHaveBeenCalledWith("[MyApp] start");
    });

    it("uses [Directive] prefix by default", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger });

      plugin.onStop!({} as never);

      expect(logger.info).toHaveBeenCalledWith("[Directive] stop");
    });
  });

  // ============================================================================
  // Hook → Level Mapping
  // ============================================================================

  describe("hook level mapping", () => {
    describe("debug-level hooks", () => {
      it("onInit logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onInit!();

        expect(logger.debug).toHaveBeenCalledWith("[Directive] init");
      });

      it("onDestroy logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onDestroy!({} as never);

        expect(logger.debug).toHaveBeenCalledWith("[Directive] destroy");
      });

      it("onFactSet logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onFactSet!("status", "active", "idle");

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] fact.set",
          { key: "status", value: "active", prev: "idle" },
        );
      });

      it("onFactDelete logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onFactDelete!("status", "active");

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] fact.delete",
          { key: "status", prev: "active" },
        );
      });

      it("onFactsBatch logs at debug with count", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });
        const changes = [
          { key: "a", value: 1, prev: undefined },
          { key: "b", value: 2, prev: undefined },
        ];

        plugin.onFactsBatch!(changes as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] facts.batch",
          { count: 2, changes },
        );
      });

      it("onDerivationCompute logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onDerivationCompute!("isReady", true, ["status"]);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] derivation.compute",
          { id: "isReady", value: true, deps: ["status"] },
        );
      });

      it("onDerivationInvalidate logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onDerivationInvalidate!("isReady");

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] derivation.invalidate",
          { id: "isReady" },
        );
      });

      it("onReconcileStart logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onReconcileStart!({} as never);

        expect(logger.debug).toHaveBeenCalledWith("[Directive] reconcile.start");
      });

      it("onReconcileEnd logs at debug with counts", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });
        const result = mockReconcileResult({
          unmet: [{ id: "r1" }],
          completed: [{ id: "r2", resolverId: "res1", duration: 100 }],
        });

        plugin.onReconcileEnd!(result as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] reconcile.end",
          { unmet: 1, inflight: 0, completed: 1, canceled: 0 },
        );
      });

      it("onConstraintEvaluate logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onConstraintEvaluate!("mustAuth", true);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] constraint.evaluate",
          { id: "mustAuth", active: true },
        );
      });

      it("onRequirementCreated logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });
        const req = mockRequirement("req-42", "AUTH");

        plugin.onRequirementCreated!(req as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] requirement.created",
          { id: "req-42", type: "AUTH" },
        );
      });

      it("onRequirementCanceled logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onRequirementCanceled!(mockRequirement("req-5") as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] requirement.canceled",
          { id: "req-5" },
        );
      });

      it("onResolverStart logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onResolverStart!("fetchUser", mockRequirement("req-7") as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] resolver.start",
          { resolver: "fetchUser", requirementId: "req-7" },
        );
      });

      it("onResolverCancel logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onResolverCancel!("fetchUser", mockRequirement("req-7") as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] resolver.cancel",
          { resolver: "fetchUser", requirementId: "req-7" },
        );
      });

      it("onEffectRun logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onEffectRun!("syncToStorage");

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] effect.run",
          { id: "syncToStorage" },
        );
      });

      it("onSnapshot logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });
        const snapshot = mockSnapshot(3, "fact.set");

        plugin.onSnapshot!(snapshot as never);

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] timetravel.snapshot",
          { id: 3, trigger: "fact.set" },
        );
      });

      it("onDefinitionCall logs at debug", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger, level: "debug" });

        plugin.onDefinitionCall!("resolver", "fetchUser", { force: true });

        expect(logger.debug).toHaveBeenCalledWith(
          "[Directive] definition.call",
          { type: "resolver", id: "fetchUser", props: { force: true } },
        );
      });
    });

    describe("info-level hooks", () => {
      it("onStart logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onStart!({} as never);

        expect(logger.info).toHaveBeenCalledWith("[Directive] start");
      });

      it("onStop logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onStop!({} as never);

        expect(logger.info).toHaveBeenCalledWith("[Directive] stop");
      });

      it("onRequirementMet logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onRequirementMet!(mockRequirement("req-9") as never, "fetchUser");

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] requirement.met",
          { id: "req-9", byResolver: "fetchUser" },
        );
      });

      it("onResolverComplete logs at info with duration", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onResolverComplete!("fetchUser", mockRequirement("req-9") as never, 150);

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] resolver.complete",
          { resolver: "fetchUser", requirementId: "req-9", duration: 150 },
        );
      });

      it("onHistoryNavigate logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onHistoryNavigate!(2, 5);

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] timetravel.jump",
          { from: 2, to: 5 },
        );
      });

      it("onDefinitionRegister logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onDefinitionRegister!("constraint", "mustAuth", {} as never);

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] definition.register",
          { type: "constraint", id: "mustAuth" },
        );
      });

      it("onDefinitionAssign logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onDefinitionAssign!("resolver", "fetchUser", {} as never, {} as never);

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] definition.assign",
          { type: "resolver", id: "fetchUser" },
        );
      });

      it("onDefinitionUnregister logs at info", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onDefinitionUnregister!("effect", "sync");

        expect(logger.info).toHaveBeenCalledWith(
          "[Directive] definition.unregister",
          { type: "effect", id: "sync" },
        );
      });
    });

    describe("warn-level hooks", () => {
      it("onResolverRetry logs at warn", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });

        plugin.onResolverRetry!("fetchUser", mockRequirement("req-3") as never, 2);

        expect(logger.warn).toHaveBeenCalledWith(
          "[Directive] resolver.retry",
          { resolver: "fetchUser", requirementId: "req-3", attempt: 2 },
        );
      });

      it("onErrorRecovery logs at warn", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });
        const error = mockDirectiveError("constraint", "mustAuth", "eval failed");

        plugin.onErrorRecovery!(error as never, "retry" as never);

        expect(logger.warn).toHaveBeenCalledWith(
          "[Directive] error.recovery",
          { source: "constraint", sourceId: "mustAuth", strategy: "retry" },
        );
      });
    });

    describe("error-level hooks", () => {
      it("onConstraintError logs at error", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });
        const err = new Error("bad constraint");

        plugin.onConstraintError!("mustAuth", err);

        expect(logger.error).toHaveBeenCalledWith(
          "[Directive] constraint.error",
          { id: "mustAuth", error: err },
        );
      });

      it("onResolverError logs at error", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });
        const err = new Error("fetch failed");

        plugin.onResolverError!("fetchUser", mockRequirement("req-3") as never, err);

        expect(logger.error).toHaveBeenCalledWith(
          "[Directive] resolver.error",
          { resolver: "fetchUser", requirementId: "req-3", error: err },
        );
      });

      it("onEffectError logs at error", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });
        const err = new Error("effect boom");

        plugin.onEffectError!("sync", err);

        expect(logger.error).toHaveBeenCalledWith(
          "[Directive] effect.error",
          { id: "sync", error: err },
        );
      });

      it("onError logs at error with source details", () => {
        const logger = createMockLogger();
        const plugin = loggingPlugin({ logger });
        const error = mockDirectiveError("resolver", "fetchUser", "timeout");

        plugin.onError!(error as never);

        expect(logger.error).toHaveBeenCalledWith(
          "[Directive] error",
          { source: "resolver", sourceId: "fetchUser", message: "timeout" },
        );
      });
    });
  });

  // ============================================================================
  // Argument Forwarding
  // ============================================================================

  describe("argument forwarding", () => {
    it("onFactSet forwards key, value, and prev", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onFactSet!("count", 5, 3);

      expect(logger.debug).toHaveBeenCalledWith(
        "[Directive] fact.set",
        { key: "count", value: 5, prev: 3 },
      );
    });

    it("onFactDelete forwards key and prev", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onFactDelete!("token", "abc123");

      expect(logger.debug).toHaveBeenCalledWith(
        "[Directive] fact.delete",
        { key: "token", prev: "abc123" },
      );
    });

    it("onReconcileEnd summarizes array lengths", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });
      const result = mockReconcileResult({
        unmet: [{ id: "r1" }, { id: "r2" }],
        inflight: [{ id: "r3", resolverId: "res1", startedAt: 0 }],
        completed: [],
        canceled: [{ id: "r4", resolverId: "res2" }],
      });

      plugin.onReconcileEnd!(result as never);

      expect(logger.debug).toHaveBeenCalledWith(
        "[Directive] reconcile.end",
        { unmet: 2, inflight: 1, completed: 0, canceled: 1 },
      );
    });

    it("onResolverComplete forwards resolver, requirement id, and duration", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger });

      plugin.onResolverComplete!("fetchUser", mockRequirement("req-10") as never, 42);

      expect(logger.info).toHaveBeenCalledWith(
        "[Directive] resolver.complete",
        { resolver: "fetchUser", requirementId: "req-10", duration: 42 },
      );
    });

    it("onDefinitionCall forwards type, id, and props", () => {
      const logger = createMockLogger();
      const plugin = loggingPlugin({ logger, level: "debug" });

      plugin.onDefinitionCall!("constraint", "mustAuth", { override: true });

      expect(logger.debug).toHaveBeenCalledWith(
        "[Directive] definition.call",
        { type: "constraint", id: "mustAuth", props: { override: true } },
      );
    });
  });
});
