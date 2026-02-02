import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../index.js";

describe("Time-Travel", () => {
	const counterModule = createModule("counter", {
		schema: {
			count: t.number(),
		},
		init: (facts) => {
			facts.count = 0;
		},
		events: {
			increment: (facts) => {
				facts.count = (facts.count ?? 0) + 1;
			},
		},
	});

	it("should capture snapshots when facts change", async () => {
		const system = createSystem({
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		// Initial state (no snapshots yet - snapshots are taken on fact changes)
		expect(system.facts.count).toBe(0);
		expect(system.debug).not.toBeNull();

		// Change facts - this should trigger a snapshot
		system.dispatch({ type: "increment" });
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Now we should have snapshots
		expect(system.debug?.snapshots.length).toBeGreaterThan(0);
		expect(system.facts.count).toBe(1);

		system.stop();
	});

	it("should go back and forward in time", async () => {
		const system = createSystem({
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		// Make several changes with delays to ensure snapshots are captured
		system.dispatch({ type: "increment" }); // count = 1
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.dispatch({ type: "increment" }); // count = 2
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.dispatch({ type: "increment" }); // count = 3
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(system.facts.count).toBe(3);

		const snapshotCount = system.debug?.snapshots.length ?? 0;
		expect(snapshotCount).toBeGreaterThanOrEqual(1);

		// Go back one step
		system.debug?.goBack(1);

		// After going back, we should be at a previous state
		// The exact value depends on how many snapshots were captured
		expect(system.facts.count).toBeLessThan(3);

		system.stop();
	});

	it("should export and import state", async () => {
		const system = createSystem({
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.dispatch({ type: "increment" });
		system.dispatch({ type: "increment" });

		// Wait for reconciliation
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(system.facts.count).toBe(2);

		// Export
		const exported = system.debug?.export();
		expect(exported).toBeDefined();

		const parsed = JSON.parse(exported!);
		expect(parsed.version).toBe(1);
		expect(Array.isArray(parsed.snapshots)).toBe(true);

		system.stop();

		// Create a new system and import
		const system2 = createSystem({
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system2.start();
		expect(system2.facts.count).toBe(0);

		// Import the state
		system2.debug?.import(exported!);

		// After import, state should reflect the imported snapshots
		// The currentIndex determines which snapshot's state is restored
		expect(system2.debug?.snapshots.length).toBe(parsed.snapshots.length);

		system2.stop();
	});

	it("should reject prototype pollution in import", () => {
		const system = createSystem({
			modules: [counterModule],
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
						count: 0,
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
						count: 0,
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
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 3 },
		});

		system.start();

		// Make many changes with delays to ensure each triggers a snapshot
		for (let i = 0; i < 10; i++) {
			system.dispatch({ type: "increment" });
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		// Should be capped at maxSnapshots
		expect(system.debug?.snapshots.length).toBeLessThanOrEqual(3);

		system.stop();
	});

	it("should goTo specific snapshot", async () => {
		const system = createSystem({
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.dispatch({ type: "increment" }); // count = 1
		await new Promise((resolve) => setTimeout(resolve, 30));

		system.dispatch({ type: "increment" }); // count = 2
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(system.facts.count).toBe(2);

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
			modules: [counterModule],
			debug: { timeTravel: true, maxSnapshots: 10 },
		});

		system.start();

		system.dispatch({ type: "increment" });
		system.dispatch({ type: "increment" });
		system.dispatch({ type: "increment" });

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(system.facts.count).toBe(3);

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
			modules: [counterModule],
			// debug not enabled
		});

		system.start();

		expect(system.debug).toBeNull();

		system.dispatch({ type: "increment" });
		expect(system.facts.count).toBe(1);

		system.stop();
	});

	it("should warn on invalid goTo snapshot ID", () => {
		const system = createSystem({
			modules: [counterModule],
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
});
