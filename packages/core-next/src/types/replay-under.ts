/**
 * Copied from 1.35 (packages/core/src/core/replay-under.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { ClauseResult, FactPredicate } from "./predicate.js";

/** One recorded fact-state frame. */
export interface ReplayFrame<F = Record<string, unknown>> {
  /** Stable identifier — a snapshot id, an index, a session key. */
  id: string | number;
  /** Optional wall-clock time (ms epoch). */
  timestamp?: number;
  /** The fact state at this frame. */
  facts: F;
}

export interface ReplayUnderOptions<F = Record<string, unknown>> {
  /** Recorded frames, chronological order. */
  frames: readonly ReplayFrame<F>[];
  /** The constraint's current `when` predicate (the baseline). */
  original: FactPredicate<F>;
  /** The proposed replacement `when` predicate. */
  proposed: FactPredicate<F>;
  /** Max diff samples to attach per bucket (default 20). */
  maxSamples?: number;
  /**
   * A fact key identifying the entity a frame belongs to (e.g. `"userId"`,
   * `"sessionId"`). When set, the report also reports distinct-entity counts
   * — how many unique entities matched, not just how many frames. Without it
   * the unit is frames: one fact snapshot, not one user or session.
   */
  entityKey?: string;
}

/** A frame where the original and proposed predicate disagree. */
export interface ReplayDiffSample {
  frameId: string | number;
  timestamp?: number;
  /** The fact state at this frame. */
  facts: Record<string, unknown>;
  /** Per-clause breakdown under the original predicate. */
  originalExplain: ClauseResult[];
  /** Per-clause breakdown under the proposed predicate. */
  proposedExplain: ClauseResult[];
}

/**
 * The outcome of replaying a recorded history under two predicates — a
 * static backtest of a proposed rule change, not a behavioral simulation.
 */
export interface PredicateBacktestReport {
  /** Total frames evaluated. */
  framesEvaluated: number;
  /**
   * Frames where the original predicate matched (was true). `matchedEntities`
   * is the count of distinct `entityKey` values among matched frames — only
   * populated when {@link ReplayUnderOptions.entityKey} was supplied.
   */
  original: { matched: number; matchedEntities?: number };
  /** Frames where the proposed predicate matched. */
  proposed: { matched: number; matchedEntities?: number };
  /** proposed.matched - original.matched. */
  delta: number;
  /** Total count of frames that newly match (original false -> proposed true). */
  newMatchCount: number;
  /** Total count of frames that no longer match (original true -> proposed false). */
  lostMatchCount: number;
  /** Frames where original and proposed agree. */
  unchanged: number;
  /** Sampled new-match frames (capped at maxSamples), with clause explain. */
  newMatches: ReplayDiffSample[];
  /** Sampled lost-match frames (capped at maxSamples), with clause explain. */
  lostMatches: ReplayDiffSample[];
}
