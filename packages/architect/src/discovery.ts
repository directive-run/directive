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
  /** Promise that resolves when the session completes naturally (duration timer). */
  done: Promise<DiscoveryReport>;
}

/**
 * Create a discovery session that observes a running system
 * and identifies patterns for missing constraints/resolvers.
 *
 * @param system - The Directive system to observe.
 * @param runner - Optional AgentRunner for AI-powered recommendations.
 * @param options - Duration, max events, and whether to use AI.
 * @param onTokens - Callback for token usage tracking.
 * @returns A DiscoverySession with stop(), progress(), and done promise.
 *
 * @example
 * ```typescript
 * const session = createDiscoverySession(system, runner, { duration: 60_000 });
 * const report = await session.done;
 * console.log(report.patterns);
 * ```
 */
export function createDiscoverySession(
  system: System,
  runner?: AgentRunner,
  options?: DiscoveryOptions,
  onTokens?: (tokens: number) => void,
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

  // E6: cache identifyPatterns() with dirty flag
  let cachedPatterns: DiscoveryPattern[] | null = null;
  let patternsDirty = true;

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

      // E6: mark patterns dirty on new events
      patternsDirty = true;
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

        // E6: mark patterns dirty on new events
        patternsDirty = true;
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
    // E6: return cached patterns if clean
    if (!patternsDirty && cachedPatterns !== null) {
      return cachedPatterns;
    }

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

    // E6: cache result
    cachedPatterns = patterns;
    patternsDirty = false;

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
    // Item 5: include pattern index in prompt for matching
    const prompt = [
      "## Discovery Analysis",
      "",
      "### Current Facts",
      JSON.stringify(facts, null, 2),
      "",
      "### Patterns Found",
      ...patterns.map((p, i) => `- [${i}] [${p.type}] ${p.description} (confidence: ${p.confidence}, factKeys: ${p.factKeys.join(", ") || "none"})`),
      "",
      "### Instructions",
      "Based on these patterns, suggest constraints and/or resolvers to address them.",
      "For each suggestion provide: type (constraint/resolver), id, reasoning, code, and patternIndex (the [index] of the pattern it addresses).",
      "Respond as JSON array: [{ type, id, reasoning, code, patternIndex }]",
    ].join("\n");

    try {
      const result = await runner(
        {
          name: "directive-discovery",
          instructions: "You analyze system patterns and suggest constraints/resolvers.",
        },
        prompt,
      );

      // M4: track tokens through budget
      if (onTokens && typeof result.totalTokens === "number") {
        onTokens(result.totalTokens);
      }

      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output);

      // Try to parse suggestions from LLM output
      let suggestions: Array<{ type: string; id: string; reasoning: string; code: string; patternIndex?: number }> = [];
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

      // Item 5: match recommendation to pattern by patternIndex, fallback to type/factKeys overlap
      return suggestions.map((s, i) => {
        let matchedPattern = patterns[0]!;

        // Try patternIndex from LLM response
        if (typeof s.patternIndex === "number" && patterns[s.patternIndex]) {
          matchedPattern = patterns[s.patternIndex]!;
        } else {
          // Fallback: match by pattern type or factKeys overlap
          const candidate = patterns.find((p) => {
            if (s.type === "constraint" && p.type === "recurring-unmet") {
              return true;
            }

            if (s.type === "resolver" && p.type === "recurring-unmet") {
              return true;
            }

            // Check factKeys overlap
            if (p.factKeys.length > 0 && s.code) {
              return p.factKeys.some((k: string) => String(s.code).includes(k));
            }

            return false;
          });

          if (candidate) {
            matchedPattern = candidate;
          }
        }

        return {
          type: (s.type as "constraint" | "resolver") ?? "constraint",
          id: s.id ?? `discovery-${i}`,
          reasoning: s.reasoning ?? "",
          toSource: () => s.code ?? "",
          pattern: matchedPattern,
        };
      });
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

  // E7: deferred promise for natural completion
  let doneResolve: (report: DiscoveryReport) => void;
  const donePromise = new Promise<DiscoveryReport>((resolve) => {
    doneResolve = resolve;
  });

  durationTimer = setTimeout(() => {
    if (!stopped) {
      reportPromise = buildReport();
      reportPromise.then(doneResolve);
    }
  }, duration);

  return {
    async stop(): Promise<DiscoveryReport> {
      if (reportPromise) {
        return reportPromise;
      }

      const report = await buildReport();
      doneResolve(report);

      return report;
    },

    progress() {
      return {
        eventCount: timeline.length,
        patternCount: identifyPatterns().length,
        elapsedMs: Date.now() - startedAt,
      };
    },

    done: donePromise,
  };
}
