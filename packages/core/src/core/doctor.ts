/**
 * doctor — "this rule contradicts an existing rule" gate (v1 stub).
 *
 * Walks a candidate FactPredicate against an existing system's
 * constraint set (via `system.inspect().constraints`), flagging:
 *
 *   - **direct contradiction:** same fact path, opposite-direction
 *     comparison (`$gte 50` vs `$lt 50` — they cannot both fire).
 *     Reported under `contradictions`.
 *   - **subset:** candidate's range is a strict subset of an existing
 *     constraint's range (candidate `$gte 100` when existing already
 *     has `$gte 50`; the new rule is redundant). Reported under
 *     `warnings` — a redundant rule is not a contradiction, just noise.
 *   - **overlap:** shares ≥1 fact path with non-trivial intersection —
 *     a warning, not a hard error.
 *
 * Pairs with `predicateFromIntent`: an LLM-emitted predicate can be
 * doctor-checked before assignment, and contradictions fed back into
 * the LLM's retry prompt.
 *
 * This is a **structural** v1. Full SMT-lite (Z3.wasm) is deferred to
 * a dedicated R4.B sprint; the primitive of "doctor says no" is what
 * this slice ships. False negatives are acceptable (no contradiction
 * reported when one exists in semantics that the structural checker
 * can't see). False positives (contradiction reported where none
 * exists) are NOT acceptable — every reported contradiction must be
 * defensible.
 *
 * **v1 scope LIMITATION (M4):** `checkAgainst` operates on predicate
 * logic only. It does NOT consult `bind:` / `owns:` resolver metadata —
 * a candidate that would *write* to a fact owned by another constraint
 * will not be flagged here. Use `doctor.checkOwns()` for that gate.
 *
 * **INVARIANT (M11):** `checkAgainst` depends on `flattenPredicate`
 * emitting `{ path, op, value }` LeafClause shape — if that shape ever
 * changes, every comparison below silently breaks. See
 * `doctor-leaf-shape.contract.test.ts`.
 *
 * Pure, sync, no engine dependency.
 */

import { type LeafClause, flattenPredicate } from "./rules-diff.js";
import type { FactPredicate } from "./types/predicate.js";

// ============================================================================
// Types
// ============================================================================

export type ContradictionType = "direct" | "subset" | "overlap";

export interface Contradiction {
  /** ID of the existing constraint that conflicts with the candidate. */
  readonly constraintId: string;
  /** Type of contradiction detected. */
  readonly type: ContradictionType;
  /** Human-readable explanation, suitable for showing to a user or LLM. */
  readonly reason: string;
  /** Path on the candidate predicate that triggered the finding. */
  readonly candidatePath?: string;
  /** Operator + value on the candidate side. */
  readonly candidate?: { op: string; value: unknown };
  /** Operator + value on the existing side. */
  readonly existing?: { op: string; value: unknown };
}

export interface CheckAgainstResult {
  /**
   * Hard contradictions — candidate never co-fires with existing rule.
   * Includes only `type: "direct"` findings. Redundancy (`type: "subset"`)
   * lives under `warnings` — a redundant rule is noise, not a conflict.
   */
  readonly contradictions: readonly Contradiction[];
  /**
   * Soft findings — shared facts with non-trivial intersection
   * (`type: "overlap"`) AND subset redundancy (`type: "subset"`).
   */
  readonly warnings: readonly Contradiction[];
}

/** Shape of `system.inspect().constraints[N]` we care about — accepts any superset. */
export interface ExistingConstraint {
  readonly id: string;
  readonly whenSpec?: unknown;
  /**
   * Fact paths the constraint's resolver(s) write to, if exposed by the
   * inspect API. Consulted by {@link doctor.checkOwns} to flag candidates
   * that would write to fields owned elsewhere. Optional — older inspect
   * payloads omit it.
   */
  readonly owns?: readonly string[];
  /** Same as {@link owns} but for the bind: side of binding metadata. */
  readonly bind?: readonly string[];
}

/**
 * Returned by {@link doctor.checkOwns}.
 *
 * `severity` matches the {@link Contradiction} discriminator on
 * {@link CheckAgainstResult} so callers can route both shapes
 * uniformly: by default, owns-collisions are `"warning"` (the engine
 * still has a runtime gate), but a caller can promote them to
 * `"error"` for stricter pre-deploy linting. (M5)
 */
