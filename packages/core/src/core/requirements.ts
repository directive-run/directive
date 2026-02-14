/**
 * Requirements - Typed requirement identity with custom dedupe keys
 *
 * Features:
 * - Type-safe requirement definitions
 * - Stable identity generation
 * - Custom key functions for deduplication control
 * - Requirement comparison and hashing
 */

import type { Requirement, RequirementKeyFn, RequirementWithId } from "./types.js";
import { stableStringify } from "../utils/utils.js";

// ============================================================================
// Requirement Identity
// ============================================================================

/**
 * Generate a stable ID for a requirement.
 * Uses type + sorted properties by default.
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
 * Check if two requirements are equal by their IDs.
 */
export function requirementsEqual(
	a: RequirementWithId,
	b: RequirementWithId,
): boolean {
	return a.id === b.id;
}

/**
 * Create a requirement with its computed ID.
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
 * Helper to create typed requirements with a fluent API.
 *
 * Creates a factory function that produces requirements with a specific type.
 * Useful for creating requirements in constraint definitions.
 *
 * @param type - The requirement type string
 * @returns A factory function that creates requirements with the given type
 *
 * @example
 * ```typescript
 * // Create a requirement factory
 * const fetchUser = req("FETCH_USER");
 *
 * // Use in constraint definition
 * constraints: {
 *   needsUser: {
 *     when: (facts) => facts.userId && !facts.user,
 *     require: fetchUser({ userId: 123, priority: "high" }),
 *   },
 * }
 *
 * // Results in: { type: "FETCH_USER", userId: 123, priority: "high" }
 * ```
 */
export function req<T extends string>(type: T) {
	return <P extends Record<string, unknown>>(props: P) => ({
		type,
		...props,
	}) as Requirement & { type: T } & P;
}

/**
 * Check if a requirement matches a type.
 */
export function isRequirementType<T extends string>(
	req: Requirement,
	type: T,
): req is Requirement & { type: T } {
	return req.type === type;
}

/**
 * Create a type guard for resolver `requirement` predicate.
 * Cleaner alternative to writing verbose type guards.
 *
 * @example
 * ```typescript
 * // With explicit requirement type (recommended for complex types)
 * interface FetchUserRequirement { type: "FETCH_USER"; userId: string }
 * requirement: forType<FetchUserRequirement>("FETCH_USER"),
 * key: (req) => req.userId,  // req is FetchUserRequirement
 *
 * // Or simple string literal (for basic types)
 * requirement: forType("FETCH_USER"),
 * key: (req) => req.type,  // req is Requirement & { type: "FETCH_USER" }
 * ```
 */
export function forType<R extends Requirement>(
	type: R["type"],
): (req: Requirement) => req is R;
export function forType<T extends string>(
	type: T,
): (req: Requirement) => req is Requirement & { type: T };
export function forType<T extends string>(
	type: T,
): (req: Requirement) => req is Requirement & { type: T } {
	return (req): req is Requirement & { type: T } => req.type === type;
}

// ============================================================================
// Requirement Set Management
// ============================================================================

/**
 * A set of requirements with automatic deduplication by ID.
 *
 * Requirements are uniquely identified by their ID (generated from type + properties).
 * When adding a requirement with a duplicate ID, the first one wins.
 *
 * @example
 * ```typescript
 * const set = new RequirementSet();
 *
 * // Add requirements
 * set.add(createRequirementWithId({ type: "FETCH_USER", userId: 1 }, "constraint1"));
 * set.add(createRequirementWithId({ type: "FETCH_USER", userId: 1 }, "constraint2")); // Ignored (duplicate)
 *
 * // Check and retrieve
 * console.log(set.size); // 1
 * console.log(set.has("FETCH_USER:{\"userId\":1}")); // true
 *
 * // Diff with another set
 * const newSet = new RequirementSet();
 * newSet.add(createRequirementWithId({ type: "FETCH_USER", userId: 2 }, "constraint1"));
 * const { added, removed } = newSet.diff(set);
 * // added: [{ type: "FETCH_USER", userId: 2 }]
 * // removed: [{ type: "FETCH_USER", userId: 1 }]
 * ```
 */
export class RequirementSet {
	private map = new Map<string, RequirementWithId>();

	/**
	 * Add a requirement to the set.
	 * If a requirement with the same ID already exists, it is ignored (first wins).
	 * @param req - The requirement with its computed ID
	 */
	add(req: RequirementWithId): void {
		// If already exists, keep the existing one (first wins)
		if (!this.map.has(req.id)) {
			this.map.set(req.id, req);
		}
	}

	/** Remove a requirement by ID */
	remove(id: string): boolean {
		return this.map.delete(id);
	}

	/** Check if a requirement exists */
	has(id: string): boolean {
		return this.map.has(id);
	}

	/** Get a requirement by ID */
	get(id: string): RequirementWithId | undefined {
		return this.map.get(id);
	}

	/** Get all requirements */
	all(): RequirementWithId[] {
		return [...this.map.values()];
	}

	/** Get all requirement IDs */
	ids(): string[] {
		return [...this.map.keys()];
	}

	/** Get the count of requirements */
	get size(): number {
		return this.map.size;
	}

	/** Clear all requirements */
	clear(): void {
		this.map.clear();
	}

	/** Create a copy */
	clone(): RequirementSet {
		const copy = new RequirementSet();
		for (const req of this.map.values()) {
			copy.add(req);
		}
		return copy;
	}

	/** Diff with another set - returns added and removed */
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
