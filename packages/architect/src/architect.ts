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
} from "./types.js";
import { createPipeline } from "./pipeline.js";

// ============================================================================
// Mutex: one architect per system
// ============================================================================

const attachedSystems = new WeakMap<System, true>();

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

  // ---- Warn on short schedule intervals ----
  if (options.triggers?.onSchedule) {
    const scheduleMs = parseInterval(options.triggers.onSchedule);
    if (scheduleMs < 60_000) {
      console.warn(
        `[directive/architect] onSchedule interval "${options.triggers.onSchedule}" is less than 60s. This may cause excessive LLM calls.`,
      );
    }
  }

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
    const sys = options.system as Record<string, unknown>;
    if (typeof sys.onSettledChange === "function") {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const unsub = (sys.onSettledChange as (cb: () => void) => () => void)(() => {
        // Debounce to avoid rapid triggers
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          pipeline.analyze("schedule").catch(() => {
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

  // M3: wire onFactChange via system.subscribe()
  if (options.triggers?.onFactChange && options.triggers.onFactChange.length > 0) {
    const sys = options.system as Record<string, unknown>;
    if (typeof sys.subscribe === "function") {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      const unsub = (sys.subscribe as (cb: () => void) => () => void)(() => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          pipeline.analyze("fact-change").catch(() => {
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

  if (options.triggers?.onSchedule) {
    const intervalMs = parseInterval(options.triggers.onSchedule);
    scheduleTimer = setInterval(() => {
      pipeline.analyze("schedule").catch(() => {
        // Swallow — errors emitted via events
      });
    }, intervalMs);
  }

  // E4: gate BSL notice behind NODE_ENV !== 'test'
  if (typeof console !== "undefined" && typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
    console.info(
      "[directive/architect] AI Architect — BSL 1.1 licensed. Free for open source, personal use, and companies <$1M ARR.",
    );
  }

  // ---- Build the public interface ----
  // M7: fix on() — proper type discrimination
  const architect: AIArchitect = {
    analyze(prompt?: string): Promise<ArchitectAnalysis> {
      return pipeline.analyze("demand", undefined, prompt);
    },

    approve(actionId: string): Promise<boolean> {
      return pipeline.approve(actionId);
    },

    reject(actionId: string): boolean {
      return pipeline.reject(actionId);
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

    destroy() {
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

/** Parse a human-readable interval string to milliseconds. */
function parseInterval(interval: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(interval.trim());
  if (!match) {
    throw new Error(
      `Invalid interval: "${interval}". Use format like "30s", "5m", "1h".`,
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
    default:
      return value * 1000;
  }
}
