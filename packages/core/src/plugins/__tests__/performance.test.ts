import { describe, expect, it, vi, beforeEach } from "vitest";
import { performancePlugin } from "../performance.js";

// ============================================================================
// Helpers
// ============================================================================

function createPlugin(
  options: Parameters<typeof performancePlugin>[0] = {},
) {
  return performancePlugin(options);
}

// ============================================================================
// Plugin Identity
// ============================================================================

describe("performancePlugin", () => {
  it("has name 'performance'", () => {
    const plugin = createPlugin();
    expect(plugin.name).toBe("performance");
  });

  // ==========================================================================
  // Constraint Metrics
  // ==========================================================================

  describe("constraint metrics", () => {
    it("increments evaluation count on onConstraintEvaluate", () => {
      const plugin = createPlugin();
      // First call in a cycle sets baseline, second gets timed
      plugin.onReconcileStart!();
      plugin.onConstraintEvaluate!("c1", true);
      plugin.onConstraintEvaluate!("c1", true);

      const snap = plugin.getSnapshot();
      expect(snap.constraints["c1"].evaluations).toBe(2);
    });

    it("tracks lastEvaluatedAt as a timestamp", () => {
      const plugin = createPlugin();
      const before = Date.now();
      plugin.onReconcileStart!();
      plugin.onConstraintEvaluate!("c1", true);
      const after = Date.now();

      const snap = plugin.getSnapshot();
      expect(snap.constraints["c1"].lastEvaluatedAt).toBeGreaterThanOrEqual(before);
      expect(snap.constraints["c1"].lastEvaluatedAt).toBeLessThanOrEqual(after);
    });

    it("does not record duration for the first constraint in a reconcile cycle", () => {
      const plugin = createPlugin();
      plugin.onReconcileStart!();
      plugin.onConstraintEvaluate!("c1", true);

      const snap = plugin.getSnapshot();
      // First constraint has no baseline, so totalDurationMs stays 0
      expect(snap.constraints["c1"].totalDurationMs).toBe(0);
      expect(snap.constraints["c1"].maxDurationMs).toBe(0);
    });

    it("records duration for subsequent constraints in a cycle", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      // onReconcileStart resets baseline
      perfNowSpy.mockReturnValueOnce(100);
      const plugin = createPlugin();
      plugin.onReconcileStart!();

      // First constraint: sets lastConstraintEvalEndTime = 200
      perfNowSpy.mockReturnValueOnce(200);
      plugin.onConstraintEvaluate!("c1", true);

      // Second constraint: duration = 350 - 200 = 150
      perfNowSpy.mockReturnValueOnce(350);
      plugin.onConstraintEvaluate!("c2", true);

      const snap = plugin.getSnapshot();
      expect(snap.constraints["c2"].totalDurationMs).toBe(150);
      expect(snap.constraints["c2"].maxDurationMs).toBe(150);
      expect(snap.constraints["c2"].avgDurationMs).toBe(150);

      perfNowSpy.mockRestore();
    });

    it("resets constraint timing baseline on each reconcile cycle", () => {
      const perfNowSpy = vi.spyOn(performance, "now");

      // First cycle
      perfNowSpy.mockReturnValueOnce(0); // onReconcileStart
      const plugin = createPlugin();
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(10); // c1 (baseline)
      plugin.onConstraintEvaluate!("c1", true);

      // Second cycle — baseline resets, first constraint untimed again
      perfNowSpy.mockReturnValueOnce(50); // onReconcileStart
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(70); // c1 (baseline, untimed)
      plugin.onConstraintEvaluate!("c1", true);

      const snap = plugin.getSnapshot();
      // c1 was always the first constraint per cycle, so no duration tracked
      expect(snap.constraints["c1"].totalDurationMs).toBe(0);

      perfNowSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Resolver Metrics
  // ==========================================================================

  describe("resolver metrics", () => {
    it("increments starts on onResolverStart", () => {
      const plugin = createPlugin();
      plugin.onResolverStart!("r1", { type: "TEST" });
      plugin.onResolverStart!("r1", { type: "TEST" });

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].starts).toBe(2);
    });

    it("tracks completions and duration on onResolverComplete", () => {
      const plugin = createPlugin();
      plugin.onResolverComplete!("r1", { type: "TEST" }, 42);
      plugin.onResolverComplete!("r1", { type: "TEST" }, 58);

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].completions).toBe(2);
      expect(snap.resolvers["r1"].totalDurationMs).toBe(100);
      expect(snap.resolvers["r1"].avgDurationMs).toBe(50);
    });

    it("tracks maxDurationMs across completions", () => {
      const plugin = createPlugin();
      plugin.onResolverComplete!("r1", { type: "A" }, 10);
      plugin.onResolverComplete!("r1", { type: "A" }, 90);
      plugin.onResolverComplete!("r1", { type: "A" }, 50);

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].maxDurationMs).toBe(90);
    });

    it("tracks lastCompletedAt as a timestamp", () => {
      const plugin = createPlugin();
      const before = Date.now();
      plugin.onResolverComplete!("r1", { type: "A" }, 5);
      const after = Date.now();

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].lastCompletedAt).toBeGreaterThanOrEqual(before);
      expect(snap.resolvers["r1"].lastCompletedAt).toBeLessThanOrEqual(after);
    });

    it("increments errors on onResolverError", () => {
      const plugin = createPlugin();
      plugin.onResolverError!("r1", { type: "A" }, new Error("boom"));
      plugin.onResolverError!("r1", { type: "A" }, new Error("bang"));

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].errors).toBe(2);
    });

    it("increments retries on onResolverRetry", () => {
      const plugin = createPlugin();
      plugin.onResolverRetry!("r1", { type: "A" }, 1);
      plugin.onResolverRetry!("r1", { type: "A" }, 2);
      plugin.onResolverRetry!("r1", { type: "A" }, 3);

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].retries).toBe(3);
    });

    it("increments cancellations on onResolverCancel", () => {
      const plugin = createPlugin();
      plugin.onResolverCancel!("r1", { type: "A" });

      const snap = plugin.getSnapshot();
      expect(snap.resolvers["r1"].cancellations).toBe(1);
    });
  });

  // ==========================================================================
  // Reconcile Metrics
  // ==========================================================================

  describe("reconcile metrics", () => {
    it("tracks runs and duration via onReconcileStart/onReconcileEnd", () => {
      const perfNowSpy = vi.spyOn(performance, "now");

      const plugin = createPlugin();
      // First reconcile: 100ms
      perfNowSpy.mockReturnValueOnce(1000);
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(1100);
      plugin.onReconcileEnd!();

      // Second reconcile: 200ms
      perfNowSpy.mockReturnValueOnce(2000);
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(2200);
      plugin.onReconcileEnd!();

      const snap = plugin.getSnapshot();
      expect(snap.reconcile.runs).toBe(2);
      expect(snap.reconcile.totalDurationMs).toBe(300);
      expect(snap.reconcile.avgDurationMs).toBe(150);
      expect(snap.reconcile.maxDurationMs).toBe(200);

      perfNowSpy.mockRestore();
    });

    it("updates maxDurationMs only when exceeded", () => {
      const perfNowSpy = vi.spyOn(performance, "now");

      const plugin = createPlugin();
      // First: 500ms
      perfNowSpy.mockReturnValueOnce(0);
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(500);
      plugin.onReconcileEnd!();

      // Second: 100ms (smaller)
      perfNowSpy.mockReturnValueOnce(1000);
      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(1100);
      plugin.onReconcileEnd!();

      const snap = plugin.getSnapshot();
      expect(snap.reconcile.maxDurationMs).toBe(500);

      perfNowSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Effect Metrics
  // ==========================================================================

  describe("effect metrics", () => {
    it("increments runs on onEffectRun", () => {
      const plugin = createPlugin();
      plugin.onEffectRun!("e1");
      plugin.onEffectRun!("e1");
      plugin.onEffectRun!("e1");

      const snap = plugin.getSnapshot();
      expect(snap.effects["e1"].runs).toBe(3);
    });

    it("tracks lastRunAt as a timestamp", () => {
      const plugin = createPlugin();
      const before = Date.now();
      plugin.onEffectRun!("e1");
      const after = Date.now();

      const snap = plugin.getSnapshot();
      expect(snap.effects["e1"].lastRunAt).toBeGreaterThanOrEqual(before);
      expect(snap.effects["e1"].lastRunAt).toBeLessThanOrEqual(after);
    });

    it("increments errors on onEffectError", () => {
      const plugin = createPlugin();
      plugin.onEffectError!("e1", new Error("fail"));
      plugin.onEffectError!("e1", new Error("fail again"));

      const snap = plugin.getSnapshot();
      expect(snap.effects["e1"].errors).toBe(2);
    });
  });

  // ==========================================================================
  // getSnapshot
  // ==========================================================================

  describe("getSnapshot", () => {
    it("returns all metric categories", () => {
      const plugin = createPlugin();
      const snap = plugin.getSnapshot();

      expect(snap).toHaveProperty("constraints");
      expect(snap).toHaveProperty("resolvers");
      expect(snap).toHaveProperty("effects");
      expect(snap).toHaveProperty("reconcile");
      expect(snap).toHaveProperty("uptime");
    });

    it("returns a copy — mutations do not affect internal state", () => {
      const plugin = createPlugin();
      plugin.onResolverStart!("r1", { type: "A" });

      const snap1 = plugin.getSnapshot();
      snap1.resolvers["r1"].starts = 999;

      const snap2 = plugin.getSnapshot();
      expect(snap2.resolvers["r1"].starts).toBe(1);
    });

    it("returns empty records when no hooks have fired", () => {
      const plugin = createPlugin();
      const snap = plugin.getSnapshot();

      expect(snap.constraints).toEqual({});
      expect(snap.resolvers).toEqual({});
      expect(snap.effects).toEqual({});
      expect(snap.reconcile.runs).toBe(0);
      expect(snap.uptime).toBe(0);
    });
  });

  // ==========================================================================
  // reset
  // ==========================================================================

  describe("reset", () => {
    it("clears all metrics", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      perfNowSpy.mockReturnValue(0);

      const plugin = createPlugin();
      plugin.onStart!();

      // Populate every category
      plugin.onReconcileStart!();
      plugin.onConstraintEvaluate!("c1", true);
      plugin.onConstraintEvaluate!("c2", true);
      plugin.onReconcileEnd!();
      plugin.onResolverStart!("r1", { type: "A" });
      plugin.onResolverComplete!("r1", { type: "A" }, 50);
      plugin.onEffectRun!("e1");

      plugin.reset();

      const snap = plugin.getSnapshot();
      expect(snap.constraints).toEqual({});
      expect(snap.resolvers).toEqual({});
      expect(snap.effects).toEqual({});
      expect(snap.reconcile.runs).toBe(0);
      expect(snap.reconcile.totalDurationMs).toBe(0);
      expect(snap.reconcile.avgDurationMs).toBe(0);
      expect(snap.reconcile.maxDurationMs).toBe(0);

      perfNowSpy.mockRestore();
    });

    it("does not reset uptime (startedAt is preserved)", () => {
      const plugin = createPlugin();
      plugin.onStart!();

      // Small delay to ensure uptime > 0
      const snap1 = plugin.getSnapshot();
      plugin.reset();
      const snap2 = plugin.getSnapshot();

      // Uptime should still be non-zero after reset (startedAt not cleared)
      expect(snap2.uptime).toBeGreaterThanOrEqual(snap1.uptime);
    });
  });

  // ==========================================================================
  // Slow Constraint Callback
  // ==========================================================================

  describe("slow constraint callback", () => {
    it("fires onSlowConstraint when duration exceeds default threshold (16ms)", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      const onSlowConstraint = vi.fn();
      const plugin = createPlugin({ onSlowConstraint });

      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(100); // baseline constraint
      plugin.onConstraintEvaluate!("c-baseline", true);

      perfNowSpy.mockReturnValueOnce(200); // 100ms gap — well above 16ms
      plugin.onConstraintEvaluate!("c-slow", true);

      expect(onSlowConstraint).toHaveBeenCalledWith("c-slow", 100);

      perfNowSpy.mockRestore();
    });

    it("does not fire when duration is below threshold", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      const onSlowConstraint = vi.fn();
      const plugin = createPlugin({ onSlowConstraint });

      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(100);
      plugin.onConstraintEvaluate!("c-baseline", true);

      perfNowSpy.mockReturnValueOnce(105); // 5ms — below 16ms
      plugin.onConstraintEvaluate!("c-fast", true);

      expect(onSlowConstraint).not.toHaveBeenCalled();

      perfNowSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Slow Resolver Callback
  // ==========================================================================

  describe("slow resolver callback", () => {
    it("fires onSlowResolver when duration exceeds default threshold (1000ms)", () => {
      const onSlowResolver = vi.fn();
      const plugin = createPlugin({ onSlowResolver });

      plugin.onResolverComplete!("r-slow", { type: "A" }, 1500);

      expect(onSlowResolver).toHaveBeenCalledWith("r-slow", 1500);
    });

    it("does not fire when duration is below threshold", () => {
      const onSlowResolver = vi.fn();
      const plugin = createPlugin({ onSlowResolver });

      plugin.onResolverComplete!("r-fast", { type: "A" }, 500);

      expect(onSlowResolver).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Custom Thresholds
  // ==========================================================================

  describe("custom thresholds", () => {
    it("uses custom slowConstraintThresholdMs", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      const onSlowConstraint = vi.fn();
      const plugin = createPlugin({
        onSlowConstraint,
        slowConstraintThresholdMs: 5,
      });

      plugin.onReconcileStart!();
      perfNowSpy.mockReturnValueOnce(100);
      plugin.onConstraintEvaluate!("c-baseline", true);

      // 8ms gap — above custom 5ms threshold
      perfNowSpy.mockReturnValueOnce(108);
      plugin.onConstraintEvaluate!("c-slow", true);

      expect(onSlowConstraint).toHaveBeenCalledWith("c-slow", 8);

      perfNowSpy.mockRestore();
    });

    it("uses custom slowResolverThresholdMs", () => {
      const onSlowResolver = vi.fn();
      const plugin = createPlugin({
        onSlowResolver,
        slowResolverThresholdMs: 50,
      });

      plugin.onResolverComplete!("r1", { type: "A" }, 60);
      expect(onSlowResolver).toHaveBeenCalledWith("r1", 60);

      // Below custom threshold
      onSlowResolver.mockClear();
      plugin.onResolverComplete!("r2", { type: "A" }, 40);
      expect(onSlowResolver).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Uptime
  // ==========================================================================

  describe("uptime", () => {
    it("returns 0 before onStart is called", () => {
      const plugin = createPlugin();
      const snap = plugin.getSnapshot();
      expect(snap.uptime).toBe(0);
    });

    it("returns elapsed time after onStart", () => {
      const dateNowSpy = vi.spyOn(Date, "now");

      // onStart records startedAt
      dateNowSpy.mockReturnValueOnce(1000);
      const plugin = createPlugin();
      plugin.onStart!();

      // getSnapshot calculates uptime = Date.now() - startedAt
      dateNowSpy.mockReturnValueOnce(3500);
      const snap = plugin.getSnapshot();
      expect(snap.uptime).toBe(2500);

      dateNowSpy.mockRestore();
    });
  });

  // ==========================================================================
  // Multiple Resolvers / Constraints Tracked Independently
  // ==========================================================================

  describe("independent tracking by ID", () => {
    it("tracks multiple resolvers independently", () => {
      const plugin = createPlugin();

      plugin.onResolverStart!("auth", { type: "AUTH" });
      plugin.onResolverStart!("auth", { type: "AUTH" });
      plugin.onResolverStart!("data", { type: "FETCH" });

      plugin.onResolverComplete!("auth", { type: "AUTH" }, 100);
      plugin.onResolverComplete!("data", { type: "FETCH" }, 200);
      plugin.onResolverError!("data", { type: "FETCH" }, new Error("timeout"));

      const snap = plugin.getSnapshot();

      expect(snap.resolvers["auth"].starts).toBe(2);
      expect(snap.resolvers["auth"].completions).toBe(1);
      expect(snap.resolvers["auth"].errors).toBe(0);
      expect(snap.resolvers["auth"].totalDurationMs).toBe(100);

      expect(snap.resolvers["data"].starts).toBe(1);
      expect(snap.resolvers["data"].completions).toBe(1);
      expect(snap.resolvers["data"].errors).toBe(1);
      expect(snap.resolvers["data"].totalDurationMs).toBe(200);
    });

    it("tracks multiple constraints independently", () => {
      const perfNowSpy = vi.spyOn(performance, "now");
      const plugin = createPlugin();

      plugin.onReconcileStart!();
      // First constraint sets baseline (lastConstraintEvalEndTime must be > 0)
      perfNowSpy.mockReturnValueOnce(100);
      plugin.onConstraintEvaluate!("priority", true);
      // Second: duration = 110 - 100 = 10
      perfNowSpy.mockReturnValueOnce(110);
      plugin.onConstraintEvaluate!("transition", true);
      // Third: duration = 130 - 110 = 20
      perfNowSpy.mockReturnValueOnce(130);
      plugin.onConstraintEvaluate!("safety", false);

      const snap = plugin.getSnapshot();

      expect(snap.constraints["priority"].evaluations).toBe(1);
      expect(snap.constraints["transition"].evaluations).toBe(1);
      expect(snap.constraints["safety"].evaluations).toBe(1);

      // priority: first in cycle, no duration
      expect(snap.constraints["priority"].totalDurationMs).toBe(0);
      // transition: duration = 110 - 100 = 10
      expect(snap.constraints["transition"].totalDurationMs).toBe(10);
      // safety: duration = 130 - 110 = 20
      expect(snap.constraints["safety"].totalDurationMs).toBe(20);

      perfNowSpy.mockRestore();
    });

    it("tracks multiple effects independently", () => {
      const plugin = createPlugin();

      plugin.onEffectRun!("log");
      plugin.onEffectRun!("log");
      plugin.onEffectRun!("notify");
      plugin.onEffectError!("notify", new Error("failed"));

      const snap = plugin.getSnapshot();

      expect(snap.effects["log"].runs).toBe(2);
      expect(snap.effects["log"].errors).toBe(0);
      expect(snap.effects["notify"].runs).toBe(1);
      expect(snap.effects["notify"].errors).toBe(1);
    });
  });
});
