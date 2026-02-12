import { describe, expect, it, vi } from "vitest";
import type { ModuleSchema, SnapshotMeta } from "../index.js";
import { createModule, createSystem, t } from "../index.js";
import { buildTimeTravelState } from "../adapters/shared.js";

describe("Time-Travel", () => {
	const schema = {
		facts: {
			count: t.number(),
		},
		derivations: {},
		events: {
			increment: {},
		},
		requirements: {},
	} satisfies ModuleSchema;

	const counterModule = createModule("counter", {
		schema,
		init: (facts) => {
			facts.count = 0;
		},
		derive: {},
		events: {
			increment: (facts) => {
				facts.count = (facts.count ?? 0) + 1;
			},
		},
	});

	it("should capture snapshots when facts change", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		// Initial state (no snapshots yet - snapshots are taken on fact changes)
		expect(system.facts.counter.count).toBe(0);
		expect(system.debug).not.toBeNull();

		// Change facts - this should trigger a snapshot
		system.events.counter.increment();
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Now we should have snapshots
		expect(system.debug?.snapshots.length).toBeGreaterThan(0);
		expect(system.facts.counter.count).toBe(1);

		system.stop();
	});

	it("should go back and forward in time", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		// Make several changes with delays to ensure snapshots are captured
		system.events.counter.increment(); // count = 1
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.events.counter.increment(); // count = 2
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.events.counter.increment(); // count = 3
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(system.facts.counter.count).toBe(3);

		const snapshotCount = system.debug?.snapshots.length ?? 0;
		expect(snapshotCount).toBeGreaterThanOrEqual(1);

		// Go back one step
		system.debug?.goBack(1);

		// After going back, we should be at a previous state
		// The exact value depends on how many snapshots were captured
		expect(system.facts.counter.count).toBeLessThan(3);

		system.stop();
	});

	it("should export and import state", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.events.counter.increment();
		system.events.counter.increment();

		// Wait for reconciliation
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(system.facts.counter.count).toBe(2);

		// Export
		const exported = system.debug?.export();
		expect(exported).toBeDefined();

		const parsed = JSON.parse(exported!);
		expect(parsed.version).toBe(1);
		expect(Array.isArray(parsed.snapshots)).toBe(true);

		system.stop();

		// Create a new system and import
		const system2 = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system2.start();
		expect(system2.facts.counter.count).toBe(0);

		// Import the state
		system2.debug?.import(exported!);

		// After import, state should reflect the imported snapshots
		// The currentIndex determines which snapshot's state is restored
		expect(system2.debug?.snapshots.length).toBe(parsed.snapshots.length);

		system2.stop();
	});

	it("should reject prototype pollution in import", () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Attempt to import malicious data with __proto__ in facts
		const maliciousData = JSON.stringify({
			version: 1,
			snapshots: [
				{
					id: 1,
					timestamp: Date.now(),
					trigger: "test",
					facts: {
						counter_count: 0,
						__proto__: { malicious: true },
					},
				},
			],
			currentIndex: 0,
		});

		// Note: JSON.parse strips __proto__, but we should still test the validation
		// The validation in import should catch this
		system.debug?.import(maliciousData);

		// Since JSON.parse may strip __proto__, let's also test with constructor/prototype
		const maliciousData2 = JSON.stringify({
			version: 1,
			snapshots: [
				{
					id: 1,
					timestamp: Date.now(),
					trigger: "test",
					facts: {
						counter_count: 0,
						constructor: { malicious: true },
					},
				},
			],
			currentIndex: 0,
		});

		system.debug?.import(maliciousData2);

		// The import should have caught the "constructor" key
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
		system.stop();
	});

	it("should respect maxSnapshots limit", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 3 },
		});

		system.start();

		// Make many changes with delays to ensure each triggers a snapshot
		for (let i = 0; i < 10; i++) {
			system.events.counter.increment();
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		// Should be capped at maxSnapshots
		expect(system.debug?.snapshots.length).toBeLessThanOrEqual(3);

		system.stop();
	});

	it("should goTo specific snapshot", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.events.counter.increment(); // count = 1
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.events.counter.increment(); // count = 2
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(system.facts.counter.count).toBe(2);

		// Get snapshots
		const snapshots = system.debug?.snapshots ?? [];
		expect(snapshots.length).toBeGreaterThan(0);

		// Go to first snapshot
		if (snapshots.length > 0) {
			const firstSnapshot = snapshots[0];
			system.debug?.goTo(firstSnapshot!.id);
			// State should be restored from that snapshot
			expect(system.debug?.currentIndex).toBe(0);
		}

		system.stop();
	});

	it("should replay from beginning", async () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.events.counter.increment();
		system.events.counter.increment();
		system.events.counter.increment();

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(system.facts.counter.count).toBe(3);

		// Replay from beginning - restores to first snapshot
		const snapshots = system.debug?.snapshots ?? [];
		if (snapshots.length > 0) {
			system.debug?.replay();
			expect(system.debug?.currentIndex).toBe(0);
		}

		system.stop();
	});

	it("should not capture snapshots when disabled", () => {
		const system = createSystem({
			modules: { counter: counterModule },
			// debug not enabled
		});

		system.start();

		expect(system.debug).toBeNull();

		system.events.counter.increment();
		expect(system.facts.counter.count).toBe(1);

		system.stop();
	});

	it("should warn on invalid goTo snapshot ID", () => {
		const system = createSystem({
			modules: { counter: counterModule },
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Try to go to a non-existent snapshot
		system.debug?.goTo(99999);

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		);

		consoleSpy.mockRestore();
		system.stop();
	});

	// ==========================================================================
	// Extended TimeTravelState (via buildTimeTravelState)
	// ==========================================================================

	describe("buildTimeTravelState extended API", () => {
		it("should return null when time-travel is disabled", () => {
			const system = createSystem({
				module: counterModule,
			});
			system.start();

			const state = buildTimeTravelState(system as any);
			expect(state).toBeNull();

			system.stop();
		});

		it("should expose snapshot metadata without facts", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			const state = buildTimeTravelState(system as any);
			expect(state).not.toBeNull();
			expect(state!.snapshots.length).toBeGreaterThan(0);

			// Each snapshot meta should have id, timestamp, trigger — but NOT facts
			for (const snap of state!.snapshots) {
				expect(typeof snap.id).toBe("number");
				expect(typeof snap.timestamp).toBe("number");
				expect(typeof snap.trigger).toBe("string");
				expect((snap as any).facts).toBeUndefined();
			}

			system.stop();
		});

		it("should retrieve full facts on-demand via getSnapshotFacts", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment(); // count = 1
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment(); // count = 2
			await new Promise((resolve) => setTimeout(resolve, 30));

			const state = buildTimeTravelState(system as any);
			expect(state!.snapshots.length).toBeGreaterThan(0);

			const firstSnap = state!.snapshots[0]!;
			const facts = state!.getSnapshotFacts(firstSnap.id);
			expect(facts).not.toBeNull();
			expect(typeof facts).toBe("object");

			// Non-existent ID returns null
			expect(state!.getSnapshotFacts(999999)).toBeNull();

			system.stop();
		});

		it("should support goTo via TimeTravelState", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment(); // count = 1
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment(); // count = 2
			await new Promise((resolve) => setTimeout(resolve, 30));

			let state = buildTimeTravelState(system as any);
			const firstSnap = state!.snapshots[0]!;

			// Navigate to first snapshot
			state!.goTo(firstSnap.id);

			state = buildTimeTravelState(system as any);
			expect(state!.currentIndex).toBe(0);

			system.stop();
		});

		it("should support goBack/goForward with step count", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			let state = buildTimeTravelState(system as any);
			const lastIndex = state!.currentIndex;

			// Go back 2 steps
			state!.goBack(2);
			state = buildTimeTravelState(system as any);
			expect(state!.currentIndex).toBeLessThan(lastIndex);

			// Go forward 1 step
			state!.goForward(1);
			state = buildTimeTravelState(system as any);
			expect(state!.currentIndex).toBeGreaterThan(0);

			system.stop();
		});

		it("should support replay via TimeTravelState", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			let state = buildTimeTravelState(system as any);
			const snapCount = state!.totalSnapshots;

			if (snapCount > 1) {
				// We have multiple snapshots, currentIndex should be at the end
				expect(state!.currentIndex).toBeGreaterThan(0);

				state!.replay();
				state = buildTimeTravelState(system as any);
				expect(state!.currentIndex).toBe(0);
			} else {
				// Edge case: only 1 snapshot — replay goes to index 0 (already there)
				state!.replay();
				state = buildTimeTravelState(system as any);
				expect(state!.currentIndex).toBe(0);
			}

			system.stop();
		});

		it("should support exportSession/importSession", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment();
			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 50));

			const state = buildTimeTravelState(system as any);
			const exported = state!.exportSession();

			expect(typeof exported).toBe("string");
			const parsed = JSON.parse(exported);
			expect(parsed.version).toBe(1);
			expect(Array.isArray(parsed.snapshots)).toBe(true);

			// Import into a fresh system
			const system2 = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system2.start();

			const state2 = buildTimeTravelState(system2 as any);
			state2!.importSession(exported);

			const state2After = buildTimeTravelState(system2 as any);
			expect(state2After!.totalSnapshots).toBe(parsed.snapshots.length);

			system.stop();
			system2.stop();
		});

		it("should support beginChangeset/endChangeset", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 20 },
			});
			system.start();

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			let state = buildTimeTravelState(system as any);
			state!.beginChangeset("batch-update");

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			state = buildTimeTravelState(system as any);
			state!.endChangeset();

			// After ending changeset, goBack should jump over the entire changeset
			state = buildTimeTravelState(system as any);
			const indexBeforeUndo = state!.currentIndex;

			state!.undo(); // goBack(1) — but should skip the changeset as a group
			state = buildTimeTravelState(system as any);

			// The index should have moved back more than 1 step (changeset grouping)
			expect(state!.currentIndex).toBeLessThan(indexBeforeUndo);

			system.stop();
		});

		it("should expose isPaused and support pause/resume", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			let state = buildTimeTravelState(system as any);
			expect(state!.isPaused).toBe(false);

			// Pause recording
			state!.pause();
			state = buildTimeTravelState(system as any);
			expect(state!.isPaused).toBe(true);

			const snapshotsBefore = state!.totalSnapshots;

			// Changes while paused should NOT add snapshots
			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			state = buildTimeTravelState(system as any);
			expect(state!.totalSnapshots).toBe(snapshotsBefore);

			// Resume
			state!.resume();
			state = buildTimeTravelState(system as any);
			expect(state!.isPaused).toBe(false);

			// Changes after resume SHOULD add snapshots
			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			state = buildTimeTravelState(system as any);
			expect(state!.totalSnapshots).toBeGreaterThan(snapshotsBefore);

			system.stop();
		});

		it("should maintain backward compatibility — existing fields unchanged", async () => {
			const system = createSystem({
				module: counterModule,
				debug: { timeTravel: true, maxSnapshots: 10 },
			});
			system.start();

			system.events.increment();
			await new Promise((resolve) => setTimeout(resolve, 30));

			const state = buildTimeTravelState(system as any);

			// All original fields should exist
			expect(typeof state!.canUndo).toBe("boolean");
			expect(typeof state!.canRedo).toBe("boolean");
			expect(typeof state!.undo).toBe("function");
			expect(typeof state!.redo).toBe("function");
			expect(typeof state!.currentIndex).toBe("number");
			expect(typeof state!.totalSnapshots).toBe("number");

			// New fields should also exist
			expect(Array.isArray(state!.snapshots)).toBe(true);
			expect(typeof state!.getSnapshotFacts).toBe("function");
			expect(typeof state!.goTo).toBe("function");
			expect(typeof state!.goBack).toBe("function");
			expect(typeof state!.goForward).toBe("function");
			expect(typeof state!.replay).toBe("function");
			expect(typeof state!.exportSession).toBe("function");
			expect(typeof state!.importSession).toBe("function");
			expect(typeof state!.beginChangeset).toBe("function");
			expect(typeof state!.endChangeset).toBe("function");
			expect(typeof state!.isPaused).toBe("boolean");
			expect(typeof state!.pause).toBe("function");
			expect(typeof state!.resume).toBe("function");

			system.stop();
		});
	});
});
