/**
 * Predicate backtest — rule-change impact.
 *
 * Given a recorded sequence of fact-state frames and a proposed replacement
 * for a constraint's `when` predicate, re-score the frames against BOTH the
 * original and the proposed predicate and produce a backtest report: how
 * many frames each matched, plus the per-frame diff (frames that newly
 * match / no longer match). It answers "how many recorded frames would the
 * proposed rule have matched differently" against real recorded history.
 *
 * This is a *static* backtest, not a behavioral simulation — the engine is
 * not re-run. Recorded frames are re-scored against a new predicate; the
 * resulting requirements, resolvers, and downstream fact changes are NOT
 * modeled. Treat the numbers as a divergence scan, not a forecast.
 *
 * Pure module — imports only the predicate runtime. No engine, store, or
 * tracking dependency. Replay walks frames in order; for `$changed`-style
 * predicates each frame is evaluated against the previous frame's facts.
 */

import {
  evaluatePredicate,
  evaluatePredicateExplained,
  isPredicate,
  validatePredicate,
  walkPredicate,
} from "./predicate.js";
import type { ClauseResult, FactPredicate } from "./types/predicate.js";
import {
  PREDICATE_COMBINATORS,
  PREDICATE_OPERATORS,
} from "./types/predicate.js";

/**
 * Upper bound on the number of frames a single {@link replayUnder} call will
 * process. A history file is held entirely in memory; an unbounded array is a
 * denial-of-service surface. A history larger than this should be split or
 * down-sampled before replay.
 */
export const MAX_REPLAY_FRAMES = 1_000_000;

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

/**
 * Validate one predicate spec for {@link replayUnder}, re-throwing any failure
 * with a message that names which spec (`original` / `proposed`) was bad.
 *
 * Three checks run, all up front so a malformed spec never reaches the
 * per-frame loop (where {@link evaluatePredicate} would throw a raw error on,
 * say, a `$matches` operand that is not a RegExp):
 *
 *  1. {@link validatePredicate} — JSON-unrehydratable operands (a `$matches`
 *     operand that is not a RegExp, a `bigint`, a `Set`/`Map`).
 *  2. {@link isPredicate} — the spec is structurally a FactPredicate. An
 *     empty object `{}` is a valid (always-true) predicate and is allowed.
 *  3. Unknown `$`-operators — a single walk surfaces any `$frobnicate`-style
 *     typo as one clear error instead of a per-call dev-warn.
 */
