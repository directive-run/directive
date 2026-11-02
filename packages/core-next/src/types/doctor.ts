/**
 * Copied from 1.35 (packages/core/src/core/doctor.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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
   * Fact paths the constraint's resolver aborts on when changed
   * mid-flight, if exposed by the inspect API. Consulted by
   * {@link doctor.checkAbortOn} to flag candidates that would write to
   * fields under another constraint's abort-binding. Optional — older
   * inspect payloads omit it.
   */
  readonly abortOn?: readonly string[];
  /** Same as {@link abortOn} but for the bind: side of binding metadata. */
  readonly bind?: readonly string[];
}

/**
 * Returned by {@link doctor.checkAbortOn}.
 *
 * `severity` matches the {@link Contradiction} discriminator on
 * {@link CheckAgainstResult} so callers can route both shapes
 * uniformly: by default, abort-binding collisions are `"warning"`
 * (the engine still has a runtime gate), but a caller can promote them
 * to `"error"` for stricter pre-deploy linting.
 */
export interface CheckAbortOnFinding {
  readonly constraintId: string;
  /** The fact path on the candidate predicate that triggered the finding. */
  readonly candidatePath: string;
  /** The binding side it would collide with: "abortOn" or "bind". */
  readonly source: "abortOn" | "bind";
  readonly reason: string;
  /**
   * Severity discriminator — `"warning"` by default (the engine has
   * its own runtime gate), `"error"` reserved for callers that want
   * strict pre-deploy lints.
   */
  readonly severity?: "error" | "warning";
}

/**
 * Result of {@link doctor.checkAbortOn}.
 *
 * AbortOn-/bind- collisions are warnings, not contradictions — the
 * engine itself enforces the runtime binding gate, so a pre-deploy
 * doctor pass treats them as advisory. The
 * {@link CheckAbortOnFinding.severity} discriminator anticipates v2
 * promotion of findings to errors.
 */
export interface CheckAbortOnResult {
  /**
   * AbortOn-/bind- collisions surfaced by {@link doctor.checkAbortOn}.
   * Empty when constraints expose no `abortOn:` / `bind:` metadata or
   * the candidate's fact paths don't overlap.
   */
  readonly warnings: readonly CheckAbortOnFinding[];
}
