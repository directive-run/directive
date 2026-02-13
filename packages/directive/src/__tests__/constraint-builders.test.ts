/**
 * Constraint Builder Tests
 *
 * Tests for `constraint()` and `when()` builder APIs.
 */

import { describe, it, expect } from "vitest";
import { constraint, when, t, type ModuleSchema } from "../index.js";

// ============================================================================
// Test Schema
// ============================================================================

const schema = {
	facts: {
		confidence: t.number(),
		errors: t.number(),
		phase: t.string<"red" | "green" | "yellow">(),
	},
	derivations: {},
	events: {},
	requirements: {
		ESCALATE: {},
		PAUSE: {},
		HALT: { reason: t.string() },
		TRANSITION: { to: t.string() },
	},
} satisfies ModuleSchema;

type S = typeof schema;

// ============================================================================
// constraint() Builder
// ============================================================================

describe("constraint() builder", () => {
	it("builds a minimal constraint with when + require", () => {
		const c = constraint<S>()
			.when((f) => f.confidence < 0.7)
			.require({ type: "ESCALATE" })
			.build();

		expect(c.when).toBeTypeOf("function");
		expect(c.require).toEqual({ type: "ESCALATE" });
		expect(c.priority).toBeUndefined();
		expect(c.after).toBeUndefined();
		expect(c.deps).toBeUndefined();
		expect(c.timeout).toBeUndefined();
		expect(c.async).toBeUndefined();
	});

	it("builds a constraint with all optional fields", () => {
		const c = constraint<S>()
			.when((f) => f.errors > 10)
			.require({ type: "HALT", reason: "too many errors" })
			.priority(100)
			.after("healthCheck", "validation")
			.deps("errors", "confidence")
			.timeout(5000)
			.async(true)
			.build();

		expect(c.require).toEqual({ type: "HALT", reason: "too many errors" });
		expect(c.priority).toBe(100);
		expect(c.after).toEqual(["healthCheck", "validation"]);
		expect(c.deps).toEqual(["errors", "confidence"]);
		expect(c.timeout).toBe(5000);
		expect(c.async).toBe(true);
	});

	it("supports function require", () => {
		const c = constraint<S>()
			.when((f) => f.phase === "red")
			.require((f) => ({ type: "TRANSITION", to: f.phase === "red" ? "green" : "red" }))
			.build();

		expect(c.require).toBeTypeOf("function");
	});

	it("supports null require (suppression)", () => {
		const c = constraint<S>()
			.when((f) => f.errors === 0)
			.require(null)
			.build();

		expect(c.require).toBeNull();
	});

	it("supports array require", () => {
		const c = constraint<S>()
			.when((f) => f.errors > 5)
			.require([{ type: "PAUSE" }, { type: "ESCALATE" }])
			.build();

		expect(c.require).toEqual([{ type: "PAUSE" }, { type: "ESCALATE" }]);
	});

	it("accumulates after() calls", () => {
		const c = constraint<S>()
			.when((f) => f.errors > 0)
			.require({ type: "PAUSE" })
			.after("a")
			.after("b", "c")
			.build();

		expect(c.after).toEqual(["a", "b", "c"]);
	});

	it("accumulates deps() calls", () => {
		const c = constraint<S>()
			.when((f) => f.errors > 0)
			.require({ type: "PAUSE" })
			.deps("errors")
			.deps("confidence")
			.build();

		expect(c.deps).toEqual(["errors", "confidence"]);
	});

	it("when() condition executes correctly", () => {
		const c = constraint<S>()
			.when((f) => f.confidence < 0.5)
			.require({ type: "ESCALATE" })
			.build();

		// Simulate fact objects
		expect(c.when({ confidence: 0.3, errors: 0, phase: "green" } as any)).toBe(true);
		expect(c.when({ confidence: 0.8, errors: 0, phase: "green" } as any)).toBe(false);
	});

	it("produces output identical to hand-written object literal", () => {
		const built = constraint<S>()
			.when((f) => f.errors > 10)
			.require({ type: "HALT", reason: "critical" })
			.priority(90)
			.after("check")
			.timeout(3000)
			.build();

		// Only check structural fields (not function identity)
		expect(built.require).toEqual({ type: "HALT", reason: "critical" });
		expect(built.priority).toBe(90);
		expect(built.after).toEqual(["check"]);
		expect(built.timeout).toBe(3000);
		expect(built.when).toBeTypeOf("function");
	});
});

// ============================================================================
// when() Shorthand
// ============================================================================

