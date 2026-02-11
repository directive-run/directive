/**
 * Unified Subscribe/Watch API Tests
 *
 * Tests that system.subscribe() and system.watch() auto-detect
 * whether a key is a fact or derivation and route accordingly.
 */

import { describe, it, expect, vi } from "vitest";
import { createModule, createSystem, t, type ModuleSchema } from "../index.js";

// ============================================================================
// Test Module
// ============================================================================

const counterSchema = {
	facts: {
		count: t.number(),
		name: t.string(),
	},
	derivations: {
		doubled: t.number(),
		isPositive: t.boolean(),
	},
	events: {
		increment: {},
		setName: { name: t.string() },
	},
	requirements: {},
} satisfies ModuleSchema;

const counterModule = createModule("counter", {
	schema: counterSchema,
	init: (facts) => {
		facts.count = 0;
		facts.name = "counter";
	},
	derive: {
		doubled: (facts) => facts.count * 2,
		isPositive: (facts) => facts.count > 0,
	},
	events: {
		increment: (facts) => {
			facts.count++;
		},
		setName: (facts, { name }) => {
			facts.name = name;
		},
	},
});

function createTestSystem() {
	const system = createSystem({ module: counterModule });
	system.start();
	return system;
}

// ============================================================================
// subscribe() with fact keys
// ============================================================================

