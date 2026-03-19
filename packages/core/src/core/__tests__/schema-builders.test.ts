import { describe, expect, it, vi } from "vitest";
import { t } from "../../index.js";
import type { ExtendedSchemaType } from "../../index.js";

/** Helper: run all _validators against a value */
function validates<T>(schema: { _validators: Array<(v: T) => boolean> }, value: T): boolean {
  return schema._validators.every((fn) => fn(value));
}

// ============================================================================
// t.string()
// ============================================================================

describe("t.string()", () => {
  it("accepts a string value", () => {
    const schema = t.string();

    expect(validates(schema, "hello")).toBe(true);
  });

  it("rejects non-string values", () => {
    const schema = t.string();

    expect(validates(schema, 42 as unknown as string)).toBe(false);
    expect(validates(schema, null as unknown as string)).toBe(false);
    expect(validates(schema, undefined as unknown as string)).toBe(false);
    expect(validates(schema, true as unknown as string)).toBe(false);
  });

  it("narrows generic string literals at the type level", () => {
    const schema = t.string<"red" | "green">();

    expect(validates(schema, "red")).toBe(true);
    // Runtime validator only checks typeof — generic narrowing is type-level only
    expect(validates(schema, "blue")).toBe(true);
  });

  it(".validate() adds a custom validator", () => {
    const schema = t.string().validate((s) => s.length > 0);

    expect(validates(schema, "ok")).toBe(true);
    expect(validates(schema, "")).toBe(false);
  });

  it(".default() stores a default value", () => {
    const schema = t.string().default("fallback") as ExtendedSchemaType<string>;

    expect(schema._default).toBe("fallback");
  });

  it(".default() stores a factory function", () => {
    const factory = () => "dynamic";
    const schema = t.string().default(factory) as ExtendedSchemaType<string>;

    expect(schema._default).toBe(factory);
  });

  it(".transform() stores a transform function", () => {
    const schema = t.string().transform((s) => s.toUpperCase()) as ExtendedSchemaType<string>;

    expect(schema._transform!("hello")).toBe("HELLO");
  });

  it(".brand() updates the type name", () => {
    const schema = t.string().brand<"UserId">() as ExtendedSchemaType<string>;

    expect(schema._typeName).toBe("Branded<string>");
  });

  it(".describe() stores a description", () => {
    const schema = t.string().describe("A name field") as ExtendedSchemaType<string>;

    expect(schema._description).toBe("A name field");
  });

  it(".refine() adds a validator and records the refinement", () => {
    const schema = t.string().refine((s) => s.startsWith("@"), "must start with @") as ExtendedSchemaType<string>;

    expect(validates(schema, "@user")).toBe(true);
    expect(validates(schema, "user")).toBe(false);
    expect(schema._refinements).toHaveLength(1);
    expect(schema._refinements![0]!.message).toBe("must start with @");
  });

  it(".nullable() accepts null and valid strings", () => {
    const schema = t.string().nullable();

    expect(validates(schema, null as unknown as string | null)).toBe(true);
    expect(validates(schema, "hello" as string | null)).toBe(true);
    expect(validates(schema, 42 as unknown as string | null)).toBe(false);
  });

  it(".optional() accepts undefined and valid strings", () => {
    const schema = t.string().optional();

    expect(validates(schema, undefined as unknown as string | undefined)).toBe(true);
    expect(validates(schema, "hello" as string | undefined)).toBe(true);
    expect(validates(schema, 42 as unknown as string | undefined)).toBe(false);
  });
});

// ============================================================================
// t.number()
// ============================================================================

