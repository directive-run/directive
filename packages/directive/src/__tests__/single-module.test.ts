/**
 * Single Module System Tests
 *
 * Tests for the `module:` (singular) syntax that provides direct access:
 * - `module: counterModule` → `facts.count`, `events.increment()`
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
		decrement: {},
		setName: { name: t.string() },
		tick: {},
	},
	requirements: {
		SAVE: { count: t.number() },
	},
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
		decrement: (facts) => {
			facts.count--;
		},
		setName: (facts, { name }) => {
			facts.name = name;
		},
		tick: (facts) => {
			facts.count++;
		},
	},
	constraints: {
		saveWhenLarge: {
			when: (facts) => facts.count >= 10,
			require: (facts) => ({ type: "SAVE", count: facts.count }),
		},
	},
	resolvers: {
		save: {
			requirement: "SAVE",
			resolve: async () => {
				// Simulate save
			},
		},
	},
});

// ============================================================================
// Basic System Creation
// ============================================================================

describe("Single Module System", () => {
	describe("createSystem with module:", () => {
		it("creates a system with direct fact access", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			expect(system.facts.count).toBe(0);
			expect(system.facts.name).toBe("counter");

			system.stop();
		});

		it("creates a system with direct derivation access", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			expect(system.derive.doubled).toBe(0);
			expect(system.derive.isPositive).toBe(false);

			system.stop();
		});

		it("creates a system with direct event access", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			system.events.increment();
			expect(system.facts.count).toBe(1);

			system.events.setName({ name: "updated" });
			expect(system.facts.name).toBe("updated");

			system.stop();
		});

		it("derivations update when facts change", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			expect(system.derive.doubled).toBe(0);
			expect(system.derive.isPositive).toBe(false);

			system.events.increment();
			expect(system.derive.doubled).toBe(2);
			expect(system.derive.isPositive).toBe(true);

			system.stop();
		});
	});

	describe("initialFacts", () => {
		it("sets initial facts before system starts", () => {
			const system = createSystem({
				module: counterModule,
				initialFacts: {
					count: 10,
					name: "preset",
				},
			});
			system.start();

			expect(system.facts.count).toBe(10);
			expect(system.facts.name).toBe("preset");
			expect(system.derive.doubled).toBe(20);

			system.stop();
		});

		it("initialFacts overrides module init", () => {
			const system = createSystem({
				module: counterModule,
				initialFacts: {
					count: 5,
				},
			});
			system.start();

			// count overridden, name from init
			expect(system.facts.count).toBe(5);
			expect(system.facts.name).toBe("counter");

			system.stop();
		});
	});

	describe("hydrate", () => {
		it("hydrates facts from async source", async () => {
			const system = createSystem({ module: counterModule });

			await system.hydrate(async () => ({
				count: 42,
				name: "hydrated",
			}));

			system.start();

			expect(system.facts.count).toBe(42);
			expect(system.facts.name).toBe("hydrated");

			system.stop();
		});

		it("hydrate takes precedence over initialFacts", async () => {
			const system = createSystem({
				module: counterModule,
				initialFacts: { count: 5 },
			});

			await system.hydrate(async () => ({ count: 100 }));
			system.start();

			expect(system.facts.count).toBe(100);

			system.stop();
		});

		it("throws if hydrate called after start", async () => {
			const system = createSystem({ module: counterModule });
			system.start();

			await expect(
				system.hydrate(async () => ({ count: 1 })),
			).rejects.toThrow("hydrate() must be called before start()");

			system.stop();
		});
	});

	describe("validation", () => {
		it("throws for null/undefined module", () => {
			expect(() => {
				// @ts-expect-error - testing runtime validation
				createSystem({ module: null });
			}).toThrow("createSystem requires a module");

			expect(() => {
				// @ts-expect-error - testing runtime validation
				createSystem({ module: undefined });
			}).toThrow("createSystem requires a module");
		});

		it("throws for invalid tickMs", () => {
			expect(() => {
				createSystem({ module: counterModule, tickMs: 0 });
			}).toThrow("tickMs must be a positive number");

			expect(() => {
				createSystem({ module: counterModule, tickMs: -100 });
			}).toThrow("tickMs must be a positive number");
		});

		it("throws for prototype pollution in initialFacts", () => {
			// Use Object.defineProperty to actually set __proto__ as a key
			const maliciousFacts = Object.create(null);
			Object.defineProperty(maliciousFacts, "__proto__", {
				value: { evil: true },
				enumerable: true,
			});

			expect(() => {
				createSystem({
					module: counterModule,
					initialFacts: maliciousFacts,
				});
			}).toThrow("prototype pollution");
		});

		it("throws for constructor pollution in initialFacts", () => {
			expect(() => {
				createSystem({
					module: counterModule,
					initialFacts: { constructor: { prototype: {} } } as Record<string, unknown>,
				});
			}).toThrow("prototype pollution");
		});
	});

	describe("dev mode warnings", () => {
		it("warns if crossModuleDeps defined in single module mode", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const moduleWithDeps = createModule("test", {
				schema: counterSchema,
				// @ts-expect-error - testing runtime behavior
				crossModuleDeps: {
					other: {},
				},
				init: (facts) => {
					facts.count = 0;
					facts.name = "test";
				},
				derive: {
					doubled: (facts) => facts.count * 2,
					isPositive: (facts) => facts.count > 0,
				},
				events: {
					increment: (facts) => { facts.count++; },
					decrement: (facts) => { facts.count--; },
					setName: (facts, { name }) => { facts.name = name; },
					tick: (facts) => { facts.count++; },
				},
			});

			createSystem({ module: moduleWithDeps });

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("Single module mode ignores crossModuleDeps"),
			);

			warnSpy.mockRestore();
		});

		it("warns if tickMs set without tick handler", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const moduleWithoutTick = createModule("test", {
				schema: {
					facts: { count: t.number() },
					derivations: {},
					events: {
						increment: {},
					},
					requirements: {},
				},
				init: (facts) => {
					facts.count = 0;
				},
				derive: {},
				events: {
					increment: (facts) => { facts.count++; },
				},
			});

			createSystem({ module: moduleWithoutTick, tickMs: 100 });

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('tickMs is set to 100ms but module has no "tick" event handler'),
			);

			warnSpy.mockRestore();
		});
	});

	describe("lifecycle", () => {
		it("isRunning reflects system state", () => {
			const system = createSystem({ module: counterModule });

			expect(system.isRunning).toBe(false);

			system.start();
			expect(system.isRunning).toBe(true);

			system.stop();
			expect(system.isRunning).toBe(false);
		});

		it("destroy stops the system", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			expect(system.isRunning).toBe(true);

			system.destroy();
			expect(system.isRunning).toBe(false);
		});
	});

	describe("read/subscribe/watch", () => {
		it("read() gets derivation values", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			expect(system.read("doubled")).toBe(0);

			system.events.increment();
			expect(system.read("doubled")).toBe(2);

			system.stop();
		});

		it("subscribe() notifies on changes", async () => {
			const system = createSystem({ module: counterModule });
			system.start();

			// Read to establish tracking
			system.read("doubled");

			const listener = vi.fn();
			const unsubscribe = system.subscribe(["doubled"], listener);

			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			expect(listener).toHaveBeenCalled();

			unsubscribe();
			system.stop();
		});

		it("watch() calls callback with new and old values", async () => {
			const system = createSystem({ module: counterModule });
			system.start();

			const callback = vi.fn();
			const unwatch = system.watch("doubled", callback);

			system.events.increment();
			await new Promise((r) => setTimeout(r, 10));

			expect(callback).toHaveBeenCalledWith(2, 0);

			unwatch();
			system.stop();
		});
	});

	describe("constraints and resolvers", () => {
		it("triggers constraint when condition met", async () => {
			const system = createSystem({ module: counterModule });
			system.start();

			// Increment to trigger saveWhenLarge constraint
			for (let i = 0; i < 10; i++) {
				system.events.increment();
			}

			await system.settle();

			// Constraint should have fired
			expect(system.inspect()).toBeDefined();
			expect(system.facts.count).toBe(10);

			system.stop();
		});
	});

	describe("debug/time-travel", () => {
		it("debug is null when not enabled", () => {
			const system = createSystem({ module: counterModule });
			expect(system.debug).toBeNull();
		});

		it("debug is available when enabled", () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true },
			});
			system.start();

			expect(system.debug).not.toBeNull();
			expect(typeof system.debug?.goBack).toBe("function");

			system.stop();
		});
	});

	describe("batch", () => {
		it("batches multiple updates", () => {
			const system = createSystem({ module: counterModule });
			system.start();

			system.batch(() => {
				system.events.increment();
				system.events.increment();
				system.events.increment();
			});

			expect(system.facts.count).toBe(3);

			system.stop();
		});
	});

	describe("tickMs", () => {
		it("dispatches tick events at interval", async () => {
			const system = createSystem({
				module: counterModule,
				tickMs: 50,
			});
			system.start();

			expect(system.facts.count).toBe(0);

			// Wait for a few ticks
			await new Promise((r) => setTimeout(r, 130));

			// Should have incremented from tick events
			expect(system.facts.count).toBeGreaterThanOrEqual(2);

			system.stop();
		});
	});
});