export interface CheckOwnsFinding {
  readonly constraintId: string;
  /** The fact path on the candidate predicate that triggered the finding. */
  readonly candidatePath: string;
  /** The owner side it would collide with: "owns" or "bind". */
  readonly source: "owns" | "bind";
  readonly reason: string;
  /**
   * Severity discriminator — `"warning"` by default (the engine has
   * its own runtime gate), `"error"` reserved for callers that want
   * strict pre-deploy lints. (M5)
   */
  readonly severity?: "error" | "warning";
}

/**
 * Result of {@link doctor.checkOwns}.
 *
 * Owns-/bind- collisions are warnings, not contradictions — the engine
 * itself enforces the runtime binding gate, so a pre-deploy doctor pass
 * treats them as advisory. The {@link CheckOwnsFinding.severity}
 * discriminator anticipates v2 promotion of findings to errors. (M5, F-3)
 */
export interface CheckOwnsResult {
  /**
   * Owns-/bind- collisions surfaced by {@link doctor.checkOwns}. Empty
   * when constraints expose no `owns:` / `bind:` metadata or the
   * candidate's fact paths don't overlap.
   */
  readonly warnings: readonly CheckOwnsFinding[];
}

// ============================================================================
// Operator polarity (for direct-contradiction detection)
// ============================================================================

const COMPARABLE_OPS = new Set([
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
]);

/**
 * Numeric comparison: returns -1 if a < b, 0 if equal, 1 if a > b, NaN
 * if not comparable. Compares numbers, bigints, dates, strings lex.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "bigint" && typeof b === "bigint") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (a instanceof Date && b instanceof Date) {
    const da = a.getTime();
    const db = b.getTime();

    return da < db ? -1 : da > db ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  return Number.NaN;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }

    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Per-path contradiction check
// ============================================================================

/**
 * Given two clauses on the same fact path, return the contradiction
 * type (or null when they don't contradict / overlap).
 *
 * @example
 *   candidate `$gte 100` vs existing `$lt 50` → "direct"
 *   candidate `$gte 100` vs existing `$gte 50` → "subset"
 *   candidate `$gte 50`  vs existing `$lt 100` → "overlap"
 *   candidate `$eq "a"`  vs existing `$ne "a"` → "direct"
 */
