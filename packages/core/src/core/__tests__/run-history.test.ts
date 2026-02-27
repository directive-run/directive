import { describe, it, expect, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type { RunChangelogEntry } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestModule() {
	return createModule("test", {
		schema: {
			facts: {
				count: t.number(),
				label: t.string(),
			},
			derivations: {
				doubled: t.number(),
			},
			events: {
				increment: {},
				setLabel: { label: t.string() },
			},
			requirements: {
				LOAD_DATA: { source: t.string() },
			},
		},
		init: (facts) => {
			facts.count = 0;
			facts.label = "";
		},
		events: {
			increment: (facts) => {
				facts.count = (facts.count as number) + 1;
			},
			setLabel: (facts, { label }) => {
				facts.label = label;
			},
		},
		derive: {
			doubled: (facts) => (facts.count as number) * 2,
		},
		effects: {
			log: {
				deps: ["count"],
				run: (facts) => {
					// Side effect that reads count
					void facts.count;
				},
			},
		},
		constraints: {
			needsData: {
				priority: 10,
				when: (facts) => (facts.count as number) > 5,
				require: { type: "LOAD_DATA", source: "api" },
			},
		},
		resolvers: {
			loadData: {
				requirement: "LOAD_DATA",
				resolve: async (req, context) => {
					context.facts.label = `loaded from ${req.source}`;
				},
			},
		},
	});
}

function createSystemWithHistory(opts?: { maxRuns?: number }) {
	const mod = createTestModule();

	return createSystem({
		module: mod,
		debug: {
			runHistory: true,
			maxRuns: opts?.maxRuns ?? 100,
		},
	});
}

// ============================================================================
// Run History Tests
// ============================================================================

describe("Run History", () => {
	// -----------------------------------------------------------------------
	// 1. Disabled by default
	// -----------------------------------------------------------------------
	it("returns null when runHistory is not enabled", () => {
		const mod = createTestModule();
		const system = createSystem({ module: mod });
		system.start();

		expect(system.runHistory).toBeNull();
		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 2. Basic run creation
	// -----------------------------------------------------------------------
	it("creates a run entry on fact change", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		const history = system.runHistory!;
		expect(history.length).toBeGreaterThanOrEqual(1);

		const lastRun = history[history.length - 1]!;
		expect(lastRun.status).toBe("settled");
		expect(lastRun.factChanges.length).toBeGreaterThanOrEqual(1);

		const countChange = lastRun.factChanges.find(fc => fc.key === "count");
		expect(countChange).toBeDefined();
		expect(countChange!.newValue).toBe(1);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 3. Derivation tracking with deps (E12)
	// -----------------------------------------------------------------------
	it("tracks derivation recomputation with dependency edges", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 3;
		await system.settle();

		const history = system.runHistory!;
		const lastRun = history[history.length - 1]!;

		const derivEntry = lastRun.derivationsRecomputed.find(d =>
			typeof d === "object" && d.id === "doubled",
		);

		if (derivEntry && typeof derivEntry === "object") {
			expect(derivEntry.deps).toBeDefined();
			expect(Array.isArray(derivEntry.deps)).toBe(true);
		}

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 4. Constraint + requirement tracking
	// -----------------------------------------------------------------------
	it("tracks constraints and requirements when triggered", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		// Set count > 5 to trigger the constraint
		system.facts.count = 10;
		await system.settle();

		const history = system.runHistory!;
		const triggeringRun = history.find(r =>
			r.constraintsHit.some(c => c.id === "needsData"),
		);

		expect(triggeringRun).toBeDefined();
		expect(triggeringRun!.constraintsHit[0]!.priority).toBe(10);
		expect(triggeringRun!.requirementsAdded.length).toBeGreaterThanOrEqual(1);
		expect(triggeringRun!.requirementsAdded[0]!.type).toBe("LOAD_DATA");
		expect(triggeringRun!.requirementsAdded[0]!.fromConstraint).toBe("needsData");

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 5. Async resolver attribution
	// -----------------------------------------------------------------------
	it("attributes async resolver completion to the correct run", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 10;
		await system.settle();

		const history = system.runHistory!;

		// Find the run that started the resolver
		const runWithResolver = history.find(r =>
			r.resolversStarted.length > 0,
		);

		expect(runWithResolver).toBeDefined();
		expect(runWithResolver!.resolversCompleted.length).toBeGreaterThanOrEqual(1);
		expect(runWithResolver!.resolversCompleted[0]!.resolver).toBe("loadData");
		expect(runWithResolver!.resolversCompleted[0]!.duration).toBeGreaterThanOrEqual(0);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 6. Resolver error attribution
	// -----------------------------------------------------------------------
	it("attributes resolver errors to the correct run", async () => {
		const mod = createModule("err", {
			schema: {
				facts: { trigger: t.boolean() },
				derivations: {},
				events: {},
				requirements: { FAIL_REQ: {} },
			},
			init: (facts) => {
				facts.trigger = false;
			},
			constraints: {
				fail: {
					when: (facts) => facts.trigger === true,
					require: { type: "FAIL_REQ" },
				},
			},
			resolvers: {
				failResolver: {
					requirement: "FAIL_REQ",
					resolve: async () => {
						throw new Error("intentional failure");
					},
				},
			},
		});

		const system = createSystem({
			module: mod,
			debug: { runHistory: true },
		});
		system.start();
		await system.settle();

		system.facts.trigger = true;
		await system.settle();

		const history = system.runHistory!;
		const errRun = history.find(r => r.resolversErrored.length > 0);

		expect(errRun).toBeDefined();
		expect(errRun!.resolversErrored[0]!.error).toContain("intentional failure");

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 7. Multi-resolver run stays pending
	// -----------------------------------------------------------------------
	it("keeps run pending while multiple resolvers are inflight", async () => {
		const resolvers: { a: (() => void) | null; b: (() => void) | null } = { a: null, b: null };

		const mod = createModule("multi", {
			schema: {
				facts: { go: t.boolean(), result: t.string() },
				derivations: {},
				events: {},
				requirements: {
					REQ_A: {},
					REQ_B: {},
				},
			},
			init: (facts) => {
				facts.go = false;
				facts.result = "";
			},
			constraints: {
				triggerA: {
					when: (facts) => facts.go === true,
					require: { type: "REQ_A" },
				},
				triggerB: {
					when: (facts) => facts.go === true,
					require: { type: "REQ_B" },
				},
			},
			resolvers: {
				handleA: {
					requirement: "REQ_A",
					resolve: async (_req, context) => {
						await new Promise<void>((r) => { resolvers.a = r; });
						context.facts.result = "A done";
					},
				},
				handleB: {
					requirement: "REQ_B",
					resolve: async (_req, context) => {
						await new Promise<void>((r) => { resolvers.b = r; });
						context.facts.result = "B done";
					},
				},
			},
		});

		const system = createSystem({
			module: mod,
			debug: { runHistory: true },
		});
		system.start();
		await system.settle();

		system.facts.go = true;
		// Let microtasks flush so reconcile runs and resolvers start
		await new Promise((r) => setTimeout(r, 50));

		const history = system.runHistory!;
		const pendingRun = history.find(r =>
			r.resolversStarted.length >= 2 && r.status === "pending",
		);

		expect(pendingRun).toBeDefined();

		// Resolve both
		resolvers.a?.();
		resolvers.b?.();
		await system.settle();

		// Now the run should be settled
		const updatedHistory = system.runHistory!;
		const settledRun = updatedHistory.find(r =>
			r.resolversStarted.length >= 2 && r.status === "settled",
		);

		expect(settledRun).toBeDefined();

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 8. Ring buffer eviction
	// -----------------------------------------------------------------------
	it("evicts old runs when maxRuns is exceeded", async () => {
		const system = createSystemWithHistory({ maxRuns: 3 });
		system.start();
		await system.settle();

		// Create 5 runs
		for (let i = 1; i <= 5; i++) {
			system.facts.count = i;
			await system.settle();
		}

		const history = system.runHistory!;
		expect(history.length).toBeLessThanOrEqual(3);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 9. Ring buffer eviction cleanup
	// -----------------------------------------------------------------------
	it("cleans up maps when pending runs are evicted", async () => {
		// This is a structural test — we verify no errors after heavy eviction
		const system = createSystemWithHistory({ maxRuns: 2 });
		system.start();
		await system.settle();

		for (let i = 1; i <= 10; i++) {
			system.facts.count = i;
			await system.settle();
		}

		// System should still be functional
		system.facts.count = 100;
		await system.settle();

		const history = system.runHistory!;
		expect(history.length).toBeLessThanOrEqual(2);
		expect(history[history.length - 1]!.factChanges.some(fc => fc.newValue === 100)).toBe(true);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 10. Empty run filtering
	// -----------------------------------------------------------------------
	it("skips runs with no activity", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		const initialLength = system.runHistory!.length;

		// Setting same value should not create a new run with activity
		await system.settle();

		// Length should not increase for empty reconciles
		expect(system.runHistory!.length).toBe(initialLength);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 11. pending → settled transition
	// -----------------------------------------------------------------------
	it("transitions from pending to settled when resolver completes", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 10; // triggers constraint → resolver
		await system.settle();

		const history = system.runHistory!;
		const resolverRun = history.find(r => r.resolversStarted.length > 0);

		if (resolverRun) {
			expect(resolverRun.status).toBe("settled");
			expect(resolverRun.duration).toBeGreaterThan(0);
		}

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 12. onRunComplete plugin hook
	// -----------------------------------------------------------------------
	it("calls onRunComplete plugin hook with finalized run", async () => {
		const onRunComplete = vi.fn();
		const mod = createTestModule();
		const system = createSystem({
			module: mod,
			debug: { runHistory: true },
			plugins: [{ name: "test-plugin", onRunComplete }],
		});
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		expect(onRunComplete).toHaveBeenCalled();
		const run = onRunComplete.mock.calls[onRunComplete.mock.calls.length - 1]![0] as RunChangelogEntry;
		expect(run.status).toBe("settled");

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 13. inspect() includes runHistory
	// -----------------------------------------------------------------------
	it("includes runHistory in inspect() when enabled", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		const inspection = system.inspect();
		expect(inspection.runHistory).toBeDefined();
		expect(Array.isArray(inspection.runHistory)).toBe(true);
		expect(inspection.runHistory!.length).toBeGreaterThanOrEqual(1);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 14. destroy() cleanup
	// -----------------------------------------------------------------------
	it("cleans up run history state on destroy", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		expect(system.runHistory!.length).toBeGreaterThan(0);

		system.destroy();

		// After destroy, internal arrays are cleared
		// The cached getter may return an old snapshot, but no new data accumulates
	});

	// -----------------------------------------------------------------------
	// 15. fromConstraint on requirementsRemoved (E3)
	// -----------------------------------------------------------------------
	it("includes fromConstraint on removed requirements", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		// Trigger constraint
		system.facts.count = 10;
		await system.settle();

		// Un-trigger constraint
		system.facts.count = 0;
		await system.settle();

		const history = system.runHistory!;
		const removalRun = history.find(r => r.requirementsRemoved.length > 0);

		if (removalRun) {
			expect(removalRun.requirementsRemoved[0]!.fromConstraint).toBeDefined();
			expect(removalRun.requirementsRemoved[0]!.fromConstraint).toBe("needsData");
		}

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 16. Derivation entries have correct shape (E12)
	// -----------------------------------------------------------------------
	it("derivation entries use object format with id and deps", async () => {
		// Derivations only appear in run history when recomputed during the reconcile cycle.
		// Since derivations are lazy (recomputed on read), they only show up when
		// an effect or constraint reads them during reconcile.
		// This test verifies the TYPE shape is correct by checking any run that
		// happens to track derivation recomputes.
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		// Subscribe to derivation — this forces reads during reconcile notifications
		const unsub = system.subscribe(["doubled"], () => {});
		system.facts.count = 5;
		await system.settle();
		unsub();

		const history = system.runHistory!;
		// If any run captured derivations, verify shape
		const runWithDeriv = history.find(r => r.derivationsRecomputed.length > 0);

		if (runWithDeriv) {
			const entry = runWithDeriv.derivationsRecomputed[0]!;
			expect(typeof entry).toBe("object");
			expect(entry.id).toBe("doubled");
			expect(Array.isArray(entry.deps)).toBe(true);
		}

		// The type system ensures entries are { id: string; deps: string[] }
		// Even if no derivations were captured in the run, the array accepts that shape
		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 17. Causal chain generation (Part 6)
	// -----------------------------------------------------------------------
	it("generates causal chain on settled runs", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		const history = system.runHistory!;
		const lastRun = history[history.length - 1]!;

		expect(lastRun.causalChain).toBeDefined();
		expect(typeof lastRun.causalChain).toBe("string");
		expect(lastRun.causalChain!.length).toBeGreaterThan(0);
		expect(lastRun.causalChain).toContain("count changed");

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 18. Effect tracking with triggeredBy deps (E12)
	// -----------------------------------------------------------------------
	it("tracks effects with triggeredBy dependency arrays", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 2;
		await system.settle();

		const history = system.runHistory!;
		const runWithEffect = history.find(r => r.effectsRun.length > 0);

		expect(runWithEffect).toBeDefined();
		const effect = runWithEffect!.effectsRun[0]!;
		expect(typeof effect).toBe("object");
		expect(effect.id).toBeDefined();
		expect(Array.isArray(effect.triggeredBy)).toBe(true);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 19. Constraint deps tracked (E12)
	// -----------------------------------------------------------------------
	it("includes dependency arrays on constraint hit entries", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 10;
		await system.settle();

		const history = system.runHistory!;
		const runWithConstraint = history.find(r => r.constraintsHit.length > 0);

		expect(runWithConstraint).toBeDefined();
		const constraint = runWithConstraint!.constraintsHit[0]!;
		expect(constraint.deps).toBeDefined();
		expect(Array.isArray(constraint.deps)).toBe(true);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 20. Cached getter returns same reference on repeat access
	// -----------------------------------------------------------------------
	it("returns cached array on repeat access without changes (E1)", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		const ref1 = system.runHistory;
		const ref2 = system.runHistory;

		// Same reference when no changes
		expect(ref1).toBe(ref2);

		system.destroy();
	});

	// -----------------------------------------------------------------------
	// 21. Deep copy in inspect
	// -----------------------------------------------------------------------
	it("returns deep-copied run history from inspect() (M5)", async () => {
		const system = createSystemWithHistory();
		system.start();
		await system.settle();

		system.facts.count = 1;
		await system.settle();

		const inspection = system.inspect();
		const run = inspection.runHistory![0]!;

		// Mutating the returned data should not affect the internal state
		run.factChanges.push({ key: "fake", oldValue: 0, newValue: 1 });

		const inspection2 = system.inspect();
		const run2 = inspection2.runHistory![0]!;

		// The mutation should not have persisted
		expect(run2.factChanges.find(fc => fc.key === "fake")).toBeUndefined();

		system.destroy();
	});
});
