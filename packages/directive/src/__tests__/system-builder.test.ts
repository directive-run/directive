/**
 * System Builder Tests
 *
 * Tests for the `system()` fluent builder API.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createModule, system, t, type ModuleSchema } from "../index.js";

// ============================================================================
// Test Modules
// ============================================================================

const counterSchema = {
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

const counterModule = createModule("counter", {
	schema: counterSchema,
	init: (facts) => {
		facts.count = 0;
	},
	derive: {
		doubled: (facts) => facts.count * 2,
	},
	events: {
		increment: (facts) => {
			facts.count++;
		},
	},
});

const authSchema = {
	facts: {
		token: t.string(),
		isLoggedIn: t.boolean(),
	},
	derivations: {},
	events: {
		login: { token: t.string() },
		logout: {},
	},
	requirements: {},
} satisfies ModuleSchema;

const authModule = createModule("auth", {
	schema: authSchema,
	init: (facts) => {
		facts.token = "";
		facts.isLoggedIn = false;
	},
	events: {
		login: (facts, { token }) => {
			facts.token = token;
			facts.isLoggedIn = true;
		},
		logout: (facts) => {
			facts.token = "";
			facts.isLoggedIn = false;
		},
	},
});

// ============================================================================
// Cleanup
// ============================================================================

const systems: Array<{ stop(): void; destroy(): void }> = [];

afterEach(() => {
	for (const s of systems) {
		try { s.stop(); } catch {}
		try { s.destroy(); } catch {}
	}
	systems.length = 0;
});

function track<T extends { stop(): void; destroy(): void }>(s: T): T {
	systems.push(s);
	return s;
}

// ============================================================================
// Single Module Builder
// ============================================================================

describe("system().module() — single module", () => {
	it("builds and starts a single-module system", () => {
		const sys = track(
			system()
				.module(counterModule)
				.build()
		);

		sys.start();
		expect(sys.facts.count).toBe(0);
		expect(sys.derive.doubled).toBe(0);
	});

	it("supports events", () => {
		const sys = track(
			system()
				.module(counterModule)
				.build()
		);

		sys.start();
		sys.events.increment();
		expect(sys.facts.count).toBe(1);
		expect(sys.derive.doubled).toBe(2);
	});

	it("applies initialFacts", () => {
		const sys = track(
			system()
				.module(counterModule)
				.initialFacts({ count: 10 })
				.build()
		);

		sys.start();
		expect(sys.facts.count).toBe(10);
		expect(sys.derive.doubled).toBe(20);
	});

	it("supports debug config", () => {
		const sys = track(
			system()
				.module(counterModule)
				.debug({ timeTravel: true, maxSnapshots: 50 })
				.build()
		);

		sys.start();
		expect(sys.debug).not.toBeNull();
	});

	it("supports zeroConfig", () => {
		const sys = track(
			system()
				.module(counterModule)
				.zeroConfig()
				.build()
		);

		sys.start();
		// zeroConfig enables debug in dev mode
		expect(sys.debug).not.toBeNull();
	});

	it("supports errorBoundary config", () => {
		const sys = track(
			system()
				.module(counterModule)
				.errorBoundary({ onConstraintError: "skip" })
				.build()
		);

		sys.start();
		expect(sys.isRunning).toBe(true);
	});

	it("chains all options fluently", () => {
		const sys = track(
			system()
				.module(counterModule)
				.initialFacts({ count: 5 })
				.debug({ timeTravel: true })
				.errorBoundary({ onResolverError: "skip" })
				.zeroConfig(false)
				.build()
		);

		sys.start();
		expect(sys.facts.count).toBe(5);
		expect(sys.debug).not.toBeNull();
	});
});

// ============================================================================
// Namespaced Module Builder
// ============================================================================

describe("system().modules() — namespaced", () => {
	it("builds and starts a namespaced system", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.build()
		);

		sys.start();
		expect(sys.facts.counter.count).toBe(0);
		expect(sys.facts.auth.token).toBe("");
	});

	it("supports namespaced events", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.build()
		);

		sys.start();
		sys.events.counter.increment();
		expect(sys.facts.counter.count).toBe(1);

		sys.events.auth.login({ token: "abc" });
		expect(sys.facts.auth.token).toBe("abc");
		expect(sys.facts.auth.isLoggedIn).toBe(true);
	});

	it("supports namespaced initialFacts", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.initialFacts({
					counter: { count: 42 },
					auth: { token: "restored", isLoggedIn: true },
				})
				.build()
		);

		sys.start();
		expect(sys.facts.counter.count).toBe(42);
		expect(sys.facts.auth.token).toBe("restored");
	});

	it("supports debug config", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule })
				.debug({ timeTravel: true })
				.build()
		);

		sys.start();
		expect(sys.debug).not.toBeNull();
	});

	it("supports initOrder", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.initOrder("declaration")
				.build()
		);

		sys.start();
		expect(sys.isRunning).toBe(true);
	});

	it("chains all options fluently", () => {
		const sys = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.plugins([])
				.debug({ timeTravel: true })
				.errorBoundary({ onResolverError: "skip" })
				.zeroConfig(false)
				.initialFacts({ counter: { count: 7 } })
				.initOrder("auto")
				.build()
		);

		sys.start();
		expect(sys.facts.counter.count).toBe(7);
	});
});

// ============================================================================
// Builder produces identical output to createSystem()
// ============================================================================

describe("equivalence with createSystem()", () => {
	it("single module builder matches createSystem() behavior", () => {
		const fromBuilder = track(
			system()
				.module(counterModule)
				.initialFacts({ count: 5 })
				.build()
		);

		fromBuilder.start();
		fromBuilder.events.increment();

		expect(fromBuilder.facts.count).toBe(6);
		expect(fromBuilder.derive.doubled).toBe(12);
	});

	it("namespaced builder matches createSystem() behavior", () => {
		const fromBuilder = track(
			system()
				.modules({ counter: counterModule, auth: authModule })
				.build()
		);

		fromBuilder.start();
		fromBuilder.events.counter.increment();
		fromBuilder.events.auth.login({ token: "test" });

		expect(fromBuilder.facts.counter.count).toBe(1);
		expect(fromBuilder.facts.auth.token).toBe("test");
	});
});
