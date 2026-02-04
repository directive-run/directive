/**
 * Persistence plugin tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModuleSchema } from "../index.js";
import { createModule, createSystem, t } from "../index.js";
import { persistencePlugin } from "../plugins/persistence.js";

// Mock storage
function createMockStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	};
}

function createTestModule() {
	const schema = {
		facts: {
			count: t.number(),
			name: t.string(),
			secret: t.string(),
		},
		derivations: {},
		events: {
			increment: {},
			setName: { name: t.string() },
		},
		requirements: {},
	} satisfies ModuleSchema;

	return createModule("test", {
		schema,
		init: (facts) => {
			// Only set defaults if not already set (e.g., by persistence)
			if (facts.count === undefined) facts.count = 0;
			if (facts.name === undefined) facts.name = "test";
			if (facts.secret === undefined) facts.secret = "hidden";
		},
		derive: {},
		events: {
			increment: (facts) => {
				facts.count = (facts.count ?? 0) + 1;
			},
			setName: (facts, { name }) => {
				facts.name = name;
			},
		},
	});
}

describe("Persistence Plugin", () => {
	let storage: Storage;

	beforeEach(() => {
		storage = createMockStorage();
	});

	describe("save/restore cycle", () => {
		it("saves facts to storage", async () => {
			const onSave = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onSave,
					}),
				],
			});

			system.start();
			system.events.test.increment();

			// Wait for debounced save
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(onSave).toHaveBeenCalled();
			const saved = JSON.parse(storage.getItem("test-state")!);
			expect(saved.test_count).toBe(1);

			system.destroy();
		});

		it("restores facts from storage", () => {
			// Pre-populate storage (using internal prefixed format)
			storage.setItem("test-state", JSON.stringify({ test_count: 42, test_name: "restored" }));

			const onRestore = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onRestore,
					}),
				],
			});

			system.start();

			expect(onRestore).toHaveBeenCalledWith({ test_count: 42, test_name: "restored" });
			expect(system.facts.test.count).toBe(42);
			expect(system.facts.test.name).toBe("restored");

			system.destroy();
		});
	});

	describe("include/exclude filtering", () => {
		it("only persists included keys", async () => {
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						include: ["test_count"],
					}),
				],
			});

			system.start();
			system.events.test.increment();
			system.events.test.setName({ name: "new name" });

			// Wait for debounced save
			await new Promise((resolve) => setTimeout(resolve, 150));

			const saved = JSON.parse(storage.getItem("test-state")!);
			expect(saved.test_count).toBe(1);
			expect(saved.test_name).toBeUndefined();

			system.destroy();
		});

		it("excludes specified keys", async () => {
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						exclude: ["test_secret"],
					}),
				],
			});

			system.start();
			system.events.test.increment();

			// Wait for debounced save
			await new Promise((resolve) => setTimeout(resolve, 150));

			const saved = JSON.parse(storage.getItem("test-state")!);
			expect(saved.test_count).toBe(1);
			expect(saved.test_secret).toBeUndefined();

			system.destroy();
		});
	});

	describe("debounce behavior", () => {
		it("debounces multiple rapid saves", async () => {
			const onSave = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						debounce: 100,
						onSave,
					}),
				],
			});

			system.start();

			// Rapid updates
			system.events.test.increment();
			system.events.test.increment();
			system.events.test.increment();

			// Should not have saved yet
			expect(onSave).not.toHaveBeenCalled();

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should have saved once with final value
			expect(onSave).toHaveBeenCalledTimes(1);
			const saved = JSON.parse(storage.getItem("test-state")!);
			expect(saved.test_count).toBe(3);

			system.destroy();
		});
	});

	describe("error handling", () => {
		it("calls onError for malformed JSON", () => {
			storage.setItem("test-state", "not valid json");

			const onError = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onError,
					}),
				],
			});

			system.start();

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

			system.destroy();
		});

		it("calls onError for storage write failures", async () => {
			const failingStorage = {
				...createMockStorage(),
				setItem: () => {
					throw new Error("Storage quota exceeded");
				},
			};

			const onError = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage: failingStorage,
						key: "test-state",
						onError,
					}),
				],
			});

			system.start();
			system.events.test.increment();

			// Wait for debounced save
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0]?.[0]?.message).toBe("Storage quota exceeded");

			system.destroy();
		});
	});

	describe("security", () => {
		it("rejects prototype pollution in stored data", () => {
			// Store malicious data
			storage.setItem(
				"test-state",
				'{"test_count": 1, "__proto__": {"polluted": true}}',
			);

			const onError = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onError,
					}),
				],
			});

			system.start();

			// Should have called onError with prototype pollution warning
			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0]?.[0]?.message).toContain("prototype pollution");

			// Facts should use default values, not the polluted data
			expect(system.facts.test.count).toBe(0);

			// Verify Object.prototype was not polluted
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();

			system.destroy();
		});

		it("rejects nested prototype pollution", () => {
			storage.setItem(
				"test-state",
				'{"test_count": 1, "nested": {"__proto__": {"evil": true}}}',
			);

			const onError = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onError,
					}),
				],
			});

			system.start();

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0]?.[0]?.message).toContain("prototype pollution");

			system.destroy();
		});

		it("rejects constructor pollution", () => {
			storage.setItem("test-state", '{"constructor": {"prototype": {}}}');

			const onError = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						onError,
					}),
				],
			});

			system.start();

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0]?.[0]?.message).toContain("prototype pollution");

			system.destroy();
		});
	});

	describe("destroy behavior", () => {
		it("saves final state on destroy", async () => {
			const onSave = vi.fn();
			const system = createSystem({
				modules: { test: createTestModule() },
				plugins: [
					persistencePlugin({
						storage,
						key: "test-state",
						debounce: 1000, // Long debounce
						onSave,
					}),
				],
			});

			system.start();
			system.events.test.increment();

			// Destroy immediately (before debounce)
			system.destroy();

			// Should have saved immediately on destroy
			expect(onSave).toHaveBeenCalled();
			const saved = JSON.parse(storage.getItem("test-state")!);
			expect(saved.test_count).toBe(1);
		});
	});
});
