/**
 * Testing Utilities Tests
 *
 * Tests for the testing utilities in directive/testing
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, t } from "../index.js";
import {
	createTestSystem,
	mockResolver,
	flushMicrotasks,
	settleWithFakeTimers,
} from "../utils/testing.js";

describe("Testing Utilities", () => {
	describe("createTestSystem", () => {
		it("should create a system that tracks events", () => {
			const schema = {
				facts: { count: t.number() },
				derivations: {},
				events: { increment: {} },
				requirements: {},
			} satisfies ModuleSchema;

			const counter = createModule("counter", {
				schema,
				init: (facts) => { facts.count = 0; },
				derive: {},
				events: {
					increment: (facts) => { facts.count += 1; },
				},
			});

			const system = createTestSystem({ modules: { counter } });
			system.start();

			system.dispatch({ type: "increment" });
			system.dispatch({ type: "increment" });

			expect(system.eventHistory).toHaveLength(2);
			expect(system.eventHistory[0]).toEqual({ type: "increment" });
			system.stop();
		});

		it("should track fact changes", () => {
			const schema = {
				facts: { value: t.number(), name: t.string() },
				derivations: {},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.value = 0; facts.name = ""; },
				derive: {},
				events: {},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();

			system.facts.test.value = 10;
			system.facts.test.name = "test";
			system.facts.test.value = 20;

			const history = system.getFactsHistory();
			expect(history.filter((c) => c.key === "value")).toHaveLength(2);
			expect(history.filter((c) => c.key === "name")).toHaveLength(1);

			system.stop();
		});

		it("should reset fact history", () => {
			const schema = {
				facts: { value: t.number() },
				derivations: {},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.value = 0; },
				derive: {},
				events: {},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();

			system.facts.test.value = 10;
			expect(system.getFactsHistory()).toHaveLength(1);

			system.resetFactsHistory();
			expect(system.getFactsHistory()).toHaveLength(0);

			system.facts.test.value = 20;
			expect(system.getFactsHistory()).toHaveLength(1);

			system.stop();
		});

		it("should assert fact was set", () => {
			const schema = {
				facts: { value: t.number() },
				derivations: {},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.value = 0; },
				derive: {},
				events: {},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();

			system.facts.test.value = 42;

			// Should not throw
			system.assertFactSet("value");
			system.assertFactSet("value", 42);

			// Should throw - wrong value
			expect(() => system.assertFactSet("value", 100)).toThrow();

			// Should throw - fact never set
			expect(() => system.assertFactSet("nonexistent")).toThrow();

			system.stop();
		});

		it("should assert fact change count", () => {
			const schema = {
				facts: { value: t.number() },
				derivations: {},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.value = 0; },
				derive: {},
				events: {},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();

			system.facts.test.value = 1;
			system.facts.test.value = 2;
			system.facts.test.value = 3;

			// Should not throw
			system.assertFactChanges("value", 3);

			// Should throw
			expect(() => system.assertFactChanges("value", 2)).toThrow();

			system.stop();
		});

		it("should track all requirements including resolved ones", async () => {
			const schema = {
				facts: { trigger: t.boolean(), done: t.boolean() },
				derivations: {},
				events: {},
				requirements: { DO_WORK: {} },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.trigger = true; facts.done = false; },
				derive: {},
				events: {},
				constraints: {
					needsWork: {
						when: (facts) => facts.trigger && !facts.done,
						require: { type: "DO_WORK" },
					},
				},
				resolvers: {
					doWork: {
						requirement: "DO_WORK",
						resolve: async (_req, ctx) => {
							ctx.facts.done = true;
						},
					},
				},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();
			await system.settle();

			// Requirement was generated (even though it's now resolved)
			expect(system.allRequirements.length).toBeGreaterThan(0);
			expect(system.allRequirements.some((r) => r.requirement.type === "DO_WORK")).toBe(true);

			system.stop();
		});

		it("should assert requirement type exists", async () => {
			const schema = {
				facts: { trigger: t.boolean() },
				derivations: {},
				events: {},
				requirements: { MY_REQ: {} },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.trigger = true; },
				derive: {},
				events: {},
				constraints: {
					needsWork: {
						when: (facts) => facts.trigger,
						require: { type: "MY_REQ" },
					},
				},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();
			await flushMicrotasks();

			// Should not throw
			system.assertRequirement("MY_REQ");

			// Should throw
			expect(() => system.assertRequirement("NONEXISTENT")).toThrow();

			system.stop();
		});
	});

	describe("mockResolver", () => {
		it("should capture requirements", async () => {
			const schema = {
				facts: { trigger: t.boolean() },
				derivations: {},
				events: {},
				requirements: { FETCH: { id: t.string() } },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.trigger = true; },
				derive: {},
				events: {},
				constraints: {
					needsFetch: {
						when: (facts) => facts.trigger,
						require: { type: "FETCH", id: "123" },
					},
				},
			});

			const fetchMock = mockResolver<{ type: "FETCH"; id: string }>("FETCH");

			const system = createTestSystem({
				modules: { test: module },
				mocks: {
					resolvers: {
						FETCH: { resolve: fetchMock.handler },
					},
				},
			});

			system.start();
			await flushMicrotasks();

			expect(fetchMock.calls).toHaveLength(1);
			expect(fetchMock.calls[0]).toMatchObject({ type: "FETCH", id: "123" });
			expect(fetchMock.pending).toHaveLength(1);

			system.stop();
		});

		it("should allow manual resolution", async () => {
			const schema = {
				facts: { userId: t.string(), user: t.any<{ name: string } | null>() },
				derivations: {},
				events: {},
				requirements: { FETCH_USER: {} },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.userId = ""; facts.user = null; },
				derive: {},
				events: {},
				constraints: {
					needsUser: {
						when: (facts) => facts.userId !== "" && facts.user === null,
						require: { type: "FETCH_USER" },
					},
				},
				resolvers: {
					fetchUser: {
						requirement: "FETCH_USER",
						resolve: async (_req, ctx) => {
							// This will be replaced by mock
							ctx.facts.user = { name: "default" };
						},
					},
				},
			});

			const fetchMock = mockResolver<{ type: "FETCH_USER" }>("FETCH_USER");

			const system = createTestSystem({
				modules: { test: module },
				mocks: {
					resolvers: {
						fetchUser: {
							resolve: async (req, ctx) => {
								await fetchMock.handler(req, ctx);
								ctx.facts.user = { name: "John" };
							},
						},
					},
				},
			});

			system.start();
			system.facts.test.userId = "123";
			await flushMicrotasks();

			// Requirement is pending
			expect(fetchMock.pending).toHaveLength(1);
			expect(system.facts.test.user).toBeNull();

			// Resolve it
			fetchMock.resolve();
			await flushMicrotasks();
			await system.settle();

			expect(system.facts.test.user).toEqual({ name: "John" });
			expect(fetchMock.pending).toHaveLength(0);

			system.stop();
		});

		it("should allow manual rejection", async () => {
			const schema = {
				facts: { trigger: t.boolean() },
				derivations: {},
				events: {},
				requirements: { FAIL_ME: {} },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.trigger = true; },
				derive: {},
				events: {},
				constraints: {
					needsFail: {
						when: (facts) => facts.trigger,
						require: { type: "FAIL_ME" },
					},
				},
			});

			const failMock = mockResolver<{ type: "FAIL_ME" }>("FAIL_ME");
			const errorHandler = vi.fn();

			const system = createTestSystem({
				modules: { test: module },
				mocks: {
					resolvers: {
						FAIL_ME: { resolve: failMock.handler },
					},
				},
				plugins: [{
					name: "error-tracker",
					onResolverError: errorHandler,
				}],
			});

			system.start();
			await flushMicrotasks();

			expect(failMock.pending).toHaveLength(1);

			// Reject it
			failMock.reject(new Error("Test error"));
			await flushMicrotasks();

			expect(errorHandler).toHaveBeenCalled();
			expect(failMock.pending).toHaveLength(0);

			system.stop();
		});

		it("should resolve/reject all pending", async () => {
			const schema = {
				facts: { count: t.number() },
				derivations: {},
				events: {},
				requirements: { WORK: { id: t.number() } },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.count = 3; },
				derive: {},
				events: {},
				constraints: {
					needsWork: {
						when: (facts) => facts.count > 0,
						require: (facts) =>
							Array.from({ length: facts.count }, (_, i) => ({
								type: "WORK" as const,
								id: i,
							})),
					},
				},
			});

			const workMock = mockResolver<{ type: "WORK"; id: number }>("WORK");

			const system = createTestSystem({
				modules: { test: module },
				mocks: {
					resolvers: {
						WORK: { resolve: workMock.handler },
					},
				},
			});

			system.start();
			await flushMicrotasks();

			expect(workMock.pending.length).toBe(3);

			workMock.resolveAll();
			await flushMicrotasks();

			expect(workMock.pending).toHaveLength(0);

			system.stop();
		});

		it("should reset call history", async () => {
			const workMock = mockResolver<{ type: "WORK" }>("WORK");

			// Simulate some calls
			workMock.handler({ type: "WORK" }, { facts: {}, signal: new AbortController().signal });
			workMock.handler({ type: "WORK" }, { facts: {}, signal: new AbortController().signal });

			expect(workMock.calls).toHaveLength(2);
			expect(workMock.pending).toHaveLength(2);

			workMock.reset();

			expect(workMock.calls).toHaveLength(0);
			expect(workMock.pending).toHaveLength(0);
		});
	});

	describe("flushMicrotasks", () => {
		it("should flush pending microtasks", async () => {
			let resolved = false;
			Promise.resolve().then(() => { resolved = true; });

			expect(resolved).toBe(false);
			await flushMicrotasks();
			expect(resolved).toBe(true);
		});
	});

	describe("settleWithFakeTimers", () => {
		it("should settle system with fake timers", async () => {
			vi.useFakeTimers();

			const schema = {
				facts: { trigger: t.boolean(), done: t.boolean() },
				derivations: {},
				events: {},
				requirements: { DELAYED: {} },
			} satisfies ModuleSchema;

			const module = createModule("test", {
				schema,
				init: (facts) => { facts.trigger = true; facts.done = false; },
				derive: {},
				events: {},
				constraints: {
					needsDelayed: {
						when: (facts) => facts.trigger && !facts.done,
						require: { type: "DELAYED" },
					},
				},
				resolvers: {
					delayed: {
						requirement: "DELAYED",
						resolve: async (_req, ctx) => {
							await new Promise((resolve) => setTimeout(resolve, 100));
							ctx.facts.done = true;
						},
					},
				},
			});

			const system = createTestSystem({ modules: { test: module } });
			system.start();

			await settleWithFakeTimers(system, vi.advanceTimersByTime.bind(vi), {
				totalTime: 500,
				stepSize: 10,
			});

			expect(system.facts.test.done).toBe(true);

			system.stop();
			vi.useRealTimers();
		});
	});
});
