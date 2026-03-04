/**
 * Requirements - Typed requirement identity with custom dedupe keys
 *
 * Features:
 * - Type-safe requirement definitions
 * - Stable identity generation
 * - Custom key functions for deduplication control
 * - Requirement comparison and hashing
 */

import { stableStringify } from "../utils/utils.js";
import type {
  Requirement,
  RequirementKeyFn,
  RequirementWithId,
} from "./types.js";

// ============================================================================
// Requirement Identity
// ============================================================================

/**
 * Generate a stable identity string for a requirement.
 *
 * When no custom key function is provided, the ID is formed from the
 * requirement's `type` plus a deterministic JSON serialization of its
 * remaining properties. A custom {@link RequirementKeyFn} can override
 * this to control deduplication granularity.
 *
 * @param req - The requirement to generate an ID for.
 * @param keyFn - Optional custom key function that overrides the default identity logic.
 * @returns A stable string that uniquely identifies this requirement for deduplication.
 *
 * @public
 */
export function generateRequirementId(
  req: Requirement,
  keyFn?: RequirementKeyFn,
): string {
  // Use custom key function if provided
  if (keyFn) {
    return keyFn(req);
  }

  // Default: type + stable JSON of other properties
  const { type, ...rest } = req;
  const sortedRest = stableStringify(rest);
  return `${type}:${sortedRest}`;
}

/**
 * Check if two requirements are equal by comparing their computed IDs.
 *
 * @param a - First requirement to compare.
 * @param b - Second requirement to compare.
 * @returns `true` when both requirements share the same identity string.
 *
 * @public
 */
export function requirementsEqual(
  a: RequirementWithId,
  b: RequirementWithId,
): boolean {
  return a.id === b.id;
}

/**
 * Create a {@link RequirementWithId} by pairing a requirement with its
 * computed identity string and the constraint that produced it.
 *
 * @param requirement - The raw requirement object.
 * @param fromConstraint - Name of the constraint that emitted this requirement.
 * @param keyFn - Optional custom key function forwarded to {@link generateRequirementId}.
 * @returns A requirement bundled with its stable ID and originating constraint name.
 *
 * @public
 */
export function createRequirementWithId(
  requirement: Requirement,
  fromConstraint: string,
  keyFn?: RequirementKeyFn,
): RequirementWithId {
  return {
    requirement,
    id: generateRequirementId(requirement, keyFn),
    fromConstraint,
  };
}

// ============================================================================
// Requirement Helpers
// ============================================================================

/**
 * Create a typed requirement factory for a given requirement type string.
 *
 * Returns a function that, when called with a properties object, produces a
 * fully-typed {@link Requirement} whose `type` field is the literal `T`.
 * This is the recommended way to build requirements inside constraint
 * definitions because it keeps the type string in one place and gives you
 * full TypeScript inference on the payload.
 *
 * @param type - The requirement type string (e.g. `"FETCH_USER"`).
 * @returns A factory that merges `type` with arbitrary properties into a typed requirement.
 *
 * @example
 * ```typescript
 * const fetchUser = req("FETCH_USER");
 *
 * // Use inside a module's constraint definition
 * constraints: {
 *   needsUser: {
 *     when: (facts) => facts.userId && !facts.user,
 *     require: fetchUser({ userId: 123, priority: "high" }),
 *   },
 * }
 *
 * // Produces: { type: "FETCH_USER", userId: 123, priority: "high" }
 * ```
 *
 * @public
 */
export function req<T extends string>(type: T) {
  return <P extends Record<string, unknown>>(props: P) =>
    ({
      type,
      ...props,
    }) as Requirement & { type: T } & P;
}

/**
 * Type-narrowing guard that checks whether a requirement's `type` matches the
 * given string literal.
 *
 * After this guard returns `true`, TypeScript narrows `req` to
 * `Requirement & { type: T }`, giving you access to type-specific fields.
 *
 * @param req - The requirement to test.
 * @param type - The expected type string to match against.
 * @returns `true` when `req.type === type`.
 *
 * @public
 */
export function isRequirementType<T extends string>(
  req: Requirement,
  type: T,
): req is Requirement & { type: T } {
  return req.type === type;
}

/**
 * Create a type-guard function suitable for a resolver's `requirement`
 * predicate field.
 *
 * @remarks
 * The returned predicate narrows any {@link Requirement} to the concrete
 * type `R` (or `Requirement & { type: T }` when no explicit generic is
 * provided). This is a cleaner alternative to writing verbose inline type
 * guards in every resolver definition.
 *
 * @param type - The requirement type string to match.
 * @returns A predicate that returns `true` for requirements whose `type` matches, narrowing the value for downstream callbacks like `key` and `resolve`.
 *
 * @example
 * ```typescript
 * // With an explicit requirement interface (recommended for complex payloads)
 * interface FetchUserReq { type: "FETCH_USER"; userId: string }
 * requirement: forType<FetchUserReq>("FETCH_USER"),
 * key: (req) => req.userId,  // req is FetchUserReq
 *
 * // With a simple string literal
 * requirement: forType("FETCH_USER"),
 * key: (req) => req.type,  // req is Requirement & { type: "FETCH_USER" }
 * ```
 *
 * @public
 */
