import { describe, expect, it, vi } from "vitest";
import { createFacts, createFactsStore, t } from "../facts.js";
import { isTracking, withTracking } from "../tracking.js";

describe("Facts Store", () => {
	const schema = {
		count: t.number(),
		name: t.string(),
		active: t.boolean(),
	};

	it("should create a facts store", () => {
		const { store } = createFacts({ schema });
		expect(store).toBeDefined();
	});

	it("should set and get values", () => {
		const { store } = createFacts({ schema });

		store.set("count", 42);
		expect(store.get("count")).toBe(42);

		store.set("name", "test");
		expect(store.get("name")).toBe("test");
	});

	it("should return undefined for unset keys", () => {
		const { store } = createFacts({ schema });
		expect(store.get("count")).toBeUndefined();
	});

	it("should check if a key exists", () => {
		const { store } = createFacts({ schema });

		expect(store.has("count")).toBe(false);
		store.set("count", 0);
		expect(store.has("count")).toBe(true);
	});

	it("should delete values", () => {
		const { store } = createFacts({ schema });

		store.set("count", 42);
		expect(store.has("count")).toBe(true);

		store.delete("count");
		expect(store.has("count")).toBe(false);
	});

	it("should notify subscribers on set", () => {
		const { store } = createFacts({ schema });
		const listener = vi.fn();

		store.subscribe(["count"], listener);
		store.set("count", 42);

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should notify subscribers on delete", () => {
		const { store } = createFacts({ schema });
		const listener = vi.fn();

		store.set("count", 42);
		store.subscribe(["count"], listener);
		store.delete("count");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should unsubscribe correctly", () => {
		const { store } = createFacts({ schema });
		const listener = vi.fn();

		const unsubscribe = store.subscribe(["count"], listener);
		store.set("count", 1);
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		store.set("count", 2);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should batch updates", () => {
		const { store } = createFacts({ schema });
		const listener = vi.fn();

		store.subscribeAll(listener);

		store.batch(() => {
			store.set("count", 1);
			store.set("name", "test");
			store.set("active", true);
		});

		// Should only notify once for the entire batch
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should call onBatch callback", () => {
		const onBatch = vi.fn();
		const store = createFactsStore({ schema, onBatch });

		store.batch(() => {
			store.set("count", 1);
			store.set("name", "test");
		});

		expect(onBatch).toHaveBeenCalledTimes(1);
		expect(onBatch).toHaveBeenCalledWith([
			{ key: "count", value: 1, prev: undefined, type: "set" },
			{ key: "name", value: "test", prev: undefined, type: "set" },
		]);
	});
});

describe("Facts Proxy", () => {
	const schema = {
		count: t.number(),
		name: t.string(),
	};

	it("should allow proxy-style access", () => {
		const { facts } = createFacts({ schema });

		facts.count = 42;
		expect(facts.count).toBe(42);

		facts.name = "test";
		expect(facts.name).toBe("test");
	});

	it("should provide $store access", () => {
		const { facts, store } = createFacts({ schema });
		expect(facts.$store).toBe(store);
	});

	it("should provide $snapshot function", () => {
		const { facts } = createFacts({ schema });

		facts.count = 42;
		const snapshot = facts.$snapshot();

		expect(snapshot.get("count")).toBe(42);
	});
});

describe("Auto-Tracking", () => {
	const schema = {
		a: t.number(),
		b: t.number(),
		c: t.number(),
	};

	it("should track accessed keys", () => {
		const { facts } = createFacts({ schema });
		facts.a = 1;
		facts.b = 2;
		facts.c = 3;

		const { value, deps } = withTracking(() => {
			return facts.a + facts.b;
		});

		expect(value).toBe(3);
		expect(deps.has("a")).toBe(true);
		expect(deps.has("b")).toBe(true);
		expect(deps.has("c")).toBe(false);
	});

	it("should not track when not in tracking context", () => {
		expect(isTracking()).toBe(false);
	});

	it("should report tracking when in context", () => {
		withTracking(() => {
			expect(isTracking()).toBe(true);
		});
	});
});

describe("Schema Type Builders", () => {
	it("should create string type", () => {
		const type = t.string();
		expect(type._validators.length).toBe(1);
		expect(type._validators[0]!("hello")).toBe(true);
		expect(type._validators[0]!(123 as unknown as string)).toBe(false);
	});

	it("should create number type", () => {
		const type = t.number();
		expect(type._validators[0]!(42)).toBe(true);
		expect(type._validators[0]!("42" as unknown as number)).toBe(false);
	});

	it("should create boolean type", () => {
		const type = t.boolean();
		expect(type._validators[0]!(true)).toBe(true);
		expect(type._validators[0]!(1 as unknown as boolean)).toBe(false);
	});

	it("should support custom validation", () => {
		const type = t.string().validate((v) => v.length > 0);
		expect(type._validators.length).toBe(2);
	});
});
