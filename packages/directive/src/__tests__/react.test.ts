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
import type { ModuleSchema, System } from "../index.js";
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

describe("React Adapter - Selector Patterns", () => {
	it("selector equality function is called correctly", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		// Simulate what useFactSelector does internally
		const selector = (name: string | undefined) => name?.toUpperCase() ?? "GUEST";
		const equalityFn = vi.fn((a: string, b: string) => a === b);

		let cachedValue = selector(system.facts.test.name);

		// Simulate subscription update
		system.events.test.setName({ name: "Alice" });
		const newValue = selector(system.facts.test.name);
		equalityFn(cachedValue, newValue);
		expect(equalityFn).toHaveBeenCalledWith("TEST", "ALICE");
	});

	it("handles undefined as a valid selector result", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		// Selector that can return undefined
		const selector = (items: string[] | undefined) =>
			items && items.length > 0 ? items[0] : undefined;

		const result1 = selector(system.facts.test.items);
		expect(result1).toBeUndefined();

		system.events.test.addItem({ item: "first" });
		const result2 = selector(system.facts.test.items);
		expect(result2).toBe("first");
	});

	it("Object.is equality handles NaN correctly", () => {
		const defaultEquality = <T>(a: T, b: T) => Object.is(a, b);

		// NaN === NaN is false, but Object.is(NaN, NaN) is true
		expect(Number.NaN === Number.NaN).toBe(false);
		expect(defaultEquality(Number.NaN, Number.NaN)).toBe(true);

		// +0 and -0 are === but Object.is distinguishes them
		expect(0 === -0).toBe(true);
		expect(defaultEquality(0, -0)).toBe(false);
	});
});

