/**
 * createAIArchitect() — the main factory for AI Architect instances.
 *
 * Handles: mutex enforcement, option validation, trigger wiring,
 * and returns the full AIArchitect interface.
 */

import type { System } from "@directive-run/core";
import type {
  AIArchitect,
  AIArchitectOptions,
  ArchitectAnalysis,
  ArchitectEventType,
  ArchitectEventListener,
  ArchitectStatus,
  FederationPattern,
} from "./types.js";
import { createPipeline } from "./pipeline.js";
import { createDiscoverySession } from "./discovery.js";
import { createWhatIfAnalysis } from "./what-if.js";
import { extractSystemGraph } from "./graph.js";
import { createReplayRecorder } from "./replay.js";
import { exportPattern, importPattern } from "./federation.js";

// ============================================================================
// Mutex: one architect per system
// ============================================================================

const attachedSystems = new WeakMap<System, true>();

// Item 14: BSL notice once per process
let bslPrinted = false;

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an AI Architect that can observe and modify a Directive system.
 *
 * @example
 * ```typescript
 * // Tier 1: Observe-only (2 lines)
 * const architect = createAIArchitect({ system, runner, budget: { tokens: 10_000, dollars: 1 } });
 * const analysis = await architect.analyze("What's wrong with my system?");
 *
 * // Tier 2: Custom triggers
 * const architect = createAIArchitect({
 *   system, runner,
 *   budget: { tokens: 50_000, dollars: 5 },
 *   triggers: { onError: true, onUnmetRequirement: true },
 * });
 *
 * // Tier 3: Full control
 * const architect = createAIArchitect({
 *   system, runner,
 *   budget: { tokens: 100_000, dollars: 10 },
 *   triggers: { onError: true, onUnmetRequirement: true, onFactChange: ['status'] },
 *   capabilities: { constraints: true, resolvers: true },
 *   safety: { approval: { constraints: 'always', resolvers: 'first-time' } },
 * });
 * ```
 */
