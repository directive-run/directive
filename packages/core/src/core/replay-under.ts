/**
 * Counterfactual rule replay.
 *
 * Given a recorded sequence of fact-state frames and a proposed replacement
 * for a constraint's `when` predicate, replay the frames through BOTH the
 * original and the proposed predicate and produce a counterfactual report:
 * how many frames each matched, plus the per-frame diff (frames that newly
 * match / no longer match). It answers "how many users would this rule
 * change have affected?" against real recorded history.
 *
 * Pure module — imports only the predicate runtime. No engine, store, or
 * tracking dependency. Replay walks frames in order; for `$changed`-style
 * predicates each frame is evaluated against the previous frame's facts.
 */

import { evaluatePredicate, evaluatePredicateExplained } from "./predicate.js";
import type { ClauseResult } from "./types/predicate.js";

/** One recorded fact-state frame. */
export interface ReplayFrame {
  /** Stable identifier — a snapshot id, an index, a session key. */
  id: string | number;
  /** Optional wall-clock time (ms epoch). */
  timestamp?: number;
  /** The fact state at this frame. */
  facts: Record<string, unknown>;
}

export interface ReplayUnderOptions {
  /** Recorded frames, chronological order. */
  frames: readonly ReplayFrame[];
  /** The constraint's current `when` predicate (the baseline). */
  original: unknown;
  /** The proposed replacement `when` predicate. */
  proposed: unknown;
  /** Max diff samples to attach per bucket (default 20). */
  maxSamples?: number;
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

export interface CounterfactualReport {
  /** Total frames evaluated. */
  framesEvaluated: number;
  /** Frames where the original predicate matched (was true). */
  original: { matched: number };
  /** Frames where the proposed predicate matched. */
  proposed: { matched: number };
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

/**
 * Replay a recorded fact-frame history through two predicates — the
 * constraint's current `when` and a proposed replacement — and report how
 * their match sets differ.
 *
 * Each frame is evaluated against both specs; the previous frame's facts are
 * threaded as `prev` so a replayed effect-`on` predicate using `$changed`
 * still works (for a constraint `when` it is harmless). The report counts
 * matches under each spec and buckets the disagreements into new matches
 * (original false, proposed true) and lost matches (original true, proposed
 * false). Up to `maxSamples` diff frames per bucket carry a per-clause
 * `evaluatePredicateExplained` breakdown for inspection.
 *
 * @example
 * ```ts
 * const report = replayUnder({
 *   frames: [
 *     { id: 0, facts: { phase: "red", elapsed: 10 } },
 *     { id: 1, facts: { phase: "red", elapsed: 35 } },
 *   ],
 *   original: { phase: "red" },
 *   proposed: { phase: "red", elapsed: { $gte: 30 } },
 * });
 * // report.original.matched  === 2
 * // report.proposed.matched  === 1
 * // report.delta             === -1
 * // report.lostMatchCount    === 1
 * ```
 */
export function replayUnder(options: ReplayUnderOptions): CounterfactualReport {
  const { frames, original, proposed } = options;
  const requested = options.maxSamples ?? 20;
  const maxSamples = requested > 0 ? requested : 0;

  let originalMatched = 0;
  let proposedMatched = 0;
  let newMatchCount = 0;
  let lostMatchCount = 0;
  let unchanged = 0;
  const newMatches: ReplayDiffSample[] = [];
  const lostMatches: ReplayDiffSample[] = [];

  let prevFacts: Record<string, unknown> | undefined;

  for (const frame of frames) {
    const facts = frame.facts;
    const originalBit = evaluatePredicate(original, facts, prevFacts);
    const proposedBit = evaluatePredicate(proposed, facts, prevFacts);

    if (originalBit) {
      originalMatched++;
    }
    if (proposedBit) {
      proposedMatched++;
    }

    if (originalBit === proposedBit) {
      unchanged++;
    } else if (!originalBit && proposedBit) {
      newMatchCount++;
      if (newMatches.length < maxSamples) {
        newMatches.push(buildSample(frame, original, proposed, prevFacts));
      }
    } else {
      lostMatchCount++;
      if (lostMatches.length < maxSamples) {
        lostMatches.push(buildSample(frame, original, proposed, prevFacts));
      }
    }

    prevFacts = facts;
  }

  return {
    framesEvaluated: frames.length,
    original: { matched: originalMatched },
    proposed: { matched: proposedMatched },
    delta: proposedMatched - originalMatched,
    newMatchCount,
    lostMatchCount,
    unchanged,
    newMatches,
    lostMatches,
  };
}

/**
 * Build a {@link ReplayDiffSample} for a frame the two predicates disagree
 * on — the per-clause explain is computed only here, never for non-diff
 * frames, so the common (mostly-agreeing) case stays cheap.
 */
function buildSample(
  frame: ReplayFrame,
  original: unknown,
  proposed: unknown,
  prevFacts: Record<string, unknown> | undefined,
): ReplayDiffSample {
  const sample: ReplayDiffSample = {
    frameId: frame.id,
    facts: frame.facts,
    originalExplain: evaluatePredicateExplained(original, frame.facts, prevFacts),
    proposedExplain: evaluatePredicateExplained(proposed, frame.facts, prevFacts),
  };

  if (frame.timestamp !== undefined) {
    sample.timestamp = frame.timestamp;
  }

  return sample;
}
