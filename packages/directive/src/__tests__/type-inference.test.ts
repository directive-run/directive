/**
 * Type Inference Tests
 *
 * These tests verify that the consolidated schema API provides full type inference:
 * - Derivation composition (derive accessor is typed)
 * - Event dispatch (typed payloads from schema)
 * - Resolver requirements (typed from schema)
 */

import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";

describe("Type Inference", () => {
	describe("optional schema sections", () => {
		it("should allow minimal schema with only facts", () => {
			// Minimal schema - only facts required
			const schema = {
				facts: {
					count: t.number(),
				},
			} satisfies ModuleSchema;

			const mod = createModule("minimal", {
				schema,
				init: (facts) => {
					facts.count = 0;
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.facts.count).toBe(0);
			system.facts.count = 42;
			expect(system.facts.count).toBe(42);

			system.stop();
		});

		it("should allow schema with derivations but no events", () => {
			const schema = {
				facts: {
					count: t.number(),
				},
				derivations: {
					doubled: t.number(),
				},
			} satisfies ModuleSchema;

			const mod = createModule("no-events", {
				schema,
				init: (facts) => {
					facts.count = 5;
				},
				derive: {
					doubled: (facts) => facts.count * 2,
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.derive.doubled).toBe(10);

			system.stop();
		});

		it("should allow schema with events but no derivations", () => {
			const schema = {
				facts: {
					count: t.number(),
				},
				events: {
					increment: {},
				},
			} satisfies ModuleSchema;

			const mod = createModule("no-derivations", {
				schema,
				init: (facts) => {
					facts.count = 0;
				},
				events: {
					increment: (facts) => {
						facts.count += 1;
					},
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			system.dispatch({ type: "increment" });
			expect(system.facts.count).toBe(1);

			system.stop();
		});

		it("should allow schema with requirements but no events or derivations", () => {
			const schema = {
				facts: {
					data: t.string(),
				},
				requirements: {
					FETCH: {},
				},
			} satisfies ModuleSchema;

			const mod = createModule("requirements-only", {
				schema,
				init: (facts) => {
					facts.data = "";
				},
				constraints: {
					needsData: {
						when: (facts) => facts.data === "",
						require: { type: "FETCH" },
					},
				},
				resolvers: {
					fetch: {
						requirement: "FETCH",
						resolve: async (_req, ctx) => {
							ctx.facts.data = "loaded";
						},
					},
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			// System should start to resolve
			expect(system.facts.data).toBe("");

			system.stop();
		});
	});

	describe("type assertions", () => {
		it("should support {} as { ... } pattern for facts", () => {
			const mod = createModule("xstate-facts", {
				schema: {
					facts: {} as { count: number; name: string },
					derivations: {} as { doubled: number },
					events: {} as { increment: {} },
					requirements: {},
				},
				init: (facts) => {
					facts.count = 0;
					facts.name = "test";
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

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.facts.count).toBe(0);
			expect(system.facts.name).toBe("test");
			expect(system.derive.doubled).toBe(0);

			system.dispatch({ type: "increment" });
			expect(system.facts.count).toBe(1);
			expect(system.derive.doubled).toBe(2);

			system.stop();
		});

		it("should support mixed t.*() and {} as {} patterns", () => {
			const mod = createModule("mixed-styles", {
				schema: {
					facts: { count: t.number(), name: t.string() },
					derivations: {} as { doubled: number },
					events: { increment: {} },
					requirements: {} as { FETCH: { id: string } },
				},
				init: (facts) => {
					facts.count = 5;
					facts.name = "mixed";
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

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.facts.count).toBe(5);
			expect(system.derive.doubled).toBe(10);

			system.stop();
		});

		it("should skip validation for type assertion schemas", () => {
			// type assertion has no runtime validators, so any value should work
			const mod = createModule("no-validation", {
				schema: {
					facts: {} as { count: number },
				},
				init: (facts) => {
					// This would fail with t.number() and validate:true
					// but type assertion has no validators
					facts.count = 42;
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.facts.count).toBe(42);

			system.stop();
		});
	});

	describe("basic module creation", () => {
		it("should create a module with typed facts", () => {
			const schema = {
				facts: {
					count: t.number(),
					name: t.string(),
				},
				derivations: {
					doubled: t.number(),
				},
				events: {
					increment: {},
				},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("basic", {
				schema,
				init: (facts) => {
					facts.count = 0;
					facts.name = "test";
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

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.facts.count).toBe(0);
			expect(system.facts.name).toBe("test");
			expect(system.derive.doubled).toBe(0);

			system.dispatch({ type: "increment" });
			expect(system.facts.count).toBe(1);
			expect(system.derive.doubled).toBe(2);

			system.stop();
		});
	});

	describe("derivation composition", () => {
		it("should support typed derivation composition", () => {
			const schema = {
				facts: {
					a: t.number(),
					b: t.number(),
				},
				derivations: {
					sum: t.number(),
					doubled: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("composition", {
				schema,
				init: (facts) => {
					facts.a = 3;
					facts.b = 4;
				},
				derive: {
					sum: (facts) => facts.a + facts.b,
					// derive.sum is typed as number from schema.derivations!
					// Note: still need to touch facts for dependency tracking
					doubled: (facts, derive) => {
						facts.a;
						facts.b;
						return derive.sum * 2;
					},
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.derive.sum).toBe(7);
			expect(system.derive.doubled).toBe(14);

			system.facts.a = 10;
			expect(system.derive.sum).toBe(14);
			expect(system.derive.doubled).toBe(28);

			system.stop();
		});

		it("should support derivation chains (A -> B -> C)", () => {
			const schema = {
				facts: {
					base: t.number(),
				},
				derivations: {
					doubled: t.number(),
					quadrupled: t.number(),
					octupled: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("chain", {
				schema,
				init: (facts) => {
					facts.base = 2;
				},
				derive: {
					doubled: (facts) => facts.base * 2,
					quadrupled: (facts, derive) => {
						facts.base;
						return derive.doubled * 2;
					},
					octupled: (facts, derive) => {
						facts.base;
						return derive.quadrupled * 2;
					},
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.derive.doubled).toBe(4);
			expect(system.derive.quadrupled).toBe(8);
			expect(system.derive.octupled).toBe(16);

			system.facts.base = 3;
			expect(system.derive.doubled).toBe(6);
			expect(system.derive.quadrupled).toBe(12);
			expect(system.derive.octupled).toBe(24);

			system.stop();
		});
	});

	describe("typed event payloads", () => {
		it("should support events with typed payloads from schema", () => {
			const schema = {
				facts: {
					count: t.number(),
					lastAction: t.string(),
				},
				derivations: {},
				events: {
					increment: {},
					incrementBy: { amount: t.number() },
					setCount: { value: t.number(), reason: t.string() },
				},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("events", {
				schema,
				init: (facts) => {
					facts.count = 0;
					facts.lastAction = "";
				},
				derive: {},
				events: {
					increment: (facts) => {
						facts.count += 1;
						facts.lastAction = "increment";
					},
					// { amount } is typed from schema.events.incrementBy!
					incrementBy: (facts, { amount }) => {
						facts.count += amount;
						facts.lastAction = `incrementBy(${amount})`;
					},
					// { value, reason } are typed from schema.events.setCount!
					setCount: (facts, { value, reason }) => {
						facts.count = value;
						facts.lastAction = reason;
					},
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			system.dispatch({ type: "increment" });
			expect(system.facts.count).toBe(1);
			expect(system.facts.lastAction).toBe("increment");

			system.dispatch({ type: "incrementBy", amount: 5 });
			expect(system.facts.count).toBe(6);
			expect(system.facts.lastAction).toBe("incrementBy(5)");

			system.dispatch({ type: "setCount", value: 100, reason: "manual reset" });
			expect(system.facts.count).toBe(100);
			expect(system.facts.lastAction).toBe("manual reset");

			system.stop();
		});
	});

	describe("typed requirements and resolvers", () => {
		it("should support constraints and resolvers with typed requirements", async () => {
			const resolver = vi.fn();

			const schema = {
				facts: {
					userId: t.number(),
					user: t.any<{ id: number; name: string } | null>(),
				},
				derivations: {
					needsUser: t.boolean(),
				},
				events: {},
				requirements: {
					FETCH_USER: { userId: t.number() },
				},
			} satisfies ModuleSchema;

			const mod = createModule("fetch", {
				schema,
				init: (facts) => {
					facts.userId = 0;
					facts.user = null;
				},
				derive: {
					needsUser: (facts) => facts.userId > 0 && facts.user === null,
				},
				events: {},
				constraints: {
					needsUser: {
						when: (facts) => facts.userId > 0 && facts.user === null,
						// Typed requirement from schema.requirements!
						require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
					},
				},
				resolvers: {
					fetchUser: {
						requirement: "FETCH_USER",
						// req.userId is typed from schema.requirements.FETCH_USER!
						resolve: async (req, ctx) => {
							resolver(req.userId);
							ctx.facts.user = { id: req.userId, name: `User ${req.userId}` };
						},
					},
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			system.facts.userId = 42;
			await system.settle();

			expect(resolver).toHaveBeenCalledWith(42);
			expect(system.facts.user).toEqual({ id: 42, name: "User 42" });

			system.stop();
		});

		it("should support multiple resolvers for different requirement types", async () => {
			const fetchResolver = vi.fn();
			const processResolver = vi.fn();

			const schema = {
				facts: {
					status: t.string<"idle" | "fetching" | "processing" | "done">(),
				},
				derivations: {},
				events: {},
				requirements: {
					FETCH: {},
					PROCESS: {},
				},
			} satisfies ModuleSchema;

			const mod = createModule("multi", {
				schema,
				init: (facts) => {
					facts.status = "idle";
				},
				derive: {},
				events: {},
				constraints: {
					needsFetch: {
						when: (facts) => facts.status === "idle",
						require: { type: "FETCH" },
					},
					needsProcess: {
						when: (facts) => facts.status === "fetching",
						require: { type: "PROCESS" },
					},
				},
				resolvers: {
					fetch: {
						requirement: "FETCH",
						resolve: async (_req, ctx) => {
							fetchResolver();
							ctx.facts.status = "fetching";
						},
					},
					process: {
						requirement: "PROCESS",
						resolve: async (_req, ctx) => {
							processResolver();
							ctx.facts.status = "done";
						},
					},
				},
			});

			const system = createSystem({ modules: [mod] });
			system.start();
			await system.settle();

			expect(fetchResolver).toHaveBeenCalled();
			expect(processResolver).toHaveBeenCalled();
			expect(system.facts.status).toBe("done");

			system.stop();
		});
	});

	describe("complex schemas", () => {
		it("should handle nested object schemas", () => {
			const schema = {
				facts: {
					config: t.object<{
						api: { baseUrl: string; timeout: number };
						features: { darkMode: boolean; notifications: boolean };
					}>(),
				},
				derivations: {
					apiUrl: t.string(),
					isDarkMode: t.boolean(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("nested", {
				schema,
				init: (facts) => {
					facts.config = {
						api: { baseUrl: "https://api.example.com", timeout: 5000 },
						features: { darkMode: false, notifications: true },
					};
				},
				derive: {
					apiUrl: (facts) => facts.config.api.baseUrl,
					isDarkMode: (facts) => facts.config.features.darkMode,
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.derive.apiUrl).toBe("https://api.example.com");
			expect(system.derive.isDarkMode).toBe(false);

			system.facts.config = {
				...system.facts.config,
				features: { ...system.facts.config.features, darkMode: true },
			};

			expect(system.derive.isDarkMode).toBe(true);

			system.stop();
		});

		it("should handle array schemas with item types", () => {
			const schema = {
				facts: {
					items: t.array<{ price: number; qty: number }>(),
					taxRate: t.number(),
				},
				derivations: {
					subtotal: t.number(),
					total: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("array", {
				schema,
				init: (facts) => {
					facts.items = [
						{ price: 10, qty: 2 },
						{ price: 5, qty: 3 },
					];
					facts.taxRate = 0.1;
				},
				derive: {
					subtotal: (facts) =>
						facts.items.reduce((sum, item) => sum + item.price * item.qty, 0),
					total: (facts) => {
						const subtotal = facts.items.reduce(
							(sum, item) => sum + item.price * item.qty,
							0,
						);
						return subtotal * (1 + facts.taxRate);
					},
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			// subtotal = 10*2 + 5*3 = 35
			expect(system.derive.subtotal).toBe(35);
			// total = 35 * 1.1 = 38.5
			expect(system.derive.total).toBe(38.5);

			system.stop();
		});
	});

	describe("system.derive accessor", () => {
		it("should provide typed access to derivations", () => {
			const schema = {
				facts: {
					a: t.number(),
					b: t.number(),
				},
				derivations: {
					sum: t.number(),
					product: t.number(),
					isPositive: t.boolean(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("math", {
				schema,
				init: (facts) => {
					facts.a = 3;
					facts.b = 4;
				},
				derive: {
					sum: (facts) => facts.a + facts.b,
					product: (facts) => facts.a * facts.b,
					isPositive: (facts) => facts.a > 0 && facts.b > 0,
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			expect(system.derive.sum).toBe(7);
			expect(system.derive.product).toBe(12);
			expect(system.derive.isPositive).toBe(true);

			system.facts.a = 0;
			expect(system.derive.sum).toBe(4);
			expect(system.derive.product).toBe(0);
			expect(system.derive.isPositive).toBe(false);

			system.stop();
		});
	});

	describe("typed read() and watch()", () => {
		it("should infer return types from derivation definitions", () => {
			const schema = {
				facts: {
					items: t.array<{ price: number; qty: number }>(),
				},
				derivations: {
					total: t.number(),
					itemCount: t.number(),
					isEmpty: t.boolean(),
					firstItem: t.any<{ price: number; qty: number } | null>(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("read", {
				schema,
				init: (facts) => {
					facts.items = [
						{ price: 10, qty: 2 },
						{ price: 5, qty: 4 },
					];
				},
				derive: {
					total: (facts) => facts.items.reduce((sum, i) => sum + i.price * i.qty, 0),
					itemCount: (facts) => facts.items.length,
					isEmpty: (facts) => facts.items.length === 0,
					firstItem: (facts) => facts.items[0] ?? null,
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			const total = system.read("total");
			expect(total).toBe(40);

			const count = system.read("itemCount");
			expect(count).toBe(2);

			const empty = system.read("isEmpty");
			expect(empty).toBe(false);

			const first = system.read("firstItem");
			expect(first).toEqual({ price: 10, qty: 2 });

			system.stop();
		});

		it("should provide typed callbacks in watch()", () => {
			const watchCallback = vi.fn();

			const schema = {
				facts: {
					count: t.number(),
				},
				derivations: {
					doubled: t.number(),
				},
				events: {},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("watch", {
				schema,
				init: (facts) => {
					facts.count = 0;
				},
				derive: {
					doubled: (facts) => facts.count * 2,
				},
				events: {},
			});

			const system = createSystem({ modules: [mod] });
			system.start();

			const unwatch = system.watch("doubled", (newValue, oldValue) => {
				watchCallback({ newValue, oldValue });
			});

			system.facts.count = 5;
			expect(watchCallback).toHaveBeenCalledWith({ newValue: 10, oldValue: 0 });

			system.facts.count = 10;
			expect(watchCallback).toHaveBeenCalledWith({ newValue: 20, oldValue: 10 });

			unwatch();
			system.stop();
		});
	});

	describe("tickMs support", () => {
		it("should support tickMs", async () => {
			const tickHandler = vi.fn();

			const schema = {
				facts: {
					tickCount: t.number(),
				},
				derivations: {},
				events: {
					tick: {},
				},
				requirements: {},
			} satisfies ModuleSchema;

			const mod = createModule("ticker", {
				schema,
				init: (facts) => {
					facts.tickCount = 0;
				},
				derive: {},
				events: {
					tick: (facts) => {
						facts.tickCount += 1;
						tickHandler();
					},
				},
			});

			const system = createSystem({
				modules: [mod],
				tickMs: 50,
			});

			system.start();
			await new Promise((resolve) => setTimeout(resolve, 180));

			expect(tickHandler.mock.calls.length).toBeGreaterThanOrEqual(2);
			expect(system.facts.tickCount).toBeGreaterThanOrEqual(2);

			system.stop();
		});
	});
});
