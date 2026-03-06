/**
 * Outcome Tracking — track action success/failure and health impact.
 *
 * Records the health score before and after each applied action,
 * aggregates patterns by tool, and formats history for LLM context.
 */

/** A recorded outcome of an applied action. */
export interface ActionOutcome {
  actionId: string;
  tool: string;
  healthBefore: number;
  healthAfter: number;
  healthDelta: number;
  rolledBack: boolean;
  measuredAt: number;
  measurementDelayMs: number;
  trigger: string;
  summary: string;
}

/** Outcome tracking configuration. */
export interface OutcomeTrackingConfig {
  /** Delay before measuring health after an action, in ms. Default: 10000. */
  measurementDelay?: number;
  /** Max outcomes to retain. FIFO eviction. Default: 200. */
  maxOutcomes?: number;
}

/** Aggregated pattern from outcome history. */
export interface OutcomePattern {
  tool: string;
  avgHealthDelta: number;
  count: number;
  /** Fraction of outcomes where health improved (delta > 0). */
  successRate: number;
}

/** Outcome tracker instance. */
export interface OutcomeTracker {
  /** Schedule a health measurement after an action is applied. */
  scheduleOutcome(
    actionId: string,
    tool: string,
    trigger: string,
    summary: string,
    healthBefore: number,
    measureFn: () => number,
  ): void;
  /** Mark an action as rolled back. */
  markRolledBack(actionId: string): void;
  /** Get all recorded outcomes (newest first). */
  getOutcomes(): ActionOutcome[];
  /** Get aggregated patterns by tool. */
  getPatterns(): OutcomePattern[];
  /** Format outcomes for LLM context injection. */
  formatForPrompt(maxEntries?: number): string;
  /** Clean up pending timers. */
  destroy(): void;
}

/**
 * Create an outcome tracker.
 */
export function createOutcomeTracker(config?: OutcomeTrackingConfig): OutcomeTracker {
  const measurementDelay = config?.measurementDelay ?? 10_000;
  const maxOutcomes = config?.maxOutcomes ?? 200;

  const outcomes: ActionOutcome[] = [];
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function scheduleOutcome(
    actionId: string,
    tool: string,
    trigger: string,
    summary: string,
    healthBefore: number,
    measureFn: () => number,
  ): void {
    const timer = setTimeout(() => {
      pendingTimers.delete(actionId);

      const healthAfter = measureFn();
      const outcome: ActionOutcome = {
        actionId,
        tool,
        healthBefore,
        healthAfter,
        healthDelta: healthAfter - healthBefore,
        rolledBack: false,
        measuredAt: Date.now(),
        measurementDelayMs: measurementDelay,
        trigger,
        summary,
      };

      // FIFO eviction
      if (outcomes.length >= maxOutcomes) {
        outcomes.shift();
      }

      outcomes.push(outcome);
    }, measurementDelay);

    pendingTimers.set(actionId, timer);
  }

  function markRolledBack(actionId: string): void {
    // Cancel pending measurement if not yet recorded
    const timer = pendingTimers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(actionId);
    }

    // Mark existing outcome as rolled back
    const outcome = outcomes.find((o) => o.actionId === actionId);
    if (outcome) {
      outcome.rolledBack = true;
    }
  }

  function getOutcomes(): ActionOutcome[] {
    return [...outcomes].reverse();
  }

  function getPatterns(): OutcomePattern[] {
    const byTool = new Map<string, ActionOutcome[]>();

    for (const o of outcomes) {
      const existing = byTool.get(o.tool);
      if (existing) {
        existing.push(o);
      } else {
        byTool.set(o.tool, [o]);
      }
    }

    const patterns: OutcomePattern[] = [];

    for (const [tool, toolOutcomes] of byTool) {
      const count = toolOutcomes.length;
      const totalDelta = toolOutcomes.reduce((sum, o) => sum + o.healthDelta, 0);
      const successes = toolOutcomes.filter((o) => o.healthDelta > 0).length;

      patterns.push({
        tool,
        avgHealthDelta: Math.round((totalDelta / count) * 10) / 10,
        count,
        successRate: Math.round((successes / count) * 100) / 100,
      });
    }

    // Sort by success rate descending
    patterns.sort((a, b) => b.successRate - a.successRate);

    return patterns;
  }

  function formatForPrompt(maxEntries = 10): string {
    const recent = outcomes.slice(-maxEntries).reverse();

    if (recent.length === 0) {
      return "";
    }

    const lines: string[] = ["### Recent Action Outcomes"];

    for (const o of recent) {
      const delta = o.healthDelta >= 0 ? `+${o.healthDelta}` : `${o.healthDelta}`;
      const status = o.rolledBack ? " (rolled back)" : o.healthDelta > 0 ? "" : " ⚠";
      lines.push(`- ${o.tool} "${o.summary}": health ${delta} (${o.healthBefore}→${o.healthAfter})${status}`);
    }

    const patterns = getPatterns();
    if (patterns.length > 0) {
      lines.push("");
      lines.push("### Outcome Patterns");

      for (const p of patterns) {
        const delta = p.avgHealthDelta >= 0 ? `+${p.avgHealthDelta}` : `${p.avgHealthDelta}`;
        lines.push(`- ${p.tool}: ${p.count} uses, ${delta} avg health, ${Math.round(p.successRate * 100)}% success`);
      }
    }

    return lines.join("\n");
  }

  function destroy(): void {
    for (const timer of pendingTimers.values()) {
      clearTimeout(timer);
    }

    pendingTimers.clear();
  }

  return {
    scheduleOutcome,
    markRolledBack,
    getOutcomes,
    getPatterns,
    formatForPrompt,
    destroy,
  };
}
