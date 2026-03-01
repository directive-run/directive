import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * Tests that batch.enabled works with plain resolve() (no resolveBatch).
 * The system should fall back to calling resolve() individually for each
 * batched requirement instead of throwing.
 */
describe("batch + resolve fallback", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createBatchModule() {
		return createModule("batch-test", {
			schema: {
				facts: {
					items: t.object<Record<string, string>>(),
					trigger: t.number(),
				},
				requirements: {
					FETCH_ITEM: { id: t.string() },
				},
			},
			init: (facts) => {
				facts.items = {};
				facts.trigger = 0;
			},
			constraints: {
				loadItems: {
					when: (facts) => facts.trigger > 0,
					require: (facts) => {
						const reqs = [];
						for (let i = 0; i < facts.trigger; i++) {
							reqs.push({ type: "FETCH_ITEM" as const, id: `item-${i}` });
						}

						return reqs;
					},
				},
			},
			resolvers: {
				fetchItem: {
					requirement: "FETCH_ITEM",
					batch: {
						enabled: true,
						windowMs: 10,
					},
					// Only resolve() — no resolveBatch()
					resolve: async (req, context) => {
						context.facts.items = {
							...context.facts.items,
							[req.id]: `data-${req.id}`,
						};
					},
				},
			},
		});
	}

	it("resolves requirements individually when batch.enabled but no resolveBatch", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const mod = createBatchModule();
		const system = createSystem({ module: mod });
		system.start();

		// Trigger 3 requirements that will be batched
		system.facts.trigger = 3;

		// Let reconciliation queue the batch requirements
		await vi.advanceTimersByTimeAsync(0);

		// Advance past the batch windowMs (10ms) to fire the batch timer
		await vi.advanceTimersByTimeAsync(50);

		// Let promises resolve
		await vi.advanceTimersByTimeAsync(50);

		// All items should be resolved individually via resolve() fallback
		expect(system.facts.items["item-0"]).toBe("data-item-0");
		expect(system.facts.items["item-1"]).toBe("data-item-1");
		expect(system.facts.items["item-2"]).toBe("data-item-2");

		warnSpy.mockRestore();
	});

	it("emits dev warning when batch.enabled without resolveBatch", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const mod = createBatchModule();
		createSystem({ module: mod });

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Falling back to individual resolve() calls"),
		);

		warnSpy.mockRestore();
	});
});