function validateReplaySpec(
  spec: unknown,
  which: "original" | "proposed",
): void {
  try {
    validatePredicate(spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    throw new Error(
      `[Directive] replayUnder: the ${which} predicate is invalid — ${message}`,
    );
  }

  if (!isPredicate(spec)) {
    const preview =
      spec === null || typeof spec !== "object"
        ? `${typeof spec} — ${JSON.stringify(spec)}`
        : JSON.stringify(spec).slice(0, 80);

    throw new Error(
      `[Directive] replayUnder: the ${which} predicate is not a valid FactPredicate (got ${preview})`,
    );
  }

  // Surface an unknown `$`-operator (`$frobnicate`) as one clear error.
  // `walkPredicate` reports a `$`-key at fact position via `strayOperatorKey`
  // and an operator clause via `operator`; check both against the known sets.
  let unknownOp: string | undefined;
  walkPredicate(spec, {
    operator(_factPath, op) {
      if (
        unknownOp === undefined &&
        op.startsWith("$") &&
        !PREDICATE_OPERATORS.has(op)
      ) {
        unknownOp = op;
      }
    },
    strayOperatorKey(key) {
      if (
        unknownOp === undefined &&
        !PREDICATE_OPERATORS.has(key) &&
        !PREDICATE_COMBINATORS.has(key)
      ) {
        unknownOp = key;
      }
    },
  });

  if (unknownOp !== undefined) {
    throw new Error(
      `[Directive] replayUnder: the ${which} predicate uses an unknown operator "${unknownOp}" — known operators: ${[...PREDICATE_OPERATORS].join(", ")}`,
    );
  }
}

/**
 * Normalize a parsed-from-JSON history value into a `ReplayFrame[]`.
 *
 * Accepts the three documented history shapes:
 *
 *  1. A bare array of frames:        `[{ id, timestamp?, facts }, ...]`
 *  2. An object wrapping them:       `{ frames: [{ id, ..., facts }, ...] }`
 *  3. A bare array of fact objects:  `[{ phase: "red", ... }, ...]`
 *     — each element is wrapped as a frame.
 *
 * Frame ids are kept unambiguous: a frame that supplies its own `id` keeps
 * it; a frame missing an `id` (and every bare-fact frame) gets an
 * **index-derived** id prefixed with `#` (`"#0"`, `"#1"`, …) so a fallback
 * id can never collide with an explicit numeric or string id in a mixed
 * history. This is a pure helper — it **throws** a clear `Error` on bad
 * input and never calls `process.exit`, so library users can catch it.
 *
 * @example
 * ```ts
 * toReplayFrames([{ id: "s1", facts: { phase: "red" } }]);
 * // → [{ id: "s1", facts: { phase: "red" } }]
 * toReplayFrames([{ phase: "red" }, { phase: "green" }]);
 * // → [{ id: "#0", facts: { phase: "red" } }, { id: "#1", facts: { phase: "green" } }]
 * ```
 */
export function toReplayFrames(raw: unknown): ReplayFrame[] {
  // A history-manager export ({ version, snapshots, currentIndex }) is a
  // valid input shape — route it through framesFromHistory so the CLI and
  // the library accept the same files.
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { snapshots?: unknown }).snapshots)
  ) {
    return framesFromHistory(raw);
  }

  const list: unknown[] | null = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { frames?: unknown }).frames)
      ? (raw as { frames: unknown[] }).frames
      : null;

  if (!list) {
    throw new Error(
      "[Directive] toReplayFrames: history must be a JSON array of frames, an object with a `frames` array, or a history export with a `snapshots` array",
    );
  }

  // Enforce the frame cap on `length` before `.map()` materializes a second
  // array — the cap must bound memory, not just the evaluation loop.
  if (list.length > MAX_REPLAY_FRAMES) {
    throw new Error(
      `[Directive] toReplayFrames: history has ${list.length} frames, exceeds the MAX_REPLAY_FRAMES limit (${MAX_REPLAY_FRAMES}) — split or down-sample the history`,
    );
  }

  return list.map((entry, index) => {
    if (entry && typeof entry === "object" && "facts" in entry) {
      const frame = entry as {
        id?: string | number;
        timestamp?: number;
        facts: unknown;
      };
      // An explicit id is used verbatim; a missing id falls back to a
      // `#`-prefixed index so it cannot collide with an explicit id.
      const out: ReplayFrame = {
        id: frame.id ?? `#${index}`,
        facts: (frame.facts ?? {}) as Record<string, unknown>,
      };
      if (typeof frame.timestamp === "number") {
        out.timestamp = frame.timestamp;
      }

      return out;
    }

    // A bare fact object — wrap it, keyed by `#`-prefixed index.
    return { id: `#${index}`, facts: (entry ?? {}) as Record<string, unknown> };
  });
}

/**
 * Convert a history-manager export (the JSON produced by
 * `system.history.export()`) into a `ReplayFrame[]` ready for
 * {@link replayUnder}.
 *
 * The history manager records a ring buffer of `{ id, timestamp, facts,
 * trigger }` snapshots; `export()` wraps them as `{ version, snapshots,
 * currentIndex }`. Each snapshot's `facts` is the fact state at that point,
 * so the snapshot sequence is exactly a frame stream.
 *
 * Accepts either the parsed export object, the raw JSON string, or a bare
 * array of snapshots. Throws a clear `Error` on bad input.
 *
 * @example
 * ```ts
 * const frames = framesFromHistory(system.history.export());
 * const report = replayUnder({ frames, original, proposed });
 * ```
 */
export function framesFromHistory(historyExport: unknown): ReplayFrame[] {
  const parsed =
    typeof historyExport === "string"
      ? (JSON.parse(historyExport) as unknown)
      : historyExport;

  // A bare snapshot array is accepted directly.
  if (Array.isArray(parsed)) {
    return framesFromSnapshots(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      "[Directive] framesFromHistory: expected a history export object with a `snapshots` array (from system.history.export())",
    );
  }

  const exportObj = parsed as { version?: unknown; snapshots?: unknown };

  // Mirror history.ts import(): only version 1 is understood. A bump in the
  // export format must fail loud here, not silently yield wrong frames.
  if (exportObj.version !== undefined && exportObj.version !== 1) {
    throw new Error(
      `[Directive] framesFromHistory: unsupported history export version ${JSON.stringify(exportObj.version)} — expected 1`,
    );
  }

  if (!Array.isArray(exportObj.snapshots)) {
    throw new Error(
      "[Directive] framesFromHistory: expected a history export object with a `snapshots` array (from system.history.export())",
    );
  }

  return framesFromSnapshots(exportObj.snapshots);
}

/**
 * Convert an array of `{ id, timestamp?, facts }` snapshots — e.g. the
 * `snapshots` field of a history export, or an array assembled by pushing
 * `system.getSnapshot()` on each reconcile — into a `ReplayFrame[]`.
 *
 * Throws a clear `Error` if the argument is not an array. Each snapshot is
 * normalized through the same {@link toReplayFrames} id logic.
 *
 * @example
 * ```ts
 * const snapshots: typeof history[] = [];
 * system.observe(() => snapshots.push(system.getSnapshot()));
 * // ...later
 * const frames = framesFromSnapshots(snapshots);
 * ```
 */