export function createAIArchitect(options: AIArchitectOptions): AIArchitect {
  // ---- Validate required options ----
  if (!options.system) {
    throw new Error("AIArchitect requires a `system`");
  }

  if (!options.runner) {
    throw new Error("AIArchitect requires a `runner`");
  }

  if (!options.budget) {
    throw new Error("AIArchitect requires a `budget` with { tokens, dollars }");
  }

  if (typeof options.budget.tokens !== "number" || options.budget.tokens <= 0) {
    throw new Error("budget.tokens must be a positive number");
  }

  if (typeof options.budget.dollars !== "number" || options.budget.dollars <= 0) {
    throw new Error("budget.dollars must be a positive number");
  }

  // ---- Mutex check ----
  if (attachedSystems.has(options.system)) {
    throw new Error(
      "This system already has an AI Architect attached. Only one architect per system is allowed.",
    );
  }

  attachedSystems.set(options.system, true);

  // Item 23: apply preset if specified — preset provides defaults, explicit options override
  if (options.preset) {
    applyPreset(options);
  }

  // ---- Warn on short schedule intervals ----
  if (options.triggers?.onSchedule) {
    const scheduleMs = parseInterval(options.triggers.onSchedule);
    if (scheduleMs < 60_000) {
      console.warn(
        `[directive/architect] onSchedule interval "${options.triggers.onSchedule}" is less than 60s. This may cause excessive LLM calls.`,
      );
    }
  }

  const createdAt = Date.now();
  let isDestroyedFlag = false;

  // ---- Create pipeline ----
  const pipeline = createPipeline({
    system: options.system,
    runner: options.runner,
    options,
  });

  // ---- Wire triggers ----
  const unsubscribers: Array<() => void> = [];
  let scheduleTimer: ReturnType<typeof setInterval> | undefined;

  // M3: wire onError/onUnmetRequirement via system.onSettledChange()
  if (options.triggers?.onError || options.triggers?.onUnmetRequirement) {
    const sys = options.system as unknown as Record<string, unknown>;
    if (typeof sys.onSettledChange === "function") {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const unsub = (sys.onSettledChange as (cb: () => void) => () => void)(() => {
        // Debounce to avoid rapid triggers
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          // Item 2: inspect unmet requirements to determine trigger type
          const inspection = options.system.inspect() as unknown as Record<string, unknown>;
          const unmet = inspection.unmet ?? inspection.pendingRequirements ?? [];
          const hasUnmet = Array.isArray(unmet) && unmet.length > 0;
          const trigger = hasUnmet ? "unmet-requirement" : "error";

          pipeline.analyze(trigger).catch(() => {
            // Swallow — errors emitted via events
          });
        }, 3000);
      });

      unsubscribers.push(() => {
        unsub();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      });
    }
  }

  // Item 1: wire onFactChange via system.subscribe(keys, listener)
  if (options.triggers?.onFactChange && options.triggers.onFactChange.length > 0) {
    const sys = options.system as unknown as Record<string, unknown>;
    if (typeof sys.subscribe === "function") {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      const factKeys = options.triggers.onFactChange;

      // Pass fact keys array to system.subscribe for key-level subscription
      const unsub = (sys.subscribe as (keys: string[], cb: () => void) => () => void)(
        factKeys,
        () => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            pipeline.analyze("fact-change").catch(() => {
              // Swallow — errors emitted via events
            });
          }, 3000);
        },
      );

      unsubscribers.push(() => {
        unsub();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      });
    }
  }

  if (options.triggers?.onSchedule) {
    const intervalMs = parseInterval(options.triggers.onSchedule);
    scheduleTimer = setInterval(() => {
      pipeline.analyze("schedule").catch(() => {
        // Swallow — errors emitted via events
      });
    }, intervalMs);
  }

  // Item 14: BSL notice once per process
  if (!bslPrinted && typeof console !== "undefined" && typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
    bslPrinted = true;
    console.info(
      "[directive/architect] AI Architect — BSL 1.1 licensed. Free for open source, personal use, and companies <$1M ARR.",
    );
  }

  // ---- Build the public interface ----
  // M7: fix on() — proper type discrimination
  const architect: AIArchitect = {
    analyze(prompt?: string, analyzeOpts?: { mode?: "single" | "plan" }): Promise<ArchitectAnalysis> {
      return pipeline.analyze("demand", undefined, prompt, 0, analyzeOpts?.mode);
    },

    approve(actionId: string): Promise<boolean> {
      return pipeline.approve(actionId);
    },

    // M6: reject returns Promise<boolean> for consistency with approve
    reject(actionId: string): Promise<boolean> {
      return Promise.resolve(pipeline.reject(actionId));
    },

    rollback(actionId: string): boolean {
      return pipeline.rollback(actionId);
    },

    previewRollback(actionId: string) {
      return pipeline.previewRollback(actionId);
    },

    rollbackBatch(actionIds: string[]) {
      return pipeline.rollbackBatch(actionIds);
    },

    toSource(actionId: string) {
      return pipeline.toSource(actionId);
    },

    kill() {
      return pipeline.kill();
    },

    resetBudget() {
      pipeline.resetBudget();
    },

    getActiveDefinitions() {
      return pipeline.getActiveDefinitions();
    },

    // M7: proper overloaded on() with type discrimination
    on(
      typeOrListener: ArchitectEventType | ArchitectEventListener,
      listener?: ArchitectEventListener,
    ): () => void {
      if (typeof typeOrListener === "function") {
        return pipeline.on(typeOrListener);
      }

      return pipeline.on(typeOrListener, listener!);
    },

    getAuditLog(query) {
      return pipeline.getAuditLog(query);
    },

    getPendingApprovals() {
      return pipeline.getPendingApprovals();
    },

    getRollbackEntries() {
      return pipeline.getRollbackEntries();
    },

    getBudgetUsage() {
      return pipeline.getBudgetUsage();
    },

    // Item 19: convenience methods for innovation features
    discover(discoverOptions?) {
      return createDiscoverySession(options.system, options.runner, discoverOptions);
    },

    whatIf(action, whatIfOptions?) {
      // E3: normalize WhatIfInput to full ArchitectAction
      const fullAction = "id" in action ? action : {
        id: `whatif-${Date.now()}`,
        tool: action.tool,
        arguments: action.arguments,
        reasoning: { trigger: "demand", observation: "", justification: "", expectedOutcome: "", raw: "" },
        confidence: 0.5,
        risk: "low" as const,
        requiresApproval: false,
        approvalStatus: "pending" as const,
        timestamp: Date.now(),
      };

      return createWhatIfAnalysis(options.system, fullAction, options.runner, whatIfOptions);
    },

    graph(graphOptions?) {
      return extractSystemGraph(options.system, {
        ...graphOptions,
        dynamicIds: pipeline._dynamicIds,
      });
    },

    record() {
      return createReplayRecorder(options.system);
    },

    exportAction(actionId, exportOptions?) {
      const allActions = pipeline.getAuditLog({ applied: true });
      const entry = allActions.find((e) => e.id === actionId || e.definitionId === actionId);
      if (!entry) {
        return null;
      }

      const action = {
        id: actionId,
        tool: entry.tool,
        arguments: entry.arguments,
        reasoning: entry.reasoning,
        confidence: 0.8,
        risk: "medium" as const,
        requiresApproval: false,
        approvalStatus: "approved" as const,
        timestamp: entry.timestamp,
      };

      return exportPattern(action, exportOptions);
    },

    async importPattern(pattern: FederationPattern) {
      return importPattern(pattern, options.system, options.runner);
    },

    // Item 24: status summary — E5: uses unified BudgetUsage shape
    status(): ArchitectStatus {
      const budgetUsage = pipeline.getBudgetUsage();
      const cbState = pipeline.guards.getCircuitBreakerState();
      const activeDefs = pipeline.getActiveDefinitions();
      const pendingApprovals = pipeline.getPendingApprovals();
      const auditEntries = pipeline.getAuditLog();

      return {
        budget: budgetUsage,
        circuitBreaker: cbState,
        activeDefinitions: activeDefs.length,
        pendingApprovals: pendingApprovals.length,
        auditEntries: auditEntries.length,
        uptime: Date.now() - createdAt,
        isDestroyed: isDestroyedFlag,
      };
    },

    destroy() {
      isDestroyedFlag = true;

      // Clean up triggers
      for (const unsub of unsubscribers) {
        unsub();
      }

      if (scheduleTimer) {
        clearInterval(scheduleTimer);
      }

      // Release mutex
      attachedSystems.delete(options.system);

      // Destroy pipeline
      pipeline.destroy();
    },
  };

  return architect;
}

