import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t, forType } from "../index.js";

describe("Integration", () => {
	it("should create a basic system", () => {
		const counter = createModule("counter", {
			schema: {
				count: t.number(),
			},
			init: (facts) => {
				facts.count = 0;
			},
			events: {
				increment: (facts) => {
					facts.count = (facts.count ?? 0) + 1;
				},
			},
			derive: {
				doubled: (facts) => (facts.count ?? 0) * 2,
			},
		});

		const system = createSystem({
			modules: [counter],
		});

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

		const fetchModule = createModule("fetch", {
			schema: {
				userId: t.number(),
				user: t.any<{ id: number; name: string } | null>(),
			},
			init: (facts) => {
				facts.userId = 0;
				facts.user = null;
			},
			events: {
				setUserId: (facts, event) => {
					// Now events receive the full event payload
					facts.userId = (event as { userId: number }).userId ?? facts.userId;
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
					// Using the new forType helper instead of verbose type guard
					handles: forType("FETCH_USER"),
					resolve: async (req, ctx) => {
						resolver();
						ctx.facts.user = { id: 1, name: "Test User" };
					},
				},
			},
		});

		const system = createSystem({
			modules: [fetchModule],
		});

		system.start();

		// Use dispatch with payload to set userId (tests event payload feature)
		system.dispatch({ type: "setUserId", userId: 1 });

		// Wait for system to settle (uses new settle() API instead of setTimeout)
		await system.settle();

		expect(resolver).toHaveBeenCalled();
		expect(system.facts.userId).toBe(1);

		system.stop();
	});

	it("should run effects", async () => {
		const effectFn = vi.fn();

		const effectModule = createModule("effect-test", {
			schema: {
				value: t.number(),
			},
			init: (facts) => {
				facts.value = 0;
			},
			effects: {
				logValue: {
					run: (facts) => {
						effectFn(facts.value);
					},
				},
			},
		});

		const system = createSystem({
			modules: [effectModule],
		});

		system.start();

		// Change value to trigger effect
		system.facts.value = 42;

		// Wait for system to settle (uses new settle() API)
		await system.settle();

		expect(effectFn).toHaveBeenCalledWith(42);

		system.stop();
	});

	it("should support derivation composition", () => {
		const mathModule = createModule("math", {
			schema: {
				a: t.number(),
				b: t.number(),
			},
			init: (facts) => {
				facts.a = 2;
				facts.b = 3;
			},
			derive: {
				sum: (facts) => (facts.a ?? 0) + (facts.b ?? 0),
				product: (facts) => (facts.a ?? 0) * (facts.b ?? 0),
				// Composition: depends on other derivations
				sumPlusProduct: (facts, derive) => derive.sum + derive.product,
			},
		});

		const system = createSystem({
			modules: [mathModule],
		});

		system.start();

		expect(system.read("sum")).toBe(5);
		expect(system.read("product")).toBe(6);
		expect(system.read("sumPlusProduct")).toBe(11);

		system.stop();
	});

	it("should support plugins", () => {
		const events: string[] = [];

		const counter = createModule("counter", {
			schema: {
				count: t.number(),
			},
			init: (facts) => {
				facts.count = 0;
			},
		});

		const trackingPlugin = {
			name: "tracking",
			onInit: () => events.push("init"),
			onStart: () => events.push("start"),
			onStop: () => events.push("stop"),
			onFactSet: (key: string) => events.push(`set:${key}`),
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
		const counter = createModule("counter", {
			schema: {
				count: t.number(),
			},
			init: (facts) => {
				facts.count = 0;
			},
			constraints: {
				needsIncrement: {
					when: (facts) => (facts.count ?? 0) < 5,
					require: { type: "INCREMENT" },
				},
			},
		});

		const system = createSystem({
			modules: [counter],
		});

		system.start();

		const inspection = system.inspect();
		expect(inspection).toHaveProperty("unmet");
		expect(inspection).toHaveProperty("inflight");
		expect(inspection).toHaveProperty("constraints");

		system.stop();
	});
});