describe("t.number()", () => {
  it("accepts a number value", () => {
    const schema = t.number();

    expect(validates(schema, 42)).toBe(true);
    expect(validates(schema, 0)).toBe(true);
    expect(validates(schema, -3.14)).toBe(true);
  });

  it("rejects non-number values", () => {
    const schema = t.number();

    expect(validates(schema, "42" as unknown as number)).toBe(false);
    expect(validates(schema, null as unknown as number)).toBe(false);
  });

  it(".min() rejects values below the minimum", () => {
    const schema = t.number().min(0);

    expect(validates(schema, 0)).toBe(true);
    expect(validates(schema, 10)).toBe(true);
    expect(validates(schema, -1)).toBe(false);
  });

  it(".max() rejects values above the maximum", () => {
    const schema = t.number().max(100);

    expect(validates(schema, 100)).toBe(true);
    expect(validates(schema, 50)).toBe(true);
    expect(validates(schema, 101)).toBe(false);
  });

  it(".min().max() chains to create a range", () => {
    const schema = t.number().min(0).max(150);

    expect(validates(schema, 0)).toBe(true);
    expect(validates(schema, 75)).toBe(true);
    expect(validates(schema, 150)).toBe(true);
    expect(validates(schema, -1)).toBe(false);
    expect(validates(schema, 151)).toBe(false);
  });

  it(".default() stores a default value", () => {
    const schema = t.number().default(0) as ExtendedSchemaType<number>;

    expect(schema._default).toBe(0);
  });

  it(".transform() stores a transform function", () => {
    const schema = t.number().transform((n) => n * 2) as ExtendedSchemaType<number>;

    expect(schema._transform!(5)).toBe(10);
  });

  it(".describe() stores a description", () => {
    const schema = t.number().describe("Age in years") as ExtendedSchemaType<number>;

    expect(schema._description).toBe("Age in years");
  });

  it(".refine() adds a validator and records the refinement", () => {
    const schema = t.number().refine((n) => n % 2 === 0, "must be even") as ExtendedSchemaType<number>;

    expect(validates(schema, 4)).toBe(true);
    expect(validates(schema, 3)).toBe(false);
    expect(schema._refinements).toHaveLength(1);
    expect(schema._refinements![0]!.message).toBe("must be even");
  });
});

// ============================================================================
// t.boolean()
// ============================================================================

describe("t.boolean()", () => {
  it("accepts boolean values", () => {
    const schema = t.boolean();

    expect(validates(schema, true)).toBe(true);
    expect(validates(schema, false)).toBe(true);
  });

  it("rejects non-boolean values", () => {
    const schema = t.boolean();

    expect(validates(schema, 0 as unknown as boolean)).toBe(false);
    expect(validates(schema, "true" as unknown as boolean)).toBe(false);
    expect(validates(schema, null as unknown as boolean)).toBe(false);
  });

  it(".default() stores a default value", () => {
    const schema = t.boolean().default(false) as ExtendedSchemaType<boolean>;

    expect(schema._default).toBe(false);
  });

  it(".describe() stores a description", () => {
    const schema = t.boolean().describe("Is active") as ExtendedSchemaType<boolean>;

    expect(schema._description).toBe("Is active");
  });
});

// ============================================================================
// t.array()
// ============================================================================

describe("t.array()", () => {
  it("accepts an array value", () => {
    const schema = t.array<string>();

    expect(validates(schema, ["a", "b"])).toBe(true);
    expect(validates(schema, [])).toBe(true);
  });

  it("rejects non-array values", () => {
    const schema = t.array<string>();

    expect(validates(schema, "not array" as unknown as string[])).toBe(false);
    expect(validates(schema, {} as unknown as string[])).toBe(false);
    expect(validates(schema, null as unknown as string[])).toBe(false);
  });

  it(".of() validates each element against the inner type", () => {
    const schema = t.array<string>().of(t.string());

    expect(validates(schema, ["hello", "world"])).toBe(true);
    expect(validates(schema, [42 as unknown as string])).toBe(false);
  });

  it(".of() tracks _lastFailedIndex on element failure", () => {
    const schema = t.array<string>().of(t.string());

    validates(schema, ["ok", 99 as unknown as string, "fine"]);

    expect(schema._lastFailedIndex).toBe(1);
  });

  it(".nonEmpty() rejects empty arrays", () => {
    const schema = t.array<number>().nonEmpty();

    expect(validates(schema, [1])).toBe(true);
    expect(validates(schema, [])).toBe(false);
  });

  it(".maxLength() rejects arrays exceeding the max", () => {
    const schema = t.array<number>().maxLength(2);

    expect(validates(schema, [1, 2])).toBe(true);
    expect(validates(schema, [1, 2, 3])).toBe(false);
  });

  it(".minLength() rejects arrays shorter than the min", () => {
    const schema = t.array<number>().minLength(2);

    expect(validates(schema, [1, 2])).toBe(true);
    expect(validates(schema, [1])).toBe(false);
  });

  it(".default() stores a default value", () => {
    const schema = t.array<string>().default(["a"]) as ExtendedSchemaType<string[]>;

    expect(schema._default).toEqual(["a"]);
  });

  it(".describe() stores a description", () => {
    const schema = t.array<string>().describe("Tags list") as ExtendedSchemaType<string[]>;

    expect(schema._description).toBe("Tags list");
  });

  it("chains .of().nonEmpty().maxLength()", () => {
    const schema = t.array<string>().of(t.string()).nonEmpty().maxLength(3);

    expect(validates(schema, ["a"])).toBe(true);
    expect(validates(schema, ["a", "b", "c"])).toBe(true);
    expect(validates(schema, [])).toBe(false);
    expect(validates(schema, ["a", "b", "c", "d"])).toBe(false);
  });
});