// ============================================================================
// Helpers
// ============================================================================

/** Item 23: Apply autonomy preset defaults. Explicit options override. */
function applyPreset(options: AIArchitectOptions): void {
  const preset = options.preset!;

  // Only set values that weren't explicitly provided
  if (!options.capabilities) {
    options.capabilities = {};
  }

  if (!options.safety) {
    options.safety = {};
  }

  if (!options.safety.approval) {
    options.safety.approval = {};
  }

  switch (preset) {
    case "observer":
      // Read-only, no mutations
      options.capabilities.constraints = options.capabilities.constraints ?? false;
      options.capabilities.resolvers = options.capabilities.resolvers ?? false;
      options.capabilities.effects = options.capabilities.effects ?? false;
      options.capabilities.derivations = options.capabilities.derivations ?? false;
      options.capabilities.facts = options.capabilities.facts ?? "read-only";
      break;

    case "advisor":
      // Constraints + resolvers, facts read-only, always approve
      options.capabilities.constraints = options.capabilities.constraints ?? true;
      options.capabilities.resolvers = options.capabilities.resolvers ?? true;
      options.capabilities.effects = options.capabilities.effects ?? false;
      options.capabilities.derivations = options.capabilities.derivations ?? false;
      options.capabilities.facts = options.capabilities.facts ?? "read-only";
      options.safety.approval.constraints = options.safety.approval.constraints ?? "always";
      options.safety.approval.resolvers = options.safety.approval.resolvers ?? "always";
      break;

    case "operator":
      // Constraints + resolvers, facts read-write, first-time approval
      options.capabilities.constraints = options.capabilities.constraints ?? true;
      options.capabilities.resolvers = options.capabilities.resolvers ?? true;
      options.capabilities.effects = options.capabilities.effects ?? false;
      options.capabilities.derivations = options.capabilities.derivations ?? false;
      options.capabilities.facts = options.capabilities.facts ?? "read-write";
      options.safety.approval.constraints = options.safety.approval.constraints ?? "first-time";
      options.safety.approval.resolvers = options.safety.approval.resolvers ?? "first-time";
      break;

    case "autonomous":
      // Full autonomy within budget
      options.capabilities.constraints = options.capabilities.constraints ?? true;
      options.capabilities.resolvers = options.capabilities.resolvers ?? true;
      options.capabilities.effects = options.capabilities.effects ?? true;
      options.capabilities.derivations = options.capabilities.derivations ?? true;
      options.capabilities.facts = options.capabilities.facts ?? "read-write";
      options.safety.approval.constraints = options.safety.approval.constraints ?? "never";
      options.safety.approval.resolvers = options.safety.approval.resolvers ?? "never";
      options.safety.approval.effects = options.safety.approval.effects ?? "never";
      options.safety.approval.derivations = options.safety.approval.derivations ?? "never";
      break;
  }
}

/** Parse a human-readable interval string to milliseconds. */
export function parseInterval(interval: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(interval.trim());
  if (!match) {
    throw new Error(
      `Invalid interval: "${interval}". Use format like "30s", "5m", "1h", "1d".`,
    );
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    case "d":
      return value * 86_400_000;
    default:
      return value * 1000;
  }
}
