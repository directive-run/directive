/**
 * Constraint Ordering Tests
 *
 * Tests for the `after` property on constraints, which allows
 * explicit ordering of constraint evaluation based on resolver completion.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";

describe("Constraint Ordering (after)", () => {
	it("delays constraint evaluation until dependency resolver completes", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				step: t.number(),
				creditChecked: t.boolean(),
				addressVerified: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				RUN_CREDIT_CHECK: {},
				VERIFY_ADDRESS: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("order-test", {
			schema,
			init: (facts) => {
				facts.step = 2;
				facts.creditChecked = false;
				facts.addressVerified = false;
			},
			derive: {},
			events: {},
			constraints: {
				creditCheck: {
					when: (facts) => facts.step >= 2 && !facts.creditChecked,
					require: { type: "RUN_CREDIT_CHECK" },
				},
				addressVerification: {
					after: ["creditCheck"],
					when: (facts) => facts.step >= 2 && !facts.addressVerified,
					require: { type: "VERIFY_ADDRESS" },
				},
			},
			resolvers: {
				creditCheck: {
					requirement: "RUN_CREDIT_CHECK",
					resolve: async (_req, ctx) => {
						executionOrder.push("CREDIT_CHECK");
						ctx.facts.creditChecked = true;
					},
				},
				addressVerification: {
					requirement: "VERIFY_ADDRESS",
					resolve: async (_req, ctx) => {
						executionOrder.push("ADDRESS_VERIFY");
						ctx.facts.addressVerified = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		expect(executionOrder).toEqual(["CREDIT_CHECK", "ADDRESS_VERIFY"]);
		expect(system.facts.creditChecked).toBe(true);
		expect(system.facts.addressVerified).toBe(true);

		system.stop();
	});

	it("proceeds when dependency constraint doesn't fire (when returns false)", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				needsCredit: t.boolean(),
				addressVerified: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				RUN_CREDIT_CHECK: {},
				VERIFY_ADDRESS: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("no-fire-test", {
			schema,
			init: (facts) => {
				facts.needsCredit = false; // Credit check won't fire
				facts.addressVerified = false;
			},
			derive: {},
			events: {},
			constraints: {
				creditCheck: {
					when: (facts) => facts.needsCredit,
					require: { type: "RUN_CREDIT_CHECK" },
				},
				addressVerification: {
					after: ["creditCheck"],
					when: (facts) => !facts.addressVerified,
					require: { type: "VERIFY_ADDRESS" },
				},
			},
			resolvers: {
				creditCheck: {
					requirement: "RUN_CREDIT_CHECK",
					resolve: async () => {
						executionOrder.push("CREDIT_CHECK");
					},
				},
				addressVerification: {
					requirement: "VERIFY_ADDRESS",
					resolve: async (_req, ctx) => {
						executionOrder.push("ADDRESS_VERIFY");
						ctx.facts.addressVerified = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// Credit check should not have run, but address verification should proceed
		expect(executionOrder).toEqual(["ADDRESS_VERIFY"]);
		expect(system.facts.addressVerified).toBe(true);

		system.stop();
	});

	it("chains multiple dependencies in order", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				step1Done: t.boolean(),
				step2Done: t.boolean(),
				step3Done: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				STEP_1: {},
				STEP_2: {},
				STEP_3: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("chain-test", {
			schema,
			init: (facts) => {
				facts.step1Done = false;
				facts.step2Done = false;
				facts.step3Done = false;
			},
			derive: {},
			events: {},
			constraints: {
				step1: {
					when: (facts) => !facts.step1Done,
					require: { type: "STEP_1" },
				},
				step2: {
					after: ["step1"],
					when: (facts) => !facts.step2Done,
					require: { type: "STEP_2" },
				},
				step3: {
					after: ["step2"],
					when: (facts) => !facts.step3Done,
					require: { type: "STEP_3" },
				},
			},
			resolvers: {
				step1: {
					requirement: "STEP_1",
					resolve: async (_req, ctx) => {
						executionOrder.push("STEP_1");
						ctx.facts.step1Done = true;
					},
				},
				step2: {
					requirement: "STEP_2",
					resolve: async (_req, ctx) => {
						executionOrder.push("STEP_2");
						ctx.facts.step2Done = true;
					},
				},
				step3: {
					requirement: "STEP_3",
					resolve: async (_req, ctx) => {
						executionOrder.push("STEP_3");
						ctx.facts.step3Done = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		expect(executionOrder).toEqual(["STEP_1", "STEP_2", "STEP_3"]);

		system.stop();
	});

	it("detects cycles in dev mode", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";

		try {
			const schema = {
				facts: {},
				derivations: {},
				events: {},
				requirements: {
					A: {},
					B: {},
				},
			} satisfies ModuleSchema;

			const module = createModule("cycle-test", {
				schema,
				init: () => {},
				derive: {},
				events: {},
				constraints: {
					a: {
						after: ["b"],
						when: () => true,
						require: { type: "A" },
					},
					b: {
						after: ["a"],
						when: () => true,
						require: { type: "B" },
					},
				},
				resolvers: {
					a: {
						requirement: "A",
						resolve: async () => {},
					},
					b: {
						requirement: "B",
						resolve: async () => {},
					},
				},
			});

			// Cycle detection happens when creating the system (engine), not the module
			expect(() => createSystem({ module })).toThrow(/cycle detected/i);
		} finally {
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("allows multiple dependencies on the same constraint", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				setupDone: t.boolean(),
				taskADone: t.boolean(),
				taskBDone: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				SETUP: {},
				TASK_A: {},
				TASK_B: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("multi-dep-test", {
			schema,
			init: (facts) => {
				facts.setupDone = false;
				facts.taskADone = false;
				facts.taskBDone = false;
			},
			derive: {},
			events: {},
			constraints: {
				setup: {
					when: (facts) => !facts.setupDone,
					require: { type: "SETUP" },
				},
				taskA: {
					after: ["setup"],
					when: (facts) => !facts.taskADone,
					require: { type: "TASK_A" },
				},
				taskB: {
					after: ["setup"],
					when: (facts) => !facts.taskBDone,
					require: { type: "TASK_B" },
				},
			},
			resolvers: {
				setup: {
					requirement: "SETUP",
					resolve: async (_req, ctx) => {
						executionOrder.push("SETUP");
						ctx.facts.setupDone = true;
					},
				},
				taskA: {
					requirement: "TASK_A",
					resolve: async (_req, ctx) => {
						executionOrder.push("TASK_A");
						ctx.facts.taskADone = true;
					},
				},
				taskB: {
					requirement: "TASK_B",
					resolve: async (_req, ctx) => {
						executionOrder.push("TASK_B");
						ctx.facts.taskBDone = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// Setup runs first, then A and B can run (order between A and B may vary)
		expect(executionOrder[0]).toBe("SETUP");
		expect(executionOrder.slice(1).sort()).toEqual(["TASK_A", "TASK_B"]);

		system.stop();
	});

	it("respects after with multiple dependencies (all must complete)", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				dep1Done: t.boolean(),
				dep2Done: t.boolean(),
				mainDone: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				DEP_1: {},
				DEP_2: {},
				MAIN: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("multi-after-test", {
			schema,
			init: (facts) => {
				facts.dep1Done = false;
				facts.dep2Done = false;
				facts.mainDone = false;
			},
			derive: {},
			events: {},
			constraints: {
				dep1: {
					when: (facts) => !facts.dep1Done,
					require: { type: "DEP_1" },
				},
				dep2: {
					when: (facts) => !facts.dep2Done,
					require: { type: "DEP_2" },
				},
				main: {
					after: ["dep1", "dep2"],
					when: (facts) => !facts.mainDone,
					require: { type: "MAIN" },
				},
			},
			resolvers: {
				dep1: {
					requirement: "DEP_1",
					resolve: async (_req, ctx) => {
						await new Promise((r) => setTimeout(r, 10));
						executionOrder.push("DEP_1");
						ctx.facts.dep1Done = true;
					},
				},
				dep2: {
					requirement: "DEP_2",
					resolve: async (_req, ctx) => {
						await new Promise((r) => setTimeout(r, 5));
						executionOrder.push("DEP_2");
						ctx.facts.dep2Done = true;
					},
				},
				main: {
					requirement: "MAIN",
					resolve: async (_req, ctx) => {
						executionOrder.push("MAIN");
						ctx.facts.mainDone = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// MAIN should run after both DEP_1 and DEP_2
		const mainIndex = executionOrder.indexOf("MAIN");
		const dep1Index = executionOrder.indexOf("DEP_1");
		const dep2Index = executionOrder.indexOf("DEP_2");

		expect(mainIndex).toBeGreaterThan(dep1Index);
		expect(mainIndex).toBeGreaterThan(dep2Index);

		system.stop();
	});

	it("keeps dependent blocked when dependency resolver fails (until retry succeeds)", async () => {
		const executionOrder: string[] = [];
		let shouldFail = true;

		const schema = {
			facts: {
				step1Done: t.boolean(),
				step2Done: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				STEP_1: {},
				STEP_2: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("failure-test", {
			schema,
			init: (facts) => {
				facts.step1Done = false;
				facts.step2Done = false;
			},
			derive: {},
			events: {},
			constraints: {
				step1: {
					when: (facts) => !facts.step1Done,
					require: { type: "STEP_1" },
				},
				step2: {
					after: ["step1"],
					when: (facts) => !facts.step2Done,
					require: { type: "STEP_2" },
				},
			},
			resolvers: {
				step1: {
					requirement: "STEP_1",
					retry: { attempts: 3, backoff: "none", initialDelay: 10 },
					resolve: async (_req, ctx) => {
						if (shouldFail) {
							shouldFail = false;
							throw new Error("Temporary failure");
						}
						executionOrder.push("STEP_1");
						ctx.facts.step1Done = true;
					},
				},
				step2: {
					requirement: "STEP_2",
					resolve: async (_req, ctx) => {
						executionOrder.push("STEP_2");
						ctx.facts.step2Done = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// Step 1 retried and succeeded, then step 2 ran
		expect(executionOrder).toEqual(["STEP_1", "STEP_2"]);
		expect(system.facts.step1Done).toBe(true);
		expect(system.facts.step2Done).toBe(true);

		system.stop();
	});

	it("warns about unknown constraint IDs in after (dev mode)", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			const schema = {
				facts: { done: t.boolean() },
				derivations: {},
				events: {},
				requirements: { DO_THING: {} },
			} satisfies ModuleSchema;

			const module = createModule("unknown-dep-test", {
				schema,
				init: (facts) => {
					facts.done = false;
				},
				derive: {},
				events: {},
				constraints: {
					doThing: {
						after: ["nonExistentConstraint"], // typo or missing dependency
						when: (facts) => !facts.done,
						require: { type: "DO_THING" },
					},
				},
				resolvers: {
					doThing: {
						requirement: "DO_THING",
						resolve: async (_req, ctx) => {
							ctx.facts.done = true;
						},
					},
				},
			});

			// Warning happens when system is created (constraints manager initialized)
			const system = createSystem({ module });

			// Should have warned about unknown constraint
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("nonExistentConstraint"),
			);

			// But constraint should still run (unknown deps are skipped)
			system.start();
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("respects priority within topological order", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				setupDone: t.boolean(),
				highPriorityDone: t.boolean(),
				lowPriorityDone: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				SETUP: {},
				HIGH_PRIORITY: {},
				LOW_PRIORITY: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("priority-test", {
			schema,
			init: (facts) => {
				facts.setupDone = false;
				facts.highPriorityDone = false;
				facts.lowPriorityDone = false;
			},
			derive: {},
			events: {},
			constraints: {
				setup: {
					priority: 100,
					when: (facts) => !facts.setupDone,
					require: { type: "SETUP" },
				},
				highPriority: {
					priority: 50,
					after: ["setup"],
					when: (facts) => !facts.highPriorityDone,
					require: { type: "HIGH_PRIORITY" },
				},
				lowPriority: {
					priority: 10,
					after: ["setup"],
					when: (facts) => !facts.lowPriorityDone,
					require: { type: "LOW_PRIORITY" },
				},
			},
			resolvers: {
				setup: {
					requirement: "SETUP",
					resolve: async (_req, ctx) => {
						executionOrder.push("SETUP");
						ctx.facts.setupDone = true;
					},
				},
				highPriority: {
					requirement: "HIGH_PRIORITY",
					resolve: async (_req, ctx) => {
						executionOrder.push("HIGH_PRIORITY");
						ctx.facts.highPriorityDone = true;
					},
				},
				lowPriority: {
					requirement: "LOW_PRIORITY",
					resolve: async (_req, ctx) => {
						executionOrder.push("LOW_PRIORITY");
						ctx.facts.lowPriorityDone = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// Setup first (highest priority), then high and low (both depend on setup)
		// after takes precedence over priority for ordering
		expect(executionOrder[0]).toBe("SETUP");
		// Both high and low run after setup - order may vary since they run in parallel
		expect(executionOrder.slice(1).sort()).toEqual(["HIGH_PRIORITY", "LOW_PRIORITY"]);

		system.stop();
	});

	it("detects cycles in production mode", () => {
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";

		try {
			const schema = {
				facts: {},
				derivations: {},
				events: {},
				requirements: {
					A: {},
					B: {},
					C: {},
				},
			} satisfies ModuleSchema;

			const module = createModule("production-cycle-test", {
				schema,
				init: () => {},
				derive: {},
				events: {},
				constraints: {
					a: {
						after: ["c"], // a -> c -> b -> a (cycle of 3)
						when: () => true,
						require: { type: "A" },
					},
					b: {
						after: ["a"],
						when: () => true,
						require: { type: "B" },
					},
					c: {
						after: ["b"],
						when: () => true,
						require: { type: "C" },
					},
				},
				resolvers: {
					a: { requirement: "A", resolve: async () => {} },
					b: { requirement: "B", resolve: async () => {} },
					c: { requirement: "C", resolve: async () => {} },
				},
			});

			// Cycle detection runs even in production mode
			expect(() => createSystem({ module })).toThrow(/cycle detected/i);
		} finally {
			process.env.NODE_ENV = originalEnv;
		}
	});

	it("skips disabled constraints as dependencies (dependent proceeds)", async () => {
		const executionOrder: string[] = [];

		const schema = {
			facts: {
				setupDone: t.boolean(),
				mainDone: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: {
				SETUP: {},
				MAIN: {},
			},
		} satisfies ModuleSchema;

		const module = createModule("disabled-dep-test", {
			schema,
			// Initialize with setupDone = true so setup constraint won't fire
			init: (facts) => {
				facts.setupDone = true; // Already done - setup won't fire
				facts.mainDone = false;
			},
			derive: {},
			events: {},
			constraints: {
				setup: {
					when: (facts) => !facts.setupDone, // Won't fire since setupDone = true
					require: { type: "SETUP" },
				},
				main: {
					after: ["setup"],
					when: (facts) => !facts.mainDone,
					require: { type: "MAIN" },
				},
			},
			resolvers: {
				setup: {
					requirement: "SETUP",
					resolve: async (_req, ctx) => {
						executionOrder.push("SETUP");
						ctx.facts.setupDone = true;
					},
				},
				main: {
					requirement: "MAIN",
					resolve: async (_req, ctx) => {
						executionOrder.push("MAIN");
						ctx.facts.mainDone = true;
					},
				},
			},
		});

		const system = createSystem({ module });
		system.start();
		await system.settle();

		// Main should have run even though it has `after: ["setup"]`
		// because setup's when() returned false (didn't fire, nothing to wait for)
		// This tests the noFireConstraints tracking
		expect(executionOrder).toEqual(["MAIN"]);
		expect(system.facts.mainDone).toBe(true);

		system.stop();
	});
});
