/**
 * React adapter tests
 *
 * These tests verify the React hooks' underlying logic:
 * - Subscription behavior
 * - Snapshot generation
 * - Reference stability
 * - SSR support
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";

// Create a test module with consolidated schema
function createTestModule() {
	const schema = {
		facts: {
			count: t.number(),
			name: t.string(),
			items: t.array<string>(),
		},
		derivations: {
			doubled: t.number(),
			isPositive: t.boolean(),
			itemCount: t.number(),
			summary: t.object<{ count: number; doubled: number }>(),
		},
		events: {
			increment: {},
			setName: { name: t.string() },
			addItem: { item: t.string() },
		},
		requirements: {},
	} satisfies ModuleSchema;

	return createModule("test", {
		schema,
		init: (facts) => {
			facts.count = 0;
			facts.name = "test";
			facts.items = [];
		},
		derive: {
			doubled: (facts) => (facts.count ?? 0) * 2,
			isPositive: (facts) => (facts.count ?? 0) > 0,
			itemCount: (facts) => (facts.items ?? []).length,
			summary: (facts, derive) => {
				facts.count;
				return {
					count: facts.count,
					doubled: derive.doubled,
				};
			},
		},
		events: {
			increment: (facts) => {
				facts.count = (facts.count ?? 0) + 1;
			},
			setName: (facts, { name }) => {
				facts.name = name;
			},
			addItem: (facts, { item }) => {
				facts.items = [...(facts.items ?? []), item];
			},
		},
	});
}

describe("React Adapter - System Integration", () => {
	// biome-ignore lint/suspicious/noExplicitAny: Test uses generic system for runtime behavior testing
	let system: any;

	beforeEach(() => {
		system = createSystem({ modules: { test: createTestModule() } });
		system.start();
	});

	describe("system.read()", () => {
		it("reads derivation values", () => {
			expect(system.read("test.doubled")).toBe(0);
			expect(system.read("test.isPositive")).toBe(false);
		});

		it("returns typed values with generic parameter", () => {
			const doubled = system.read("test.doubled") as number;
			expect(typeof doubled).toBe("number");
		});

		it("updates when facts change", () => {
			expect(system.read("test.doubled")).toBe(0);
			system.events.test.increment();
			expect(system.read("test.doubled")).toBe(2);
		});

		it("handles composed derivations", () => {
			const summary = system.read("test.summary");
			expect(summary).toEqual({ count: 0, doubled: 0 });

			system.events.test.increment();
			const updated = system.read("test.summary");
			expect(updated).toEqual({ count: 1, doubled: 2 });
		});
	});

	describe("system.subscribe()", () => {
		it("calls listener when derivation changes", async () => {
			// Read derivation first to establish dependency tracking
			expect(system.read("test.doubled")).toBe(0);

			const listener = vi.fn();
			const unsubscribe = system.subscribe(["test.doubled"], listener);

			system.events.test.increment();
			// Wait for microtasks (derivation invalidation is async)
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listener).toHaveBeenCalled();

			unsubscribe();
		});

		it("calls listener for multiple derivations", async () => {
			// Read derivations first to establish dependency tracking
			expect(system.read("test.doubled")).toBe(0);
			expect(system.read("test.isPositive")).toBe(false);

			const listener = vi.fn();
			const unsubscribe = system.subscribe(["test.doubled", "test.isPositive"], listener);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listener).toHaveBeenCalled();

			unsubscribe();
		});

		it("stops calling listener after unsubscribe", async () => {
			// Read derivation first to establish dependency tracking
			expect(system.read("test.doubled")).toBe(0);

			const listener = vi.fn();
			const unsubscribe = system.subscribe(["test.doubled"], listener);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listener).toHaveBeenCalledTimes(1);

			unsubscribe();

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("handles multiple subscribers", async () => {
			// Read derivation first to establish dependency tracking
			expect(system.read("test.doubled")).toBe(0);

			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const unsub1 = system.subscribe(["test.doubled"], listener1);
			const unsub2 = system.subscribe(["test.doubled"], listener2);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listener1).toHaveBeenCalled();
			expect(listener2).toHaveBeenCalled();

			unsub1();
			unsub2();
		});
	});

	describe("system.watch()", () => {
		it("calls callback with new and previous values", async () => {
			// watch() reads the derivation internally to get initial value,
			// which establishes dependency tracking
			const callback = vi.fn();
			const unwatch = system.watch("test.doubled", callback);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).toHaveBeenCalledWith(2, 0);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).toHaveBeenCalledWith(4, 2);

			unwatch();
		});

		it("does not call callback if value is unchanged", async () => {
			// Read derivation to establish tracking
			expect(system.read("test.doubled")).toBe(0);

			const callback = vi.fn();
			const unwatch = system.watch("test.doubled", callback);

			// Dispatch an event that doesn't change the derivation
			system.events.test.setName({ name: "new name" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).not.toHaveBeenCalled();

			unwatch();
		});

		it("provides initial value as previous value on first change", async () => {
			// Create a fresh system to test initial value tracking
			const freshSystem = createSystem({ modules: { test: createTestModule() } });
			freshSystem.start();

			let firstPrev: number | undefined;
			const unwatch = freshSystem.watch<number>("test.doubled", (_, prev) => {
				firstPrev = prev;
			});

			freshSystem.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));

			// The first callback gets the previous value (0, since init ran)
			expect(firstPrev).toBe(0);

			unwatch();
		});

		it("stops watching after unwatch is called", async () => {
			const callback = vi.fn();
			const unwatch = system.watch("test.doubled", callback);

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).toHaveBeenCalledTimes(1);

			unwatch();

			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).toHaveBeenCalledTimes(1);
		});

		it("handles boolean derivations", async () => {
			const callback = vi.fn();
			const unwatch = system.watch("test.isPositive", callback);

			expect(system.read("test.isPositive")).toBe(false);
			system.events.test.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callback).toHaveBeenCalledWith(true, false);

			unwatch();
		});
	});
});

describe("React Adapter - Reference Stability", () => {
	it("read() returns same reference for unchanged objects", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		const summary1 = system.read("test.summary");
		const summary2 = system.read("test.summary");

		// Derivation caching ensures same reference
		expect(summary1).toBe(summary2);
	});
});

describe("React Adapter - Facts Store Subscriptions", () => {
	it("subscribe to derivations notifies on changes", async () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		// Read derivation first to establish tracking
		expect(system.read("test.doubled")).toBe(0);

		const listener = vi.fn();
		const unsubscribe = system.subscribe(["test.doubled"], listener);

		system.events.test.increment();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(listener).toHaveBeenCalled();

		unsubscribe();
	});

	it("subscribe to multiple derivations notifies on any change", async () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		// Read derivations first to establish tracking
		expect(system.read("test.doubled")).toBe(0);
		expect(system.read("test.itemCount")).toBe(0);

		const listener = vi.fn();
		const unsubscribe = system.subscribe(["test.doubled", "test.itemCount"], listener);

		system.events.test.increment();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(listener).toHaveBeenCalled();

		system.events.test.addItem({ item: "test" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
	});
});

describe("React Adapter - Typed Events", () => {
	it("handles typed event payloads correctly", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		system.events.test.setName({ name: "TypedName" });
		expect(system.facts.test.name).toBe("TypedName");

		system.events.test.addItem({ item: "first" });
		expect(system.facts.test.items).toEqual(["first"]);
	});
});