export function framesFromSnapshots(snapshots: unknown): ReplayFrame[] {
  if (!Array.isArray(snapshots)) {
    throw new Error(
      "[Directive] framesFromSnapshots: expected an array of fact-state snapshots",
    );
  }

  if (snapshots.length > MAX_REPLAY_FRAMES) {
    throw new Error(
      `[Directive] framesFromSnapshots: history has ${snapshots.length} snapshots, exceeds the MAX_REPLAY_FRAMES limit (${MAX_REPLAY_FRAMES}) — split or down-sample the history`,
    );
  }

  // A snapshot is always a { facts, ... } object — reject a garbage array
  // before it is silently wrapped into empty-fact frames.
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    if (!s || typeof s !== "object" || !("facts" in s)) {
      throw new Error(
        `[Directive] framesFromSnapshots: snapshot at index ${i} is not a { facts, ... } object`,
      );
    }
  }

  return toReplayFrames(snapshots);
}

/**
 * Replay a recorded fact-frame history through two predicates — the
 * constraint's current `when` and a proposed replacement — and report how
 * their match sets differ.
 *
 * This is a **predicate backtest**: the engine is not re-run. Each recorded
 * frame is statically re-scored against both specs; the previous frame's
 * facts are threaded as `prev` so a replayed effect-`on` predicate using
 * `$changed` still works (for a constraint `when` it is harmless). The
 * report counts matches under each spec and buckets the disagreements into
 * new matches (original false, proposed true) and lost matches (original
 * true, proposed false). Up to `maxSamples` diff frames per bucket carry a
 * per-clause `evaluatePredicateExplained` breakdown for inspection.
 *
 * Both specs are validated up front — a malformed spec throws a clear
 * `[Directive] replayUnder:` error identifying which spec failed, rather
 * than letting a raw `evaluatePredicate` error escape mid-loop.
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
export function replayUnder<F = Record<string, unknown>>(
  options: ReplayUnderOptions<F>,
): PredicateBacktestReport {
  const { frames, original, proposed, entityKey } = options;
  const requested = options.maxSamples ?? 20;
  const maxSamples = requested > 0 ? requested : 0;

  if (frames.length > MAX_REPLAY_FRAMES) {
    throw new Error(
      `[Directive] replayUnder: history has ${frames.length} frames, exceeds the MAX_REPLAY_FRAMES limit (${MAX_REPLAY_FRAMES}) — split or down-sample the history`,
    );
  }

  // Validate both specs before the frame loop — fail loud and clear here
  // rather than at frame 0 with a raw evaluatePredicate stack trace.
  validateReplaySpec(original, "original");
  validateReplaySpec(proposed, "proposed");

  let originalMatched = 0;
  let proposedMatched = 0;
  let newMatchCount = 0;
  let lostMatchCount = 0;
  let unchanged = 0;
  const newMatches: ReplayDiffSample[] = [];
  const lostMatches: ReplayDiffSample[] = [];

  // Distinct-entity tracking — only allocated when `entityKey` was supplied.
  const originalEntities = entityKey ? new Set<unknown>() : undefined;
  const proposedEntities = entityKey ? new Set<unknown>() : undefined;

  let prevFacts: Record<string, unknown> | undefined;

  for (const frame of frames) {
    const facts = frame.facts as Record<string, unknown>;
    const originalBit = evaluatePredicate(original, facts, prevFacts);
    const proposedBit = evaluatePredicate(proposed, facts, prevFacts);

    if (originalBit) {
      originalMatched++;
      originalEntities?.add(facts[entityKey as string]);
    }
    if (proposedBit) {
      proposedMatched++;
      proposedEntities?.add(facts[entityKey as string]);
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

  const report: PredicateBacktestReport = {
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

  if (originalEntities && proposedEntities) {
    report.original.matchedEntities = originalEntities.size;
    report.proposed.matchedEntities = proposedEntities.size;
  }

  return report;
}

/**
 * Build a {@link ReplayDiffSample} for a frame the two predicates disagree
 * on — the per-clause explain is computed only here, never for non-diff
 * frames, so the common (mostly-agreeing) case stays cheap.
 */
function buildSample<F>(
  frame: ReplayFrame<F>,
  original: unknown,
  proposed: unknown,
  prevFacts: Record<string, unknown> | undefined,
): ReplayDiffSample {
  const facts = frame.facts as Record<string, unknown>;
  const sample: ReplayDiffSample = {
    frameId: frame.id,
    facts,
    originalExplain: evaluatePredicateExplained(original, facts, prevFacts),
    proposedExplain: evaluatePredicateExplained(proposed, facts, prevFacts),
  };

  if (frame.timestamp !== undefined) {
    sample.timestamp = frame.timestamp;
  }

  return sample;
}
