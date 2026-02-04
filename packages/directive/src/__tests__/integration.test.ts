/**
 * Integration Tests
 *
 * These tests verify the end-to-end behavior of the Directive runtime.
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";

describe("Integration", () => {
	it("should create a basic system", () => {
		const schema = {
			facts: {
				count: t.number(),
			},
			derivations: {
				doubled: t.number(),
			},
			events: {
				increment: {},
			},
			requirements: {},
		} satisfies ModuleSchema;

		const counter = createModule("counter", {
			schema,
			init: (facts) => {
				facts.count = 0;
			},
			derive: {
				doubled: (facts) => facts.count * 2,
			},
			events: {
				increment: (facts) => {
					facts.count += 1;
				},
			},
		});

		const system = createSystem({ modules: [counter] });
		system.start();

		expect(system.facts.count).toBe(0);
		expect(system.read("doubled")).toBe(0);

		system.dispatch({ type: "increment" });
		expect(system.facts.count).toBe(1);
		expect(system.read("doubled")).toBe(2);

		system.stop();
	});

	it("should handle constraints and resolvers", async () => {
		const resolver = vi.fn();

		const schema = {
			facts: {
				userId: t.number(),
				user: t.any<{ id: number; name: string } | null>(),
			},
			derivations: {},
			events: {
				setUserId: { userId: t.number() },
			},
			requirements: {
				FETCH_USER: {},
			},
		} satisfies ModuleSchema;

		const fetchModule = createModule("fetch", {
			schema,
			init: (facts) => {
				facts.userId = 0;
				facts.user = null;
			},
			derive: {},
			events: {
				setUserId: (facts, { userId }) => {
					facts.userId = userId;
				},
			},
			constraints: {
				needsUser: {
					when: (facts) => facts.userId > 0 && facts.user === null,
					require: { type: "FETCH_USER" },
				},
			},
			resolvers: {
				fetchUser: {
					requirement: "FETCH_USER",
					resolve: async (_req, ctx) => {
						resolver();
						ctx.facts.user = { id: 1, name: "Test User" };
					},
				},
			},
		});

		const system = createSystem({ modules: [fetchModule] });
		system.start();

		system.dispatch({ type: "setUserId", userId: 1 });
		await system.settle();

		expect(resolver).toHaveBeenCalled();
		expect(system.facts.userId).toBe(1);

		system.stop();
	});

	it("should run effects", async () => {
		const effectFn = vi.fn();

		const schema = {
			facts: {
				value: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const effectModule = createModule("effect-test", {
			schema,
			init: (facts) => {
				facts.value = 0;
			},
			derive: {},
			events: {},
			effects: {
				logValue: {
					run: (facts) => {
						effectFn(facts.value);
					},
				},
			},
		});

		const system = createSystem({ modules: [effectModule] });
		system.start();

		system.facts.value = 42;
		await system.settle();

		expect(effectFn).toHaveBeenCalledWith(42);

		system.stop();
	});

	it("should support derivation composition", () => {
		const schema = {
			facts: {
				a: t.number(),
				b: t.number(),
			},
			derivations: {
				sum: t.number(),
				product: t.number(),
				sumPlusProduct: t.number(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mathModule = createModule("math", {
			schema,
			init: (facts) => {
				facts.a = 2;
				facts.b = 3;
			},
			derive: {
				sum: (facts) => facts.a + facts.b,
				product: (facts) => facts.a * facts.b,
				sumPlusProduct: (facts, derive) => {
					facts.a;
					facts.b;
					return derive.sum + derive.product;
				},
			},
			events: {},
		});

		const system = createSystem({ modules: [mathModule] });
		system.start();

		expect(system.read("sum")).toBe(5);
		expect(system.read("product")).toBe(6);
		expect(system.read("sumPlusProduct")).toBe(11);

		system.stop();
	});

	it("should support plugins", () => {
		const events: string[] = [];

		const schema = {
			facts: {
				count: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const counter = createModule("counter", {
			schema,
			init: (facts) => {
				facts.count = 0;
			},
			derive: {},
			events: {},
		});

		const trackingPlugin = {
			name: "tracking",
			onInit: () => { events.push("init"); },
			onStart: () => { events.push("start"); },
			onStop: () => { events.push("stop"); },
			onFactSet: (key: string) => { events.push(`set:${key}`); },
		};

		const system = createSystem({
			modules: [counter],
			plugins: [trackingPlugin],
		});

		system.start();
		system.facts.count = 1;
		system.stop();

		expect(events).toContain("init");
		expect(events).toContain("start");
		expect(events).toContain("set:count");
		expect(events).toContain("stop");
	});

	it("should provide inspection", () => {
		const schema = {
			facts: {
				count: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				INCREMENT: {},
			},
		} satisfies ModuleSchema;

		const counter = createModule("counter", {
			schema,
			init: (facts) => {
				facts.count = 0;
			},
			derive: {},
			events: {},
			constraints: {
				needsIncrement: {
					when: (facts) => facts.count < 5,
					require: { type: "INCREMENT" },
				},
			},
		});

		const system = createSystem({ modules: [counter] });
		system.start();

		const inspection = system.inspect();
		expect(inspection).toHaveProperty("unmet");
		expect(inspection).toHaveProperty("inflight");
		expect(inspection).toHaveProperty("constraints");

		system.stop();
	});

	describe("Multi-requirement constraints", () => {
		it("should support array of requirements", async () => {
			const resolvedTypes: string[] = [];

			const schema = {
				facts: {
					needsBoth: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					ACTION_A: { value: t.number() },
					ACTION_B: { message: t.string() },
				},
			} satisfies ModuleSchema;

			const multiModule = createModule("multi", {
				schema,
				init: (facts) => {
					facts.needsBoth = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerBoth: {
						when: (facts) => facts.needsBoth,
						require: [
							{ type: "ACTION_A", value: 42 },
							{ type: "ACTION_B", message: "hello" },
						],
					},
				},
				resolvers: {
					handleA: {
						requirement: "ACTION_A",
						resolve: async (req, ctx) => {
							resolvedTypes.push(`A:${req.value}`);
							ctx.facts.needsBoth = false;
						},
					},
					handleB: {
						requirement: "ACTION_B",
						resolve: async (req) => {
							resolvedTypes.push(`B:${req.message}`);
						},
					},
				},
			});

			const system = createSystem({ modules: [multiModule] });
			system.start();
			await system.settle();
			system.stop();

			expect(resolvedTypes).toContain("A:42");
			expect(resolvedTypes).toContain("B:hello");
		});

		it("should support function returning array", async () => {
			const resolvedTypes: string[] = [];

			const schema = {
				facts: {
					items: t.array<string>(),
				},
				derivations: {},
				events: {},
				requirements: {
					PROCESS_ITEM: { item: t.string() },
				},
			} satisfies ModuleSchema;

			const dynamicModule = createModule("dynamic", {
				schema,
				init: (facts) => {
					facts.items = ["x", "y", "z"];
				},
				derive: {},
				events: {},
				constraints: {
					processAll: {
						when: (facts) => facts.items.length > 0,
						require: (facts) => facts.items.map((item) => ({ type: "PROCESS_ITEM", item })),
					},
				},
				resolvers: {
					processItem: {
						requirement: "PROCESS_ITEM",
						key: (req) => `process-${req.item}`,
						resolve: async (req, ctx) => {
							resolvedTypes.push(req.item);
							ctx.facts.items = ctx.facts.items.filter((i) => i !== req.item);
						},
					},
				},
			});

			const system = createSystem({ modules: [dynamicModule] });
			system.start();
			await system.settle();
			system.stop();

			expect(resolvedTypes).toContain("x");
			expect(resolvedTypes).toContain("y");
			expect(resolvedTypes).toContain("z");
		});

		it("should handle null and empty array as no requirements", async () => {
			const constraintEvaluated = vi.fn();

			const schema = {
				facts: {
					mode: t.string<"null" | "empty" | "single">(),
				},
				derivations: {},
				events: {},
				requirements: {
					ACTION: { payload: t.string() },
				},
			} satisfies ModuleSchema;

			const nullModule = createModule("null-test", {
				schema,
				init: (facts) => {
					facts.mode = "null";
				},
				derive: {},
				events: {},
				constraints: {
					conditional: {
						when: () => {
							constraintEvaluated();
							return true;
						},
						require: (facts) => {
							if (facts.mode === "null") return null;
							if (facts.mode === "empty") return [];
							return { type: "ACTION", payload: "test" };
						},
					},
				},
			});

			const system = createSystem({ modules: [nullModule] });
			system.start();
			await system.settle();

			expect(constraintEvaluated).toHaveBeenCalled();
			const inspection = system.inspect();
			expect(inspection.unmet.length).toBe(0);

			system.stop();
		});

		it("should filter null/undefined from arrays", async () => {
			const resolvedTypes: string[] = [];

			const schema = {
				facts: {
					active: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					VALID_A: {},
					VALID_B: {},
				},
			} satisfies ModuleSchema;

			const filterModule = createModule("filter-test", {
				schema,
				init: (facts) => {
					facts.active = true;
				},
				derive: {},
				events: {},
				constraints: {
					mixedArray: {
						when: (facts) => facts.active,
						require: () => [
							{ type: "VALID_A" },
							null as unknown as { type: "VALID_A" },
							{ type: "VALID_B" },
							undefined as unknown as { type: "VALID_B" },
						],
					},
				},
				resolvers: {
					handleA: {
						requirement: "VALID_A",
						resolve: async (_req, ctx) => {
							resolvedTypes.push("A");
							ctx.facts.active = false;
						},
					},
					handleB: {
						requirement: "VALID_B",
						resolve: async () => {
							resolvedTypes.push("B");
						},
					},
				},
			});

			const system = createSystem({ modules: [filterModule] });
			system.start();
			await system.settle();
			system.stop();

			expect(resolvedTypes).toContain("A");
			expect(resolvedTypes).toContain("B");
			expect(resolvedTypes.length).toBe(2);
		});
	});

	describe("Error handling", () => {
		it("should handle resolver errors gracefully", async () => {
			const errorFn = vi.fn();

			const schema = {
				facts: {
					trigger: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					FAILING_ACTION: {},
				},
			} satisfies ModuleSchema;

			const errorModule = createModule("error-test", {
				schema,
				init: (facts) => {
					facts.trigger = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerError: {
						when: (facts) => facts.trigger,
						require: { type: "FAILING_ACTION" },
					},
				},
				resolvers: {
					failingResolver: {
						requirement: "FAILING_ACTION",
						resolve: async () => {
							throw new Error("Intentional failure");
						},
					},
				},
			});

			const errorPlugin = {
				name: "error-tracker",
				onResolverError: errorFn,
			};

			const system = createSystem({
				modules: [errorModule],
				plugins: [errorPlugin],
			});
			system.start();

			// Wait for the resolver to fail
			await new Promise((resolve) => setTimeout(resolve, 50));
			system.stop();

			expect(errorFn).toHaveBeenCalled();
			const call = errorFn.mock.calls[0];
			expect(call).toBeDefined();
			const error = call?.[2] as Error;
			expect(error).toBeInstanceOf(Error);
			expect(error.message).toBe("Intentional failure");
		});

		it("should retry resolver on failure with exponential backoff", async () => {
			let attempts = 0;

			const schema = {
				facts: {
					trigger: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					RETRY_ACTION: {},
				},
			} satisfies ModuleSchema;

			const retryModule = createModule("retry-test", {
				schema,
				init: (facts) => {
					facts.trigger = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerRetry: {
						when: (facts) => facts.trigger,
						require: { type: "RETRY_ACTION" },
					},
				},
				resolvers: {
					retryResolver: {
						requirement: "RETRY_ACTION",
						retry: {
							attempts: 3,
							backoff: "exponential",
							initialDelay: 10,
						},
						resolve: async (_req, ctx) => {
							attempts++;
							if (attempts < 3) {
								throw new Error(`Attempt ${attempts} failed`);
							}
							ctx.facts.trigger = false;
						},
					},
				},
			});

			const system = createSystem({ modules: [retryModule] });
			system.start();
			await system.settle();
			system.stop();

			expect(attempts).toBe(3);
			expect(system.facts.trigger).toBe(false);
		});

		it("should timeout resolver after configured duration", async () => {
			const errorFn = vi.fn();

			const schema = {
				facts: {
					trigger: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					SLOW_ACTION: {},
				},
			} satisfies ModuleSchema;

			const timeoutModule = createModule("timeout-test", {
				schema,
				init: (facts) => {
					facts.trigger = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerTimeout: {
						when: (facts) => facts.trigger,
						require: { type: "SLOW_ACTION" },
					},
				},
				resolvers: {
					slowResolver: {
						requirement: "SLOW_ACTION",
						timeout: 50,
						resolve: async () => {
							// This will timeout
							await new Promise((resolve) => setTimeout(resolve, 200));
						},
					},
				},
			});

			const errorPlugin = {
				name: "error-tracker",
				onResolverError: errorFn,
			};

			const system = createSystem({
				modules: [timeoutModule],
				plugins: [errorPlugin],
			});
			system.start();

			// Wait for timeout
			await new Promise((resolve) => setTimeout(resolve, 100));
			system.stop();

			expect(errorFn).toHaveBeenCalled();
			const call = errorFn.mock.calls[0];
			expect(call).toBeDefined();
			const error = call?.[2] as Error;
			expect(error.message).toContain("timed out");
		});

		it("should cancel inflight resolvers when system stops", async () => {
			let resolverStarted = false;
			let resolverCompleted = false;

			const schema = {
				facts: {
					trigger: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					CANCELABLE_ACTION: {},
				},
			} satisfies ModuleSchema;

			const cancelModule = createModule("cancel-test", {
				schema,
				init: (facts) => {
					facts.trigger = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerCancel: {
						when: (facts) => facts.trigger,
						require: { type: "CANCELABLE_ACTION" },
					},
				},
				resolvers: {
					cancelableResolver: {
						requirement: "CANCELABLE_ACTION",
						resolve: async (_req, ctx) => {
							resolverStarted = true;
							// Long running operation
							await new Promise((resolve) => setTimeout(resolve, 500));
							resolverCompleted = true;
							ctx.facts.trigger = false;
						},
					},
				},
			});

			const system = createSystem({ modules: [cancelModule] });
			system.start();

			// Wait for resolver to start
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(resolverStarted).toBe(true);

			// Stop system before resolver completes
			system.stop();

			// Wait a bit to ensure resolver would have completed if not canceled
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(resolverCompleted).toBe(false);
		});

		it("should respect abort signal in resolvers", async () => {
			let wasAborted = false;

			const schema = {
				facts: {
					trigger: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					ABORTABLE_ACTION: {},
				},
			} satisfies ModuleSchema;

			const abortModule = createModule("abort-test", {
				schema,
				init: (facts) => {
					facts.trigger = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerAbort: {
						when: (facts) => facts.trigger,
						require: { type: "ABORTABLE_ACTION" },
					},
				},
				resolvers: {
					abortableResolver: {
						requirement: "ABORTABLE_ACTION",
						resolve: async (_req, ctx) => {
							// Check signal periodically
							for (let i = 0; i < 10; i++) {
								if (ctx.signal?.aborted) {
									wasAborted = true;
									return;
								}
								await new Promise((resolve) => setTimeout(resolve, 50));
							}
						},
					},
				},
			});

			const system = createSystem({ modules: [abortModule] });
			system.start();

			// Wait for resolver to start
			await new Promise((resolve) => setTimeout(resolve, 20));

			// Stop system to trigger abort
			system.stop();

			// Wait a bit for abort to be detected
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(wasAborted).toBe(true);
		});

		it("should handle multiple resolver failures", async () => {
			const errors: string[] = [];

			const schema = {
				facts: {
					active: t.boolean(),
				},
				derivations: {},
				events: {},
				requirements: {
					FAIL_A: {},
					FAIL_B: {},
				},
			} satisfies ModuleSchema;

			const multiFailModule = createModule("multi-fail-test", {
				schema,
				init: (facts) => {
					facts.active = true;
				},
				derive: {},
				events: {},
				constraints: {
					triggerMultiFail: {
						when: (facts) => facts.active,
						require: [{ type: "FAIL_A" }, { type: "FAIL_B" }],
					},
				},
				resolvers: {
					failA: {
						requirement: "FAIL_A",
						resolve: async () => {
							throw new Error("Failure A");
						},
					},
					failB: {
						requirement: "FAIL_B",
						resolve: async () => {
							throw new Error("Failure B");
						},
					},
				},
			});

			const errorPlugin = {
				name: "error-tracker",
				onResolverError: (_: string, __: unknown, error: unknown) => {
					errors.push((error as Error).message);
				},
			};

			const system = createSystem({
				modules: [multiFailModule],
				plugins: [errorPlugin],
			});
			system.start();

			// Wait for both resolvers to fail
			await new Promise((resolve) => setTimeout(resolve, 100));
			system.stop();

			expect(errors).toContain("Failure A");
			expect(errors).toContain("Failure B");
		});
	});
});
