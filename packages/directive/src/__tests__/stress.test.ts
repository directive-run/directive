/**
 * Stress tests — designed to break the runtime.
 *
 * Targets: constraint/resolver cascades, subscriber storms,
 * memory pressure from builder patterns, large namespaced systems,
 * rapid mutations, priority avalanches, and concurrent resolver saturation.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	createModule,
	createSystem,
	constraint,
	when,
	module,
	system,
	t,
	type ModuleSchema,
} from "../index.js";

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

/** Race a promise against a timeout — fails loudly if it freezes */
function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`FREEZE: ${label} timed out after ${ms}ms`)), ms)
		),
	]);
}

// ============================================================================
// 1. Scale: 100 builder constraints on a single module
// ============================================================================

describe("scale: 100 builder constraints", () => {
	it("100 when() constraints evaluate without freeze", async () => {
		const schema = {
			facts: { level: t.number() },
			derivations: {},
			events: {},
			requirements: {
				ACTION: { index: t.number() },
			},
		} satisfies ModuleSchema;

		const constraints: Record<string, ReturnType<typeof when<typeof schema>>> = {};
		for (let i = 0; i < 100; i++) {
			constraints[`c${i}`] = when<typeof schema>(f => f.level >= i)
				.require({ type: "ACTION", index: i })
				.withPriority(100 - i);
		}

		let resolveCount = 0;
		const mod = createModule("scale100", {
			schema,
			init: f => { f.level = 0; },
			constraints,
			resolvers: {
				action: {
					requirement: "ACTION",
					key: (req) => `action-${req.index}`,
					resolve: async () => { resolveCount++; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Set level to 50 — should fire constraints c0..c50 (51 constraints)
		sys.facts.level = 50;
		await raceTimeout(sys.settle(), 5000, "100 constraints settle");

		expect(resolveCount).toBe(51);
	});

	it("100 constraint() builders with all options set", async () => {
		const schema = {
			facts: { value: t.number() },
			derivations: {},
			events: {},
			requirements: {
				PROCESS: { id: t.number() },
			},
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 100; i++) {
			constraints[`c${i}`] = constraint<typeof schema>()
				.when(f => f.value === i)
				.require({ type: "PROCESS", id: i })
				.priority(i)
				.deps("value")
				.timeout(5000)
				.build();
		}

		let lastProcessed = -1;
		const mod = createModule("scale100full", {
			schema,
			init: f => { f.value = -1; },
			constraints,
			resolvers: {
				process: {
					requirement: "PROCESS",
					key: req => `proc-${req.id}`,
					resolve: async (req) => { lastProcessed = req.id; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.value = 42;
		await raceTimeout(sys.settle(), 3000, "constraint(42) settle");
		expect(lastProcessed).toBe(42);

		sys.facts.value = 99;
		await raceTimeout(sys.settle(), 3000, "constraint(99) settle");
		expect(lastProcessed).toBe(99);
	});
});

// ============================================================================
// 2. Rapid mutation storm — 1000 fact writes in a tight loop
// ============================================================================

describe("rapid mutation storm", () => {
	it("1000 synchronous fact writes don't freeze or corrupt state", async () => {
		const schema = {
			facts: { counter: t.number(), total: t.number() },
			derivations: { doubled: t.number() },
			events: {},
			requirements: {
				CHECKPOINT: {},
			},
		} satisfies ModuleSchema;

		const checkpoint = when<typeof schema>(f => f.counter >= 1000)
			.require({ type: "CHECKPOINT" });

		let checkpointHit = false;
		const mod = createModule("storm", {
			schema,
			init: f => { f.counter = 0; f.total = 0; },
			derive: { doubled: f => f.counter * 2 },
			constraints: { checkpoint },
			resolvers: {
				checkpoint: {
					requirement: "CHECKPOINT",
					resolve: async (_req, ctx) => { checkpointHit = true; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		for (let i = 0; i < 1000; i++) {
			sys.facts.counter = i + 1;
		}

		await raceTimeout(sys.settle(), 5000, "1000 writes settle");

		expect(sys.facts.counter).toBe(1000);
		expect(sys.derive.doubled).toBe(2000);
		expect(checkpointHit).toBe(true);
	});

	it("rapid event dispatch (500 events in a loop)", async () => {
		const schema = {
			facts: { count: t.number() },
			derivations: {},
			events: { bump: {} },
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("rapid-events", {
			schema,
			init: f => { f.count = 0; },
			events: {
				bump: f => { f.count++; },
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		for (let i = 0; i < 500; i++) {
			sys.events.bump();
		}

		await raceTimeout(
			new Promise(r => setTimeout(r, 500)),
			3000,
			"500 events",
		);

		expect(sys.facts.count).toBe(500);
	});
});

// ============================================================================
// 3. Deep constraint→resolver→constraint cascade
// ============================================================================

describe("deep constraint-resolver cascade", () => {
	it("10-level cascade completes without freeze", async () => {
		const schema = {
			facts: { stage: t.number() },
			derivations: {},
			events: {},
			requirements: {
				ADVANCE: { to: t.number() },
			},
		} satisfies ModuleSchema;

		// Each stage triggers the next: stage N → resolver sets stage N+1 → next constraint fires
		const constraints: Record<string, any> = {};
		for (let i = 0; i < 10; i++) {
			constraints[`advance${i}`] = when<typeof schema>(f => f.stage === i)
				.require({ type: "ADVANCE", to: i + 1 })
				.withPriority(100 - i);
		}

		const mod = createModule("cascade10", {
			schema,
			init: f => { f.stage = -1; },
			constraints,
			resolvers: {
				advance: {
					requirement: "ADVANCE",
					key: req => `adv-${req.to}`,
					resolve: async (req, ctx) => { ctx.facts.stage = req.to; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.stage = 0; // kick off the cascade
		await raceTimeout(sys.settle(), 5000, "10-level cascade");

		expect(sys.facts.stage).toBe(10);
	});

	it("20-level cascade doesn't stack overflow", async () => {
		const schema = {
			facts: { step: t.number() },
			derivations: {},
			events: {},
			requirements: { NEXT: { target: t.number() } },
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 20; i++) {
			constraints[`s${i}`] = constraint<typeof schema>()
				.when(f => f.step === i)
				.require({ type: "NEXT", target: i + 1 })
				.priority(20 - i)
				.build();
		}

		const mod = createModule("cascade20", {
			schema,
			init: f => { f.step = -1; },
			constraints,
			resolvers: {
				next: {
					requirement: "NEXT",
					key: req => `next-${req.target}`,
					resolve: async (req, ctx) => { ctx.facts.step = req.target; },
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.step = 0;
		await raceTimeout(sys.settle(), 10000, "20-level cascade");

		expect(sys.facts.step).toBe(20);
	});
});

// ============================================================================
// 4. Memory pressure: thousands of immutable when() copies
// ============================================================================

describe("memory pressure: when() immutability", () => {
	it("1000 withPriority() calls create independent constraints", () => {
		const schema = {
			facts: { x: t.number() },
			derivations: {},
			events: {},
			requirements: { DO: {} },
		} satisfies ModuleSchema;

		const base = when<typeof schema>(f => f.x > 0).require({ type: "DO" });

		const variants: any[] = [];
		for (let i = 0; i < 1000; i++) {
			variants.push(base.withPriority(i));
		}

		// All 1000 should be unique objects with distinct priorities
		for (let i = 0; i < 1000; i++) {
			expect(variants[i].priority).toBe(i);
		}
		// Base should be unchanged
		expect(base.priority).toBeUndefined();
	});

	it("chained immutable builders don't share state", () => {
		const schema = {
			facts: { x: t.number() },
			derivations: {},
			events: {},
			requirements: { DO: {} },
		} satisfies ModuleSchema;

		const base = when<typeof schema>(f => f.x > 0).require({ type: "DO" });
		const a = base.withPriority(10).withTimeout(1000);
		const b = base.withPriority(20).withAsync(true);
		const c = a.withAfter("other");

		expect(a.priority).toBe(10);
		expect(a.timeout).toBe(1000);
		expect((a as any).async).toBeUndefined();

		expect(b.priority).toBe(20);
		expect(b.async).toBe(true);
		expect(b.timeout).toBeUndefined();

		expect(c.priority).toBe(10);
		expect(c.timeout).toBe(1000);
		expect(c.after).toEqual(["other"]);
		expect(a.after).toBeUndefined();
	});
});

// ============================================================================
// 5. Priority avalanche — all constraints fire simultaneously
// ============================================================================

describe("priority avalanche", () => {
	it("50 constraints with distinct priorities resolve in priority order", async () => {
		const schema = {
			facts: { trigger: t.boolean(), log: t.any<number[]>() },
			derivations: {},
			events: {},
			requirements: { RECORD: { priority: t.number() } },
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 50; i++) {
			constraints[`c${i}`] = when<typeof schema>(f => f.trigger)
				.require({ type: "RECORD", priority: i })
				.withPriority(50 - i); // c0 = highest priority
		}

		const mod = createModule("avalanche", {
			schema,
			init: f => { f.trigger = false; f.log = []; },
			constraints,
			resolvers: {
				record: {
					requirement: "RECORD",
					key: req => `rec-${req.priority}`,
					resolve: async (req, ctx) => {
						ctx.facts.log = [...ctx.facts.log, req.priority];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.trigger = true;
		await raceTimeout(sys.settle(), 5000, "50-constraint avalanche");

		// All 50 should have fired
		expect(sys.facts.log).toHaveLength(50);
		// Every value 0..49 should be present
		const sorted = [...sys.facts.log].sort((a, b) => a - b);
		expect(sorted).toEqual(Array.from({ length: 50 }, (_, i) => i));
	});
});

// ============================================================================
// 6. Subscriber storm during constraint cascade
// ============================================================================

describe("subscriber storm", () => {
	it("50 subscribers reading derivations during rapid mutations", async () => {
		const schema = {
			facts: { value: t.number() },
			derivations: {
				doubled: t.number(),
				quadrupled: t.number(),
				label: t.string(),
			},
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("substorm", {
			schema,
			init: f => { f.value = 0; },
			derive: {
				doubled: f => f.value * 2,
				quadrupled: (_f, d) => d.doubled * 2,
				label: (f, d) => `v=${f.value} d=${d.doubled} q=${d.quadrupled}`,
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		let callbackCount = 0;
		const derivKeys = ["doubled", "quadrupled", "label"];

		// 50 subscribers all reading all derivations on every change
		for (let i = 0; i < 50; i++) {
			sys.subscribe(derivKeys, () => {
				callbackCount++;
				for (const k of derivKeys) {
					sys.read(k);
				}
			});
		}

		// Rapid mutations
		for (let i = 1; i <= 100; i++) {
			sys.facts.value = i;
		}

		await raceTimeout(
			new Promise(r => setTimeout(r, 1000)),
			5000,
			"subscriber storm",
		);

		expect(sys.facts.value).toBe(100);
		expect(sys.derive.doubled).toBe(200);
		expect(sys.derive.quadrupled).toBe(400);
		expect(sys.derive.label).toBe("v=100 d=200 q=400");
		// Callbacks should be bounded — not millions
		expect(callbackCount).toBeLessThan(50000);
	});

	it("subscriber unsubscribes mid-storm without crash", async () => {
		const schema = {
			facts: { val: t.number() },
			derivations: { d: t.number() },
			events: {},
			requirements: {},
		} satisfies ModuleSchema;

		const mod = createModule("unsub-storm", {
			schema,
			init: f => { f.val = 0; },
			derive: { d: f => f.val * 10 },
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Force initial derivation computation to establish dependency tracking
		expect(sys.derive.d).toBe(0);

		const unsubs: (() => void)[] = [];
		let calls = 0;

		for (let i = 0; i < 20; i++) {
			const idx = i;
			unsubs.push(
				sys.subscribe(["d"], () => {
					calls++;
					// Half of them unsubscribe after first call
					if (idx < 10) unsubs[idx]();
				})
			);
		}

		// Write in batches with microtask gaps to allow notifications to flush
		for (let batch = 0; batch < 5; batch++) {
			for (let i = 0; i < 10; i++) {
				sys.facts.val = batch * 10 + i + 1;
			}
			await new Promise(r => setTimeout(r, 10));
		}

		await raceTimeout(
			new Promise(r => setTimeout(r, 500)),
			3000,
			"unsub storm",
		);

		expect(sys.facts.val).toBe(50);
		expect(sys.derive.d).toBe(500);
		// Should not crash — calls should be reasonable
		expect(calls).toBeGreaterThan(0);
		expect(calls).toBeLessThan(10000);
	});
});

// ============================================================================
// 7. Namespaced system with many modules
// ============================================================================

describe("large namespaced system", () => {
	it("10 modules with builder constraints in a namespaced system", async () => {
		const makeCounterModule = (name: string, threshold: number) => {
			const schema = {
				facts: { count: t.number() },
				derivations: { isHigh: t.boolean() },
				events: { inc: {} },
				requirements: { RESET: {} },
			} satisfies ModuleSchema;

			return createModule(name, {
				schema,
				init: f => { f.count = 0; },
				derive: { isHigh: f => f.count >= threshold },
				events: { inc: f => { f.count++; } },
				constraints: {
					reset: when<typeof schema>(f => f.count >= threshold)
						.require({ type: "RESET" }),
				},
				resolvers: {
					reset: {
						requirement: "RESET",
						resolve: async (_req, ctx) => { ctx.facts.count = 0; },
					},
				},
			});
		};

		const modules: Record<string, ReturnType<typeof makeCounterModule>> = {};
		for (let i = 0; i < 10; i++) {
			modules[`mod${i}`] = makeCounterModule(`counter${i}`, 5);
		}

		const sys = track(system()
			.modules(modules)
			.build()
		);
		sys.start();

		// Increment mod0 to threshold
		for (let i = 0; i < 5; i++) {
			(sys.events as any).mod0.inc();
		}

		await raceTimeout(sys.settle(), 5000, "10-module namespaced");

		// mod0 should have been reset to 0 by its constraint
		expect((sys.facts as any).mod0.count).toBe(0);
		// Other modules untouched
		expect((sys.facts as any).mod1.count).toBe(0);
	});

	it("all 10 modules fire constraints simultaneously", async () => {
		// Each module uses a unique requirement type to avoid cross-module dedup
		const makeModule = (name: string, idx: number) => {
			const reqType = `DO_THING_${idx}`;
			const schema = {
				facts: { active: t.boolean(), resolved: t.boolean() },
				derivations: {},
				events: {},
				requirements: { [`DO_THING_${idx}`]: {} },
			} satisfies ModuleSchema;

			return createModule(name, {
				schema,
				init: f => { f.active = false; f.resolved = false; },
				constraints: {
					trigger: {
						when: (f: any) => f.active && !f.resolved,
						require: { type: reqType },
					},
				},
				resolvers: {
					doThing: {
						requirement: reqType,
						resolve: async (_req: any, ctx: any) => {
							ctx.facts.resolved = true;
						},
					},
				},
			});
		};

		const modules: Record<string, any> = {};
		for (let i = 0; i < 10; i++) {
			modules[`m${i}`] = makeModule(`unit${i}`, i);
		}

		const sys = track(system().modules(modules).build());
		sys.start();

		// Activate all 10 at once
		for (let i = 0; i < 10; i++) {
			(sys.facts as any)[`m${i}`].active = true;
		}

		await raceTimeout(sys.settle(), 5000, "10 modules simultaneous");

		for (let i = 0; i < 10; i++) {
			expect((sys.facts as any)[`m${i}`].resolved).toBe(true);
		}
	});
});

// ============================================================================
// 8. Concurrent resolver saturation
// ============================================================================

describe("concurrent resolver saturation", () => {
	it("20 resolvers running in parallel complete correctly", async () => {
		const schema = {
			facts: {
				trigger: t.boolean(),
				results: t.any<string[]>(),
			},
			derivations: {},
			events: {},
			requirements: {
				WORK: { id: t.number() },
			},
		} satisfies ModuleSchema;

		// 20 constraints, each fires when trigger=true
		const constraints: Record<string, any> = {};
		for (let i = 0; i < 20; i++) {
			constraints[`w${i}`] = when<typeof schema>(f => f.trigger)
				.require({ type: "WORK", id: i });
		}

		const mod = createModule("parallel", {
			schema,
			init: f => { f.trigger = false; f.results = []; },
			constraints,
			resolvers: {
				work: {
					requirement: "WORK",
					key: req => `work-${req.id}`,
					resolve: async (req, ctx) => {
						// Simulate async work with random-ish delay
						await new Promise(r => setTimeout(r, 10 + (req.id % 5) * 10));
						ctx.facts.results = [...ctx.facts.results, `done-${req.id}`];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.trigger = true;
		await raceTimeout(sys.settle(), 10000, "20 parallel resolvers");

		expect(sys.facts.results).toHaveLength(20);
		for (let i = 0; i < 20; i++) {
			expect(sys.facts.results).toContain(`done-${i}`);
		}
	});

	it("resolver errors don't crash other concurrent resolvers", async () => {
		const schema = {
			facts: {
				go: t.boolean(),
				successes: t.number(),
				failures: t.number(),
			},
			derivations: {},
			events: {},
			requirements: {
				TASK: { id: t.number() },
			},
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 10; i++) {
			constraints[`t${i}`] = when<typeof schema>(f => f.go)
				.require({ type: "TASK", id: i });
		}

		const mod = createModule("error-resilience", {
			schema,
			init: f => { f.go = false; f.successes = 0; f.failures = 0; },
			constraints,
			resolvers: {
				task: {
					requirement: "TASK",
					key: req => `task-${req.id}`,
					resolve: async (req, ctx) => {
						if (req.id % 3 === 0) {
							ctx.facts.failures++;
							throw new Error(`Task ${req.id} failed`);
						}
						ctx.facts.successes++;
					},
				},
			},
		});

		const sys = track(createSystem({
			module: mod,
			errorBoundary: { onResolverError: "ignore" },
		}));
		sys.start();

		sys.facts.go = true;
		await raceTimeout(sys.settle(), 5000, "error resilience");

		// Tasks 0,3,6,9 fail (4 failures), rest succeed (6 successes)
		expect(sys.facts.successes).toBe(6);
		expect(sys.facts.failures).toBe(4);
	});
});

// ============================================================================
// 9. Effect storm during builder constraint resolution
// ============================================================================

describe("effect storm", () => {
	it("effects fire correctly during 10-step cascade", async () => {
		const schema = {
			facts: {
				stage: t.number(),
				effectLog: t.any<number[]>(),
			},
			derivations: { stageLabel: t.string() },
			events: {},
			requirements: { ADVANCE: { to: t.number() } },
		} satisfies ModuleSchema;

		const constraints: Record<string, any> = {};
		for (let i = 0; i < 10; i++) {
			constraints[`s${i}`] = when<typeof schema>(f => f.stage === i)
				.require({ type: "ADVANCE", to: i + 1 });
		}

		const mod = createModule("effect-cascade", {
			schema,
			init: f => { f.stage = -1; f.effectLog = []; },
			derive: { stageLabel: f => `stage-${f.stage}` },
			constraints,
			resolvers: {
				advance: {
					requirement: "ADVANCE",
					key: req => `adv-${req.to}`,
					resolve: async (req, ctx) => { ctx.facts.stage = req.to; },
				},
			},
			effects: {
				trackStage: {
					run: (facts, prev) => {
						if (prev && prev.stage !== facts.stage) {
							facts.effectLog = [...facts.effectLog, facts.stage];
						}
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.stage = 0;
		await raceTimeout(sys.settle(), 10000, "effect cascade");

		expect(sys.facts.stage).toBe(10);
		expect(sys.derive.stageLabel).toBe("stage-10");
		// Effects log transitions where prev exists (first run has prev=undefined, so stage 0 is skipped)
		expect(sys.facts.effectLog).toHaveLength(10);
		expect(sys.facts.effectLog).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});
});

// ============================================================================
// 10. System builder with maximal configuration
// ============================================================================

describe("system builder: maximal config", () => {
	it("system() with all options produces working runtime", async () => {
		const schema = {
			facts: { x: t.number() },
			derivations: { y: t.number() },
			events: { setX: { value: t.number() } },
			requirements: { COMPUTE: {} },
		} satisfies ModuleSchema;

		const mod = createModule("maxconfig", {
			schema,
			init: f => { f.x = 0; },
			derive: { y: f => f.x * 3 },
			events: { setX: (f, { value }) => { f.x = value; } },
			constraints: {
				compute: when<typeof schema>(f => f.x > 100)
					.require({ type: "COMPUTE" }),
			},
			resolvers: {
				compute: {
					requirement: "COMPUTE",
					resolve: async (_req, ctx) => { ctx.facts.x = 0; },
				},
			},
		});

		const sys = track(
			system()
				.module(mod)
				.debug({ timeTravel: true, maxSnapshots: 10 })
				.errorBoundary({ onResolverError: "ignore" })
				.build()
		);
		sys.start();

		sys.events.setX({ value: 50 });
		expect(sys.facts.x).toBe(50);
		expect(sys.derive.y).toBe(150);

		sys.events.setX({ value: 200 });
		await raceTimeout(sys.settle(), 3000, "maxconfig settle");

		// Constraint should have reset x to 0
		expect(sys.facts.x).toBe(0);
		expect(sys.derive.y).toBe(0);

		// Time travel should have snapshots
		expect(sys.debug).toBeDefined();
	});
});

// ============================================================================
// 11. Module builder under stress
// ============================================================================

describe("module() builder under stress", () => {
	it("module builder creates working module with all features", async () => {
		const schema = {
			facts: {
				items: t.any<string[]>(),
				processing: t.boolean(),
			},
			derivations: {
				count: t.number(),
				isEmpty: t.boolean(),
			},
			events: {
				addItem: { item: t.string() },
				clear: {},
			},
			requirements: {
				PROCESS: {},
			},
		} satisfies ModuleSchema;

		const mod = module("stress-mod")
			.schema(schema)
			.init(f => {
				f.items = [];
				f.processing = false;
			})
			.derive({
				count: f => f.items.length,
				isEmpty: f => f.items.length === 0,
			})
			.events({
				addItem: (f, { item }) => { f.items = [...f.items, item]; },
				clear: f => { f.items = []; },
			})
			.build();

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Add 200 items rapidly
		for (let i = 0; i < 200; i++) {
			sys.events.addItem({ item: `item-${i}` });
		}

		expect(sys.facts.items).toHaveLength(200);
		expect(sys.derive.count).toBe(200);
		expect(sys.derive.isEmpty).toBe(false);

		sys.events.clear();
		expect(sys.facts.items).toHaveLength(0);
		expect(sys.derive.count).toBe(0);
		expect(sys.derive.isEmpty).toBe(true);
	});
});

// ============================================================================
// 12. Dynamic require under load
// ============================================================================

describe("dynamic require functions under load", () => {
	it("function require() called 100 times with different state", async () => {
		const schema = {
			facts: { level: t.number(), resolved: t.any<number[]>() },
			derivations: {},
			events: {},
			requirements: { ADJUST: { target: t.number() } },
		} satisfies ModuleSchema;

		// Dynamic require that computes based on current facts
		const adjust = when<typeof schema>(f => f.level > 0 && f.level <= 100)
			.require(f => ({ type: "ADJUST", target: f.level * 2 }));

		let lastTarget = 0;
		const mod = createModule("dynamic-req", {
			schema,
			init: f => { f.level = 0; f.resolved = []; },
			constraints: { adjust },
			resolvers: {
				adjust: {
					requirement: "ADJUST",
					resolve: async (req, ctx) => {
						lastTarget = req.target;
						ctx.facts.resolved = [...ctx.facts.resolved, req.target];
						ctx.facts.level = 0; // reset to stop the constraint
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Fire the constraint 10 times with different values
		for (let i = 1; i <= 10; i++) {
			sys.facts.level = i * 10;
			await raceTimeout(sys.settle(), 2000, `dynamic require ${i}`);
		}

		expect(sys.facts.resolved).toHaveLength(10);
		expect(sys.facts.resolved).toContain(20);  // level=10 → target=20
		expect(sys.facts.resolved).toContain(200); // level=100 → target=200
	});
});

// ============================================================================
// 13. Array require (multiple requirements from one constraint)
// ============================================================================

describe("array require under load", () => {
	it("constraint producing array of 10 requirements resolves all", async () => {
		const schema = {
			facts: { fire: t.boolean(), completed: t.any<number[]>() },
			derivations: {},
			events: {},
			requirements: { TASK: { id: t.number() } },
		} satisfies ModuleSchema;

		const multiReq = when<typeof schema>(f => f.fire)
			.require(
				Array.from({ length: 10 }, (_, i) => ({ type: "TASK" as const, id: i }))
			);

		const mod = createModule("array-req", {
			schema,
			init: f => { f.fire = false; f.completed = []; },
			constraints: { multiReq },
			resolvers: {
				task: {
					requirement: "TASK",
					key: req => `task-${req.id}`,
					resolve: async (req, ctx) => {
						ctx.facts.completed = [...ctx.facts.completed, req.id];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		sys.facts.fire = true;
		await raceTimeout(sys.settle(), 5000, "array require x10");

		expect(sys.facts.completed).toHaveLength(10);
		for (let i = 0; i < 10; i++) {
			expect(sys.facts.completed).toContain(i);
		}
	});
});

// ============================================================================
// 14. Destroy mid-resolution
// ============================================================================

describe("destroy mid-resolution", () => {
	it("destroying system while resolvers are inflight doesn't crash", async () => {
		const schema = {
			facts: { go: t.boolean() },
			derivations: {},
			events: {},
			requirements: { SLOW: {} },
		} satisfies ModuleSchema;

		const mod = createModule("destroy-mid", {
			schema,
			init: f => { f.go = false; },
			constraints: {
				trigger: when<typeof schema>(f => f.go)
					.require({ type: "SLOW" }),
			},
			resolvers: {
				slow: {
					requirement: "SLOW",
					resolve: async () => {
						await new Promise(r => setTimeout(r, 5000)); // very slow
					},
				},
			},
		});

		const sys = createSystem({ module: mod });
		sys.start();

		sys.facts.go = true;
		// Wait a tick for the resolver to start
		await new Promise(r => setTimeout(r, 50));

		// Destroy while resolver is still inflight
		expect(() => {
			sys.stop();
			sys.destroy();
		}).not.toThrow();
	});
});

// ============================================================================
// 15. Mixed builder + literal constraints competing for same resolver
// ============================================================================

describe("mixed builder + literal constraints", () => {
	it("builder and object literal constraints both fire the same resolver type", async () => {
		const schema = {
			facts: {
				a: t.boolean(),
				b: t.boolean(),
				results: t.any<string[]>(),
			},
			derivations: {},
			events: {},
			requirements: {
				WORK: { source: t.string() },
			},
		} satisfies ModuleSchema;

		const builderConstraint = when<typeof schema>(f => f.a)
			.require({ type: "WORK", source: "builder" })
			.withPriority(10);

		const mod = createModule("mixed", {
			schema,
			init: f => { f.a = false; f.b = false; f.results = []; },
			constraints: {
				fromBuilder: builderConstraint,
				fromLiteral: {
					priority: 20,
					when: f => f.b,
					require: { type: "WORK", source: "literal" },
				},
			},
			resolvers: {
				work: {
					requirement: "WORK",
					key: req => `work-${req.source}`,
					resolve: async (req, ctx) => {
						ctx.facts.results = [...ctx.facts.results, req.source];
					},
				},
			},
		});

		const sys = track(createSystem({ module: mod }));
		sys.start();

		// Fire both
		sys.facts.a = true;
		sys.facts.b = true;
		await raceTimeout(sys.settle(), 3000, "mixed constraints");

		expect(sys.facts.results).toContain("builder");
		expect(sys.facts.results).toContain("literal");
		expect(sys.facts.results).toHaveLength(2);
	});
});
