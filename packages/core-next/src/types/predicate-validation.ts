/**
 * Copied from 1.35 (packages/core/src/core/predicate.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { SchemaKindNode } from "../api/schema-introspection.js";
// ============================================================================
// Discriminators
// ============================================================================

/** A readable scope — the `Facts` proxy and a plain snapshot both satisfy it. */
export type Scope = Record<string, unknown>;

export interface SchemaValidationError {
  /** Dotted path to the failing clause (e.g. `cartTotal`, `auth.token.$gte`). */
  readonly path: string;
  /** The operator that failed (or the literal-equality marker `$eq`). */
  readonly op: string;
  /** The kind of the fact at this path, or `undefined` when the fact wasn't in the kind map. */
  readonly kind?: SchemaKindNode;
  /** The operators that ARE allowed for this fact's kind. */
  readonly allowedOps?: readonly string[];
  /** Human-readable failure reason (suitable for feeding back to an LLM). */
  readonly reason: string;
}

export interface SchemaValidationOptions {
  /** Reject predicates with more than this many operator clauses (DoS guard). Default unbounded. */
  readonly maxOperatorCount?: number;
  /**
   * Reject `$in` / `$nin` operands that contain more than this many elements
   * (query-planner DoS guard). Default unbounded. A typical safe cap is 1000
   * — beyond that, a downstream query compiler may degrade quadratically.
   */
  readonly maxArrayOperandLength?: number;
}

export type SchemaValidationResult =
  | { ok: true; operatorCount: number }
  | {
      ok: false;
      errors: readonly SchemaValidationError[];
      operatorCount: number;
    };