// ============================================================================
// t.object()
// ============================================================================

describe("t.object()", () => {
  it("accepts a plain object", () => {
    const schema = t.object<{ name: string }>();

    expect(validates(schema, { name: "test" })).toBe(true);
  });

  it("rejects non-object values", () => {
    const schema = t.object<{ name: string }>();

    expect(validates(schema, null as unknown as { name: string })).toBe(false);
    expect(validates(schema, "obj" as unknown as { name: string })).toBe(false);
    expect(validates(schema, 42 as unknown as { name: string })).toBe(false);
  });

  it("rejects arrays (arrays are not plain objects)", () => {
    const schema = t.object<{ name: string }>();

    expect(validates(schema, [] as unknown as { name: string })).toBe(false);
  });

  it(".shape() validates individual properties", () => {
    const schema = t.object<{ name: string; age: number }>().shape({
      name: t.string(),
      age: t.number(),
    });

    expect(validates(schema, { name: "Alice", age: 30 })).toBe(true);
    expect(validates(schema, { name: "Alice", age: "30" as unknown as number })).toBe(false);
  });

  it(".nonNull() rejects null and undefined", () => {
    const schema = t.object<{ x: number }>().nonNull();

    expect(validates(schema, { x: 1 })).toBe(true);
    // nonNull adds a validator on top of the base object validator
    // null is already rejected by the base object check, but nonNull ensures it explicitly
    expect(validates(schema, null as unknown as { x: number })).toBe(false);
  });

  it(".hasKeys() requires specific keys to be present", () => {
    const schema = t.object<Record<string, unknown>>().hasKeys("id", "name");

    expect(validates(schema, { id: 1, name: "test", extra: true } as Record<string, unknown>)).toBe(true);
    expect(validates(schema, { id: 1 } as Record<string, unknown>)).toBe(false);
  });

  it(".default() stores a default value", () => {
    const schema = t.object<{ x: number }>().default({ x: 0 }) as ExtendedSchemaType<{ x: number }>;

    expect(schema._default).toEqual({ x: 0 });
  });

  it(".describe() stores a description", () => {
    const schema = t.object<{ x: number }>().describe("Position") as ExtendedSchemaType<{ x: number }>;

    expect(schema._description).toBe("Position");
  });
});

// ============================================================================
// t.enum()
// ============================================================================