function compareClauses(
  cand: LeafClause,
  exi: LeafClause,
): { type: ContradictionType; reason: string } | null {
  // Only structurally-comparable operators are decidable here.
  if (!COMPARABLE_OPS.has(cand.op) || !COMPARABLE_OPS.has(exi.op)) {
    // Shared path with non-comparable operators → soft overlap.
    return { type: "overlap", reason: `Both rules touch "${cand.path}".` };
  }

  // ---- $eq / $ne pairs ----
  if (cand.op === "$eq" && exi.op === "$eq") {
    if (deepEqual(cand.value, exi.value)) {
      return {
        type: "subset",
        reason: `Both rules require ${cand.path} = ${JSON.stringify(cand.value)} — candidate is redundant.`,
      };
    }

    return {
      type: "direct",
      reason: `Candidate requires ${cand.path} = ${JSON.stringify(cand.value)} but an existing rule requires ${cand.path} = ${JSON.stringify(exi.value)} — they cannot both fire.`,
    };
  }
  if (cand.op === "$eq" && exi.op === "$ne") {
    if (deepEqual(cand.value, exi.value)) {
      return {
        type: "direct",
        reason: `Candidate requires ${cand.path} = ${JSON.stringify(cand.value)} but an existing rule excludes that value.`,
      };
    }

    return null;
  }
  if (cand.op === "$ne" && exi.op === "$eq") {
    if (deepEqual(cand.value, exi.value)) {
      return {
        type: "direct",
        reason: `Candidate excludes ${cand.path} = ${JSON.stringify(cand.value)} but an existing rule requires that exact value.`,
      };
    }

    return null;
  }

  // ---- $in / $nin pairs ----
  if (cand.op === "$in" && exi.op === "$in") {
    const candSet = new Set(Array.isArray(cand.value) ? cand.value : []);
    const exiSet = new Set(Array.isArray(exi.value) ? exi.value : []);
    const inter = [...candSet].filter((v) => exiSet.has(v));
    if (inter.length === 0) {
      return {
        type: "direct",
        reason: `Candidate $in set for ${cand.path} (${JSON.stringify([...candSet])}) and existing $in set (${JSON.stringify([...exiSet])}) have no values in common — the candidate can never fire while the existing rule holds.`,
      };
    }
    if (inter.length === candSet.size && inter.length < exiSet.size) {
      return {
        type: "subset",
        reason: `Candidate $in set for ${cand.path} is a strict subset of the existing rule's $in set.`,
      };
    }

    return null;
  }

  // ---- Order comparisons: $gt / $gte / $lt / $lte ----
  // Two range comparisons over the same fact; check for empty intersection.
  const candLow =
    cand.op === "$gt" || cand.op === "$gte" ? cand.value : undefined;
  const candHi =
    cand.op === "$lt" || cand.op === "$lte" ? cand.value : undefined;
  const exiLow = exi.op === "$gt" || exi.op === "$gte" ? exi.value : undefined;
  const exiHi = exi.op === "$lt" || exi.op === "$lte" ? exi.value : undefined;

  // candidate lower bound vs existing upper bound — disjoint?
  if (candLow !== undefined && exiHi !== undefined) {
    const cmp = compareValues(candLow, exiHi);
    if (!Number.isNaN(cmp)) {
      if (cmp > 0 || (cmp === 0 && (cand.op === "$gt" || exi.op === "$lt"))) {
        return {
          type: "direct",
          reason: `Candidate requires ${cand.path} ${cand.op === "$gt" ? ">" : "≥"} ${JSON.stringify(candLow)} but an existing rule caps it at ${exi.op === "$lt" ? "<" : "≤"} ${JSON.stringify(exiHi)}.`,
        };
      }
    }
  }

  // existing lower bound vs candidate upper bound — disjoint?
  if (exiLow !== undefined && candHi !== undefined) {
    const cmp = compareValues(exiLow, candHi);
    if (!Number.isNaN(cmp)) {
      if (cmp > 0 || (cmp === 0 && (exi.op === "$gt" || cand.op === "$lt"))) {
        return {
          type: "direct",
          reason: `Candidate caps ${cand.path} at ${cand.op === "$lt" ? "<" : "≤"} ${JSON.stringify(candHi)} but an existing rule requires it ${exi.op === "$gt" ? ">" : "≥"} ${JSON.stringify(exiLow)}.`,
        };
      }
    }
  }

  // Same direction → check subset.
  if (candLow !== undefined && exiLow !== undefined) {
    const cmp = compareValues(candLow, exiLow);
    if (!Number.isNaN(cmp) && cmp > 0) {
      return {
        type: "subset",
        reason: `Candidate's lower bound on ${cand.path} (${JSON.stringify(candLow)}) is stricter than the existing rule's lower bound (${JSON.stringify(exiLow)}) — candidate is a subset.`,
      };
    }
  }
  if (candHi !== undefined && exiHi !== undefined) {
    const cmp = compareValues(candHi, exiHi);
    if (!Number.isNaN(cmp) && cmp < 0) {
      return {
        type: "subset",
        reason: `Candidate's upper bound on ${cand.path} (${JSON.stringify(candHi)}) is stricter than the existing rule's upper bound (${JSON.stringify(exiHi)}) — candidate is a subset.`,
      };
    }
  }

  // Fall through — overlap.
  return { type: "overlap", reason: `Both rules constrain "${cand.path}".` };
}

// ============================================================================
// Public API
// ============================================================================

function isExistingConstraint(v: unknown): v is ExistingConstraint {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ExistingConstraint).id === "string"
  );
}

