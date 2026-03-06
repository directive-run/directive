/**
 * Constraint Discovery Mode — observe a running system and identify
 * patterns that suggest missing constraints/resolvers.
 *
 * Subscribe to system events, collect timeline, identify patterns,
 * optionally send to LLM for recommendations.
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  DiscoveryOptions,
  DiscoveryPattern,
  DiscoveryRecommendation,
  DiscoveryReport,
  DiscoveryTimelineEvent,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DURATION = 300_000; // 5 minutes
const DEFAULT_MAX_EVENTS = 500;

// ============================================================================
// Discovery Session
// ============================================================================

export interface DiscoverySession {
  /** Stop observation early and run analysis. */
  stop(): Promise<DiscoveryReport>;
  /** Check current progress. */
  progress(): { eventCount: number; patternCount: number; elapsedMs: number };
}

/**
 * Create a discovery session that observes a running system
 * and identifies patterns for missing constraints/resolvers.
 */
export function createDiscoverySession(
  system: System,
  runner?: AgentRunner,
  options?: DiscoveryOptions,
): DiscoverySession {
  const duration = options?.duration ?? DEFAULT_DURATION;
  const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const useAI = options?.useAI ?? true;

  const startedAt = Date.now();
  const timeline: DiscoveryTimelineEvent[] = [];
  const unsubscribers: Array<() => void> = [];
  let stopped = false;
  let durationTimer: ReturnType<typeof setTimeout> | undefined;

  // Track fact values for oscillation detection
  const factHistory = new Map<string, unknown[]>();

  // ---- Subscribe to system events ----

  const sys = system as unknown as Record<string, unknown>;

  // Subscribe to fact changes
  if (typeof sys.subscribe === "function") {
    const unsub = (sys.subscribe as (cb: () => void) => () => void)(() => {
      if (stopped || timeline.length >= maxEvents) {
        return;
      }

      const facts = { ...system.facts } as Record<string, unknown>;

      // Track fact history for oscillation detection
      for (const [key, value] of Object.entries(facts)) {
        const history = factHistory.get(key) ?? [];
        history.push(value);

        // Keep last 20 values
        if (history.length > 20) {
          history.shift();
        }

        factHistory.set(key, history);
      }

      timeline.push({
        timestamp: Date.now(),
        type: "fact-change",
        data: { facts },
      });
    });

    unsubscribers.push(unsub);
  }

  // Subscribe to settlement changes
  if (typeof sys.onSettledChange === "function") {
    const unsub = (sys.onSettledChange as (cb: (settled: boolean) => void) => () => void)(
      (settled: boolean) => {
        if (stopped || timeline.length >= maxEvents) {
          return;
        }

        timeline.push({
          timestamp: Date.now(),
          type: "settled",
          data: { settled },
        });
      },
    );

    unsubscribers.push(unsub);
  }

  // ---- Cleanup ----

  function cleanup() {
    stopped = true;

    for (const unsub of unsubscribers) {
      unsub();
    }

    if (durationTimer) {
      clearTimeout(durationTimer);
    }
  }

  // ---- Pattern identification ----

  function identifyPatterns(): DiscoveryPattern[] {
    const patterns: DiscoveryPattern[] = [];

    // Pattern 1: Recurring unmet requirements
    const unmetCounts = new Map<string, number>();

    for (const event of timeline) {
      if (event.type === "settled" && event.data.settled === false) {
        const key = "unsettled";
        unmetCounts.set(key, (unmetCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [_key, count] of unmetCounts) {
      if (count >= 3) {
        patterns.push({
          type: "recurring-unmet",
          description: `System became unsettled ${count} times during observation`,
          occurrences: count,
          factKeys: [],
          confidence: Math.min(0.9, count * 0.15),
        });
      }
    }

    // Pattern 2: Fact oscillation (value changes back and forth)
    for (const [key, history] of factHistory) {
      if (history.length < 4) {
        continue;
      }

      let oscillations = 0;
      for (let i = 2; i < history.length; i++) {
        if (
          JSON.stringify(history[i]) === JSON.stringify(history[i - 2]) &&
          JSON.stringify(history[i]) !== JSON.stringify(history[i - 1])
        ) {
          oscillations++;
        }
      }

      if (oscillations >= 2) {
        patterns.push({
          type: "fact-oscillation",
          description: `Fact "${key}" oscillated ${oscillations} times — value flipped back and forth`,
          occurrences: oscillations,
          factKeys: [key],
          confidence: Math.min(0.85, oscillations * 0.2),
        });
      }
    }

    // Pattern 3: Idle state — no events for long periods
    if (timeline.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < timeline.length; i++) {
        gaps.push(timeline[i]!.timestamp - timeline[i - 1]!.timestamp);
      }

      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const longGaps = gaps.filter((g) => g > avgGap * 5);

      if (longGaps.length > 0) {
        patterns.push({
          type: "idle-state",
          description: `${longGaps.length} long idle period(s) detected — system may need periodic health checks`,
          occurrences: longGaps.length,
          factKeys: [],
          confidence: 0.5,
        });
      }
    }

    return patterns;
  }

  // ---- LLM analysis ----

  async function getAIRecommendations(
    patterns: DiscoveryPattern[],
  ): Promise<DiscoveryRecommendation[]> {
    if (!runner || !useAI || patterns.length === 0) {
      return [];
    }

    const facts = { ...system.facts } as Record<string, unknown>;
    const prompt = [
      "## Discovery Analysis",
      "",
      "### Current Facts",
      JSON.stringify(facts, null, 2),
      "",
      "### Patterns Found",
      ...patterns.map((p) => `- [${p.type}] ${p.description} (confidence: ${p.confidence})`),
      "",
      "### Instructions",
      "Based on these patterns, suggest constraints and/or resolvers to address them.",
      "For each suggestion provide: type (constraint/resolver), id, reasoning, and code.",
      "Respond as JSON array: [{ type, id, reasoning, code }]",
    ].join("\n");

    try {
      const result = await runner(
        {
          name: "directive-discovery",
          instructions: "You analyze system patterns and suggest constraints/resolvers.",
        },
        prompt,
      );

      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output);

      // Try to parse suggestions from LLM output
      let suggestions: Array<{ type: string; id: string; reasoning: string; code: string }> = [];
      try {
        const parsed = JSON.parse(output);
        if (Array.isArray(parsed)) {
          suggestions = parsed;
        }
      } catch {
        // Try to extract JSON array from text
        const match = /\[[\s\S]*\]/.exec(output);
        if (match) {
          try {
            suggestions = JSON.parse(match[0]);
          } catch {
            // Give up
          }
        }
      }

      return suggestions.map((s, i) => ({
        type: (s.type as "constraint" | "resolver") ?? "constraint",
        id: s.id ?? `discovery-${i}`,
        reasoning: s.reasoning ?? "",
        toSource: () => s.code ?? "",
        pattern: patterns[0]!,
      }));
    } catch {
      return [];
    }
  }

  // ---- Build report ----

  async function buildReport(): Promise<DiscoveryReport> {
    cleanup();

    const patterns = identifyPatterns();
    const recommendations = await getAIRecommendations(patterns);

    return {
      patterns,
      recommendations,
      timeline: [...timeline],
      durationMs: Date.now() - startedAt,
      startedAt,
    };
  }

  // ---- Auto-stop after duration ----

  let reportPromise: Promise<DiscoveryReport> | undefined;

  durationTimer = setTimeout(() => {
    if (!stopped) {
      reportPromise = buildReport();
    }
  }, duration);

  return {
    async stop(): Promise<DiscoveryReport> {
      if (reportPromise) {
        return reportPromise;
      }

      return buildReport();
    },

    progress() {
      return {
        eventCount: timeline.length,
        patternCount: identifyPatterns().length,
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}
