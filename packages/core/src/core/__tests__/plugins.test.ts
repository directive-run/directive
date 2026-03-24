import { describe, expect, it, vi } from "vitest";
import { createPluginManager } from "../plugins.js";

// ============================================================================
// Helpers
// ============================================================================

function makePlugin(name: string, hooks: Record<string, unknown> = {}) {
  return { name, ...hooks };
}

// ============================================================================
// Registration
// ============================================================================

describe("createPluginManager", () => {
  describe("registration", () => {
    it("registers a plugin", () => {
      const pm = createPluginManager();
      const plugin = makePlugin("alpha");

      pm.register(plugin);

      expect(pm.getPlugins()).toEqual([plugin]);
    });

    it("unregisters a plugin by name", () => {
      const pm = createPluginManager();
      pm.register(makePlugin("alpha"));
      pm.register(makePlugin("beta"));

      pm.unregister("alpha");

      expect(pm.getPlugins()).toHaveLength(1);
      expect(pm.getPlugins()[0]!.name).toBe("beta");
    });

    it("unregister is a no-op for unknown names", () => {
      const pm = createPluginManager();
      pm.register(makePlugin("alpha"));

      pm.unregister("unknown");

      expect(pm.getPlugins()).toHaveLength(1);
    });

    it("getPlugins returns a copy, not the internal array", () => {
      const pm = createPluginManager();
      pm.register(makePlugin("alpha"));

      const list = pm.getPlugins();
      list.push(makePlugin("injected"));

      expect(pm.getPlugins()).toHaveLength(1);
    });

    it("warns and replaces on duplicate plugin name", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pm = createPluginManager();

      const first = makePlugin("dup", { onStart: vi.fn() });
      const second = makePlugin("dup", { onStop: vi.fn() });

      pm.register(first);
      pm.register(second);

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]![0]).toContain("dup");
      expect(pm.getPlugins()).toHaveLength(1);
      expect(pm.getPlugins()[0]).toBe(second);

      warnSpy.mockRestore();
    });

    it("plugins fire in registration order", () => {
      const pm = createPluginManager();
      const order: string[] = [];

      pm.register(makePlugin("first", { onStart: () => order.push("first") }));
      pm.register(
        makePlugin("second", { onStart: () => order.push("second") }),
      );
      pm.register(makePlugin("third", { onStart: () => order.push("third") }));

      pm.emitStart({} as never);

      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  // ============================================================================
  // Error Isolation
  // ============================================================================

  describe("error isolation", () => {
    it("a throwing hook does not prevent subsequent plugins from firing", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pm = createPluginManager();
      const afterHook = vi.fn();

      pm.register(
        makePlugin("bad", {
          onStart: () => {
            throw new Error("boom");
          },
        }),
      );
      pm.register(makePlugin("good", { onStart: afterHook }));

      pm.emitStart({} as never);

      expect(afterHook).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]![0]).toContain("[Directive] Plugin error:");

      errorSpy.mockRestore();
    });

    it("a throwing async hook does not prevent subsequent plugins from firing", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pm = createPluginManager();
      const afterHook = vi.fn().mockResolvedValue(undefined);

      pm.register(
        makePlugin("bad", {
          onInit: async () => {
            throw new Error("async boom");
          },
        }),
      );
      pm.register(makePlugin("good", { onInit: afterHook }));

      await pm.emitInit({} as never);

      expect(afterHook).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();

      errorSpy.mockRestore();
    });

    it("missing hooks are silently skipped", () => {
      const pm = createPluginManager();
      pm.register(makePlugin("no-hooks"));

      // Should not throw
      pm.emitStart({} as never);
      pm.emitStop({} as never);
      pm.emitFactSet("key", 1, undefined);
    });
  });

  // ============================================================================
  // Lifecycle Hooks
  // ============================================================================

  describe("lifecycle hooks", () => {
    it("emitInit calls onInit and is async", async () => {
      const pm = createPluginManager();
      const hook = vi.fn().mockResolvedValue(undefined);
      const system = { id: "sys" } as never;

      pm.register(makePlugin("p", { onInit: hook }));
      await pm.emitInit(system);

      expect(hook).toHaveBeenCalledWith(system);
    });

    it("emitStart calls onStart with system", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const system = { id: "sys" } as never;

      pm.register(makePlugin("p", { onStart: hook }));
      pm.emitStart(system);

      expect(hook).toHaveBeenCalledWith(system);
    });

    it("emitStop calls onStop with system", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const system = { id: "sys" } as never;

      pm.register(makePlugin("p", { onStop: hook }));
      pm.emitStop(system);

      expect(hook).toHaveBeenCalledWith(system);
    });

    it("emitDestroy calls onDestroy with system", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const system = { id: "sys" } as never;

      pm.register(makePlugin("p", { onDestroy: hook }));
      pm.emitDestroy(system);

      expect(hook).toHaveBeenCalledWith(system);
    });
  });

  // ============================================================================
  // Fact Hooks
  // ============================================================================

  describe("fact hooks", () => {
    it("emitFactSet passes key, value, and prev", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onFactSet: hook }));
      pm.emitFactSet("count", 5, 3);

      expect(hook).toHaveBeenCalledWith("count", 5, 3);
    });

    it("emitFactDelete passes key and prev", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onFactDelete: hook }));
      pm.emitFactDelete("count", 42);

      expect(hook).toHaveBeenCalledWith("count", 42);
    });

    it("emitFactsBatch passes the changes array", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const changes = [
        { key: "a", value: 1, prev: 0 },
        { key: "b", value: 2, prev: 1 },
      ];

      pm.register(makePlugin("p", { onFactsBatch: hook }));
      pm.emitFactsBatch(changes as never);

      expect(hook).toHaveBeenCalledWith(changes);
    });
  });

  // ============================================================================
  // Derivation Hooks
  // ============================================================================

  describe("derivation hooks", () => {
    it("emitDerivationCompute passes id, value, and deps", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onDerivationCompute: hook }));
      pm.emitDerivationCompute("isRed", true, ["phase"]);

      expect(hook).toHaveBeenCalledWith("isRed", true, ["phase"]);
    });

    it("emitDerivationInvalidate passes id", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onDerivationInvalidate: hook }));
      pm.emitDerivationInvalidate("isRed");

      expect(hook).toHaveBeenCalledWith("isRed");
    });
  });

  // ============================================================================
  // Reconciliation Hooks
  // ============================================================================

  describe("reconciliation hooks", () => {
    it("emitReconcileStart passes snapshot", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const snapshot = { phase: "red" };

      pm.register(makePlugin("p", { onReconcileStart: hook }));
      pm.emitReconcileStart(snapshot as never);

      expect(hook).toHaveBeenCalledWith(snapshot);
    });

    it("emitReconcileEnd passes result", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const result = { resolved: 2, failed: 0 };

      pm.register(makePlugin("p", { onReconcileEnd: hook }));
      pm.emitReconcileEnd(result as never);

      expect(hook).toHaveBeenCalledWith(result);
    });
  });

  // ============================================================================
  // Constraint Hooks
  // ============================================================================

  describe("constraint hooks", () => {
    it("emitConstraintEvaluate passes id and active flag", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onConstraintEvaluate: hook }));
      pm.emitConstraintEvaluate("transition", true);

      expect(hook).toHaveBeenCalledWith("transition", true);
    });

    it("emitConstraintError passes id and error", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const error = new Error("constraint failed");

      pm.register(makePlugin("p", { onConstraintError: hook }));
      pm.emitConstraintError("transition", error);

      expect(hook).toHaveBeenCalledWith("transition", error);
    });
  });

  // ============================================================================
  // Requirement Hooks
  // ============================================================================

  describe("requirement hooks", () => {
    it("emitRequirementCreated passes the requirement", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const req = { id: "r1", type: "TRANSITION" };

      pm.register(makePlugin("p", { onRequirementCreated: hook }));
      pm.emitRequirementCreated(req as never);

      expect(hook).toHaveBeenCalledWith(req);
    });

    it("emitRequirementMet passes requirement and resolver name", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const req = { id: "r1", type: "TRANSITION" };

      pm.register(makePlugin("p", { onRequirementMet: hook }));
      pm.emitRequirementMet(req as never, "transition-resolver");

      expect(hook).toHaveBeenCalledWith(req, "transition-resolver");
    });

    it("emitRequirementCanceled passes the requirement", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const req = { id: "r1", type: "TRANSITION" };

      pm.register(makePlugin("p", { onRequirementCanceled: hook }));
      pm.emitRequirementCanceled(req as never);

      expect(hook).toHaveBeenCalledWith(req);
    });
  });

  // ============================================================================
  // Resolver Hooks
  // ============================================================================

  describe("resolver hooks", () => {
    const req = { id: "r1", type: "TRANSITION" } as never;

    it("emitResolverStart passes resolver name and requirement", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onResolverStart: hook }));
      pm.emitResolverStart("transition", req);

      expect(hook).toHaveBeenCalledWith("transition", req);
    });

    it("emitResolverComplete passes resolver, requirement, and duration", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onResolverComplete: hook }));
      pm.emitResolverComplete("transition", req, 150);

      expect(hook).toHaveBeenCalledWith("transition", req, 150);
    });

    it("emitResolverError passes resolver, requirement, and error", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const error = new Error("resolve failed");

      pm.register(makePlugin("p", { onResolverError: hook }));
      pm.emitResolverError("transition", req, error);

      expect(hook).toHaveBeenCalledWith("transition", req, error);
    });

    it("emitResolverRetry passes resolver, requirement, and attempt", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onResolverRetry: hook }));
      pm.emitResolverRetry("transition", req, 2);

      expect(hook).toHaveBeenCalledWith("transition", req, 2);
    });

    it("emitResolverCancel passes resolver and requirement", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onResolverCancel: hook }));
      pm.emitResolverCancel("transition", req);

      expect(hook).toHaveBeenCalledWith("transition", req);
    });
  });

  // ============================================================================
  // Effect Hooks
  // ============================================================================

  describe("effect hooks", () => {
    it("emitEffectRun passes effect id", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onEffectRun: hook }));
      pm.emitEffectRun("log-effect");

      expect(hook).toHaveBeenCalledWith("log-effect");
    });

    it("emitEffectError passes effect id and error", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const error = new Error("effect boom");

      pm.register(makePlugin("p", { onEffectError: hook }));
      pm.emitEffectError("log-effect", error);

      expect(hook).toHaveBeenCalledWith("log-effect", error);
    });
  });

  // ============================================================================
  // Time-Travel Hooks
  // ============================================================================

  describe("time-travel hooks", () => {
    it("emitSnapshot passes the snapshot", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const snapshot = { index: 0, facts: { phase: "red" } };

      pm.register(makePlugin("p", { onSnapshot: hook }));
      pm.emitSnapshot(snapshot as never);

      expect(hook).toHaveBeenCalledWith(snapshot);
    });

    it("emitHistoryNavigate passes from and to indices", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onHistoryNavigate: hook }));
      pm.emitHistoryNavigate(3, 1);

      expect(hook).toHaveBeenCalledWith(3, 1);
    });
  });

  // ============================================================================
  // Error Hooks
  // ============================================================================

  describe("error hooks", () => {
    it("emitError passes the DirectiveError", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const error = { code: "RESOLVER_FAILED", message: "fail" };

      pm.register(makePlugin("p", { onError: hook }));
      pm.emitError(error as never);

      expect(hook).toHaveBeenCalledWith(error);
    });

    it("emitErrorRecovery passes error and strategy", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const error = { code: "RESOLVER_FAILED", message: "fail" };
      const strategy = "retry";

      pm.register(makePlugin("p", { onErrorRecovery: hook }));
      pm.emitErrorRecovery(error as never, strategy as never);

      expect(hook).toHaveBeenCalledWith(error, strategy);
    });
  });

  // ============================================================================
  // Dynamic Definition Hooks
  // ============================================================================

  describe("dynamic definition hooks", () => {
    it("emitDefinitionRegister passes type, id, and def", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const def = { resolve: () => {} };

      pm.register(makePlugin("p", { onDefinitionRegister: hook }));
      pm.emitDefinitionRegister("resolver", "fetchUser", def);

      expect(hook).toHaveBeenCalledWith("resolver", "fetchUser", def);
    });

    it("emitDefinitionAssign passes type, id, def, and original", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const def = { resolve: () => {} };
      const original = { resolve: () => {} };

      pm.register(makePlugin("p", { onDefinitionAssign: hook }));
      pm.emitDefinitionAssign("resolver", "fetchUser", def, original);

      expect(hook).toHaveBeenCalledWith("resolver", "fetchUser", def, original);
    });

    it("emitDefinitionUnregister passes type and id", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onDefinitionUnregister: hook }));
      pm.emitDefinitionUnregister("resolver", "fetchUser");

      expect(hook).toHaveBeenCalledWith("resolver", "fetchUser");
    });

    it("emitDefinitionCall passes type, id, and optional props", () => {
      const pm = createPluginManager();
      const hook = vi.fn();

      pm.register(makePlugin("p", { onDefinitionCall: hook }));
      pm.emitDefinitionCall("effect", "notify", { urgent: true });

      expect(hook).toHaveBeenCalledWith("effect", "notify", { urgent: true });
    });
  });

  // ============================================================================
  // Trace Hooks
  // ============================================================================

  describe("trace hooks", () => {
    it("emitTraceComplete passes the trace entry", () => {
      const pm = createPluginManager();
      const hook = vi.fn();
      const entry = { id: 1, timestamp: Date.now(), changes: [] };

      pm.register(makePlugin("p", { onTraceComplete: hook }));
      pm.emitTraceComplete(entry as never);

      expect(hook).toHaveBeenCalledWith(entry);
    });
  });
});
