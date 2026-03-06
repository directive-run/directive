/**
 * Adaptive Analysis Context — enrich LLM prompts with historical data.
 *
 * Consumes outcome history, health trends, and template effectiveness
 * to help the AI make better decisions over time.
 */

import type { ActionOutcome, OutcomePattern } from "./outcomes.js";

// ============================================================================
// Health Trend
// ============================================================================

export interface HealthTrend {
  /** Record a health score sample. */
  record(score: number): void;
  /** Get all recorded samples. */
  getSamples(): Array<{ score: number; timestamp: number }>;
  /** Determine the trend direction. */
  direction(): "improving" | "declining" | "stable";
  /** Format the trend for LLM prompt. */
  formatForPrompt(): string;
}

/**
 * Create a health trend tracker.
 */
export function createHealthTrend(maxSamples = 20): HealthTrend {
  const samples: Array<{ score: number; timestamp: number }> = [];

  function record(score: number): void {
    if (samples.length >= maxSamples) {
      samples.shift();
    }

    samples.push({ score, timestamp: Date.now() });
  }

  function getSamples(): Array<{ score: number; timestamp: number }> {
    return [...samples];
  }

  function direction(): "improving" | "declining" | "stable" {
    if (samples.length < 2) {
      return "stable";
    }

    // Compare last 3 samples (or fewer)
    const recent = samples.slice(-3);
    const first = recent[0]!.score;
    const last = recent[recent.length - 1]!.score;
    const delta = last - first;

    if (delta > 3) {
      return "improving";
    }

    if (delta < -3) {
      return "declining";
    }

    return "stable";
  }

  function formatForPrompt(): string {
    if (samples.length === 0) {
      return "";
    }

    const dir = direction();
    const arrow = dir === "improving" ? "↗" : dir === "declining" ? "↘" : "→";
    const scores = samples.slice(-5).map((s) => s.score).join(" → ");

    return `### Health Trend: ${dir} ${arrow} (${scores})`;
  }

  return {
    record,
    getSamples,
    direction,
    formatForPrompt,
  };
}

// ============================================================================
// Adaptive Context Builder
// ============================================================================

/** Data passed to the adaptive context builder. */
export interface AdaptiveContextData {
  outcomes: ActionOutcome[];
  patterns: OutcomePattern[];
  healthTrend: Array<{ score: number; timestamp: number }>;
  templateStats: Array<{ templateId: string; timesUsed: number; avgHealthDelta: number }>;
}

/** Configuration for adaptive context generation. */
export interface AdaptiveContextConfig {
  includeOutcomes?: boolean;
  includeHealthTrend?: boolean;
  includeTemplateStats?: boolean;
  maxOutcomeEntries?: number;
  customBuilder?: (data: AdaptiveContextData) => string;
}

/**
 * Build adaptive context string for LLM prompt enrichment.
 */
export function buildAdaptiveContext(
  data: AdaptiveContextData,
  config?: AdaptiveContextConfig,
): string {
  const includeOutcomes = config?.includeOutcomes ?? true;
  const includeHealthTrend = config?.includeHealthTrend ?? true;
  const includeTemplateStats = config?.includeTemplateStats ?? true;
  const maxOutcomeEntries = config?.maxOutcomeEntries ?? 10;

  const sections: string[] = [];

  // Outcomes section
  if (includeOutcomes && data.outcomes.length > 0) {
    const lines: string[] = [`### Recent Outcomes (last ${Math.min(data.outcomes.length, maxOutcomeEntries)})`];
    const recent = data.outcomes.slice(0, maxOutcomeEntries);

    for (const o of recent) {
      const delta = o.healthDelta >= 0 ? `+${o.healthDelta}` : `${o.healthDelta}`;
      const status = o.rolledBack ? " (rolled back)" : o.healthDelta > 0 ? " ✓" : " ⚠";
      lines.push(`- ${o.tool} "${o.summary}": health ${delta} (${o.healthBefore}→${o.healthAfter})${status}`);
    }

    sections.push(lines.join("\n"));
  }

  // Patterns section
  if (includeOutcomes && data.patterns.length > 0) {
    const lines: string[] = ["### Patterns"];

    for (const p of data.patterns) {
      const delta = p.avgHealthDelta >= 0 ? `+${p.avgHealthDelta}` : `${p.avgHealthDelta}`;
      lines.push(`- ${p.tool}: ${p.count} uses, ${delta} avg health, ${Math.round(p.successRate * 100)}% success`);
    }

    sections.push(lines.join("\n"));
  }

  // Health trend section
  if (includeHealthTrend && data.healthTrend.length > 0) {
    const scores = data.healthTrend.slice(-5).map((s) => s.score);
    const first = scores[0]!;
    const last = scores[scores.length - 1]!;
    const delta = last - first;
    const dir = delta > 3 ? "improving ↗" : delta < -3 ? "declining ↘" : "stable →";

    sections.push(`### Health Trend: ${dir} (${scores.join(" → ")})`);
  }

  // Template stats section
  if (includeTemplateStats && data.templateStats.length > 0) {
    const lines: string[] = ["### Template Effectiveness"];

    for (const t of data.templateStats) {
      const delta = t.avgHealthDelta >= 0 ? `+${t.avgHealthDelta}` : `${t.avgHealthDelta}`;
      lines.push(`- "${t.templateId}": ${t.timesUsed} uses, ${delta} avg health`);
    }

    sections.push(lines.join("\n"));
  }

  // Guidance section
  if (data.patterns.length > 0) {
    const lines: string[] = ["### Guidance"];
    const bestPattern = data.patterns[0]; // Already sorted by success rate
    if (bestPattern) {
      lines.push(`- Prefer ${bestPattern.tool} (highest success rate: ${Math.round(bestPattern.successRate * 100)}%)`);
    }

    const bestTemplate = data.templateStats.sort((a, b) => b.avgHealthDelta - a.avgHealthDelta)[0];
    if (bestTemplate && bestTemplate.avgHealthDelta > 0) {
      lines.push(`- Template "${bestTemplate.templateId}" proven effective (+${bestTemplate.avgHealthDelta} avg health)`);
    }

    if (lines.length > 1) {
      sections.push(lines.join("\n"));
    }
  }

  if (sections.length === 0) {
    return "";
  }

  // Custom builder appends additional context
  let result = "## Learning Context\n\n" + sections.join("\n\n");
  if (config?.customBuilder) {
    const custom = config.customBuilder(data);
    if (custom) {
      result += "\n\n" + custom;
    }
  }

  return result;
}
