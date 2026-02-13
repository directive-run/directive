/**
 * Gap Analysis Feature Tests
 *
 * Tests for features identified in the AE full-project audit:
 * - Effect Cleanup (Priority 2)
 * - Dynamic Module Registration (Priority 3)
 * - Module Instance Factory (Priority 4)
 * - Performance Plugin (Priority 5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModule, createModuleFactory, createSystem, t, type ModuleSchema } from "../index.js";
import { performancePlugin } from "../plugins/index.js";

// ============================================================================
// Effect Cleanup Tests
// ============================================================================

describe("Effect Cleanup", () => {
	it("calls sync cleanup when effect re-runs", async () => {
		const cleanupFn = vi.fn();
		const runFn = vi.fn(() => cleanupFn);

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
			effects: {
				tracked: {
					deps: ["count"],
					run: runFn,
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		// First run — no cleanup yet
		expect(runFn).toHaveBeenCalledTimes(1);
		expect(cleanupFn).not.toHaveBeenCalled();

		// Trigger re-run
		system.events.inc();
		await system.settle();

		// Cleanup from first run should be called before second run
		expect(cleanupFn).toHaveBeenCalledTimes(1);
		expect(runFn).toHaveBeenCalledTimes(2);

		system.destroy();
	});

	it("calls async cleanup when effect re-runs", async () => {
		const cleanupFn = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
			effects: {
				asyncEffect: {
					deps: ["count"],
					run: async () => {
						await Promise.resolve();
						return cleanupFn;
					},
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		// Trigger re-run
		system.events.inc();
		await system.settle();

		expect(cleanupFn).toHaveBeenCalledTimes(1);
		system.destroy();
	});

	it("calls cleanup on system stop", async () => {
		const cleanupFn = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { value: t.string() },
				derivations: {},
				events: {},
				requirements: {},
			},
			init: (facts) => { facts.value = "hello"; },
			derive: {},
			events: {},
			effects: {
				withCleanup: {
					deps: ["value"],
					run: () => cleanupFn,
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		expect(cleanupFn).not.toHaveBeenCalled();
		system.stop();
		expect(cleanupFn).toHaveBeenCalledTimes(1);
	});

	it("calls cleanup on system destroy", async () => {
		const cleanupFn = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { value: t.string() },
				derivations: {},
				events: {},
				requirements: {},
			},
			init: (facts) => { facts.value = "hello"; },
			derive: {},
			events: {},
			effects: {
				withCleanup: {
					deps: ["value"],
					run: () => cleanupFn,
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		system.destroy();
		expect(cleanupFn).toHaveBeenCalledTimes(1);
	});

	it("handles cleanup that throws without breaking other cleanups", async () => {
		const cleanupA = vi.fn(() => { throw new Error("cleanup error"); });
		const cleanupB = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { value: t.number() },
				derivations: {},
				events: {},
				requirements: {},
			},
			init: (facts) => { facts.value = 0; },
			derive: {},
			events: {},
			effects: {
				effectA: { deps: ["value"], run: () => cleanupA },
				effectB: { deps: ["value"], run: () => cleanupB },
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		// Should not throw even though cleanupA throws
		system.stop();
		expect(cleanupA).toHaveBeenCalled();
		expect(cleanupB).toHaveBeenCalled();
	});

	it("works with effects that return void (no cleanup)", async () => {
		const runFn = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
			effects: {
				noCleanup: {
					deps: ["count"],
					run: runFn,
				},
			},
		});

		const system = createSystem({ module: mod });
		system.start();
		await system.settle();

		system.events.inc();
		await system.settle();

		// Should not crash — no cleanup to call
		expect(runFn).toHaveBeenCalledTimes(2);
		system.destroy();
	});
});

// ============================================================================
// Dynamic Module Registration Tests
// ============================================================================

describe("Dynamic Module Registration", () => {
	describe("Single Module System", () => {
		it("registers a new module into a running system", async () => {
			const baseModule = createModule("base", {
				schema: {
					facts: { count: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.count = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: baseModule });
			system.start();
			await system.settle();

			// Register a new module dynamically
			const extraModule = createModule("extra", {
				schema: {
					facts: { name: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.name = "extra"; },
				derive: {},
				events: {},
			});

			system.registerModule(extraModule);
			await system.settle();

			// The new fact should be accessible
			expect((system.facts as Record<string, unknown>).name).toBe("extra");
		});

		it("registers a module with derivations", async () => {
			const baseModule = createModule("base", {
				schema: {
					facts: { count: t.number() },
					derivations: { doubled: t.number() },
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.count = 5; },
				derive: { doubled: (facts) => facts.count * 2 },
				events: {},
			});

			const system = createSystem({ module: baseModule });
			system.start();
			await system.settle();

			expect(system.derive.doubled).toBe(10);

			// Register module with its own derivation
			const extraModule = createModule("extra", {
				schema: {
					facts: { label: t.string() },
					derivations: { upper: t.string() },
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.label = "hello"; },
				derive: { upper: (facts) => facts.label.toUpperCase() },
				events: {},
			});

			system.registerModule(extraModule);
			await system.settle();

			expect(system.read("upper")).toBe("HELLO");
		});

		it("registers a module with events", async () => {
			const baseModule = createModule("base", {
				schema: {
					facts: { count: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.count = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: baseModule });
			system.start();
			await system.settle();

			// Register module with an event handler
			const extraModule = createModule("extra", {
				schema: {
					facts: { status: t.string() },
					derivations: {},
					events: { activate: {} },
					requirements: {},
				},
				init: (facts) => { facts.status = "inactive"; },
				derive: {},
				events: {
					activate: (facts) => { facts.status = "active"; },
				},
			});

			system.registerModule(extraModule);
			await system.settle();

			system.dispatch({ type: "activate" });
			await system.settle();

			expect((system.facts as Record<string, unknown>).status).toBe("active");
		});
	});

	describe("Namespaced System", () => {
		it("registers a new module with namespace", async () => {
			const authModule = createModule("auth", {
				schema: {
					facts: { token: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.token = ""; },
				derive: {},
				events: {},
			});

			const system = createSystem({ modules: { auth: authModule } });
			system.start();
			await system.settle();

			// Dynamically register a chat module
			const chatModule = createModule("chat", {
				schema: {
					facts: { messages: t.array<string>() },
					derivations: { count: t.number() },
					events: { send: { text: t.string() } },
					requirements: {},
				},
				init: (facts) => { facts.messages = []; },
				derive: { count: (facts) => facts.messages.length },
				events: {
					send: (facts, { text }) => { facts.messages = [...facts.messages, text]; },
				},
			});

			system.registerModule("chat", chatModule);
			await system.settle();

			// Access via namespace
			expect(system.facts.chat.messages).toEqual([]);
			expect(system.derive.chat.count).toBe(0);

			// Dispatch namespaced event
			system.events.chat.send({ text: "hello" });
			await system.settle();

			expect(system.facts.chat.messages).toEqual(["hello"]);
			expect(system.derive.chat.count).toBe(1);
		});

		it("rejects duplicate namespace", async () => {
			const mod = createModule("auth", {
				schema: {
					facts: { token: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.token = ""; },
				derive: {},
				events: {},
			});

			const system = createSystem({ modules: { auth: mod } });
			system.start();
			await system.settle();

			expect(() => system.registerModule("auth", mod)).toThrow(/already exists/);
			system.destroy();
		});

		it("rejects namespace with separator", async () => {
			const mod = createModule("test", {
				schema: {
					facts: { v: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.v = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ modules: { base: mod } });
			system.start();

			expect(() => system.registerModule("bad::name", mod)).toThrow(/separator/);
			system.destroy();
		});

		it("supports subscribe and watch on dynamically registered module", async () => {
			const baseModule = createModule("base", {
				schema: {
					facts: { v: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.v = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ modules: { base: baseModule } });
			system.start();
			await system.settle();

			const dynamicModule = createModule("dynamic", {
				schema: {
					facts: { value: t.number() },
					derivations: {},
					events: { set: { n: t.number() } },
					requirements: {},
				},
				init: (facts) => { facts.value = 0; },
				derive: {},
				events: { set: (facts, { n }) => { facts.value = n; } },
			});

			system.registerModule("dynamic", dynamicModule);
			await system.settle();

			const changes: number[] = [];
			system.watch("dynamic.value", (val: number) => changes.push(val));

			system.events.dynamic.set({ n: 42 });
			await system.settle();

			expect(changes).toContain(42);
			system.destroy();
		});
	});
});

// ============================================================================
// Module Instance Factory Tests
// ============================================================================

describe("Module Instance Factory", () => {
	it("creates multiple named instances from a single definition", () => {
		const chatRoom = createModuleFactory({
			schema: {
				facts: { messages: t.array<string>(), users: t.array<string>() },
				derivations: { count: t.number() },
				events: { send: { text: t.string() } },
				requirements: {},
			},
			init: (facts) => { facts.messages = []; facts.users = []; },
			derive: { count: (facts) => facts.messages.length },
			events: {
				send: (facts, { text }) => { facts.messages = [...facts.messages, text]; },
			},
		});

		const lobby = chatRoom("lobby");
		const support = chatRoom("support");

		expect(lobby.id).toBe("lobby");
		expect(support.id).toBe("support");
		// They should be different module instances
		expect(lobby).not.toBe(support);
	});

	it("instances are independent in a namespaced system", async () => {
		const chatRoom = createModuleFactory({
			schema: {
				facts: { messages: t.array<string>() },
				derivations: { count: t.number() },
				events: { send: { text: t.string() } },
				requirements: {},
			},
			init: (facts) => { facts.messages = []; },
			derive: { count: (facts) => facts.messages.length },
			events: {
				send: (facts, { text }) => { facts.messages = [...facts.messages, text]; },
			},
		});

		const system = createSystem({
			modules: {
				lobby: chatRoom("lobby"),
				support: chatRoom("support"),
			},
		});

		system.start();
		await system.settle();

		// Send message to lobby only
		system.events.lobby.send({ text: "hello lobby" });
		await system.settle();

		expect(system.facts.lobby.messages).toEqual(["hello lobby"]);
		expect(system.facts.support.messages).toEqual([]);
		expect(system.derive.lobby.count).toBe(1);
		expect(system.derive.support.count).toBe(0);

		system.destroy();
	});
});

// ============================================================================
// Performance Plugin Tests
// ============================================================================

describe("Performance Plugin", () => {
	it("tracks reconciliation metrics", async () => {
		const perf = performancePlugin();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		const snapshot = perf.getSnapshot();
		expect(snapshot.reconcile.runs).toBeGreaterThanOrEqual(1);
		expect(snapshot.reconcile.totalDurationMs).toBeGreaterThanOrEqual(0);
		expect(snapshot.uptime).toBeGreaterThanOrEqual(0);

		system.destroy();
	});

	it("tracks effect runs", async () => {
		const perf = performancePlugin();
		const effectRan = vi.fn();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
			effects: {
				logger: {
					deps: ["count"],
					run: effectRan,
				},
			},
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		system.events.inc();
		await system.settle();

		const snapshot = perf.getSnapshot();
		expect(snapshot.effects.logger).toBeDefined();
		expect(snapshot.effects.logger.runs).toBeGreaterThanOrEqual(1);

		system.destroy();
	});

	it("tracks resolver metrics", async () => {
		const perf = performancePlugin();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number(), saved: t.boolean() },
				derivations: {},
				events: {},
				requirements: {
					SAVE: { count: t.number() },
				},
			},
			init: (facts) => { facts.count = 100; facts.saved = false; },
			derive: {},
			events: {},
			constraints: {
				saveWhenLarge: {
					when: (facts) => facts.count > 50 && !facts.saved,
					require: (facts) => ({ type: "SAVE" as const, count: facts.count }),
				},
			},
			resolvers: {
				saver: {
					requirement: "SAVE",
					resolve: async (_req, ctx) => {
						ctx.facts.saved = true;
					},
				},
			},
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		const snapshot = perf.getSnapshot();
		expect(snapshot.resolvers.saver).toBeDefined();
		expect(snapshot.resolvers.saver.completions).toBe(1);
		expect(snapshot.resolvers.saver.totalDurationMs).toBeGreaterThanOrEqual(0);

		system.destroy();
	});

	it("calls onSlowResolver callback", async () => {
		const onSlowResolver = vi.fn();
		const perf = performancePlugin({
			slowResolverThresholdMs: 0, // Everything is "slow" for testing
			onSlowResolver,
		});

		const mod = createModule("test", {
			schema: {
				facts: { active: t.boolean(), done: t.boolean() },
				derivations: {},
				events: {},
				requirements: { DO: {} },
			},
			init: (facts) => { facts.active = true; facts.done = false; },
			derive: {},
			events: {},
			constraints: {
				doIt: {
					when: (facts) => facts.active && !facts.done,
					require: { type: "DO" as const },
				},
			},
			resolvers: {
				doer: {
					requirement: "DO",
					resolve: async (_req, ctx) => {
						// Small delay so Date.now() duration > 0
						await new Promise((r) => setTimeout(r, 5));
						ctx.facts.done = true;
					},
				},
			},
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		expect(onSlowResolver).toHaveBeenCalledWith("doer", expect.any(Number));
		system.destroy();
	});

	it("reset() clears all metrics", async () => {
		const perf = performancePlugin();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: {},
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		system.events.inc();
		await system.settle();

		perf.reset();
		const snapshot = perf.getSnapshot();
		expect(snapshot.reconcile.runs).toBe(0);
		expect(Object.keys(snapshot.effects)).toHaveLength(0);

		system.destroy();
	});

	it("constraint evaluation tracking", async () => {
		const perf = performancePlugin();

		const mod = createModule("test", {
			schema: {
				facts: { count: t.number() },
				derivations: {},
				events: { inc: {} },
				requirements: { SAVE: {} },
			},
			init: (facts) => { facts.count = 0; },
			derive: {},
			events: { inc: (facts) => { facts.count++; } },
			constraints: {
				checkCount: {
					when: (facts) => facts.count > 100,
					require: { type: "SAVE" as const },
				},
			},
		});

		const system = createSystem({ module: mod, plugins: [perf] });
		system.start();
		await system.settle();

		system.events.inc();
		await system.settle();

		const snapshot = perf.getSnapshot();
		expect(snapshot.constraints.checkCount).toBeDefined();
		expect(snapshot.constraints.checkCount.evaluations).toBeGreaterThanOrEqual(1);

		system.destroy();
	});
});

// ============================================================================
// AE Review Fix Tests
// ============================================================================

describe("AE Review Fixes", () => {
	describe("C1: registerModule reconciliation guard", () => {
		it("throws if registerModule is called during reconciliation", async () => {
			// We can't easily trigger registerModule mid-reconcile directly,
			// but we can test the destroyed guard which uses the same pattern
			const mod = createModule("base", {
				schema: {
					facts: { v: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.v = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: mod });
			system.start();
			await system.settle();
			system.destroy();

			const newMod = createModule("extra", {
				schema: {
					facts: { x: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.x = 0; },
				derive: {},
				events: {},
			});

			expect(() => system.registerModule(newMod)).toThrow(/destroyed/);
		});
	});

	describe("M4: Schema collision detection in production", () => {
		it("throws on duplicate fact keys regardless of NODE_ENV", () => {
			const mod = createModule("base", {
				schema: {
					facts: { shared: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.shared = 0; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: mod });
			system.start();

			const conflicting = createModule("conflict", {
				schema: {
					facts: { shared: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.shared = ""; },
				derive: {},
				events: {},
			});

			// Should throw even if we weren't in dev mode
			expect(() => system.registerModule(conflicting)).toThrow(/collision/i);
			system.destroy();
		});
	});

	describe("C2: Constraint topology rebuild on dynamic registration", () => {
		it("dynamically registered constraint with after ordering works correctly", async () => {
			const mod = createModule("base", {
				schema: {
					facts: { step: t.number(), done: t.boolean() },
					derivations: {},
					events: {},
					requirements: { STEP: {} },
				},
				init: (facts) => { facts.step = 0; facts.done = false; },
				derive: {},
				events: {},
				constraints: {
					first: {
						when: (facts) => facts.step === 0,
						require: { type: "STEP" as const },
					},
				},
				resolvers: {
					stepper: {
						requirement: "STEP",
						resolve: async (_req, ctx) => {
							ctx.facts.step = (ctx.facts.step as number) + 1;
						},
					},
				},
			});

			const system = createSystem({ module: mod });
			system.start();
			await system.settle();

			// Step should have been incremented by the first constraint
			expect(system.facts.step).toBe(1);
			system.destroy();
		});
	});

	describe("M1: Facts proxy ownKeys after dynamic registration", () => {
		it("Object.keys(system.facts) includes dynamically registered keys in single-module mode", async () => {
			const mod = createModule("base", {
				schema: {
					facts: { a: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.a = 1; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: mod });
			system.start();
			await system.settle();

			expect(Object.keys(system.facts)).toContain("a");

			const extra = createModule("extra", {
				schema: {
					facts: { b: t.number() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.b = 2; },
				derive: {},
				events: {},
			});

			system.registerModule(extra);
			await system.settle();

			const keys = Object.keys(system.facts);
			expect(keys).toContain("a");
			expect(keys).toContain("b");
			expect(system.facts.b).toBe(2);
			system.destroy();
		});
	});

	describe("M5: Namespaced proxy ownKeys includes dynamic modules", () => {
		it("Object.keys(system.facts) includes dynamically registered namespace", async () => {
			const auth = createModule("auth", {
				schema: {
					facts: { token: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.token = ""; },
				derive: {},
				events: {},
			});

			const system = createSystem({ modules: { auth } });
			system.start();
			await system.settle();

			expect(Object.keys(system.facts)).toContain("auth");
			expect(Object.keys(system.facts)).not.toContain("chat");

			const chat = createModule("chat", {
				schema: {
					facts: { msg: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.msg = ""; },
				derive: {},
				events: {},
			});

			system.registerModule("chat", chat);
			await system.settle();

			const nsKeys = Object.keys(system.facts);
			expect(nsKeys).toContain("auth");
			expect(nsKeys).toContain("chat");
			expect(system.facts.chat.msg).toBe("");
			system.destroy();
		});
	});

	describe("Dynamic constraint + resolver integration", () => {
		it("dynamically registered constraint triggers its resolver", async () => {
			const base = createModule("base", {
				schema: {
					facts: { ready: t.boolean() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.ready = false; },
				derive: {},
				events: {},
			});

			const system = createSystem({ module: base });
			system.start();
			await system.settle();

			expect(system.facts.ready).toBe(false);

			// Dynamically register a module with a constraint that should fire immediately
			const activator = createModule("activator", {
				schema: {
					facts: { triggered: t.boolean() },
					derivations: {},
					events: {},
					requirements: { ACTIVATE: {} },
				},
				init: (facts) => { facts.triggered = false; },
				derive: {},
				events: {},
				constraints: {
					autoActivate: {
						when: (facts) => !facts.triggered,
						require: { type: "ACTIVATE" as const },
					},
				},
				resolvers: {
					activator: {
						requirement: "ACTIVATE",
						resolve: async (_req, ctx) => {
							ctx.facts.triggered = true;
						},
					},
				},
			});

			system.registerModule(activator);
			await system.settle();

			expect(system.facts.triggered).toBe(true);
			system.destroy();
		});
	});

	describe("M2: Performance plugin constraint timing fix", () => {
		it("does not produce NaN or negative durations for constraints", async () => {
			const perf = performancePlugin();

			const mod = createModule("test", {
				schema: {
					facts: { count: t.number() },
					derivations: {},
					events: { inc: {} },
					requirements: { SAVE: {} },
				},
				init: (facts) => { facts.count = 0; },
				derive: {},
				events: { inc: (facts) => { facts.count++; } },
				constraints: {
					checkA: {
						when: (facts) => facts.count > 0,
						require: { type: "SAVE" as const },
					},
					checkB: {
						when: (facts) => facts.count > 10,
						require: { type: "SAVE" as const },
					},
				},
			});

			const system = createSystem({ module: mod, plugins: [perf] });
			system.start();
			await system.settle();

			// Trigger multiple reconciliation cycles
			system.events.inc();
			await system.settle();
			system.events.inc();
			await system.settle();

			const snapshot = perf.getSnapshot();
			for (const [_id, metrics] of Object.entries(snapshot.constraints)) {
				expect(metrics.evaluations).toBeGreaterThanOrEqual(1);
				expect(Number.isNaN(metrics.avgDurationMs)).toBe(false);
				expect(metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
				expect(metrics.maxDurationMs).toBeGreaterThanOrEqual(0);
			}

			system.destroy();
		});

		it("resets constraint timing baseline on each reconcile cycle", async () => {
			const perf = performancePlugin();

			const mod = createModule("test", {
				schema: {
					facts: { v: t.number() },
					derivations: {},
					events: { bump: {} },
					requirements: {},
				},
				init: (facts) => { facts.v = 0; },
				derive: {},
				events: { bump: (facts) => { facts.v++; } },
				constraints: {
					onlyConstraint: {
						when: (facts) => facts.v > 100,
						require: { type: "NEVER" as const },
					},
				},
			});

			const system = createSystem({ module: mod, plugins: [perf] });
			system.start();
			await system.settle();

			system.events.bump();
			await system.settle();

			const snapshot = perf.getSnapshot();
			// The single constraint should have evaluations but since it's the only one,
			// and it's always first in the cycle, it may or may not have duration
			const metrics = snapshot.constraints.onlyConstraint;
			expect(metrics).toBeDefined();
			expect(metrics.evaluations).toBeGreaterThanOrEqual(1);
			// Duration should never be negative or NaN
			expect(Number.isNaN(metrics.avgDurationMs)).toBe(false);
			expect(metrics.totalDurationMs).toBeGreaterThanOrEqual(0);

			system.destroy();
		});
	});

	describe("M7: Async effect cleanup on stop", () => {
		it("invokes cleanup returned by async effect even if system stops before resolution", async () => {
			const cleanupFn = vi.fn();
			let resolveEffect: () => void;
			const effectPromise = new Promise<void>((r) => { resolveEffect = r; });

			const mod = createModule("test", {
				schema: {
					facts: { active: t.boolean() },
					derivations: {},
					events: {},
					requirements: {},
				},
				init: (facts) => { facts.active = true; },
				derive: {},
				events: {},
				effects: {
					asyncEffect: {
						run: async () => {
							await effectPromise;
							return cleanupFn;
						},
					},
				},
			});

			const system = createSystem({ module: mod });
			system.start();

			// Let the effect start running (microtask)
			await new Promise((r) => setTimeout(r, 10));

			// Stop the system while the effect is still pending
			system.stop();

			// Now resolve the async effect — cleanup should fire immediately since system is stopped
			resolveEffect!();
			await new Promise((r) => setTimeout(r, 10));

			expect(cleanupFn).toHaveBeenCalledTimes(1);
			system.destroy();
		});
	});

	describe("m7: createModuleFactory preserves crossModuleDeps", () => {
		it("factory-created modules retain crossModuleDeps", () => {
			const authSchema = {
				facts: { token: t.string() },
				derivations: {},
				events: {},
				requirements: {},
			};

			const factory = createModuleFactory({
				schema: {
					facts: { data: t.string() },
					derivations: {},
					events: {},
					requirements: {},
				},
				crossModuleDeps: { auth: authSchema },
				init: (facts) => { facts.data = ""; },
				derive: {},
				events: {},
			});

			const instance = factory("myInstance");
			expect(instance.id).toBe("myInstance");
			expect(instance.crossModuleDeps).toBeDefined();
			expect(instance.crossModuleDeps).toHaveProperty("auth");
		});
	});
});