describe("t.enum()", () => {
  it("accepts values in the enum set", () => {
    const schema = t.enum("idle", "loading", "success", "error");

    expect(validates(schema, "idle")).toBe(true);
    expect(validates(schema, "error")).toBe(true);
  });

  it("rejects values not in the enum set", () => {
    const schema = t.enum("idle", "loading", "success", "error");

    expect(validates(schema, "pending" as unknown as string)).toBe(false);
    expect(validates(schema, 42 as unknown as string)).toBe(false);
  });

  it("warns in dev mode when called with no values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    t.enum();

    expect(warnSpy).toHaveBeenCalledWith(
      "[Directive] t.enum() called with no values - this will reject all strings",
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// t.literal()
// ============================================================================

describe("t.literal()", () => {
  it("matches an exact string value", () => {
    const schema = t.literal("user");

    expect(validates(schema, "user")).toBe(true);
    expect(validates(schema, "admin" as unknown as "user")).toBe(false);
  });

  it("matches an exact number value", () => {
    const schema = t.literal(1);

    expect(validates(schema, 1)).toBe(true);
    expect(validates(schema, 2 as unknown as 1)).toBe(false);
  });

  it("matches an exact boolean value", () => {
    const schema = t.literal(true);

    expect(validates(schema, true)).toBe(true);
    expect(validates(schema, false as unknown as true)).toBe(false);
  });
});

// ============================================================================
// t.nullable()
// ============================================================================

describe("t.nullable()", () => {
  it("accepts null", () => {
    const schema = t.nullable(t.string());

    expect(validates(schema, null)).toBe(true);
  });

  it("accepts the inner type when not null", () => {
    const schema = t.nullable(t.string());

    expect(validates(schema, "hello")).toBe(true);
  });

  it("rejects values that fail inner validation and are not null", () => {
    const schema = t.nullable(t.string());

    expect(validates(schema, 42 as unknown as string | null)).toBe(false);
  });
});

// ============================================================================
// t.optional()
// ============================================================================

describe("t.optional()", () => {
  it("accepts undefined", () => {
    const schema = t.optional(t.number());

    expect(validates(schema, undefined)).toBe(true);
  });

  it("accepts the inner type when not undefined", () => {
    const schema = t.optional(t.number());

    expect(validates(schema, 42)).toBe(true);
  });

  it("rejects values that fail inner validation and are not undefined", () => {
    const schema = t.optional(t.number());

    expect(validates(schema, "nope" as unknown as number | undefined)).toBe(false);
  });
});

// ============================================================================
// t.union()
// ============================================================================

describe("t.union()", () => {
  it("accepts any value matching one of the types", () => {
    const schema = t.union(t.string(), t.number());

    expect(validates(schema, "hello")).toBe(true);
    expect(validates(schema, 42)).toBe(true);
  });

  it("rejects values that match none of the types", () => {
    const schema = t.union(t.string(), t.number());

    expect(validates(schema, true as unknown as string | number)).toBe(false);
    expect(validates(schema, null as unknown as string | number)).toBe(false);
  });

  it("warns in dev mode when called with no types", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    t.union();

    expect(warnSpy).toHaveBeenCalledWith(
      "[Directive] t.union() called with no types - this will reject all values",
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// t.record()
// ============================================================================

describe("t.record()", () => {
  it("accepts an object with all values matching the value type", () => {
    const schema = t.record(t.number());

    expect(validates(schema, { a: 1, b: 2 } as Record<string, number>)).toBe(true);
    expect(validates(schema, {} as Record<string, number>)).toBe(true);
  });

  it("rejects when any value fails the inner type validation", () => {
    const schema = t.record(t.number());

    expect(validates(schema, { a: 1, b: "two" } as unknown as Record<string, number>)).toBe(false);
  });

  it("rejects non-object values", () => {
    const schema = t.record(t.string());

    expect(validates(schema, null as unknown as Record<string, string>)).toBe(false);
    expect(validates(schema, "str" as unknown as Record<string, string>)).toBe(false);
    expect(validates(schema, [] as unknown as Record<string, string>)).toBe(false);
  });
});

// ============================================================================
// t.tuple()
// ============================================================================

describe("t.tuple()", () => {
  it("accepts a tuple with matching element types", () => {
    const schema = t.tuple(t.string(), t.number());

    expect(validates(schema, ["hello", 42] as unknown as [string, number])).toBe(true);
  });

  it("rejects a tuple with wrong length", () => {
    const schema = t.tuple(t.string(), t.number());

    expect(validates(schema, ["hello"] as unknown as [string, number])).toBe(false);
    expect(validates(schema, ["hello", 42, true] as unknown as [string, number])).toBe(false);
  });

  it("rejects when element types do not match", () => {
    const schema = t.tuple(t.string(), t.number());

    expect(validates(schema, [42, "hello"] as unknown as [string, number])).toBe(false);
  });

  it("rejects non-array values", () => {
    const schema = t.tuple(t.string());

    expect(validates(schema, "hello" as unknown as [string])).toBe(false);
    expect(validates(schema, {} as unknown as [string])).toBe(false);
  });

  it("warns in dev mode when called with no types", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    t.tuple();

    expect(warnSpy).toHaveBeenCalledWith(
      "[Directive] t.tuple() called with no types - this will only accept empty arrays",
    );

    warnSpy.mockRestore();
  });
});

// ============================================================================
// t.date()
// ============================================================================

describe("t.date()", () => {
  it("accepts a valid Date instance", () => {
    const schema = t.date();

    expect(validates(schema, new Date())).toBe(true);
    expect(validates(schema, new Date("2025-01-01"))).toBe(true);
  });

  it("rejects an invalid Date (NaN time)", () => {
    const schema = t.date();

    expect(validates(schema, new Date("not-a-date"))).toBe(false);
  });

  it("rejects non-Date values", () => {
    const schema = t.date();

    expect(validates(schema, "2025-01-01" as unknown as Date)).toBe(false);
    expect(validates(schema, 1234567890 as unknown as Date)).toBe(false);
    expect(validates(schema, null as unknown as Date)).toBe(false);
  });
});

// ============================================================================
// t.uuid()
// ============================================================================

describe("t.uuid()", () => {
  it("accepts a valid UUID v4", () => {
    const schema = t.uuid();

    expect(validates(schema, "550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(validates(schema, "f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects malformed UUIDs", () => {
    const schema = t.uuid();

    expect(validates(schema, "not-a-uuid")).toBe(false);
    expect(validates(schema, "550e8400-e29b-41d4-a716")).toBe(false);
    expect(validates(schema, "")).toBe(false);
  });

  it("rejects non-string values", () => {
    const schema = t.uuid();

    expect(validates(schema, 12345 as unknown as string)).toBe(false);
  });
});

// ============================================================================
// t.email()
// ============================================================================

describe("t.email()", () => {
  it("accepts a valid email address", () => {
    const schema = t.email();

    expect(validates(schema, "user@example.com")).toBe(true);
    expect(validates(schema, "test+tag@domain.co")).toBe(true);
  });

  it("rejects invalid email formats", () => {
    const schema = t.email();

    expect(validates(schema, "not-an-email")).toBe(false);
    expect(validates(schema, "@missing-local.com")).toBe(false);
    expect(validates(schema, "missing@")).toBe(false);
    expect(validates(schema, "")).toBe(false);
  });

  it("rejects non-string values", () => {
    const schema = t.email();

    expect(validates(schema, 42 as unknown as string)).toBe(false);
  });
});

// ============================================================================
// t.url()
// ============================================================================

describe("t.url()", () => {
  it("accepts valid URLs", () => {
    const schema = t.url();

    expect(validates(schema, "https://example.com")).toBe(true);
    expect(validates(schema, "http://localhost:3000/path")).toBe(true);
    expect(validates(schema, "ftp://files.example.com/doc.pdf")).toBe(true);
  });

  it("rejects invalid URLs", () => {
    const schema = t.url();

    expect(validates(schema, "not a url")).toBe(false);
    expect(validates(schema, "")).toBe(false);
    expect(validates(schema, "example.com")).toBe(false);
  });

  it("rejects non-string values", () => {
    const schema = t.url();

    expect(validates(schema, 42 as unknown as string)).toBe(false);
    expect(validates(schema, null as unknown as string)).toBe(false);
  });
});

// ============================================================================
// t.bigint()
// ============================================================================

describe("t.bigint()", () => {
  it("accepts bigint values", () => {
    const schema = t.bigint();

    expect(validates(schema, 0n)).toBe(true);
    expect(validates(schema, 9007199254740991n)).toBe(true);
  });

  it("rejects non-bigint values", () => {
    const schema = t.bigint();

    expect(validates(schema, 42 as unknown as bigint)).toBe(false);
    expect(validates(schema, "42" as unknown as bigint)).toBe(false);
    expect(validates(schema, null as unknown as bigint)).toBe(false);
  });
});

// ============================================================================
// Chaining & Composition
// ============================================================================

describe("chaining and composition", () => {
  it("chaining multiple validators preserves all checks", () => {
    const schema = t.string()
      .validate((s) => s.length >= 3)
      .validate((s) => s.startsWith("a"));

    expect(validates(schema, "abc")).toBe(true);
    expect(validates(schema, "ab")).toBe(false);
    expect(validates(schema, "bcd")).toBe(false);
  });

  it("transform composes with an existing transform", () => {
    const schema = t.string()
      .transform((s) => s.trim())
      .transform((s) => s.toUpperCase()) as ExtendedSchemaType<string>;

    expect(schema._transform!("  hello  ")).toBe("HELLO");
  });

  it("multiple refines accumulate validators and refinement metadata", () => {
    const schema = t.number()
      .refine((n) => n > 0, "must be positive")
      .refine((n) => n < 100, "must be under 100") as ExtendedSchemaType<number>;

    expect(validates(schema, 50)).toBe(true);
    expect(validates(schema, -1)).toBe(false);
    expect(validates(schema, 200)).toBe(false);
    expect(schema._refinements).toHaveLength(2);
  });
});
