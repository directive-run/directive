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
import { computeHealthScore } from "./health.js";
import { resolveStories, mergeStoryConfig } from "./intent.js";

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
  let isPausedFlag = false;
  const queuedWhilePaused: Array<() => void> = [];
  const MAX_QUEUED_TRIGGERS = 1000;

  function queueTrigger(fn: () => void): void {
    if (queuedWhilePaused.length >= MAX_QUEUED_TRIGGERS) {
      // Drop oldest to prevent unbounded growth
      queuedWhilePaused.shift();
    }

    queuedWhilePaused.push(fn);
  }

  // ---- Story resolution state ----
  let storiesResolved = !options.stories || options.stories.length === 0;
  let storyResolutionPromise: Promise<void> | undefined;

  async function ensureStoriesResolved(): Promise<void> {
    if (storiesResolved) {
      return;
    }

    if (storyResolutionPromise) {
      return storyResolutionPromise;
    }

    storyResolutionPromise = (async () => {
      try {
        const result = await resolveStories(
          options.stories!,
          options.system,
          options.runner,
          options.storyResolution,
        );

        // Merge: explicit config overrides story-derived
        const merged = mergeStoryConfig(options, result.config);

        // Apply merged config — update mutable fields
        // Story-derived context supplements but never overwrites required fields
        if (merged.context) {
          const storyCtx = merged.context;
          if (!options.context) {
            // Only set if story provides a description (required field)
            if (storyCtx.description) {
              options.context = {
                description: storyCtx.description,
                goals: storyCtx.goals,
                notes: storyCtx.notes,
              };
            }
          } else {
            // Merge goals/notes from story, keep existing values
            if (storyCtx.goals && !options.context.goals) {
              options.context.goals = storyCtx.goals;
            }

            if (storyCtx.notes && !options.context.notes) {
              options.context.notes = storyCtx.notes;
            }
          }
        }

        if (merged.triggers) {
          options.triggers = {
            ...options.triggers,
            ...(merged.triggers as typeof options.triggers),
          };
        }

        if (merged.capabilities) {
          options.capabilities = {
            ...options.capabilities,
            ...(merged.capabilities as typeof options.capabilities),
          };
        }

        if (merged.safety) {
          options.safety = {
            ...options.safety,
            ...(merged.safety as typeof options.safety),
          };
        }

        pipeline.emitEvent({
          type: "stories-resolved",
          timestamp: Date.now(),
          config: result.config,
          rawResponse: result.rawResponse,
        });
      } catch {
        // Stories resolution is best-effort — don't crash the architect
        pipeline.emitEvent({
          type: "error",
          timestamp: Date.now(),
          error: new Error("Failed to resolve stories"),
        });
      } finally {
        storiesResolved = true;
        storyResolutionPromise = undefined;
      }
    })();

    return storyResolutionPromise;
  }

  // M4: cost estimation for discovery/whatIf budget tracking
  const costPerThousandTokens = options.budget.costPerThousandTokens ?? 0.003;
  const estimateDollars = (tokens: number) => (tokens / 1000) * costPerThousandTokens;

  // ---- Initialize metrics ----
  if (options.metrics?.init) {
    options.metrics.init().catch(() => {
      // Swallow — metrics init failure should not crash the architect
    });
  }

  // ---- Create pipeline ----
  const pipeline = createPipeline({
    system: options.system,
    runner: options.runner,
    options,
  });

  // ---- Initialize persistence ----
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;

  if (options.persistence) {
    const initPromises: Promise<void>[] = [];

    if (options.persistence.audit?.init) {
      initPromises.push(options.persistence.audit.init());
    }

    if (options.persistence.checkpoint?.init) {
      initPromises.push(options.persistence.checkpoint.init());
    }

    // Hydrate from checkpoint after stores are initialized
    if (options.persistence.checkpoint) {
      const doInit = async () => {
        await Promise.all(initPromises);
        await pipeline.hydrate();
      };
      doInit().catch(() => {
        // Swallow — persistence init failure should not crash the architect
      });
    } else if (initPromises.length > 0) {
      Promise.all(initPromises).catch(() => {
        // Swallow
      });
    }

    // Start periodic checkpoint timer
    const checkpointInterval = options.persistence.checkpointInterval;
    if (checkpointInterval !== null && options.persistence.checkpoint) {
      const intervalStr = checkpointInterval ?? "5m";
      const intervalMs = parseInterval(intervalStr);
      const cpStore = options.persistence.checkpoint;
      checkpointTimer = setInterval(() => {
        // Pipeline's scheduleCheckpoint handles debouncing; force one here
        const checkpoint = pipeline._buildCheckpoint();
        cpStore.save(checkpoint).catch(() => {
          // Swallow — periodic checkpoint failure is non-fatal
        });
      }, intervalMs);
    }
  }

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
          const triggerFn = () => {
            // Item 2: inspect unmet requirements to determine trigger type
            const inspection = options.system.inspect() as unknown as Record<string, unknown>;
            const unmet = inspection.unmet ?? inspection.pendingRequirements ?? [];
            const hasUnmet = Array.isArray(unmet) && unmet.length > 0;
            const trigger = hasUnmet ? "unmet-requirement" : "error";

            pipeline.analyze(trigger).catch(() => {
              // Swallow — errors emitted via events
            });
          };

          if (isPausedFlag) {
            queueTrigger(triggerFn);
          } else {
            triggerFn();
          }
        }, 3000);
      });

      unsubscribers.push(() => {
        unsub();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      });
    } else {
      // M5: warn when trigger configured but system lacks the required API
      console.warn(
        "[directive/architect] onError/onUnmetRequirement triggers configured but system.onSettledChange() is unavailable. These triggers will not fire.",
      );
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
            const triggerFn = () => {
              pipeline.analyze("fact-change").catch(() => {
                // Swallow — errors emitted via events
              });
            };

            if (isPausedFlag) {
              queueTrigger(triggerFn);
            } else {
              triggerFn();
            }
          }, 3000);
        },
      );

      unsubscribers.push(() => {
        unsub();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      });
    } else {
      // M5: warn when trigger configured but system lacks the required API
      console.warn(
        "[directive/architect] onFactChange triggers configured but system.subscribe() is unavailable. These triggers will not fire.",
      );
    }
  }

  if (options.triggers?.onSchedule) {
    const intervalMs = parseInterval(options.triggers.onSchedule);
    scheduleTimer = setInterval(() => {
      if (isPausedFlag) {
        queueTrigger(() => {
          pipeline.analyze("schedule").catch(() => {
            // Swallow — errors emitted via events
          });
        });
      } else {
        pipeline.analyze("schedule").catch(() => {
          // Swallow — errors emitted via events
        });
      }
    }, intervalMs);
  }

  // ---- Wire onHealthDecline — periodic health polling ----
  let healthTimer: ReturnType<typeof setInterval> | undefined;

  if (options.triggers?.onHealthDecline) {
    const healthConfig = options.triggers.onHealthDecline;
    const threshold = healthConfig.threshold ?? 50;
    const minDrop = healthConfig.minDrop ?? 10;
    const pollMs = parseInterval(healthConfig.pollInterval ?? "30s");
    let previousScore = 100; // Start optimistic

    healthTimer = setInterval(() => {
      if (isPausedFlag) {
        return;
      }

      const health = computeHealthScore(options.system);
      const drop = previousScore - health.score;
      const shouldTrigger = health.score < threshold && drop >= minDrop;

      pipeline.emitEvent({
        type: "health-check",
        timestamp: Date.now(),
        score: health.score,
        previousScore,
        threshold,
        triggered: shouldTrigger,
      });

      if (shouldTrigger) {
        const context = `Health score dropped from ${previousScore} to ${health.score} (threshold: ${threshold}). Warnings: ${health.warnings.join("; ")}`;
        pipeline.analyze("health-decline", context).catch(() => {
          // Swallow — errors emitted via events
        });
      }

      previousScore = health.score;
    }, pollMs);
  }

  // E10: BSL notice — gate behind NODE_ENV !== "production" and !silent
  if (!bslPrinted && typeof console !== "undefined" && typeof process !== "undefined" && process.env?.NODE_ENV !== "test" && process.env?.NODE_ENV !== "production" && !options.silent) {
    bslPrinted = true;
    console.info(
      "[directive/architect] AI Architect — BSL 1.1 licensed. Free for open source, personal use, and companies <$1M ARR.",
    );
  }

  // ---- Helper for exportAction / exportPattern ----
  function exportActionInternal(actionId: string, exportOptions?: Parameters<typeof exportPattern>[1]) {
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
  }

  // M7: assertNotDestroyed guard for mutation methods
  function assertNotDestroyed(): void {
    if (isDestroyedFlag) {
      throw new Error("Architect has been destroyed");
    }
  }

  // ---- Build the public interface ----
  // M7: fix on() — proper type discrimination
  const architect: AIArchitect = {
    async analyze(prompt?: string, analyzeOpts?: { mode?: "single" | "plan"; dryRun?: boolean }): Promise<ArchitectAnalysis> {
      assertNotDestroyed();
      await ensureStoriesResolved();

      return pipeline.analyze("demand", undefined, prompt, 0, analyzeOpts?.mode, analyzeOpts?.dryRun);
    },

    approve(actionId: string): Promise<boolean> {
      assertNotDestroyed();

      return pipeline.approve(actionId);
    },

    // M6: reject returns Promise<boolean> for consistency with approve
    reject(actionId: string, reason?: string): Promise<boolean> {
      assertNotDestroyed();

      return Promise.resolve(pipeline.reject(actionId, reason));
    },

    rollback(actionId: string) {
      assertNotDestroyed();

      return pipeline.rollback(actionId);
    },

    previewRollback(actionId: string) {
      return pipeline.previewRollback(actionId);
    },

    rollbackBatch(actionIds: string[]) {
      assertNotDestroyed();

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

    // Item 19: convenience methods for innovation features — M7: all guarded
    discover(discoverOptions?) {
      assertNotDestroyed();
      // M4: route discovery LLM calls through budget tracking
      const trackTokens = (tokens: number) => {
        pipeline.guards.recordTokens(tokens, estimateDollars(tokens));
      };

      return createDiscoverySession(options.system, options.runner, discoverOptions, trackTokens);
    },

    whatIf(action, whatIfOptions?) {
      assertNotDestroyed();
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

      // M4: route what-if LLM calls through budget tracking
      const trackTokens = (tokens: number) => {
        pipeline.guards.recordTokens(tokens, estimateDollars(tokens));
      };

      return createWhatIfAnalysis(options.system, fullAction, options.runner, whatIfOptions, trackTokens);
    },

    graph(graphOptions?) {
      assertNotDestroyed();
      return extractSystemGraph(options.system, {
        ...graphOptions,
        dynamicIds: pipeline._dynamicIds,
      });
    },

    record() {
      assertNotDestroyed();
      return createReplayRecorder(options.system);
    },

    exportAction(actionId, exportOptions?) {
      assertNotDestroyed();
      return exportActionInternal(actionId, exportOptions);
    },

    exportPattern(actionId, exportOptions?) {
      assertNotDestroyed();
      return exportActionInternal(actionId, exportOptions);
    },

    async importPattern(pattern: FederationPattern) {
      assertNotDestroyed();
      return importPattern(pattern, options.system, options.runner);
    },

    getOutcomes() {
      return pipeline.outcomeTracker?.getOutcomes() ?? [];
    },

    getOutcomePatterns() {
      return pipeline.outcomeTracker?.getPatterns() ?? [];
    },

    registerTool(def) {
      assertNotDestroyed();
      pipeline.customToolRegistry.register(def);
    },

    unregisterTool(name) {
      assertNotDestroyed();
      return pipeline.customToolRegistry.unregister(name);
    },

    pause() {
      isPausedFlag = true;
      pipeline.emitEvent({
        type: "paused",
        timestamp: Date.now(),
        queuedTriggers: queuedWhilePaused.length,
      });
    },

    resume() {
      isPausedFlag = false;

      // Drain queued triggers
      const queued = queuedWhilePaused.splice(0);

      pipeline.emitEvent({
        type: "resumed",
        timestamp: Date.now(),
        queuedTriggers: queued.length,
      });

      for (const fn of queued) {
        fn();
      }
    },

    get isPaused() {
      return isPausedFlag;
    },

    async ready(): Promise<void> {
      await ensureStoriesResolved();
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
        isPaused: isPausedFlag,
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

      if (healthTimer) {
        clearInterval(healthTimer);
      }

      // Close metrics provider
      if (options.metrics?.close) {
        options.metrics.close().catch(() => {
          // Swallow — metrics close failure should not crash cleanup
        });
      }

      // Clean up checkpoint timer
      if (checkpointTimer) {
        clearInterval(checkpointTimer);
      }

      // Close persistence stores
      if (options.persistence?.audit?.close) {
        options.persistence.audit.close().catch(() => {});
      }

      if (options.persistence?.checkpoint?.close) {
        options.persistence.checkpoint.close().catch(() => {});
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

/** Apply autonomy preset defaults. Explicit options override. */
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
/**
 * Parse a human-readable interval string into milliseconds.
 *
 * @param interval - Duration string (e.g., `"30s"`, `"5m"`, `"1h"`, `"1d"`).
 * @returns Duration in milliseconds.
 */
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
