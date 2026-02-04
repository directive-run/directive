import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFacts, createFactsStore, t } from "../core/facts.js";
import { isTracking, withTracking } from "../core/tracking.js";

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

describe("Facts Proxy Edge Cases", () => {
	const schema = {
		count: t.number(),
		name: t.string(),
		active: t.boolean(),
	};

	it("should support delete via proxy", () => {
		const { facts } = createFacts({ schema });

		facts.count = 42;
		expect(facts.count).toBe(42);

		// TypeScript doesn't allow deleting non-optional properties, but runtime supports it
		delete (facts as { count?: number }).count;
		expect(facts.count).toBeUndefined();
		expect("count" in facts).toBe(false);
	});

	it("should return schema keys for Object.keys()", () => {
		const { facts } = createFacts({ schema });

		const keys = Object.keys(facts);
		expect(keys).toContain("count");
		expect(keys).toContain("name");
		expect(keys).toContain("active");
		expect(keys).toHaveLength(3);
	});

	it("should return undefined for Symbol property access", () => {
		const { facts } = createFacts({ schema });

		const sym = Symbol("test");
		expect((facts as unknown as Record<symbol, unknown>)[sym]).toBeUndefined();
	});

	it("should reject Symbol property assignment", () => {
		const { facts } = createFacts({ schema });

		const sym = Symbol("test");
		const result = Reflect.set(facts, sym, "value");
		expect(result).toBe(false);
	});

	it("should block __proto__ access (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		// Should return undefined, not the actual prototype
		expect((facts as unknown as Record<string, unknown>).__proto__).toBeUndefined();
	});

	it("should block constructor access (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		// Should return undefined, not the actual constructor
		expect((facts as unknown as Record<string, unknown>).constructor).toBeUndefined();
	});

	it("should block prototype access (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		// Should return undefined
		expect((facts as unknown as Record<string, unknown>).prototype).toBeUndefined();
	});

	it("should reject setting __proto__ (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.set(facts, "__proto__", { malicious: true });
		expect(result).toBe(false);
	});

	it("should reject setting constructor (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.set(facts, "constructor", () => {});
		expect(result).toBe(false);
	});

	it("should reject deleting __proto__ (prototype pollution protection)", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.deleteProperty(facts, "__proto__");
		expect(result).toBe(false);
	});

	it("should report false for 'in' check on blocked properties", () => {
		const { facts } = createFacts({ schema });

		expect("__proto__" in facts).toBe(false);
		expect("constructor" in facts).toBe(false);
		expect("prototype" in facts).toBe(false);
	});

	it("should reject setting $store", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.set(facts, "$store", {});
		expect(result).toBe(false);
	});

	it("should reject setting $snapshot", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.set(facts, "$snapshot", () => {});
		expect(result).toBe(false);
	});

	it("should reject deleting $store", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.deleteProperty(facts, "$store");
		expect(result).toBe(false);
	});

	it("should reject deleting $snapshot", () => {
		const { facts } = createFacts({ schema });

		const result = Reflect.deleteProperty(facts, "$snapshot");
		expect(result).toBe(false);
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

describe("Schema Validation at Boundary", () => {
	it("should throw when setting invalid type with validation enabled", () => {
		const validatedSchema = {
			count: t.number(),
			name: t.string(),
		};

		const { facts } = createFacts({ schema: validatedSchema, validate: true });

		// Set invalid type - string where number expected
		expect(() => {
			facts.count = "not a number" as unknown as number;
		}).toThrow("Validation failed");
	});

	it("should throw when number constraint violated with validation enabled", () => {
		const validatedSchema = {
			age: t.number().min(0).max(150),
		};

		const { facts } = createFacts({ schema: validatedSchema, validate: true });

		// Valid value - should not throw
		facts.age = 25;

		// Invalid value - negative
		expect(() => {
			facts.age = -5;
		}).toThrow("Validation failed");
	});

	it("should not throw for valid values with validation enabled", () => {
		const validatedSchema = {
			count: t.number(),
			name: t.string(),
			active: t.boolean(),
		};

		const { facts } = createFacts({ schema: validatedSchema, validate: true });

		// These should not throw
		facts.count = 42;
		facts.name = "hello";
		facts.active = true;
	});

	it("should not validate when validation is disabled", () => {
		const validatedSchema = {
			count: t.number(),
		};

		const { facts } = createFacts({ schema: validatedSchema, validate: false });

		// Should not throw even with invalid type
		facts.count = "not a number" as unknown as number;
		expect(facts.count).toBe("not a number");
	});
});

describe("Extended Schema Type Builders", () => {
	it("should create enum type with valid values", () => {
		const type = t.enum("red", "green", "yellow");
		expect(type._validators[0]!("red")).toBe(true);
		expect(type._validators[0]!("green")).toBe(true);
		expect(type._validators[0]!("yellow")).toBe(true);
		expect(type._validators[0]!("blue" as never)).toBe(false);
		expect(type._validators[0]!(123 as never)).toBe(false);
	});

	it("should validate enum values at boundary", () => {
		const schema = {
			status: t.enum("idle", "loading", "success", "error"),
		};

		const { facts } = createFacts({ schema, validate: true });

		// Valid values
		facts.status = "idle";
		expect(facts.status).toBe("idle");

		facts.status = "loading";
		expect(facts.status).toBe("loading");

		// Invalid value
		expect(() => {
			facts.status = "invalid" as never;
		}).toThrow("Validation failed");
	});

	it("should create literal type for exact matching", () => {
		const stringLiteral = t.literal("exact");
		expect(stringLiteral._validators[0]!("exact")).toBe(true);
		expect(stringLiteral._validators[0]!("other" as never)).toBe(false);

		const numberLiteral = t.literal(42);
		expect(numberLiteral._validators[0]!(42)).toBe(true);
		expect(numberLiteral._validators[0]!(43 as never)).toBe(false);

		const boolLiteral = t.literal(true);
		expect(boolLiteral._validators[0]!(true)).toBe(true);
		expect(boolLiteral._validators[0]!(false as never)).toBe(false);
	});

	it("should validate literal values at boundary", () => {
		const schema = {
			type: t.literal("user"),
			version: t.literal(1),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.type = "user";
		expect(facts.type).toBe("user");

		facts.version = 1;
		expect(facts.version).toBe(1);

		expect(() => {
			facts.type = "admin" as never;
		}).toThrow("Validation failed");

		expect(() => {
			facts.version = 2 as never;
		}).toThrow("Validation failed");
	});

	it("should create nullable type", () => {
		const type = t.nullable(t.string());
		expect(type._validators[0]!(null)).toBe(true);
		expect(type._validators[0]!("hello")).toBe(true);
		expect(type._validators[0]!(123 as never)).toBe(false);
	});

	it("should validate nullable values at boundary", () => {
		const schema = {
			name: t.nullable(t.string()),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.name = "hello";
		expect(facts.name).toBe("hello");

		facts.name = null;
		expect(facts.name).toBe(null);

		expect(() => {
			facts.name = 123 as never;
		}).toThrow("Validation failed");
	});

	it("should create optional type", () => {
		const type = t.optional(t.number());
		expect(type._validators[0]!(undefined)).toBe(true);
		expect(type._validators[0]!(42)).toBe(true);
		expect(type._validators[0]!("hello" as never)).toBe(false);
	});

	it("should validate optional values at boundary", () => {
		const schema = {
			age: t.optional(t.number()),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.age = 25;
		expect(facts.age).toBe(25);

		facts.age = undefined;
		expect(facts.age).toBe(undefined);

		expect(() => {
			facts.age = "twenty-five" as never;
		}).toThrow("Validation failed");
	});

	it("should compose nullable with other types", () => {
		const schema = {
			score: t.nullable(t.number().min(0).max(100)),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.score = null;
		facts.score = 50;
		expect(facts.score).toBe(50);

		// Inner validation still applies
		expect(() => {
			facts.score = -1;
		}).toThrow("Validation failed");
	});
});

describe("Zod Schema Integration", () => {
	it("should validate Zod string schema", () => {
		const schema = {
			name: z.string(),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.name = "hello";
		expect(facts.name).toBe("hello");

		expect(() => {
			facts.name = 123 as never;
		}).toThrow("Validation failed");
	});

	it("should validate Zod number schema with constraints", () => {
		const schema = {
			age: z.number().min(0).max(150),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.age = 25;
		expect(facts.age).toBe(25);

		expect(() => {
			facts.age = -5;
		}).toThrow("Validation failed");

		expect(() => {
			facts.age = 200;
		}).toThrow("Validation failed");
	});

	it("should validate Zod email schema", () => {
		const schema = {
			email: z.string().email(),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.email = "test@example.com";
		expect(facts.email).toBe("test@example.com");

		expect(() => {
			facts.email = "not-an-email";
		}).toThrow("Validation failed");
	});

	it("should validate Zod enum schema", () => {
		const StatusSchema = z.enum(["idle", "loading", "success", "error"]);
		const schema = {
			status: StatusSchema,
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.status = "idle";
		expect(facts.status).toBe("idle");

		facts.status = "loading";
		expect(facts.status).toBe("loading");

		expect(() => {
			facts.status = "invalid" as never;
		}).toThrow("Validation failed");
	});

	it("should validate Zod object schema", () => {
		const UserSchema = z.object({
			id: z.number(),
			name: z.string(),
			email: z.string().email(),
		});

		const schema = {
			user: UserSchema,
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.user = { id: 1, name: "John", email: "john@example.com" };
		expect(facts.user.name).toBe("John");

		expect(() => {
			facts.user = { id: "1", name: "John", email: "john@example.com" } as never;
		}).toThrow("Validation failed");
	});

	it("should validate Zod nullable schema", () => {
		const schema = {
			name: z.string().nullable(),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.name = "hello";
		expect(facts.name).toBe("hello");

		facts.name = null;
		expect(facts.name).toBe(null);

		expect(() => {
			facts.name = 123 as never;
		}).toThrow("Validation failed");
	});

	it("should validate Zod array schema", () => {
		const schema = {
			tags: z.array(z.string()),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.tags = ["a", "b", "c"];
		expect(facts.tags).toEqual(["a", "b", "c"]);

		expect(() => {
			facts.tags = [1, 2, 3] as never;
		}).toThrow("Validation failed");
	});

	it("should validate Zod union schema", () => {
		// Union that allows empty string or valid email
		const EmailOrEmpty = z.union([z.literal(""), z.string().email()]);
		const schema = {
			email: EmailOrEmpty,
		};

		const { facts } = createFacts({ schema, validate: true });

		// Empty string is valid
		facts.email = "";
		expect(facts.email).toBe("");

		// Valid email is valid
		facts.email = "test@example.com";
		expect(facts.email).toBe("test@example.com");

		// Invalid email throws
		expect(() => {
			facts.email = "not-an-email";
		}).toThrow("Validation failed");
	});

	it("should work with mixed t.*() and Zod schemas", () => {
		const schema = {
			// Using t.*() builder
			count: t.number().min(0),
			name: t.string(),
			// Using Zod
			email: z.string().email(),
			status: z.enum(["active", "inactive"]),
		};

		const { facts } = createFacts({ schema, validate: true });

		facts.count = 10;
		facts.name = "Test";
		facts.email = "test@example.com";
		facts.status = "active";

		// t.*() validation works
		expect(() => {
			facts.count = -5;
		}).toThrow("Validation failed");

		// Zod validation works
		expect(() => {
			facts.email = "invalid";
		}).toThrow("Validation failed");
	});

	it("should provide meaningful error messages from Zod", () => {
		const schema = {
			age: z.number().min(0, "Age must be positive").max(150, "Age too high"),
		};

		const { facts } = createFacts({ schema, validate: true });

		try {
			facts.age = -1;
			// Should not reach here
			expect(true).toBe(false);
		} catch (e) {
			const error = e as Error;
			expect(error.message).toContain("Validation failed");
			expect(error.message).toContain("age");
		}
	});

	it("should skip validation for type assertion schemas", () => {
		// type assertion: {} as { ... } - no _validators, no safeParse
		const schema = {} as { count: number; name: string };

		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		// Should not throw - type assertion has no validation
		facts.count = "not a number" as unknown as number;
		expect(facts.count).toBe("not a number");
	});
});

describe("Nested Batching", () => {
	const schema = {
		count: t.number(),
		name: t.string(),
		active: t.boolean(),
	};

	it("should coalesce notifications for nested batches", () => {
		const { store } = createFacts({ schema, strictKeys: false });
		const listener = vi.fn();

		store.subscribeAll(listener);

		store.batch(() => {
			store.set("count", 1);
			store.batch(() => {
				store.set("name", "inner");
			});
			store.set("active", true);
		});

		// Should notify only once for the entire batch, not 3 times
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should handle deeply nested batches", () => {
		const { store } = createFacts({ schema, strictKeys: false });
		const listener = vi.fn();

		store.subscribeAll(listener);

		store.batch(() => {
			store.set("count", 1);
			store.batch(() => {
				store.set("name", "level2");
				store.batch(() => {
					store.set("active", true);
				});
			});
		});

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("toObject() Behavior", () => {
	const schema = {
		count: t.number(),
		name: t.string(),
	};

	it("should not include deleted keys in toObject()", () => {
		const { store } = createFacts({ schema, strictKeys: false });

		store.set("count", 42);
		store.set("name", "test");
		store.delete("count");

		const obj = store.toObject();
		expect(obj).toEqual({ name: "test" });
		expect("count" in obj).toBe(false);
	});

	it("should handle set-delete-set cycle correctly", () => {
		const { store } = createFacts({ schema, strictKeys: false });

		store.set("count", 1);
		store.delete("count");
		store.set("count", 2);

		const obj = store.toObject();
		expect(obj).toEqual({ count: 2 });
	});
});

describe("New Schema Type Builders", () => {
	it("should create union type", () => {
		const unionType = t.union(t.string(), t.number());
		expect(unionType._validators[0]!("hello")).toBe(true);
		expect(unionType._validators[0]!(42)).toBe(true);
		expect(unionType._validators[0]!(true as never)).toBe(false);
	});

	it("should validate union at boundary", () => {
		const schema = {
			value: t.union(t.string(), t.number()),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		facts.value = "hello";
		expect(facts.value).toBe("hello");

		facts.value = 42;
		expect(facts.value).toBe(42);

		expect(() => {
			facts.value = true as never;
		}).toThrow("Validation failed");
	});

	it("should create record type", () => {
		const recordType = t.record(t.number());
		expect(recordType._validators[0]!({ a: 1, b: 2 })).toBe(true);
		expect(recordType._validators[0]!({ a: "string" } as never)).toBe(false);
		expect(recordType._validators[0]!([] as never)).toBe(false);
	});

	it("should validate record at boundary", () => {
		const schema = {
			scores: t.record(t.number()),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		facts.scores = { alice: 100, bob: 85 };
		expect(facts.scores).toEqual({ alice: 100, bob: 85 });

		expect(() => {
			facts.scores = { alice: "not a number" } as never;
		}).toThrow("Validation failed");
	});

	it("should create tuple type", () => {
		const tupleType = t.tuple(t.string(), t.number());
		expect(tupleType._validators[0]!(["hello", 42])).toBe(true);
		expect(tupleType._validators[0]!([42, "hello"] as never)).toBe(false);
		expect(tupleType._validators[0]!(["hello"] as never)).toBe(false);
		expect(tupleType._validators[0]!(["hello", 42, "extra"] as never)).toBe(false);
	});

	it("should validate tuple at boundary", () => {
		const schema = {
			coord: t.tuple(t.string(), t.number()),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		facts.coord = ["x", 10];
		expect(facts.coord).toEqual(["x", 10]);

		expect(() => {
			facts.coord = [10, "x"] as never;
		}).toThrow("Validation failed");
	});

	it("should create date type", () => {
		const dateType = t.date();
		expect(dateType._validators[0]!(new Date())).toBe(true);
		expect(dateType._validators[0]!(new Date("invalid") as never)).toBe(false);
		expect(dateType._validators[0]!("2024-01-01" as never)).toBe(false);
	});

	it("should create uuid type", () => {
		const uuidType = t.uuid();
		expect(uuidType._validators[0]!("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
		expect(uuidType._validators[0]!("not-a-uuid")).toBe(false);
		expect(uuidType._validators[0]!("550e8400-e29b-41d4-a716")).toBe(false);
	});

	it("should create email type", () => {
		const emailType = t.email();
		expect(emailType._validators[0]!("test@example.com")).toBe(true);
		expect(emailType._validators[0]!("user.name+tag@domain.co.uk")).toBe(true);
		expect(emailType._validators[0]!("not-an-email")).toBe(false);
		expect(emailType._validators[0]!("@example.com")).toBe(false);
	});

	it("should create url type", () => {
		const urlType = t.url();
		expect(urlType._validators[0]!("https://example.com")).toBe(true);
		expect(urlType._validators[0]!("http://localhost:3000/path")).toBe(true);
		expect(urlType._validators[0]!("not-a-url")).toBe(false);
		expect(urlType._validators[0]!("example.com")).toBe(false);
	});
});

describe("Default Values", () => {
	it("should store default value on schema type", () => {
		const stringWithDefault = t.string().default("hello");
		expect((stringWithDefault as { _default?: string })._default).toBe("hello");

		const numberWithDefault = t.number().default(42);
		expect((numberWithDefault as { _default?: number })._default).toBe(42);
	});

	it("should support function defaults", () => {
		const dynamicDefault = t.string().default(() => "generated");
		const defaultFn = (dynamicDefault as { _default?: () => string })._default;
		expect(typeof defaultFn).toBe("function");
		expect(defaultFn?.()).toBe("generated");
	});

	it("should support enum defaults", () => {
		const enumWithDefault = t.enum("a", "b", "c").default("b");
		expect((enumWithDefault as { _default?: string })._default).toBe("b");
	});
});

describe("Transform Support", () => {
	it("should store transform function on schema type", () => {
		const transformedString = t.string().transform((s) => s.toUpperCase());
		expect((transformedString as { _transform?: (v: unknown) => unknown })._transform).toBeDefined();
	});

	it("should chain transforms via composition", () => {
		// Test that transform captures a function
		const trimmed = t.string().transform((s: string) => s.trim());
		const trimFn = (trimmed as { _transform?: (v: unknown) => unknown })._transform;
		expect(trimFn?.("  hello  ")).toBe("hello");

		// For chained transforms, compose manually
		const transform = (s: string) => s.trim().toUpperCase();
		const composed = t.string().transform(transform);
		const composedFn = (composed as { _transform?: (v: unknown) => unknown })._transform;
		expect(composedFn?.("  hello  ")).toBe("HELLO");
	});
});

describe("Branded Types", () => {
	it("should create branded string type", () => {
		const UserId = t.string().brand<"UserId">();
		expect(UserId._validators[0]!("user-123")).toBe(true);
		expect(UserId._typeName).toBe("Branded<string>");
	});

	it("should create branded number type", () => {
		const Age = t.number().min(0).brand<"Age">();
		// All validators should pass for valid value
		expect(Age._validators.every(v => v(25))).toBe(true);
		// At least one validator should fail for invalid value
		expect(Age._validators.every(v => v(-5 as never))).toBe(false);
	});
});

describe("Strict Keys Mode", () => {
	const schema = {
		count: t.number(),
	};

	it("should throw on unknown keys when strictKeys is true", () => {
		const { facts } = createFacts({ schema, validate: true, strictKeys: true });

		expect(() => {
			(facts as Record<string, unknown>).unknown = 42;
		}).toThrow("Unknown fact key");
	});

	it("should warn but not throw when strictKeys is false", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		// Should not throw
		(facts as Record<string, unknown>).unknown = 42;
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown fact key"));

		warnSpy.mockRestore();
	});
});

describe("Redacted Errors", () => {
	it("should redact values in error messages when redactErrors is true", () => {
		const schema = {
			password: t.string().validate((s) => s.length >= 8),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false, redactErrors: true });

		try {
			facts.password = "short";
			expect(true).toBe(false); // Should not reach here
		} catch (e) {
			const error = e as Error;
			expect(error.message).toContain("[redacted]");
			expect(error.message).not.toContain("short");
		}
	});

	it("should show values in error messages when redactErrors is false", () => {
		const schema = {
			name: t.string().validate((s) => s.length >= 3),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false, redactErrors: false });

		try {
			facts.name = "ab";
			expect(true).toBe(false); // Should not reach here
		} catch (e) {
			const error = e as Error;
			expect(error.message).toContain('"ab"');
		}
	});
});

describe("Empty Enum Warning", () => {
	it("should warn when creating empty enum (dev mode)", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		t.enum();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("t.enum() called with no values")
		);
		warnSpy.mockRestore();
	});
});

describe("Array Index in Errors", () => {
	it("should include array index in validation error", () => {
		const schema = {
			numbers: t.array<number>().of(t.number()),
		};

		const { facts } = createFacts({ schema, validate: true, strictKeys: false });

		try {
			facts.numbers = [1, 2, "three" as unknown as number, 4];
			expect(true).toBe(false); // Should not reach here
		} catch (e) {
			const error = e as Error;
			expect(error.message).toContain("element at index 2 failed");
		}
	});
});

describe("t.any() Warning Debouncing", () => {
	it("should only warn once for t.any()", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Call t.any() multiple times
		t.any<string>();
		t.any<number>();
		t.any<boolean>();

		// Should only have warned once (plus any other warnings)
		const anyWarnings = warnSpy.mock.calls.filter(
			(call) => call[0]?.toString().includes("t.any()")
		);
		expect(anyWarnings.length).toBeLessThanOrEqual(1);

		warnSpy.mockRestore();
	});
});

describe("Chainable .describe() Method", () => {
	it("should add description to schema type", () => {
		const Age = t.number().min(0).max(150).describe("User's age in years");
		expect(Age._description).toBe("User's age in years");
		expect(Age._validators[0]!(25)).toBe(true);
	});

	it("should preserve description through chaining", () => {
		const Email = t.string().describe("User email address").brand<"Email">();
		expect(Email._description).toBe("User email address");
	});
});

describe("Chainable .refine() Method", () => {
	it("should add custom refinement with message", () => {
		const EvenNumber = t.number().refine(
			(n) => n % 2 === 0,
			"Must be an even number"
		);
		expect(EvenNumber._refinements).toHaveLength(1);
		expect(EvenNumber._refinements![0]!.message).toBe("Must be an even number");
		expect(EvenNumber._validators.every(v => v(4))).toBe(true);
		expect(EvenNumber._validators.every(v => v(5))).toBe(false);
	});

	it("should support multiple refinements", () => {
		const SpecialNumber = t.number()
			.refine((n) => n > 0, "Must be positive")
			.refine((n) => n < 100, "Must be less than 100");
		expect(SpecialNumber._refinements).toHaveLength(2);
		expect(SpecialNumber._validators.every(v => v(50))).toBe(true);
		expect(SpecialNumber._validators.every(v => v(-1))).toBe(false);
		expect(SpecialNumber._validators.every(v => v(150))).toBe(false);
	});
});

describe("Chainable .nullable() and .optional() Methods", () => {
	it("should support chainable .nullable()", () => {
		const NullableString = t.string().nullable();
		expect(NullableString._typeName).toBe("string | null");
		expect(NullableString._validators[0]!("hello")).toBe(true);
		expect(NullableString._validators[0]!(null)).toBe(true);
		expect(NullableString._validators[0]!(undefined)).toBe(false);
	});

	it("should support chainable .optional()", () => {
		const OptionalNumber = t.number().optional();
		expect(OptionalNumber._typeName).toBe("number | undefined");
		expect(OptionalNumber._validators[0]!(42)).toBe(true);
		expect(OptionalNumber._validators[0]!(undefined)).toBe(true);
		expect(OptionalNumber._validators[0]!(null)).toBe(false);
	});

	it("should work with other chainable methods", () => {
		const OptionalPositive = t.number().min(0).optional();
		expect(OptionalPositive._validators[0]!(undefined)).toBe(true);
		// Note: min() validator is separate from the optional wrapper
	});
});

describe("t.bigint() Type", () => {
	it("should create bigint schema type", () => {
		const BigNumber = t.bigint();
		expect(BigNumber._typeName).toBe("bigint");
		expect(BigNumber._validators[0]!(BigInt(123))).toBe(true);
		expect(BigNumber._validators[0]!(123)).toBe(false);
		expect(BigNumber._validators[0]!("123")).toBe(false);
	});

	it("should support chainable methods", () => {
		const BigId = t.bigint().describe("Large identifier").brand<"BigId">();
		expect(BigId._description).toBe("Large identifier");
		expect(BigId._typeName).toBe("Branded<bigint>");
	});
});

describe("Empty Union/Tuple Warnings", () => {
	it("should warn for empty t.union()", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		t.union();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("t.union() called with no types")
		);
		warnSpy.mockRestore();
	});

	it("should warn for empty t.tuple()", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		t.tuple();
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("t.tuple() called with no types")
		);
		warnSpy.mockRestore();
	});
});

describe("Chainable Methods on All Types", () => {
	it("t.union() should support chainable methods", () => {
		const StringOrNumber = t.union(t.string(), t.number()).describe("Mixed value");
		expect(StringOrNumber._description).toBe("Mixed value");
	});

	it("t.record() should support chainable methods", () => {
		const Metadata = t.record(t.string()).describe("Key-value metadata");
		expect(Metadata._description).toBe("Key-value metadata");
	});

	it("t.tuple() should support chainable methods", () => {
		const Coordinate = t.tuple(t.number(), t.number()).describe("X,Y position");
		expect(Coordinate._description).toBe("X,Y position");
	});

	it("t.literal() should support chainable methods", () => {
		const Admin = t.literal("admin").describe("Admin role");
		expect(Admin._description).toBe("Admin role");
	});

	it("t.enum() should support chainable methods", () => {
		const Status = t.enum("active", "inactive").describe("User status");
		expect(Status._description).toBe("User status");
	});
});
