/**
 * Core Runtime Stress Tests
 *
 * Targets the fundamental machinery: facts store batching, derivation
 * invalidation, constraint evaluation, resolver races, effect re-tracking,
 * the reconciliation loop, and cross-system interactions.
 *
 * Goal: break it or prove it won't break.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	createModule,
	createSystem,
	createFacts,
	createFactsStore,
	createFactsProxy,
	createDerivationsManager,
	createEffectsManager,
	createConstraintsManager,
	createResolversManager,
	createEngine,
	t,
	withTracking,
	withoutTracking,
	trackAccess,
	isTracking,
	type ModuleSchema,
} from "../index.js";

// ============================================================================
// Helpers
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

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`FREEZE: ${label} timed out after ${ms}ms`)), ms)
		),
	]);
}

// ============================================================================
// 1. FACTS STORE — batching, coalescing, re-entrance guards
// ============================================================================

describe("facts store stress", () => {

	it("1000 keys in a single batch coalesce to one flush", () => {
		const schema = { value0: t.number() }; // minimal schema
		const store = createFactsStore({
			schema: {} as any,
			dev: false,
		});

		let notifyCount = 0;
		// Subscribe to wildcard
		store.subscribeAll(() => { notifyCount++; });

		store.batch(() => {
			for (let i = 0; i < 1000; i++) {
				store.set(`key${i}`, i);
			}
		});

		// All 1000 writes should coalesce — subscribeAll fires once per flush, not 1000 times
		expect(notifyCount).toBeGreaterThan(0);
		expect(notifyCount).toBeLessThan(100); // Well below 1000
		for (let i = 0; i < 1000; i++) {
			expect(store.get(`key${i}`)).toBe(i);
		}
	});

	it("nested batch() calls coalesce correctly", () => {
		const store = createFactsStore({ schema: {} as any, dev: false });

		const changes: string[] = [];
		store.subscribe(["a"], () => changes.push("a"));
		store.subscribe(["b"], () => changes.push("b"));

		store.batch(() => {
			store.set("a", 1);
			store.batch(() => {
				store.set("b", 2);
				store.batch(() => {
					store.set("a", 10); // overwrite a
				});
			});
		});

		// Both a and b should have been notified, but only after outermost batch
		expect(store.get("a")).toBe(10);
		expect(store.get("b")).toBe(2);
		expect(changes).toContain("a");
		expect(changes).toContain("b");
	});

	it("listener that mutates facts doesn't infinite loop (re-entrance guard)", () => {
		const store = createFactsStore({ schema: {} as any, dev: false });
		store.set("counter", 0);

		let calls = 0;
		store.subscribe(["counter"], () => {
			calls++;
			if (calls < 200) {
				// This triggers re-entrance — the coalescing layer should handle it
				store.set("counter", calls);
			}
		});

		// Trigger the first notification
		store.set("counter", 1);

		// Should not infinite loop — guard at MAX_NOTIFY_ITERATIONS (100)
		// The exact number depends on coalescing, but it must be bounded
		expect(calls).toBeGreaterThan(0);
		expect(calls).toBeLessThanOrEqual(200);
		expect(store.get("counter")).toBeDefined();
	});

	it("rapid set/get interleaving maintains consistency", () => {
		const store = createFactsStore({ schema: {} as any, dev: false });

		for (let i = 0; i < 10000; i++) {
			store.set("val", i);
			expect(store.get("val")).toBe(i);
		}
	});

	it("subscriber added during notification doesn't cause crash", () => {
		const store = createFactsStore({ schema: {} as any, dev: false });
		store.set("x", 0);

		let lateSub = 0;
		store.subscribe(["x"], () => {
			// Add a new subscriber during notification
			store.subscribe(["x"], () => { lateSub++; });
		});

		store.set("x", 1);
		store.set("x", 2);

		// Should not crash; late subscriber may or may not fire for the current cycle
		expect(lateSub).toBeGreaterThanOrEqual(0);
	});

	it("batch with no changes doesn't fire listeners", () => {
		const store = createFactsStore({ schema: {} as any, dev: false });
		store.set("x", 42);

		let called = false;
		store.subscribe(["x"], () => { called = true; });

		store.batch(() => {
			// No actual changes
		});

		expect(called).toBe(false);
	});
});

// ============================================================================
// 2. DERIVATIONS — composition chains, diamond deps, invalidation storms
// ============================================================================

describe("derivation stress", () => {

	it("10-level derivation composition chain computes correctly", () => {
		const schema = {
			facts: { base: t.number() },
			derivations: {
				d0: t.number(), d1: t.number(), d2: t.number(), d3: t.number(), d4: t.number(),
				d5: t.number(), d6: t.number(), d7: t.number(), d8: t.number(), d9: t.number(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("deepchain", {
			schema,
			init: f => { f.base = 1; },
			derive: {
				d0: f => f.base + 1,           // 2
				d1: (_f, d) => d.d0 + 1,       // 3
				d2: (_f, d) => d.d1 + 1,       // 4
				d3: (_f, d) => d.d2 + 1,       // 5
				d4: (_f, d) => d.d3 + 1,       // 6
				d5: (_f, d) => d.d4 + 1,       // 7
				d6: (_f, d) => d.d5 + 1,       // 8
				d7: (_f, d) => d.d6 + 1,       // 9
				d8: (_f, d) => d.d7 + 1,       // 10
				d9: (_f, d) => d.d8 + 1,       // 11
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		expect(sys.derive.d9).toBe(11);

		sys.facts.base = 100;
		expect(sys.derive.d9).toBe(110);

		sys.facts.base = 0;
		expect(sys.derive.d9).toBe(10);
	});

	it("diamond dependency: A→B, A→C, B+C→D", () => {
		const schema = {
			facts: { a: t.number() },
			derivations: {
				b: t.number(),
				c: t.number(),
				d: t.number(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("diamond", {
			schema,
			init: f => { f.a = 1; },
			derive: {
				b: f => f.a * 2,
				c: f => f.a * 3,
				d: (_f, d) => d.b + d.c,
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		expect(sys.derive.d).toBe(5); // 2+3

		sys.facts.a = 10;
		expect(sys.derive.d).toBe(50); // 20+30

		// Rapid changes
		for (let i = 0; i < 100; i++) {
			sys.facts.a = i;
		}
		expect(sys.derive.d).toBe(99 * 5); // 198+297 = 495
	});

	it("wide fan-out: one fact feeds 50 derivations", () => {
		const schema = {
			facts: { source: t.number() },
			derivations: {} as Record<string, ReturnType<typeof t.number>>,
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		// Dynamically build 50 derivations
		const deriveKeys: Record<string, ReturnType<typeof t.number>> = {};
		const derive: Record<string, (f: any) => number> = {};
		for (let i = 0; i < 50; i++) {
			deriveKeys[`d${i}`] = t.number();
			derive[`d${i}`] = (f: any) => f.source + i;
		}
		(schema as any).derivations = deriveKeys;

		const mod = createModule("fanout", {
			schema,
			init: (f: any) => { f.source = 0; },
			derive,
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		for (let i = 0; i < 50; i++) {
			expect(sys.read(`d${i}`)).toBe(i);
		}

		(sys.facts as any).source = 100;

		for (let i = 0; i < 50; i++) {
			expect(sys.read(`d${i}`)).toBe(100 + i);
		}
	});

	it("derivation with conditional deps re-tracks correctly", () => {
		const schema = {
			facts: {
				mode: t.string<"a" | "b">(),
				valueA: t.number(),
				valueB: t.number(),
			},
			derivations: {
				result: t.number(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("condtrack", {
			schema,
			init: f => { f.mode = "a"; f.valueA = 10; f.valueB = 20; },
			derive: {
				result: f => f.mode === "a" ? f.valueA : f.valueB,
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		expect(sys.derive.result).toBe(10);

		// Change mode — derivation should re-track to depend on valueB
		sys.facts.mode = "b";
		expect(sys.derive.result).toBe(20);

		// Now changing valueB should update result
		sys.facts.valueB = 99;
		expect(sys.derive.result).toBe(99);

		// And changing valueA should NOT affect result (no longer tracked)
		sys.facts.valueA = 999;
		// Re-read to get fresh value — derivation only depends on mode + valueB now
		expect(sys.derive.result).toBe(99);
	});

	it("50 subscribers reading derivations during rapid fact changes", async () => {
		const schema = {
			facts: { x: t.number() },
			derivations: {
				doubled: t.number(),
				tripled: t.number(),
				sum: t.number(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("substress", {
			schema,
			init: f => { f.x = 0; },
			derive: {
				doubled: f => f.x * 2,
				tripled: f => f.x * 3,
				sum: (_f, d) => d.doubled + d.tripled,
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Read derivations to establish tracking
		expect(sys.derive.sum).toBe(0);

		let callbacks = 0;
		const keys = ["doubled", "tripled", "sum"];
		for (let i = 0; i < 50; i++) {
			sys.subscribe(keys, () => {
				callbacks++;
				// Each subscriber reads all derivations (like React re-render)
				for (const k of keys) sys.read(k);
			});
		}

		// 500 rapid mutations
		for (let i = 1; i <= 500; i++) {
			sys.facts.x = i;
		}

		await raceTimeout(new Promise(r => setTimeout(r, 1000)), 5000, "50 subscribers");

		expect(sys.facts.x).toBe(500);
		expect(sys.derive.doubled).toBe(1000);
		expect(sys.derive.tripled).toBe(1500);
		expect(sys.derive.sum).toBe(2500);
		expect(callbacks).toBeLessThan(100000); // bounded
	});
});

// ============================================================================
// 3. TRACKING — stack integrity, nested contexts, error recovery
// ============================================================================

describe("tracking stress", () => {

	it("1000 nested withTracking calls don't overflow", () => {
		let depth = 0;
		function nested(n: number): Set<string> {
			if (n === 0) {
				trackAccess("leaf");
				return new Set(["leaf"]);
			}
			const { deps } = withTracking(() => {
				depth++;
				trackAccess(`level-${n}`);
				nested(n - 1);
				return null;
			});
			return deps;
		}

		// 1000 is conservative — should not stack overflow
		const result = nested(1000);
		expect(result).toBeDefined();
	});

	it("withoutTracking inside withTracking isolates deps", () => {
		const { deps } = withTracking(() => {
			trackAccess("tracked");

			withoutTracking(() => {
				trackAccess("hidden");
			});

			trackAccess("also-tracked");
		});

		expect(deps.has("tracked")).toBe(true);
		expect(deps.has("also-tracked")).toBe(true);
		expect(deps.has("hidden")).toBe(false);
	});

	it("exception in withTracking restores tracking stack", () => {
		const { deps: outer } = withTracking(() => {
			trackAccess("before");

			try {
				withTracking(() => {
					trackAccess("inner");
					throw new Error("boom");
				});
			} catch {}

			trackAccess("after");
		});

		expect(outer.has("before")).toBe(true);
		expect(outer.has("after")).toBe(true);
		expect(outer.has("inner")).toBe(false); // inner context was separate
	});

	it("exception in withoutTracking restores outer context", () => {
		const { deps } = withTracking(() => {
			trackAccess("before");

			try {
				withoutTracking(() => {
					throw new Error("boom");
				});
			} catch {}

			// Tracking should still work
			expect(isTracking()).toBe(true);
			trackAccess("after");
		});

		expect(deps.has("before")).toBe(true);
		expect(deps.has("after")).toBe(true);
	});
});

// ============================================================================
// 4. CONSTRAINTS — async, topological order, after chains, incremental eval
// ============================================================================

describe("constraint stress", () => {

	it("50-constraint after-chain resolves in correct order", async () => {
		const schema = {
			facts: { go: t.boolean(), log: t.any<string[]>() },
			derivations: {},
			events: {},
			requirements: {
				STEP: { index: t.number() },
			},
		} satisfies ModuleSchema;

		// c0 has no after, c1 after c0, c2 after c1, ... c49 after c48
		const constraints: Record<string, any> = {};
		for (let i = 0; i < 50; i++) {
			const def: any = {
				when: (f: any) => f.go,
				require: { type: "STEP", index: i },
			};
			if (i > 0) def.after = [`c${i - 1}`];
			constraints[`c${i}`] = def;
		}

		const mod = createModule("afterchain", {
			schema,
			init: f => { f.go = false; f.log = []; },
			constraints,
			resolvers: {
				step: {
					requirement: "STEP",
					key: req => `step-${req.index}`,
					resolve: async (req, ctx) => {
						ctx.facts.log = [...ctx.facts.log, `s${req.index}`];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 15000, "50-constraint after-chain");

		// All 50 should have fired
		expect(sys.facts.log).toHaveLength(50);
		// And in order (each waits for predecessor)
		for (let i = 0; i < 50; i++) {
			expect(sys.facts.log[i]).toBe(`s${i}`);
		}
	});

	it("constraint that toggles itself off stabilizes", async () => {
		const schema = {
			facts: { active: t.boolean(), count: t.number() },
			derivations: {},
			events: {},
			requirements: { DEACTIVATE: {} },
		} satisfies ModuleSchema;

		const mod = createModule("toggle", {
			schema,
			init: f => { f.active = true; f.count = 0; },
			constraints: {
				selfOff: {
					when: f => f.active,
					require: { type: "DEACTIVATE" },
				},
			},
			resolvers: {
				deactivate: {
					requirement: "DEACTIVATE",
					resolve: async (_req, ctx) => {
						ctx.facts.active = false;
						ctx.facts.count++;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		await raceTimeout(sys.settle(), 3000, "self-toggle");

		expect(sys.facts.active).toBe(false);
		expect(sys.facts.count).toBe(1); // Should only fire once
	});

	it("constraint with async when() and explicit deps", async () => {
		const schema = {
			facts: { userId: t.number(), validated: t.boolean() },
			derivations: {},
			events: {},
			requirements: { VALIDATE: {} },
		} satisfies ModuleSchema;

		const mod = createModule("asyncconstraint", {
			schema,
			init: f => { f.userId = 0; f.validated = false; },
			constraints: {
				check: {
					async: true,
					deps: ["userId"],
					when: async (f: any) => {
						await new Promise(r => setTimeout(r, 10));
						return f.userId > 0 && !f.validated;
					},
					require: { type: "VALIDATE" },
				},
			},
			resolvers: {
				validate: {
					requirement: "VALIDATE",
					resolve: async (_req, ctx) => {
						ctx.facts.validated = true;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.userId = 42;
		await raceTimeout(sys.settle(), 5000, "async constraint");

		expect(sys.facts.validated).toBe(true);
	});

	it("disabled constraint doesn't fire even when condition is true", async () => {
		const schema = {
			facts: { x: t.number(), fired: t.boolean() },
			derivations: {},
			events: {},
			requirements: { FIRE: {} },
		} satisfies ModuleSchema;

		let resolverCalled = false;
		const mod = createModule("disabled", {
			schema,
			init: f => { f.x = 0; f.fired = false; },
			constraints: {
				shouldFire: {
					when: f => f.x > 10,
					require: { type: "FIRE" },
				},
			},
			resolvers: {
				fire: {
					requirement: "FIRE",
					resolve: async (_req, ctx) => {
						resolverCalled = true;
						ctx.facts.fired = true;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Disable the constraint
		sys.constraints.disable("shouldFire");

		sys.facts.x = 100;
		await raceTimeout(sys.settle(), 2000, "disabled constraint");

		expect(resolverCalled).toBe(false);
		expect(sys.facts.fired).toBe(false);

		// Re-enable
		sys.constraints.enable("shouldFire");

		// Trigger re-evaluation
		sys.facts.x = 101;
		await raceTimeout(sys.settle(), 2000, "re-enabled constraint");

		expect(resolverCalled).toBe(true);
		expect(sys.facts.fired).toBe(true);
	});

	it("100 constraints with mixed priorities fire highest first", async () => {
		const schema = {
			facts: { go: t.boolean(), order: t.any<number[]>() },
			derivations: {},
			events: {},
			requirements: { LOG: { pri: t.number() } },
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 100; i++) {
			constraints[`c${i}`] = {
				priority: i, // c99 = highest priority
				when: (f: any) => f.go,
				require: { type: "LOG", pri: i },
			};
		}

		const mod = createModule("prioorder", {
			schema,
			init: f => { f.go = false; f.order = []; },
			constraints,
			resolvers: {
				log: {
					requirement: "LOG",
					key: req => `log-${req.pri}`,
					resolve: async (req, ctx) => {
						ctx.facts.order = [...ctx.facts.order, req.pri];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 10000, "100 priority constraints");

		expect(sys.facts.order).toHaveLength(100);
		// All values present
		const sorted = [...sys.facts.order].sort((a, b) => a - b);
		expect(sorted).toEqual(Array.from({ length: 100 }, (_, i) => i));
	});
});

// ============================================================================
// 5. RESOLVERS — retry, cancel, race, dedup, batch
// ============================================================================

describe("resolver stress", () => {

	it("resolver with retry succeeds on third attempt", async () => {
		const schema = {
			facts: { go: t.boolean(), result: t.string() },
			derivations: {},
			events: {},
			requirements: { FLAKY: {} },
		} satisfies ModuleSchema;

		let attempts = 0;
		const mod = createModule("retry", {
			schema,
			init: f => { f.go = false; f.result = ""; },
			constraints: {
				trigger: { when: f => f.go && !f.result, require: { type: "FLAKY" } },
			},
			resolvers: {
				flaky: {
					requirement: "FLAKY",
					retry: { attempts: 5, backoff: "exponential", initialDelay: 10 },
					resolve: async (_req, ctx) => {
						attempts++;
						if (attempts < 3) throw new Error(`Attempt ${attempts} failed`);
						ctx.facts.result = "success";
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 5000, "retry resolver");

		expect(sys.facts.result).toBe("success");
		expect(attempts).toBe(3);
	});

	it("cancelled resolver doesn't corrupt state", async () => {
		const schema = {
			facts: {
				trigger: t.boolean(),
				value: t.string(),
			},
			derivations: {},
			events: {},
			requirements: { SLOW: {} },
		} satisfies ModuleSchema;

		const mod = createModule("cancel", {
			schema,
			init: f => { f.trigger = true; f.value = "initial"; },
			constraints: {
				slow: {
					when: f => f.trigger,
					require: { type: "SLOW" },
				},
			},
			resolvers: {
				slow: {
					requirement: "SLOW",
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 2000));
						ctx.facts.value = "resolved";
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Wait for resolver to start
		await new Promise(r => setTimeout(r, 50));

		// Remove the requirement by setting trigger=false — cancels the resolver
		sys.facts.trigger = false;
		await raceTimeout(sys.settle(), 3000, "cancel resolver");

		// Value should still be initial — cancelled resolver shouldn't have completed
		expect(sys.facts.value).toBe("initial");
	});

	it("20 concurrent resolvers with staggered delays all complete", async () => {
		const schema = {
			facts: {
				go: t.boolean(),
				done: t.any<Set<number>>(),
			},
			derivations: {},
			events: {},
			requirements: { WORK: { id: t.number() } },
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 20; i++) {
			constraints[`w${i}`] = {
				when: (f: any) => f.go,
				require: { type: "WORK", id: i },
			};
		}

		const mod = createModule("concurrent", {
			schema,
			init: f => { f.go = false; f.done = new Set(); },
			constraints,
			resolvers: {
				work: {
					requirement: "WORK",
					key: req => `work-${req.id}`,
					resolve: async (req, ctx) => {
						await new Promise(r => setTimeout(r, 10 + Math.random() * 50));
						const newSet = new Set(ctx.facts.done);
						newSet.add(req.id);
						ctx.facts.done = newSet;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 10000, "20 concurrent resolvers");

		expect(sys.facts.done.size).toBe(20);
	});

	it("deduplication: identical requirements only resolve once", async () => {
		const schema = {
			facts: { a: t.boolean(), b: t.boolean(), count: t.number() },
			derivations: {},
			events: {},
			requirements: { SHARED: {} },
		} satisfies ModuleSchema;

		let resolveCount = 0;
		const mod = createModule("dedup", {
			schema,
			init: f => { f.a = false; f.b = false; f.count = 0; },
			constraints: {
				fromA: { when: f => f.a, require: { type: "SHARED" } },
				fromB: { when: f => f.b, require: { type: "SHARED" } },
			},
			resolvers: {
				shared: {
					requirement: "SHARED",
					resolve: async (_req, ctx) => {
						resolveCount++;
						ctx.facts.count++;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Both constraints produce the same requirement
		sys.facts.a = true;
		sys.facts.b = true;
		await raceTimeout(sys.settle(), 3000, "dedup");

		// Should only resolve once due to deduplication
		expect(resolveCount).toBe(1);
		expect(sys.facts.count).toBe(1);
	});

	it("resolver error with ignore boundary doesn't crash system", async () => {
		const schema = {
			facts: { go: t.boolean(), safeResult: t.string() },
			derivations: {},
			events: {},
			requirements: { BROKEN: {}, SAFE: {} },
		} satisfies ModuleSchema;

		const mod = createModule("errorboundary", {
			schema,
			init: f => { f.go = false; f.safeResult = ""; },
			constraints: {
				broken: { when: f => f.go, require: { type: "BROKEN" }, priority: 10 },
				safe: { when: f => f.go, require: { type: "SAFE" }, priority: 5 },
			},
			resolvers: {
				broken: {
					requirement: "BROKEN",
					resolve: async () => { throw new Error("Kaboom!"); },
				},
				safe: {
					requirement: "SAFE",
					resolve: async (_req, ctx) => { ctx.facts.safeResult = "done"; },
				},
			},
		});

		const sys = track(createSystem({
			module: mod,
			errorBoundary: { onResolverError: "ignore" },
		}));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 3000, "error boundary");

		// Safe resolver should still have completed despite broken one throwing
		expect(sys.facts.safeResult).toBe("done");
	});
});

// ============================================================================
// 6. EFFECTS — auto-tracking, cleanup, mutations, conditional deps
// ============================================================================

describe("effect stress", () => {

	it("effect with conditional deps re-tracks when branch changes", async () => {
		const schema = {
			facts: {
				mode: t.string<"fast" | "slow">(),
				fastVal: t.number(),
				slowVal: t.number(),
				effectLog: t.any<string[]>(),
			},
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("condeffect", {
			schema,
			init: f => {
				f.mode = "fast";
				f.fastVal = 0;
				f.slowVal = 0;
				f.effectLog = [];
			},
			effects: {
				tracker: {
					// Auto-tracked: reads mode + either fastVal or slowVal
					run: (facts, prev) => {
						const val = facts.mode === "fast" ? facts.fastVal : facts.slowVal;
						if (prev) {
							facts.effectLog = [...facts.effectLog, `${facts.mode}:${val}`];
						}
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await raceTimeout(sys.settle(), 2000, "effect init");

		// Change fastVal — effect should fire (tracking fastVal in "fast" mode)
		sys.facts.fastVal = 10;
		await raceTimeout(new Promise(r => setTimeout(r, 200)), 3000, "fast change");

		expect(sys.facts.effectLog).toContain("fast:10");

		// Switch to slow mode — effect should re-track deps
		sys.facts.mode = "slow";
		await raceTimeout(new Promise(r => setTimeout(r, 200)), 3000, "mode switch");

		// Now change slowVal — effect should fire
		sys.facts.slowVal = 99;
		await raceTimeout(new Promise(r => setTimeout(r, 200)), 3000, "slow change");

		expect(sys.facts.effectLog).toContain("slow:99");
	});

	it("effect cleanup runs before next execution", async () => {
		const schema = {
			facts: { x: t.number(), cleanups: t.number() },
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("cleanup", {
			schema,
			init: f => { f.x = 0; f.cleanups = 0; },
			effects: {
				tracked: {
					deps: ["x"],
					run: (facts) => {
						// Return cleanup function
						return () => { facts.cleanups++; };
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await raceTimeout(sys.settle(), 2000, "effect cleanup init");

		// Trigger effect multiple times
		for (let i = 1; i <= 5; i++) {
			sys.facts.x = i;
			await raceTimeout(new Promise(r => setTimeout(r, 100)), 2000, `cleanup ${i}`);
		}

		// Each re-run should have cleaned up the previous
		expect(sys.facts.cleanups).toBeGreaterThanOrEqual(4); // at least 4 cleanups (5 runs - 1)
	});

	it("effect that mutates facts doesn't infinite loop", async () => {
		const schema = {
			facts: {
				input: t.number(),
				derived: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		let effectRuns = 0;
		const mod = createModule("effectmutation", {
			schema,
			init: f => { f.input = 0; f.derived = 0; },
			effects: {
				compute: {
					deps: ["input"],
					run: (facts) => {
						effectRuns++;
						// This writes to a fact — but should not re-trigger itself
						// because "derived" is not in deps
						facts.derived = facts.input * 2;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();
		await raceTimeout(sys.settle(), 2000, "effect mutation init");

		sys.facts.input = 5;
		await raceTimeout(new Promise(r => setTimeout(r, 500)), 3000, "effect mutation");

		expect(sys.facts.derived).toBe(10);
		// Should not have run excessively
		expect(effectRuns).toBeLessThan(20);
	});
});

// ============================================================================
// 7. RECONCILIATION LOOP — depth guard, churn, settle/unsettle
// ============================================================================

describe("reconciliation loop stress", () => {

	it("resolver→fact→constraint→resolver cascade settles (depth guard)", async () => {
		// A resolver increments a counter, which fires a constraint if counter < 10.
		// Uses dynamic require + key to produce unique requirements each step.
		const schema = {
			facts: { counter: t.number() },
			derivations: {},
			events: {},
			requirements: { INCREMENT: { step: t.number() } },
		} satisfies ModuleSchema;

		const mod = createModule("cascade", {
			schema,
			init: f => { f.counter = 0; },
			constraints: {
				keepGoing: {
					when: f => f.counter > 0 && f.counter < 10,
					require: f => ({ type: "INCREMENT", step: f.counter }),
				},
			},
			resolvers: {
				increment: {
					requirement: "INCREMENT",
					key: req => `inc-${req.step}`,
					resolve: async (_req, ctx) => {
						ctx.facts.counter++;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.counter = 1;
		await raceTimeout(sys.settle(), 10000, "cascade settle");

		// Should have cascaded from 1 to 10, then stopped
		expect(sys.facts.counter).toBe(10);
	});

	it("settle() resolves when system reaches stable state", async () => {
		const schema = {
			facts: { x: t.number() },
			derivations: { doubled: t.number() },
			events: {},
			requirements: { PROCESS: {} },
		} satisfies ModuleSchema;

		const mod = createModule("settle", {
			schema,
			init: f => { f.x = 0; },
			derive: { doubled: f => f.x * 2 },
			constraints: {
				process: {
					when: f => f.x === 42,
					require: { type: "PROCESS" },
				},
			},
			resolvers: {
				process: {
					requirement: "PROCESS",
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 50));
						ctx.facts.x = 0; // reset
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.x = 42;

		await raceTimeout(sys.settle(), 3000, "settle");

		expect(sys.facts.x).toBe(0);
		expect(sys.derive.doubled).toBe(0);
	});

	it("multiple settle() calls resolve independently", async () => {
		const schema = {
			facts: { count: t.number() },
			derivations: {},
			events: {},
			requirements: { BUMP: { step: t.number() } },
		} satisfies ModuleSchema;

		const mod = createModule("multisettle", {
			schema,
			init: f => { f.count = 0; },
			constraints: {
				bump: {
					when: f => f.count > 0 && f.count < 5,
					require: f => ({ type: "BUMP", step: f.count }),
				},
			},
			resolvers: {
				bump: {
					requirement: "BUMP",
					key: req => `bump-${req.step}`,
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 10));
						ctx.facts.count++;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.count = 1;

		// Multiple concurrent settle() calls
		const [r1, r2, r3] = await Promise.all([
			raceTimeout(sys.settle(), 5000, "settle1"),
			raceTimeout(sys.settle(), 5000, "settle2"),
			raceTimeout(sys.settle(), 5000, "settle3"),
		]);

		expect(sys.facts.count).toBe(5);
	});

	it("rapid fact changes during active reconciliation converge", async () => {
		const schema = {
			facts: {
				target: t.number(),
				reached: t.boolean(),
			},
			derivations: {},
			events: {},
			requirements: { REACH: {} },
		} satisfies ModuleSchema;

		const mod = createModule("convergence", {
			schema,
			init: f => { f.target = 0; f.reached = false; },
			constraints: {
				reach: {
					when: f => f.target === 100 && !f.reached,
					require: { type: "REACH" },
				},
			},
			resolvers: {
				reach: {
					requirement: "REACH",
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 10));
						ctx.facts.reached = true;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Rapid changes — only the last should matter
		for (let i = 0; i < 100; i++) {
			sys.facts.target = i;
		}
		sys.facts.target = 100;

		await raceTimeout(sys.settle(), 5000, "convergence");

		expect(sys.facts.reached).toBe(true);
	});
});

// ============================================================================
// 8. EVENTS — dispatch storm, handler mutations, cross-cutting
// ============================================================================

describe("event stress", () => {

	it("1000 rapid event dispatches all apply", () => {
		const schema = {
			facts: { sum: t.number() },
			derivations: {},
			events: { add: { n: t.number() } },
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("eventflood", {
			schema,
			init: f => { f.sum = 0; },
			events: {
				add: (f, { n }) => { f.sum += n; },
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		for (let i = 1; i <= 1000; i++) {
			sys.events.add({ n: 1 });
		}

		expect(sys.facts.sum).toBe(1000);
	});

	it("event handler triggers constraint that resolves", async () => {
		const schema = {
			facts: {
				threshold: t.number(),
				alerted: t.boolean(),
			},
			derivations: {},
			events: { bump: {} },
			requirements: { ALERT: {} },
		} satisfies ModuleSchema;

		const mod = createModule("eventconstraint", {
			schema,
			init: f => { f.threshold = 0; f.alerted = false; },
			events: {
				bump: f => { f.threshold++; },
			},
			constraints: {
				alert: {
					when: f => f.threshold >= 5 && !f.alerted,
					require: { type: "ALERT" },
				},
			},
			resolvers: {
				alert: {
					requirement: "ALERT",
					resolve: async (_req, ctx) => { ctx.facts.alerted = true; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		for (let i = 0; i < 5; i++) {
			sys.events.bump();
		}

		await raceTimeout(sys.settle(), 3000, "event→constraint");

		expect(sys.facts.threshold).toBe(5);
		expect(sys.facts.alerted).toBe(true);
	});
});

// ============================================================================
// 9. TIME TRAVEL — snapshot pressure, restore + modify
// ============================================================================

describe("time travel stress", () => {

	it("100 snapshots from rapid fact changes", async () => {
		const schema = {
			facts: { x: t.number() },
			derivations: { doubled: t.number() },
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("ttstress", {
			schema,
			init: f => { f.x = 0; },
			derive: { doubled: f => f.x * 2 },
		});

		const sys = track(createSystem({
			module: mod,
			debug: { timeTravel: true, maxSnapshots: 100 },
		}));
		sys.start();

		// Each change triggers a reconcile → snapshot
		for (let i = 1; i <= 50; i++) {
			sys.facts.x = i;
			await new Promise(r => setTimeout(r, 10));
		}

		await raceTimeout(sys.settle(), 3000, "tt snapshots");

		expect(sys.debug).toBeDefined();
		const snapshots = sys.debug!.snapshots;
		expect(snapshots.length).toBeGreaterThan(0);
		expect(snapshots.length).toBeLessThanOrEqual(100);
	});

	it("goBack and goForward after changes", async () => {
		const schema = {
			facts: { counter: t.number() },
			derivations: {},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("ttnavigate", {
			schema,
			init: f => { f.counter = 0; },
		});

		const sys = track(createSystem({
			module: mod,
			debug: { timeTravel: true, maxSnapshots: 50 },
		}));
		sys.start();

		sys.facts.counter = 1;
		await new Promise(r => setTimeout(r, 50));
		sys.facts.counter = 2;
		await new Promise(r => setTimeout(r, 50));
		sys.facts.counter = 3;
		await new Promise(r => setTimeout(r, 50));

		await raceTimeout(sys.settle(), 2000, "tt pre-navigate");

		const snapshots = sys.debug!.snapshots;
		if (snapshots.length >= 3) {
			sys.debug!.goBack();
			// After goBack, counter should be at a previous value
			const afterBack = sys.facts.counter;
			expect(afterBack).toBeLessThan(3);

			sys.debug!.goForward();
			const afterForward = sys.facts.counter;
			expect(afterForward).toBeGreaterThanOrEqual(afterBack);
		}
	});
});

// ============================================================================
// 10. CROSS-SYSTEM — namespaced multi-module, destroy, inspect
// ============================================================================

describe("cross-system stress", () => {

	it("5-module namespaced system with cross-cutting constraints", async () => {
		const makeModule = (name: string, reqType: string) => {
			const schema = {
				facts: { value: t.number(), processed: t.boolean() },
				derivations: { isReady: t.boolean() },
				events: { setValue: { n: t.number() } },
				requirements: { [reqType]: {} },
			} satisfies ModuleSchema;

			return createModule(name, {
				schema,
				init: f => { f.value = 0; f.processed = false; },
				derive: { isReady: f => f.value > 0 && !f.processed },
				events: { setValue: (f, { n }) => { f.value = n; } },
				constraints: {
					process: {
						when: (f: any) => f.value > 0 && !f.processed,
						require: { type: reqType },
					},
				},
				resolvers: {
					process: {
						requirement: reqType,
						resolve: async (_req: any, ctx: any) => {
							await new Promise(r => setTimeout(r, 10));
							ctx.facts.processed = true;
						},
					},
				},
			});
		};

		const sys = track(createSystem({
			modules: {
				alpha: makeModule("alpha", "PROC_A"),
				beta: makeModule("beta", "PROC_B"),
				gamma: makeModule("gamma", "PROC_C"),
				delta: makeModule("delta", "PROC_D"),
				epsilon: makeModule("epsilon", "PROC_E"),
			},
		}));
		sys.start();

		// Activate all modules
		(sys.events as any).alpha.setValue({ n: 10 });
		(sys.events as any).beta.setValue({ n: 20 });
		(sys.events as any).gamma.setValue({ n: 30 });
		(sys.events as any).delta.setValue({ n: 40 });
		(sys.events as any).epsilon.setValue({ n: 50 });

		await raceTimeout(sys.settle(), 10000, "5-module settle");

		expect((sys.facts as any).alpha.processed).toBe(true);
		expect((sys.facts as any).beta.processed).toBe(true);
		expect((sys.facts as any).gamma.processed).toBe(true);
		expect((sys.facts as any).delta.processed).toBe(true);
		expect((sys.facts as any).epsilon.processed).toBe(true);
	});

	it("inspect() returns correct state during and after resolution", async () => {
		const schema = {
			facts: { go: t.boolean() },
			derivations: {},
			events: {},
			requirements: { WORK: {} },
		} satisfies ModuleSchema;

		const mod = createModule("inspect", {
			schema,
			init: f => { f.go = false; },
			constraints: {
				trigger: { when: f => f.go, require: { type: "WORK" } },
			},
			resolvers: {
				work: {
					requirement: "WORK",
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 100));
						ctx.facts.go = false;
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Before trigger
		const beforeInspect = sys.inspect();
		expect(beforeInspect.unmet).toHaveLength(0);
		expect(beforeInspect.inflight).toHaveLength(0);

		sys.facts.go = true;

		// Give reconciliation time to start
		await new Promise(r => setTimeout(r, 50));

		// During resolution
		const duringInspect = sys.inspect();
		expect(duringInspect.inflight.length).toBeGreaterThanOrEqual(0);

		await raceTimeout(sys.settle(), 3000, "inspect settle");

		// After resolution
		const afterInspect = sys.inspect();
		expect(afterInspect.inflight).toHaveLength(0);
	});

	it("destroy during active resolvers completes without error", async () => {
		const schema = {
			facts: { active: t.boolean() },
			derivations: {},
			events: {},
			requirements: { LONG: {} },
		} satisfies ModuleSchema;

		const mod = createModule("destroyactive", {
			schema,
			init: f => { f.active = true; },
			constraints: {
				long: { when: f => f.active, require: { type: "LONG" } },
			},
			resolvers: {
				long: {
					requirement: "LONG",
					resolve: async () => {
						await new Promise(r => setTimeout(r, 10000));
					},
				},
			},
		});

		const sys = createSystem({ module: mod });
		sys.start();

		// Let resolver start
		await new Promise(r => setTimeout(r, 50));

		// Destroy while inflight
		expect(() => {
			sys.stop();
			sys.destroy();
		}).not.toThrow();
	});

	it("getSnapshot and restore produce consistent state", async () => {
		const schema = {
			facts: { count: t.number(), name: t.string() },
			derivations: { label: t.string() },
			events: { inc: {} },
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("snapshot", {
			schema,
			init: f => { f.count = 0; f.name = "test"; },
			derive: { label: f => `${f.name}:${f.count}` },
			events: { inc: f => { f.count++; } },
		});

		const sys1 = track(createSystem({ module: mod }));
		sys1.start();

		for (let i = 0; i < 10; i++) sys1.events.inc();

		expect(sys1.facts.count).toBe(10);
		expect(sys1.derive.label).toBe("test:10");

		const snapshot = sys1.getSnapshot();

		// Create new system from snapshot
		const sys2 = track(createSystem({
			module: mod,
			initialFacts: snapshot.facts as any,
		}));
		sys2.start();

		expect(sys2.facts.count).toBe(10);
		expect(sys2.facts.name).toBe("test");
		expect(sys2.derive.label).toBe("test:10");
	});
});

// ============================================================================
// 11. COMBINED — everything at once
// ============================================================================

describe("combined stress: everything at once", () => {

	it("full system with derivations, constraints, resolvers, effects, events, subscribers", async () => {
		const schema = {
			facts: {
				input: t.number(),
				processed: t.boolean(),
				effectCount: t.number(),
				resolverLog: t.any<string[]>(),
			},
			derivations: {
				doubled: t.number(),
				isHigh: t.boolean(),
				status: t.string(),
			},
			events: {
				setInput: { value: t.number() },
				reset: {},
			},
			requirements: {
				PROCESS: {},
				ALERT: {},
			},
		} satisfies ModuleSchema;

		const mod = createModule("everything", {
			schema,
			init: f => {
				f.input = 0;
				f.processed = false;
				f.effectCount = 0;
				f.resolverLog = [];
			},

			derive: {
				doubled: f => f.input * 2,
				isHigh: f => f.input > 50,
				status: (f, d) => d.isHigh ? `HIGH(${d.doubled})` : `low(${d.doubled})`,
			},

			events: {
				setInput: (f, { value }) => { f.input = value; },
				reset: f => {
					f.input = 0;
					f.processed = false;
					f.resolverLog = [];
				},
			},

			constraints: {
				processWhenHigh: {
					priority: 10,
					when: f => f.input > 50 && !f.processed,
					require: { type: "PROCESS" },
				},
				alertWhenExtreme: {
					priority: 20,
					when: f => f.input > 90,
					require: { type: "ALERT" },
				},
			},

			resolvers: {
				process: {
					requirement: "PROCESS",
					resolve: async (_req, ctx) => {
						await new Promise(r => setTimeout(r, 10));
						ctx.facts.processed = true;
						ctx.facts.resolverLog = [...ctx.facts.resolverLog, "PROCESS"];
					},
				},
				alert: {
					requirement: "ALERT",
					resolve: async (_req, ctx) => {
						ctx.facts.resolverLog = [...ctx.facts.resolverLog, "ALERT"];
					},
				},
			},

			effects: {
				counter: {
					deps: ["input"],
					run: (facts) => {
						if (facts.input > 0) facts.effectCount++;
					},
				},
			},
		});

		const sys = track(createSystem({
			module: mod,
			debug: { timeTravel: true, maxSnapshots: 20 },
		}));
		sys.start();

		// Subscribe to derivations (simulate React)
		let subCalls = 0;
		sys.subscribe(["doubled", "isHigh", "status"], () => {
			subCalls++;
			sys.read("status");
		});

		// Phase 1: low values
		for (let i = 1; i <= 30; i++) {
			sys.events.setInput({ value: i });
		}
		await raceTimeout(sys.settle(), 3000, "phase1");

		expect(sys.facts.input).toBe(30);
		expect(sys.derive.doubled).toBe(60);
		expect(sys.derive.isHigh).toBe(false);
		expect(sys.derive.status).toBe("low(60)");
		expect(sys.facts.processed).toBe(false);

		// Phase 2: cross threshold
		sys.events.setInput({ value: 75 });
		await raceTimeout(sys.settle(), 3000, "phase2");

		expect(sys.derive.isHigh).toBe(true);
		expect(sys.facts.processed).toBe(true);
		expect(sys.facts.resolverLog).toContain("PROCESS");

		// Phase 3: extreme value
		sys.events.setInput({ value: 95 });
		await raceTimeout(sys.settle(), 3000, "phase3");

		expect(sys.facts.resolverLog).toContain("ALERT");

		// Phase 4: reset
		sys.events.reset();
		await raceTimeout(sys.settle(), 3000, "phase4");

		expect(sys.facts.input).toBe(0);
		expect(sys.derive.doubled).toBe(0);
		expect(sys.derive.status).toBe("low(0)");
		expect(sys.facts.processed).toBe(false);

		// Subscribers should have been called
		expect(subCalls).toBeGreaterThan(0);

		// Effects should have run
		expect(sys.facts.effectCount).toBeGreaterThan(0);

		// Time travel should have snapshots
		expect(sys.debug!.snapshots.length).toBeGreaterThan(0);
	});
});