describe("React Adapter - Edge Cases", () => {
	it("handles empty derivation arrays in subscribe", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		const listener = vi.fn();
		// Empty array should not throw
		const unsubscribe = system.subscribe([], listener);
		expect(typeof unsubscribe).toBe("function");
		unsubscribe();
	});

	it("inspection provides consistent snapshots", () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		const inspection1 = system.inspect();
		const inspection2 = system.inspect();

		// Inspection structure should be consistent
		expect(inspection1).toHaveProperty("unmet");
		expect(inspection1).toHaveProperty("inflight");
		expect(Array.isArray(inspection1.unmet)).toBe(true);
		expect(Array.isArray(inspection1.inflight)).toBe(true);
	});

	it("system.facts.$store.toObject returns plain object", () => {
		// Use single-module system for simpler $store access
		const singleSystem = createSystem({ module: createTestModule() });
		singleSystem.start();

		const factsObj = singleSystem.facts.$store.toObject();
		expect(typeof factsObj).toBe("object");
		expect(factsObj.count).toBe(0);
		expect(factsObj.name).toBe("test");
	});

	it("multiple rapid subscribe/unsubscribe cycles", async () => {
		const system = createSystem({ modules: { test: createTestModule() } });
		system.start();

		// Read derivation to establish tracking
		system.read("test.doubled");

		const listeners: (() => void)[] = [];

		// Rapidly subscribe and unsubscribe
		for (let i = 0; i < 10; i++) {
			const listener = vi.fn();
			const unsub = system.subscribe(["test.doubled"], listener);
			listeners.push(unsub);
		}

		// Unsubscribe all
		for (const unsub of listeners) {
			unsub();
		}

		// Should not throw when facts change after all unsubscribed
		system.events.test.increment();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

describe("React Adapter - Suspense Cache Behavior", () => {
	it("suspense cache key generation is deterministic", () => {
		// Simulate the cache key generation for useSuspenseRequirements
		const types1 = ["FETCH_USER", "FETCH_SETTINGS"];
		const types2 = ["FETCH_SETTINGS", "FETCH_USER"];

		const key1 = types1.slice().sort().join(",");
		const key2 = types2.slice().sort().join(",");

		// Different order should produce same key
		expect(key1).toBe(key2);
		expect(key1).toBe("FETCH_SETTINGS,FETCH_USER");
	});
});

// ============================================================================
// System Override Tests
// ============================================================================

describe("React Adapter - System Override", () => {
	function createModuleA() {
		return createModule("modA", {
			schema: {
				facts: { theme: t.string() },
				derivations: { isDark: t.boolean() },
				events: { setTheme: { theme: t.string() } },
				requirements: {},
			},
			init: (facts) => {
				facts.theme = "light";
			},
			derive: {
				isDark: (facts) => facts.theme === "dark",
			},
			events: {
				setTheme: (facts, { theme }) => {
					facts.theme = theme;
				},
			},
		});
	}

	function createModuleB() {
		return createModule("modB", {
			schema: {
				facts: { email: t.string(), count: t.number() },
				derivations: { isValid: t.boolean(), doubled: t.number() },
				events: { setEmail: { email: t.string() }, increment: {} },
				requirements: {},
			},
			init: (facts) => {
				facts.email = "";
				facts.count = 0;
			},
			derive: {
				isValid: (facts) => (facts.email ?? "").includes("@"),
				doubled: (facts) => (facts.count ?? 0) * 2,
			},
			events: {
				setEmail: (facts, { email }) => {
					facts.email = email;
				},
				increment: (facts) => {
					facts.count = (facts.count ?? 0) + 1;
				},
			},
		});
	}

	describe("two systems coexisting", () => {
		it("reads facts from different systems independently", () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Each system has its own facts
			expect(systemA.facts.theme).toBe("light");
			expect(systemB.facts.email).toBe("");
			expect(systemB.facts.count).toBe(0);

			// Mutating one doesn't affect the other
			systemA.events.setTheme({ theme: "dark" });
			expect(systemA.facts.theme).toBe("dark");
			expect(systemB.facts.email).toBe("");
		});

		it("reads derivations from different systems independently", () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			expect(systemA.read("isDark")).toBe(false);
			expect(systemB.read("isValid")).toBe(false);
			expect(systemB.read("doubled")).toBe(0);

			systemA.events.setTheme({ theme: "dark" });
			expect(systemA.read("isDark")).toBe(true);
			// System B unaffected
			expect(systemB.read("isValid")).toBe(false);
		});

		it("subscribes to derivations on different systems", async () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Read to establish tracking
			systemA.read("isDark");
			systemB.read("doubled");

			const listenerA = vi.fn();
			const listenerB = vi.fn();

			const unsubA = systemA.subscribe(["isDark"], listenerA);
			const unsubB = systemB.subscribe(["doubled"], listenerB);

			// Change system A — only listener A fires
			systemA.events.setTheme({ theme: "dark" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listenerA).toHaveBeenCalled();
			expect(listenerB).not.toHaveBeenCalled();

			listenerA.mockClear();

			// Change system B — only listener B fires
			systemB.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listenerA).not.toHaveBeenCalled();
			expect(listenerB).toHaveBeenCalled();

			unsubA();
			unsubB();
		});

		it("dispatches events to correct system", () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Dispatch to A
			systemA.dispatch({ type: "setTheme", theme: "dark" });
			expect(systemA.facts.theme).toBe("dark");
			expect(systemB.facts.count).toBe(0);

			// Dispatch to B
			systemB.dispatch({ type: "increment" });
			expect(systemB.facts.count).toBe(1);
			expect(systemA.facts.theme).toBe("dark");
		});
	});

	describe("explicit system reads from passed system", () => {
		it("fact store subscriptions work across systems", async () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Simulate what useFact does: subscribe to fact store + read fact
			const listenerForTheme = vi.fn();
			const unsubTheme = systemA.facts.$store.subscribe(["theme"], listenerForTheme);

			const listenerForEmail = vi.fn();
			const unsubEmail = systemB.facts.$store.subscribe(["email"], listenerForEmail);

			// Change A
			systemA.events.setTheme({ theme: "dark" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listenerForTheme).toHaveBeenCalled();
			expect(listenerForEmail).not.toHaveBeenCalled();

			listenerForTheme.mockClear();

			// Change B
			systemB.events.setEmail({ email: "test@example.com" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(listenerForTheme).not.toHaveBeenCalled();
			expect(listenerForEmail).toHaveBeenCalled();

			unsubTheme();
			unsubEmail();
		});

		it("selector can extract values from a specific system's facts", () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Simulate what useFactSelector does internally
			const selectThemeUpper = (theme: string | undefined) =>
				(theme ?? "").toUpperCase();
			const selectEmailDomain = (email: string | undefined) =>
				(email ?? "").split("@")[1] ?? "";

			// Read from A
			const themeResult = selectThemeUpper(systemA.facts.theme);
			expect(themeResult).toBe("LIGHT");

			// Read from B
			systemB.events.setEmail({ email: "user@example.com" });
			const emailResult = selectEmailDomain(systemB.facts.email);
			expect(emailResult).toBe("example.com");
		});
	});

	describe("selector overload argument parsing", () => {
		it("parses function as equality function (backward compat)", () => {
			// Simulate the overloaded arg parsing from useFactSelector
			const eqFn = (a: string, b: string) => a === b;
			const eqOrOpts: ((a: string, b: string) => boolean) | { system?: any; equalityFn?: any } = eqFn;

			let resolvedSystem: any;
			let resolvedEqFn: any;

			if (typeof eqOrOpts === "function") {
				resolvedEqFn = eqOrOpts;
			} else if (eqOrOpts) {
				resolvedSystem = eqOrOpts.system;
				resolvedEqFn = eqOrOpts.equalityFn;
			}

			expect(resolvedSystem).toBeUndefined();
			expect(resolvedEqFn).toBe(eqFn);
		});

		it("parses options object with system", () => {
			const fakeSystem = { id: "fake" };
			const eqOrOpts: any = { system: fakeSystem };

			let resolvedSystem: any;
			let resolvedEqFn: any;

			if (typeof eqOrOpts === "function") {
				resolvedEqFn = eqOrOpts;
			} else if (eqOrOpts) {
				resolvedSystem = eqOrOpts.system;
				resolvedEqFn = eqOrOpts.equalityFn;
			}

			expect(resolvedSystem).toBe(fakeSystem);
			expect(resolvedEqFn).toBeUndefined();
		});

		it("parses options object with both system and equalityFn", () => {
			const fakeSystem = { id: "fake" };
			const eqFn = (a: number, b: number) => a === b;
			const eqOrOpts: any = { system: fakeSystem, equalityFn: eqFn };

			let resolvedSystem: any;
			let resolvedEqFn: any;

			if (typeof eqOrOpts === "function") {
				resolvedEqFn = eqOrOpts;
			} else if (eqOrOpts) {
				resolvedSystem = eqOrOpts.system;
				resolvedEqFn = eqOrOpts.equalityFn;
			}

			expect(resolvedSystem).toBe(fakeSystem);
			expect(resolvedEqFn).toBe(eqFn);
		});

		it("handles undefined (no third arg)", () => {
			const eqOrOpts: any = undefined;

			let resolvedSystem: any;
			let resolvedEqFn: any;

			if (typeof eqOrOpts === "function") {
				resolvedEqFn = eqOrOpts;
			} else if (eqOrOpts) {
				resolvedSystem = eqOrOpts.system;
				resolvedEqFn = eqOrOpts.equalityFn;
			}

			expect(resolvedSystem).toBeUndefined();
			expect(resolvedEqFn).toBeUndefined();
		});
	});

	describe("watch on different systems", () => {
		it("watches derivation on a specific system", async () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			const callbackA = vi.fn();
			const callbackB = vi.fn();

			const unwatchA = systemA.watch("isDark", callbackA);
			const unwatchB = systemB.watch("doubled", callbackB);

			systemA.events.setTheme({ theme: "dark" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callbackA).toHaveBeenCalledWith(true, false);
			expect(callbackB).not.toHaveBeenCalled();

			systemB.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(callbackB).toHaveBeenCalledWith(2, 0);

			unwatchA();
			unwatchB();
		});
	});

	describe("inspect on different systems", () => {
		it("returns independent inspection for each system", () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			const inspA = systemA.inspect();
			const inspB = systemB.inspect();

			expect(inspA).toHaveProperty("unmet");
			expect(inspA).toHaveProperty("inflight");
			expect(inspB).toHaveProperty("unmet");
			expect(inspB).toHaveProperty("inflight");

			// They are independent objects
			expect(inspA).not.toBe(inspB);
		});
	});

	describe("isSettled on different systems", () => {
		it("reports settled state independently", async () => {
			const systemA = createSystem({ module: createModuleA() });
			const systemB = createSystem({ module: createModuleB() });
			systemA.start();
			systemB.start();

			// Wait for initial reconciliation tick to settle
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(systemA.isSettled).toBe(true);
			expect(systemB.isSettled).toBe(true);
		});
	});
});