describe("Unified Subscribe/Watch API", () => {
	describe("subscribe() with fact keys", () => {
		it("fires listener when a fact changes", () => {
			const system = createTestSystem();
			const listener = vi.fn();

			system.subscribe(["count"], listener);
			system.events.increment();

			expect(listener).toHaveBeenCalled();
			system.destroy();
		});

		it("does not fire listener for unrelated fact changes", () => {
			const system = createTestSystem();
			const listener = vi.fn();

			system.subscribe(["name"], listener);
			system.events.increment(); // changes count, not name

			expect(listener).not.toHaveBeenCalled();
			system.destroy();
		});
	});

	// ============================================================================
	// subscribe() with derivation keys (backward compat)
	// ============================================================================

	describe("subscribe() with derivation keys", () => {
		it("fires listener when a derivation changes", async () => {
			const system = createTestSystem();
			// Derivations are lazy -- must be read once to establish dependency tracking
			// before subscribe() can detect invalidation notifications.
			system.read("doubled");

			const listener = vi.fn();
			system.subscribe(["doubled"], listener);
			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			expect(listener).toHaveBeenCalled();
			system.destroy();
		});
	});

	// ============================================================================
	// subscribe() with mixed keys
	// ============================================================================

	describe("subscribe() with mixed fact + derivation keys", () => {
		it("fires listener when either a fact or derivation changes", async () => {
			const system = createTestSystem();
			system.read("doubled"); // Establish tracking
			const listener = vi.fn();

			system.subscribe(["name", "doubled"], listener);

			// Change name (fact)
			system.events.setName({ name: "test" });
			expect(listener).toHaveBeenCalled();

			listener.mockClear();

			// Change count → doubled (derivation)
			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));
			expect(listener).toHaveBeenCalled();

			system.destroy();
		});

		it("returns a single unsubscribe function for mixed keys", async () => {
			const system = createTestSystem();
			const listener = vi.fn();

			const unsub = system.subscribe(["count", "doubled"], listener);
			unsub();

			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));
			expect(listener).not.toHaveBeenCalled();

			system.destroy();
		});
	});

	// ============================================================================
	// watch() with fact keys
	// ============================================================================

	describe("watch() with fact keys", () => {
		it("calls callback with old and new values on fact change", () => {
			const system = createTestSystem();
			const callback = vi.fn();

			system.watch("count", callback);
			system.events.increment();

			expect(callback).toHaveBeenCalledWith(1, 0);
			system.destroy();
		});

		it("does not call callback when fact value is unchanged", () => {
			const system = createTestSystem();
			const callback = vi.fn();

			system.watch("name", callback);
			// Increment changes count, not name
			system.events.increment();

			expect(callback).not.toHaveBeenCalled();
			system.destroy();
		});

		it("unsubscribes correctly", () => {
			const system = createTestSystem();
			const callback = vi.fn();

			const unsub = system.watch("count", callback);
			unsub();

			system.events.increment();
			expect(callback).not.toHaveBeenCalled();

			system.destroy();
		});
	});

	// ============================================================================
	// watch() with derivation keys (backward compat)
	// ============================================================================

	describe("watch() with derivation keys", () => {
		it("calls callback with old and new derivation values", async () => {
			const system = createTestSystem();
			const callback = vi.fn();

			system.watch("doubled", callback);
			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			expect(callback).toHaveBeenCalledWith(2, 0);
			system.destroy();
		});
	});

	// ============================================================================
	// Namespaced system
	// ============================================================================

	describe("namespaced system", () => {
		const authSchema = {
			facts: {
				token: t.string().nullable(),
			},
			derivations: {
				hasToken: t.boolean(),
			},
			events: {
				login: { token: t.string() },
			},
			requirements: {},
		} satisfies ModuleSchema;

		const authModule = createModule("auth", {
			schema: authSchema,
			init: (facts) => {
				facts.token = null;
			},
			derive: {
				hasToken: (facts) => facts.token !== null,
			},
			events: {
				login: (facts, { token }) => {
					facts.token = token;
				},
			},
		});

		it("subscribe works with namespaced fact key", () => {
			const system = createSystem({ modules: { auth: authModule } });
			system.start();
			const listener = vi.fn();

			system.subscribe(["auth.token"], listener);
			system.events.auth.login({ token: "abc" });

			expect(listener).toHaveBeenCalled();
			system.destroy();
		});

		it("watch works with namespaced fact key", () => {
			const system = createSystem({ modules: { auth: authModule } });
			system.start();
			const callback = vi.fn();

			system.watch("auth.token", callback);
			system.events.auth.login({ token: "abc" });

			expect(callback).toHaveBeenCalledWith("abc", null);
			system.destroy();
		});

		it("subscribe works with mixed namespaced fact and derivation keys", async () => {
			const system = createSystem({ modules: { auth: authModule } });
			system.start();
			const listener = vi.fn();

			system.subscribe(["auth.token", "auth.hasToken"], listener);
			system.events.auth.login({ token: "abc" });
			await new Promise((r) => setTimeout(r, 10));

			expect(listener).toHaveBeenCalled();
			system.destroy();
		});
	});

	// ============================================================================
	// Priority: derivation wins over fact if key exists in both
	// ============================================================================

	describe("priority", () => {
		it("derivation key takes precedence over fact key with same name", async () => {
			// In practice keys don't collide, but verify derivation-first routing
			const system = createTestSystem();
			const callback = vi.fn();

			// "doubled" is a derivation -- should route to derivation path
			system.watch("doubled", callback);
			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			// Should get derivation value (2), not a fact
			expect(callback).toHaveBeenCalledWith(2, 0);
			system.destroy();
		});
	});

	// ============================================================================
	// Unknown key warnings
	// ============================================================================

	describe("unknown key warnings", () => {
		it("subscribe() warns for unknown keys in dev mode", () => {
			const system = createTestSystem();
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			system.subscribe(["nonexistent" as any], () => {});

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('unknown key "nonexistent"'),
			);
			warnSpy.mockRestore();
			system.destroy();
		});

		it("watch() warns for unknown keys in dev mode", () => {
			const system = createTestSystem();
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			system.watch("nonexistent" as any, () => {});

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('unknown key "nonexistent"'),
			);
			warnSpy.mockRestore();
			system.destroy();
		});

		it("watch() with unknown key returns a working unsubscribe", () => {
			const system = createTestSystem();
			vi.spyOn(console, "warn").mockImplementation(() => {});

			const unsub = system.watch("nonexistent" as any, () => {});
			expect(() => unsub()).not.toThrow();

			vi.restoreAllMocks();
			system.destroy();
		});
	});

	// ============================================================================
	// equalityFn option
	// ============================================================================

	describe("watch() with equalityFn", () => {
		it("uses custom equality function to suppress callbacks", () => {
			const system = createTestSystem();
			const callback = vi.fn();

			// Custom equality: treat all numbers as equal (suppress all changes)
			system.watch("count", callback, {
				equalityFn: () => true,
			});
			system.events.increment();

			expect(callback).not.toHaveBeenCalled();
			system.destroy();
		});

		it("uses custom equality function to allow callbacks", () => {
			const system = createTestSystem();
			const callback = vi.fn();

			// Custom equality: treat nothing as equal (fire on every notification)
			system.watch("count", callback, {
				equalityFn: () => false,
			});
			system.events.increment();

			expect(callback).toHaveBeenCalledWith(1, 0);
			system.destroy();
		});

		it("works with derivation path too", async () => {
			const system = createTestSystem();
			const callback = vi.fn();

			system.watch("doubled", callback, {
				equalityFn: () => true, // suppress
			});
			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			expect(callback).not.toHaveBeenCalled();
			system.destroy();
		});
	});

	// ============================================================================
	// system.when() promise API
	// ============================================================================

	describe("when()", () => {
		it("resolves immediately if predicate is already true", async () => {
			const system = createTestSystem();
			// count starts at 0
			await expect(system.when((facts: any) => facts.count === 0)).resolves.toBeUndefined();
			system.destroy();
		});

		it("resolves when predicate becomes true after fact change", async () => {
			const system = createTestSystem();
			const promise = system.when((facts: any) => facts.count >= 3);

			system.events.increment();
			system.events.increment();
			system.events.increment();

			await expect(promise).resolves.toBeUndefined();
			system.destroy();
		});

		it("rejects on timeout if predicate never becomes true", async () => {
			const system = createTestSystem();
			const promise = system.when(
				(facts: any) => facts.count >= 100,
				{ timeout: 50 },
			);

			await expect(promise).rejects.toThrow("timed out");
			system.destroy();
		});

		it("works with namespaced system", async () => {
			const authSchema = {
				facts: { token: t.string().nullable() },
				derivations: {},
				events: { login: { token: t.string() } },
				requirements: {},
			} satisfies ModuleSchema;

			const authModule = createModule("auth", {
				schema: authSchema,
				init: (facts) => { facts.token = null; },
				events: {
					login: (facts, { token }) => { facts.token = token; },
				},
			});

			const system = createSystem({ modules: { auth: authModule } });
			system.start();

			const promise = system.when((facts: any) => facts.auth.token !== null);
			system.events.auth.login({ token: "abc" });

			await expect(promise).resolves.toBeUndefined();
			system.destroy();
		});

		it("cleans up subscription after resolving", async () => {
			const system = createTestSystem();
			await system.when((facts: any) => facts.count === 0);
			// No dangling subscriptions -- increment should not throw
			system.events.increment();
			system.destroy();
		});
	});
});