export function forType<R extends Requirement>(
  type: R["type"],
): (req: Requirement) => req is R;
export function forType<T extends string>(
  type: T,
): (req: Requirement) => req is Requirement & { type: T };
/** @internal Implementation overload — see public overloads above. */
export function forType<T extends string>(
  type: T,
): (req: Requirement) => req is Requirement & { type: T } {
  return (req): req is Requirement & { type: T } => req.type === type;
}

// ============================================================================
// Requirement Set Management
// ============================================================================

/**
 * A deduplicated collection of {@link RequirementWithId} entries keyed by
 * their identity string.
 *
 * @remarks
 * Requirements are uniquely identified by their ID (generated from type +
 * properties via {@link generateRequirementId}). When adding a requirement
 * whose ID already exists, the first entry wins and the duplicate is
 * silently ignored. The {@link RequirementSet.diff | diff} method computes
 * added, removed, and unchanged entries relative to another set, which the
 * engine uses during reconciliation.
 *
 * @example
 * ```typescript
 * const set = new RequirementSet();
 * set.add(createRequirementWithId({ type: "FETCH_USER", userId: 1 }, "c1"));
 * set.add(createRequirementWithId({ type: "FETCH_USER", userId: 1 }, "c2")); // ignored
 * console.log(set.size); // 1
 *
 * const next = new RequirementSet();
 * next.add(createRequirementWithId({ type: "FETCH_USER", userId: 2 }, "c1"));
 * const { added, removed } = next.diff(set);
 * // added has userId: 2, removed has userId: 1
 * ```
 *
 * @public
 */
export class RequirementSet {
  private map = new Map<string, RequirementWithId>();

  /**
   * Add a requirement to the set (first-wins deduplication).
   *
   * @param req - The requirement with its computed ID to insert.
   */
  add(req: RequirementWithId): void {
    // If already exists, keep the existing one (first wins)
    if (!this.map.has(req.id)) {
      this.map.set(req.id, req);
    }
  }

  /**
   * Remove a requirement by its identity string.
   *
   * @param id - The requirement identity string to remove.
   * @returns `true` if the requirement existed and was removed.
   */
  remove(id: string): boolean {
    return this.map.delete(id);
  }

  /**
   * Check whether a requirement with the given ID is in the set.
   *
   * @param id - The requirement identity string to look up.
   * @returns `true` if the set contains a requirement with this ID.
   */
  has(id: string): boolean {
    return this.map.has(id);
  }

  /**
   * Retrieve a requirement by its identity string.
   *
   * @param id - The requirement identity string to look up.
   * @returns The matching requirement, or `undefined` if not found.
   */
  get(id: string): RequirementWithId | undefined {
    return this.map.get(id);
  }

  /**
   * Return a snapshot array of all requirements in the set.
   *
   * @returns A new array containing every {@link RequirementWithId} in insertion order.
   */
  all(): RequirementWithId[] {
    return [...this.map.values()];
  }

  /**
   * Return a snapshot array of all requirement identity strings.
   *
   * @returns A new array of ID strings in insertion order.
   */
  ids(): string[] {
    return [...this.map.keys()];
  }

  /**
   * The number of requirements currently in the set.
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Remove all requirements from the set.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Create a shallow copy of this set.
   *
   * @returns A new {@link RequirementSet} containing the same entries.
   */
  clone(): RequirementSet {
    const copy = new RequirementSet();
    for (const req of this.map.values()) {
      copy.add(req);
    }
    return copy;
  }

  /**
   * Compute the difference between this set and another.
   *
   * @param other - The previous set to compare against.
   * @returns An object with `added` (in this but not other), `removed` (in other but not this), and `unchanged` arrays.
   */
  diff(other: RequirementSet): {
    added: RequirementWithId[];
    removed: RequirementWithId[];
    unchanged: RequirementWithId[];
  } {
    const added: RequirementWithId[] = [];
    const removed: RequirementWithId[] = [];
    const unchanged: RequirementWithId[] = [];

    // Find added (in this but not in other)
    for (const req of this.map.values()) {
      if (!other.has(req.id)) {
        added.push(req);
      } else {
        unchanged.push(req);
      }
    }

    // Find removed (in other but not in this)
    for (const req of other.map.values()) {
      if (!this.map.has(req.id)) {
        removed.push(req);
      }
    }

    return { added, removed, unchanged };
  }
}