describe("when() shorthand", () => {
	it("returns a valid constraint directly (no .build())", () => {
		const c = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });

		expect(c.when).toBeTypeOf("function");
		expect(c.require).toEqual({ type: "PAUSE" });
		// It's usable as a TypedConstraintDef
		expect(c).toHaveProperty("when");
		expect(c).toHaveProperty("require");
	});

	it("withPriority returns a new constraint (immutable)", () => {
		const base = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });
		const withP = base.withPriority(50);

		expect(base.priority).toBeUndefined();
		expect(withP.priority).toBe(50);
		// Different objects
		expect(base).not.toBe(withP);
	});

	it("withAfter returns a new constraint (immutable)", () => {
		const base = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });
		const withA = base.withAfter("healthCheck");

		expect(base.after).toBeUndefined();
		expect(withA.after).toEqual(["healthCheck"]);
	});

	it("withDeps returns a new constraint (immutable)", () => {
		const base = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });
		const withD = base.withDeps("errors", "confidence");

		expect(base.deps).toBeUndefined();
		expect(withD.deps).toEqual(["errors", "confidence"]);
	});

	it("withTimeout returns a new constraint (immutable)", () => {
		const base = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });
		const withT = base.withTimeout(5000);

		expect(base.timeout).toBeUndefined();
		expect(withT.timeout).toBe(5000);
	});

	it("withAsync returns a new constraint (immutable)", () => {
		const base = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });
		const withAsync = base.withAsync(true);

		expect(base.async).toBeUndefined();
		expect(withAsync.async).toBe(true);
	});

	it("chains multiple with* methods immutably", () => {
		const c = when<S>((f) => f.errors > 10)
			.require({ type: "HALT", reason: "overload" })
			.withPriority(100)
			.withAfter("healthCheck")
			.withDeps("errors")
			.withTimeout(3000)
			.withAsync(true);

		expect(c.require).toEqual({ type: "HALT", reason: "overload" });
		expect(c.priority).toBe(100);
		expect(c.after).toEqual(["healthCheck"]);
		expect(c.deps).toEqual(["errors"]);
		expect(c.timeout).toBe(3000);
		expect(c.async).toBe(true);
	});

	it("withAfter accumulates across calls", () => {
		const c = when<S>((f) => f.errors > 0)
			.require({ type: "PAUSE" })
			.withAfter("a")
			.withAfter("b");

		expect(c.after).toEqual(["a", "b"]);
	});

	it("withDeps accumulates across calls", () => {
		const c = when<S>((f) => f.errors > 0)
			.require({ type: "PAUSE" })
			.withDeps("errors")
			.withDeps("confidence");

		expect(c.deps).toEqual(["errors", "confidence"]);
	});

	it("supports function require", () => {
		const c = when<S>((f) => f.phase === "red")
			.require((f) => ({ type: "TRANSITION", to: "green" }));

		expect(c.require).toBeTypeOf("function");
	});

	it("supports null require", () => {
		const c = when<S>((f) => f.errors === 0).require(null);
		expect(c.require).toBeNull();
	});

	it("when() condition executes correctly", () => {
		const c = when<S>((f) => f.errors > 3).require({ type: "PAUSE" });

		expect(c.when({ errors: 5, confidence: 1, phase: "green" } as any)).toBe(true);
		expect(c.when({ errors: 1, confidence: 1, phase: "green" } as any)).toBe(false);
	});

	it("can be spread into a plain object (strips methods)", () => {
		const c = when<S>((f) => f.errors > 3)
			.require({ type: "PAUSE" })
			.withPriority(50);

		const plain = { ...c };
		expect(plain.priority).toBe(50);
		expect(plain.require).toEqual({ type: "PAUSE" });
		expect(plain.when).toBeTypeOf("function");
		// with* methods are also spread but that's fine
	});
});

// ============================================================================
// Integration: Builder output works in module constraints
// ============================================================================

describe("builder integration", () => {
	it("constraint() output matches TypedConstraintDef shape", () => {
		const c = constraint<S>()
			.when((f) => f.confidence < 0.7)
			.require({ type: "ESCALATE" })
			.priority(50)
			.build();

		// Structurally matches what createModule expects
		const constraints: Record<string, typeof c> = { escalate: c };
		expect(constraints.escalate.when).toBeTypeOf("function");
		expect(constraints.escalate.require).toEqual({ type: "ESCALATE" });
		expect(constraints.escalate.priority).toBe(50);
	});

	it("when() output matches TypedConstraintDef shape", () => {
		const c = when<S>((f) => f.errors > 3)
			.require({ type: "PAUSE" })
			.withPriority(50);

		const constraints: Record<string, typeof c> = { pause: c };
		expect(constraints.pause.when).toBeTypeOf("function");
		expect(constraints.pause.require).toEqual({ type: "PAUSE" });
		expect(constraints.pause.priority).toBe(50);
	});
});