export const doctor = {
  /**
   * Check a candidate predicate against existing constraints. Returns
   * contradictions (hard) + warnings (soft overlaps).
   *
   * @param candidate - The proposed predicate (typically LLM-emitted).
   * @param existing  - Either `system.inspect().constraints` directly,
   *                    or any array of `{ id, whenSpec? }` shapes.
   *                    Constraints without `whenSpec` (function-form
   *                    `when:`) are skipped — they're opaque to us.
   *
   * @example
   * ```ts
   * const candidate = { cartTotal: { $gte: 100 } };
   * const report = doctor.checkAgainst(
   *   candidate,
   *   system.inspect().constraints,
   * );
   * // → {
   * //     contradictions: [
   * //       { constraintId: "freeShipping", type: "subset",
   * //         reason: "Candidate's lower bound on cartTotal..." }
   * //     ],
   * //     warnings: []
   * //   }
   * ```
   */
  checkAgainst<F = Record<string, unknown>>(
    candidate: FactPredicate<F>,
    existing:
      | readonly ExistingConstraint[]
      | { constraints: readonly ExistingConstraint[] },
  ): CheckAgainstResult {
    const constraints: readonly ExistingConstraint[] = Array.isArray(existing)
      ? existing
      : "constraints" in existing && Array.isArray(existing.constraints)
        ? existing.constraints
        : [];

    const candidateLeaves = flattenPredicate(candidate);
    if (candidateLeaves.length === 0) {
      return { contradictions: [], warnings: [] };
    }

    const candidateByPath = new Map<string, LeafClause[]>();
    for (const leaf of candidateLeaves) {
      const existingList = candidateByPath.get(leaf.path) ?? [];
      existingList.push(leaf);
      candidateByPath.set(leaf.path, existingList);
    }

    const contradictions: Contradiction[] = [];
    const warnings: Contradiction[] = [];

    for (const c of constraints) {
      if (!isExistingConstraint(c)) continue;
      if (c.whenSpec === undefined) continue; // function-form `when:` — opaque

      const exiLeaves = flattenPredicate(c.whenSpec);
      for (const exi of exiLeaves) {
        const candLeaves = candidateByPath.get(exi.path);
        if (!candLeaves) continue;
        for (const cand of candLeaves) {
          const verdict = compareClauses(cand, exi);
          if (!verdict) continue;
          const finding: Contradiction = {
            constraintId: c.id,
            type: verdict.type,
            reason: verdict.reason,
            candidatePath: cand.path,
            candidate: { op: cand.op, value: cand.value },
            existing: { op: exi.op, value: exi.value },
          };
          // M17: subset findings are redundancy warnings, not contradictions.
          // A candidate whose range is a strict subset of an existing rule's
          // range can still co-fire — it's noise, not a conflict.
          if (verdict.type === "overlap" || verdict.type === "subset") {
            warnings.push(finding);
          } else {
            contradictions.push(finding);
          }
        }
      }
    }

    return { contradictions, warnings };
  },

  /**
   * Flag a candidate predicate whose referenced fact paths overlap with
   * fields *owned* (or `bind:`-bound) by an existing constraint's
   * resolvers. A v1 stub: relies on `inspect()` exposing `owns:` / `bind:`
   * on each constraint snapshot. When that metadata is absent, this
   * returns `{ findings: [] }` — no false positives.
   *
   * **TODO (v2):** wire the engine's resolver-ownership graph through
   * `system.inspect()` so this returns real findings without manual
   * `owns:` annotations on inspect payloads.
   *
   * @example
   * ```ts
   * doctor.checkOwns(
   *   { cartTotal: { $gte: 100 } },
   *   system.inspect(),
   * );
   * // → { findings: [
   * //     { constraintId: "applyDiscount", candidatePath: "cartTotal",
   * //       source: "owns",
   * //       reason: "Constraint applyDiscount already owns cartTotal." }
   * //   ] }
   * ```
   */
  checkOwns<F = Record<string, unknown>>(
    candidate: FactPredicate<F>,
    existing:
      | readonly ExistingConstraint[]
      | { constraints: readonly ExistingConstraint[] },
  ): CheckOwnsResult {
    const constraints: readonly ExistingConstraint[] = Array.isArray(existing)
      ? existing
      : "constraints" in existing && Array.isArray(existing.constraints)
        ? existing.constraints
        : [];

    const candidateLeaves = flattenPredicate(candidate);
    if (candidateLeaves.length === 0) {
      return { warnings: [] };
    }
    const candidatePaths = new Set(candidateLeaves.map((l) => l.path));

    const warnings: CheckOwnsFinding[] = [];
    for (const c of constraints) {
      if (!isExistingConstraint(c)) continue;
      const owns = Array.isArray(c.owns) ? c.owns : [];
      const bind = Array.isArray(c.bind) ? c.bind : [];
      for (const path of owns) {
        if (candidatePaths.has(path)) {
          warnings.push({
            constraintId: c.id,
            candidatePath: path,
            source: "owns",
            reason: `Constraint "${c.id}" already owns "${path}" — candidate would race or shadow its writes.`,
            severity: "warning",
          });
        }
      }
      for (const path of bind) {
        if (candidatePaths.has(path)) {
          warnings.push({
            constraintId: c.id,
            candidatePath: path,
            source: "bind",
            reason: `Constraint "${c.id}" binds "${path}" — candidate would write to a bound field.`,
            severity: "warning",
          });
        }
      }
    }

    // (M5, F-3) Owns-collisions are warnings by default — the engine
    // still enforces the runtime binding gate. v1 result shape is
    // `{ warnings }` only; the per-finding `severity` discriminator
    // anticipates v2 promotion of findings to errors without breaking
    // existing callers.
    return { warnings };
  },
};
