/**
 * Learning mode — human feedback store for AI Architect.
 *
 * Records approval/rejection decisions with reasons, tracks
 * patterns by tool, and formats feedback context for LLM prompts.
 */

import { RingBuffer } from "./ring-buffer.js";

// ============================================================================
// Types
// ============================================================================

/** A single feedback entry recorded on approve/reject. */
export interface FeedbackEntry {
  actionId: string;
  tool: string;
  /** Tool arguments for this action. Named `toolArguments` to avoid shadowing Function.arguments. */
  toolArguments: Record<string, unknown>;
  approved: boolean;
  reason?: string;
  healthDelta?: number;
  risk: string;
  timestamp: number;
}

/** Configuration for the learning feedback system. */
export interface LearningConfig {
  /** Maximum feedback entries to retain. Default: 500. */
  maxEntries?: number;
}

/** Aggregated feedback pattern for a tool. */
export interface FeedbackPattern {
  tool: string;
  /** Approval rate as a ratio 0–1 (e.g., 0.75 means 75% approved). */
  approvalRate: number;
  totalCount: number;
  approvedCount: number;
  rejectedCount: number;
  /** Most common rejection reasons, sorted by frequency (max 5). */
  commonReasons: string[];
}

// ============================================================================
// Feedback Store
// ============================================================================

export interface FeedbackStore {
  /** Record a feedback entry. */
  record(entry: Omit<FeedbackEntry, "timestamp">): void;
  /** Update the health delta for a recorded action. */
  updateHealthDelta(actionId: string, delta: number): void;
  /** Get all recorded entries (newest first). */
  getEntries(): FeedbackEntry[];
  /** Get aggregated patterns by tool. */
  getPatterns(): FeedbackPattern[];
  /** Format feedback context for LLM prompt injection. */
  formatForPrompt(maxEntries?: number): string;
  /** Get a snapshot of all entries for persistence. */
  getSnapshot(): FeedbackEntry[];
  /** Hydrate from a persisted snapshot. */
  hydrate(snapshot: FeedbackEntry[]): void;
  /** Clean up. */
  destroy(): void;
}

/**
 * Create a feedback store that tracks approval/rejection decisions.
 *
 * Follows the OutcomeTracker pattern: closured factory, FIFO store,
 * formatForPrompt(), destroy().
 *
 * @param config - Optional max entries configuration.
 * @returns A FeedbackStore instance.
 */
export function createFeedbackStore(config?: LearningConfig): FeedbackStore {
  const maxEntries = config?.maxEntries ?? 500;
  const entries = new RingBuffer<FeedbackEntry>(maxEntries);
  /** O(1) lookup index: actionId → FeedbackEntry. */
  const entryIndex = new Map<string, FeedbackEntry>();

  function record(entry: Omit<FeedbackEntry, "timestamp">): void {
    const full: FeedbackEntry = {
      ...entry,
      timestamp: Date.now(),
    };
    const evicted = entries.push(full);
    entryIndex.set(full.actionId, full);

    // Remove evicted entry from index
    if (evicted) {
      entryIndex.delete(evicted.actionId);
    }
  }

  function updateHealthDelta(actionId: string, delta: number): void {
    const entry = entryIndex.get(actionId);
    if (entry) {
      entry.healthDelta = delta;
    }
  }

  function getEntries(): FeedbackEntry[] {
    return entries.reversed();
  }

  function getPatterns(): FeedbackPattern[] {
    const byTool = new Map<string, FeedbackEntry[]>();

    for (const e of entries) {
      const existing = byTool.get(e.tool);
      if (existing) {
        existing.push(e);
      } else {
        byTool.set(e.tool, [e]);
      }
    }

    const patterns: FeedbackPattern[] = [];

    for (const [tool, toolEntries] of byTool) {
      const total = toolEntries.length;
      const approved = toolEntries.filter((e) => e.approved).length;
      const rejected = total - approved;

      // Collect unique rejection reasons
      const reasons = new Map<string, number>();
      for (const e of toolEntries) {
        if (!e.approved && e.reason) {
          reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
        }
      }

      // Sort reasons by frequency
      const commonReasons = [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason]) => reason);

      patterns.push({
        tool,
        approvalRate: Math.round((approved / total) * 100) / 100,
        totalCount: total,
        approvedCount: approved,
        rejectedCount: rejected,
        commonReasons,
      });
    }

    // Sort by total count descending
    patterns.sort((a, b) => b.totalCount - a.totalCount);

    return patterns;
  }

  function formatForPrompt(maxDisplay = 10): string {
    const all = entries.toArray();
    if (all.length === 0) {
      return "";
    }

    const lines: string[] = ["### Human Feedback"];

    // Summary by tool
    const patterns = getPatterns();
    for (const p of patterns) {
      const pct = Math.round(p.approvalRate * 100);
      lines.push(`- ${p.tool}: ${p.approvedCount}/${p.totalCount} approved (${pct}%)`);

      if (p.commonReasons.length > 0) {
        lines.push(`  Common rejections: ${p.commonReasons.join(", ")}`);
      }
    }

    // Recent decisions
    const recent = all.slice(-maxDisplay).reverse();
    if (recent.length > 0) {
      lines.push("");
      lines.push("Recent decisions:");
      for (const e of recent) {
        const status = e.approved ? "approved" : "rejected";
        const reason = e.reason ? ` (${e.reason})` : "";
        lines.push(`- ${e.tool}: ${status}${reason}`);
      }
    }

    return lines.join("\n");
  }

  function getSnapshot(): FeedbackEntry[] {
    return entries.toArray();
  }

  function hydrate(snapshot: FeedbackEntry[]): void {
    entries.clear();
    entryIndex.clear();
    for (const entry of snapshot) {
      entries.push(entry);
      entryIndex.set(entry.actionId, entry);
    }
  }

  function destroy(): void {
    entries.clear();
    entryIndex.clear();
  }

  return {
    record,
    updateHealthDelta,
    getEntries,
    getPatterns,
    formatForPrompt,
    getSnapshot,
    hydrate,
    destroy,
  };
}
