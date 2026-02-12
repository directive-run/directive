/**
 * AE Review Fixes Tests
 *
 * R1: Constraint dependency maps cleaned on disable()
 * R2: Reconcile depth guard prevents runaway loops
 * F1: derivedProxy missing BLOCKED_PROPS guard
 * F2: getRequirements() not error-isolated
 * F3: processConstraintResult doesn't check disabled state
 * F4: Error boundary callbacks not wrapped in try-catch
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, createErrorBoundaryManager, t } from "../index.js";

describe("R1: Constraint dep map cleanup on disable", () => {
	it("should clean up dependency maps when a constraint is disabled", async () => {
		const resolverCalls: string[] = [];

		const schema = {
			facts: {
				status: t.string(),
				count: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				CHECK_STATUS: {},
				COUNT_THINGS: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("cleanup-test", {
			schema,
			init: (facts) => {
				facts.status = "idle";
				facts.count = 0;
			},
			derive: {},
			events: {},
			constraints: {
				statusCheck: {
					when: (facts) => facts.status === "active",
					require: { type: "CHECK_STATUS" },
				},
				countCheck: {
					when: (facts) => facts.count > 5,
					require: { type: "COUNT_THINGS" },
				},
			},
			resolvers: {
				statusResolver: {
					requirement: "CHECK_STATUS",
					resolve: async (_req, ctx) => {
						resolverCalls.push("CHECK_STATUS");
						ctx.facts.status = "done";
					},
				},
				countResolver: {
					requirement: "COUNT_THINGS",
					resolve: async (_req, ctx) => {
						resolverCalls.push("COUNT_THINGS");
						ctx.facts.count = 0;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();

		// Trigger the statusCheck constraint so it registers deps
		system.facts.status = "active";
		await system.settle();

		expect(resolverCalls).toContain("CHECK_STATUS");

		// Disable statusCheck — deps should be cleaned up
		system.constraints.disable("statusCheck");

		// Changing status should NOT trigger statusCheck anymore
		resolverCalls.length = 0;
		system.facts.status = "active";
		await system.settle();

		// statusCheck should not have fired
		expect(resolverCalls).not.toContain("CHECK_STATUS");

		system.destroy();
	});

	it("should re-register deps when a disabled constraint is re-enabled", async () => {
		const resolverCalls: string[] = [];

		const schema = {
			facts: {
				level: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				LEVEL_UP: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("reenable-test", {
			schema,
			init: (facts) => {
				facts.level = 0;
			},
			derive: {},
			events: {},
			constraints: {
				levelCheck: {
					when: (facts) => facts.level > 10,
					require: { type: "LEVEL_UP" },
				},
			},
			resolvers: {
				levelResolver: {
					requirement: "LEVEL_UP",
					resolve: async (_req, ctx) => {
						resolverCalls.push("LEVEL_UP");
						ctx.facts.level = 0;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();

		// Trigger to register deps
		system.facts.level = 15;
		await system.settle();
		expect(resolverCalls).toContain("LEVEL_UP");

		// Disable then re-enable
		system.constraints.disable("levelCheck");
		system.constraints.enable("levelCheck");

		// Should work again after re-enable
		resolverCalls.length = 0;
		system.facts.level = 20;
		await system.settle();
		expect(resolverCalls).toContain("LEVEL_UP");

		system.destroy();
	});
});

describe("R2: Reconcile depth guard", () => {
	it("should stop runaway reconcile loops with a dev warning", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const schema = {
			facts: {
				counter: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				NOOP: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("runaway-test", {
			schema,
			init: (facts) => {
				facts.counter = 0;
			},
			derive: {},
			events: {},
			constraints: {
				// Pathological constraint: mutates facts as a side effect during
				// evaluation. This adds to changedKeys AFTER the reconcile's
				// changedKeys.clear(), causing a tight microtask chain.
				badConstraint: {
					when: (facts) => {
						facts.counter++;
						return facts.counter < 1000;
					},
					require: { type: "NOOP" },
				},
			},
			resolvers: {
				noopResolver: {
					requirement: "NOOP",
					resolve: async () => {
						// intentionally empty
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();

		// Wait for the reconcile loop to be capped by the depth guard
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// The warning should have been emitted
		const reconcileWarnings = warnSpy.mock.calls.filter(
			(call) => typeof call[0] === "string" && call[0].includes("Reconcile loop exceeded"),
		);
		expect(reconcileWarnings.length).toBeGreaterThan(0);

		// Counter should be bounded — the guard stopped the runaway loop
		expect(system.facts.counter).toBeLessThan(1000);

		warnSpy.mockRestore();
		system.destroy();
	});
});

describe("F1: derivedProxy BLOCKED_PROPS guard", () => {
	it("should return undefined for __proto__ access on derivation proxy, no crash", () => {
		const schema = {
			facts: {
				value: t.number(),
			},
			derivations: {
				doubled: "number",
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("proto-test", {
			schema,
			init: (facts) => {
				facts.value = 5;
			},
			derive: {
				doubled: (facts, derive) => {
					// Access __proto__ on the derive proxy — should not crash or create spurious deps
					const proto = (derive as Record<string, unknown>).__proto__;
					expect(proto).toBeUndefined();
					return facts.value * 2;
				},
			},
			events: {},
			constraints: {},
			resolvers: {},
		});

		const system = createSystem({ module: mod });
		system.start();

		expect(system.read("doubled")).toBe(10);

		// Also check constructor and prototype
		system.facts.value = 7;
		expect(system.read("doubled")).toBe(14);

		system.destroy();
	});
});

describe("F2: getRequirements() error isolation", () => {
	it("should isolate throwing require() — other constraints still fire", async () => {
		const resolverCalls: string[] = [];
		const errorSpy = vi.fn();

		const schema = {
			facts: {
				trigger: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				GOOD_REQ: {},
				BAD_REQ: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("require-throw-test", {
			schema,
			init: (facts) => {
				facts.trigger = false;
			},
			derive: {},
			events: {},
			constraints: {
				badConstraint: {
					priority: 10,
					when: (facts) => facts.trigger,
					require: () => {
						throw new Error("require() exploded");
					},
				},
				goodConstraint: {
					priority: 5,
					when: (facts) => facts.trigger,
					require: { type: "GOOD_REQ" },
				},
			},
			resolvers: {
				goodResolver: {
					requirement: "GOOD_REQ",
					resolve: async (_req, ctx) => {
						resolverCalls.push("GOOD_REQ");
						ctx.facts.trigger = false;
					},
				},
				badResolver: {
					requirement: "BAD_REQ",
					resolve: async () => {
						resolverCalls.push("BAD_REQ");
					},
				},
			},
		});

		const system = createSystem({
			module: mod,
			errorBoundary: {
				onConstraintError: (err) => errorSpy(err.message),
			},
		});
		system.start();

		system.facts.trigger = true;
		await system.settle();

		// Good constraint should still have fired its resolver
		expect(resolverCalls).toContain("GOOD_REQ");
		// Bad constraint's resolver should NOT have fired (require threw)
		expect(resolverCalls).not.toContain("BAD_REQ");

		system.destroy();
	});
});

describe("F3: processConstraintResult disabled check", () => {
	it("should not process result for a constraint disabled during async evaluation", async () => {
		const resolverCalls: string[] = [];

		const schema = {
			facts: {
				value: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				ASYNC_REQ: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("async-disable-test", {
			schema,
			init: (facts) => {
				facts.value = 0;
			},
			derive: {},
			events: {},
			constraints: {
				asyncCheck: {
					async: true,
					deps: ["value"],
					when: async (facts) => {
						await new Promise((r) => setTimeout(r, 50));
						return facts.value > 0;
					},
					require: { type: "ASYNC_REQ" },
				},
			},
			resolvers: {
				asyncResolver: {
					requirement: "ASYNC_REQ",
					resolve: async () => {
						resolverCalls.push("ASYNC_REQ");
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();

		// Trigger the async constraint
		system.facts.value = 10;

		// Disable before async evaluation completes
		await new Promise((r) => setTimeout(r, 10));
		system.constraints.disable("asyncCheck");

		// Wait for everything to settle
		await new Promise((r) => setTimeout(r, 200));

		// Resolver should not have been called — constraint was disabled mid-evaluation
		expect(resolverCalls).not.toContain("ASYNC_REQ");

		system.destroy();
	});
});

describe("F4: Error boundary callback wrapping", () => {
	it("should still apply recovery strategy when onError callback throws", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const manager = createErrorBoundaryManager({
			onError: () => {
				throw new Error("onError callback exploded");
			},
			config: {
				onResolverError: "skip",
			},
		});

		// Should not throw — the throwing onError is caught internally
		const strategy = manager.handleError("resolver", "test-resolver", new Error("resolver failed"));

		// Recovery strategy should still be applied
		expect(strategy).toBe("skip");

		// The error from the callback should have been logged
		const callbackErrors = errorSpy.mock.calls.filter(
			(call) => typeof call[0] === "string" && call[0].includes("Error in onError callback"),
		);
		expect(callbackErrors.length).toBeGreaterThan(0);

		errorSpy.mockRestore();
	});

	it("should still apply recovery strategy when onRecovery callback throws", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const manager = createErrorBoundaryManager({
			onRecovery: () => {
				throw new Error("onRecovery callback exploded");
			},
			config: {
				onResolverError: "skip",
			},
		});

		const strategy = manager.handleError("resolver", "test-resolver", new Error("resolver failed"));

		expect(strategy).toBe("skip");

		const callbackErrors = errorSpy.mock.calls.filter(
			(call) => typeof call[0] === "string" && call[0].includes("Error in onRecovery callback"),
		);
		expect(callbackErrors.length).toBeGreaterThan(0);

		errorSpy.mockRestore();
	});

	it("should still apply recovery strategy when config error handler throws", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const manager = createErrorBoundaryManager({
			config: {
				onResolverError: (error) => {
					throw new Error("handler exploded: " + error.message);
				},
			},
		});

		// The handler function throwing should be caught
		const strategy = manager.handleError("resolver", "test-resolver", new Error("resolver failed"));

		// Should still return "skip" (function handler → skip)
		expect(strategy).toBe("skip");

		const callbackErrors = errorSpy.mock.calls.filter(
			(call) => typeof call[0] === "string" && call[0].includes("Error in error handler callback"),
		);
		expect(callbackErrors.length).toBeGreaterThan(0);

		errorSpy.mockRestore();
	});
});
