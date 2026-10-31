// Ported from packages/core/src/core/__tests__/l3-small-oracle-schema-builders.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the schema builders' validators: what each `t.*` type
// accepts and rejects, through the `_validators` every SchemaType exposes.
// No message text, no dev-mode diagnostics beyond "a valid call stays quiet".
// The last block reads the name each type gives itself (`_typeName`, public on
// ExtendedSchemaType) and checks that a failed write names it.

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run every validator of a schema type against one value. */
function accepts(
  schema: { _validators: Array<(v: any) => boolean> },
  value: unknown,
) {
  return schema._validators.every((fn) => fn(value));
}

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("string length and pattern", () => {
  it("minLength accepts the exact length and more, rejects less", () => {
    const schema = t.string().minLength(3);

    expect(accepts(schema, "ab")).toBe(false);
    expect(accepts(schema, "abc")).toBe(true);
    expect(accepts(schema, "abcd")).toBe(true);
  });

  it("maxLength accepts the exact length and less, rejects more", () => {
    const schema = t.string().maxLength(3);

    expect(accepts(schema, "abcd")).toBe(false);
    expect(accepts(schema, "abc")).toBe(true);
    expect(accepts(schema, "")).toBe(true);
  });

  it("pattern accepts only what the expression matches", () => {
    const schema = t.string().pattern(/^a+$/);

    expect(accepts(schema, "aaa")).toBe(true);
    expect(accepts(schema, "ab")).toBe(false);
    expect(accepts(schema, "")).toBe(false);
  });

  it("each constraint keeps the type check and the ones before it", () => {
    const schema = t
      .string()
      .minLength(2)
      .maxLength(4)
      .pattern(/^[a-z]+$/);

    expect(accepts(schema, "a")).toBe(false);
    expect(accepts(schema, "abc")).toBe(true);
    expect(accepts(schema, "abcde")).toBe(false);
    expect(accepts(schema, "AB")).toBe(false);
    expect(accepts(schema, 123)).toBe(false);
    expect(accepts(t.string().minLength(0).maxLength(9), 12345)).toBe(false);
    expect(accepts(t.string().minLength(0).pattern(/./), 12345)).toBe(false);
  });
});

describe("nullable and optional keep the inner constraints", () => {
  it("nullable accepts null and a value the inner type accepts", () => {
    const schema = t.string().minLength(3).nullable();

    expect(accepts(schema, null)).toBe(true);
    expect(accepts(schema, "abc")).toBe(true);
    expect(accepts(schema, "ab")).toBe(false);
    expect(accepts(schema, 5)).toBe(false);
    expect(accepts(schema, undefined)).toBe(false);
  });

  it("optional accepts undefined and a value the inner type accepts", () => {
    const schema = t.string().minLength(3).optional();

    expect(accepts(schema, undefined)).toBe(true);
    expect(accepts(schema, "abc")).toBe(true);
    expect(accepts(schema, "ab")).toBe(false);
    expect(accepts(schema, null)).toBe(false);
  });

  it("t.nullable and t.optional wrap a type the same way", () => {
    const nullable = t.nullable(t.string().minLength(3));
    const optional = t.optional(t.string().minLength(3));

    expect(accepts(nullable, null)).toBe(true);
    expect(accepts(nullable, "ab")).toBe(false);
    expect(accepts(optional, undefined)).toBe(true);
    expect(accepts(optional, "ab")).toBe(false);
  });
});

describe("containers check every element against every constraint", () => {
  it("an array of constrained elements", () => {
    const schema = t.array<string>().of(t.string().minLength(2));

    expect(accepts(schema, ["ab", "cd"])).toBe(true);
    expect(accepts(schema, [])).toBe(true);
    expect(accepts(schema, ["ab", "c"])).toBe(false);
    expect(accepts(schema, ["a"])).toBe(false);
    expect(accepts(schema, "ab")).toBe(false);
  });

  it("an object shape with a constrained member", () => {
    const schema = t
      .object<{ name: string; age: number }>()
      .shape({ name: t.string().minLength(2), age: t.number() });

    expect(accepts(schema, { name: "ab", age: 1 })).toBe(true);
    expect(accepts(schema, { name: "a", age: 1 })).toBe(false);
    expect(accepts(schema, { name: "ab", age: "x" })).toBe(false);
    expect(accepts(schema, null)).toBe(false);
  });

  it("a record of constrained values", () => {
    const schema = t.record(t.string().minLength(2));

    expect(accepts(schema, { a: "ab", b: "cd" })).toBe(true);
    expect(accepts(schema, {})).toBe(true);
    expect(accepts(schema, { a: "ab", b: "c" })).toBe(false);
    expect(accepts(schema, { a: "x" })).toBe(false);
    expect(accepts(schema, ["ab"])).toBe(false);
    expect(accepts(schema, null)).toBe(false);
  });

  it("a tuple checks length, position and constraints", () => {
    const pair = t.tuple(t.string(), t.number());

    expect(accepts(pair, ["a", 1])).toBe(true);
    expect(accepts(pair, ["a", "b"])).toBe(false);
    expect(accepts(pair, [1, 1])).toBe(false);
    expect(accepts(pair, ["a"])).toBe(false);
    expect(accepts(pair, ["a", 1, 2])).toBe(false);
    expect(accepts(pair, "a1")).toBe(false);

    const constrained = t.tuple(t.string().minLength(2));

    expect(accepts(constrained, ["ab"])).toBe(true);
    expect(accepts(constrained, ["a"])).toBe(false);
  });
});

describe("enum", () => {
  it("accepts only its listed strings", () => {
    const schema = t.enum("a", "b");

    expect(accepts(schema, "a")).toBe(true);
    expect(accepts(schema, "b")).toBe(true);
    expect(accepts(schema, "c")).toBe(false);
    expect(accepts(schema, 1)).toBe(false);
    expect(accepts(schema, undefined)).toBe(false);
  });

  it("a valid enum and a valid tuple are built without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    t.enum("a");
    t.tuple(t.string());

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("uuid, email and url", () => {
  it("uuid matches a whole uuid, in either case, and nothing else", () => {
    const schema = t.uuid();

    expect(accepts(schema, UUID)).toBe(true);
    expect(accepts(schema, UUID.toUpperCase())).toBe(true);
    expect(accepts(schema, `x${UUID}`)).toBe(false);
    expect(accepts(schema, `${UUID}x`)).toBe(false);
    expect(accepts(schema, "not-a-uuid")).toBe(false);
    expect(accepts(schema, 123)).toBe(false);
    // Only a string counts, even one that a number or array would print as.
    expect(accepts(schema, [UUID])).toBe(false);
  });

  it("email needs one address with no whitespace, and a string", () => {
    const schema = t.email();

    expect(accepts(schema, "a@b.co")).toBe(true);
    expect(accepts(schema, "a b@c.de")).toBe(false);
    expect(accepts(schema, "a@b.c d")).toBe(false);
    expect(accepts(schema, "a@b")).toBe(false);
    expect(accepts(schema, 5)).toBe(false);
    expect(accepts(schema, ["a@b.co"])).toBe(false);
  });

  it("url accepts an absolute url string, not text, numbers or URL objects", () => {
    const schema = t.url();

    expect(accepts(schema, "https://example.com/a?b=1")).toBe(true);
    expect(accepts(schema, "not a url")).toBe(false);
    expect(accepts(schema, 42)).toBe(false);
    expect(accepts(schema, new URL("https://example.com"))).toBe(false);
  });
});

describe("any and unknown", () => {
  it("accept every value", () => {
    for (const value of [1, "x", null, undefined, {}, [], Symbol.for("s")]) {
      expect(accepts(t.any(), value)).toBe(true);
      expect(accepts(t.unknown(), value)).toBe(true);
    }
  });
});

/** The name a type gives itself, which a validation error repeats. */
function nameOf(schema: unknown): string | undefined {
  return (schema as { _typeName?: string })._typeName;
}

/** A schema type from outside the builders (no name of its own). */
const nameless = { _type: undefined, _validators: [] } as never;

describe("each builder names its type", () => {
  it("the scalar and format builders", () => {
    expect(nameOf(t.string())).toBe("string");
    expect(nameOf(t.number())).toBe("number");
    expect(nameOf(t.boolean())).toBe("boolean");
    expect(nameOf(t.date())).toBe("Date");
    expect(nameOf(t.uuid())).toBe("uuid");
    expect(nameOf(t.email())).toBe("email");
    expect(nameOf(t.url())).toBe("url");
    expect(nameOf(t.bigint())).toBe("bigint");
    expect(nameOf(t.any())).toBe("any");
    expect(nameOf(t.unknown())).toBe("unknown");
  });

  it("the container builders", () => {
    expect(nameOf(t.array())).toBe("array");
    expect(nameOf(t.array<string>().of(t.string()))).toBe("array");
    expect(nameOf(t.object())).toBe("object");
  });

  it("enum lists its values and literal shows its value", () => {
    expect(nameOf(t.enum("idle", "busy"))).toBe("enum(idle|busy)");
    expect(nameOf(t.enum("only"))).toBe("enum(only)");
    expect(nameOf(t.literal("user"))).toBe("literal(user)");
    expect(nameOf(t.literal(7))).toBe("literal(7)");
    expect(nameOf(t.literal(false))).toBe("literal(false)");
  });

  it("a wrapper names what it wraps", () => {
    expect(nameOf(t.nullable(t.string()))).toBe("string | null");
    expect(nameOf(t.optional(t.number()))).toBe("number | undefined");
    expect(nameOf(t.record(t.boolean()))).toBe("Record<string, boolean>");
    expect(nameOf(t.tuple(t.string(), t.number()))).toBe("[string, number]");
    expect(nameOf(t.tuple(t.date()))).toBe("[Date]");
  });

  it("a wrapper around a type with no name calls it unknown", () => {
    expect(nameOf(t.nullable(nameless))).toBe("unknown | null");
    expect(nameOf(t.optional(nameless))).toBe("unknown | undefined");
    expect(nameOf(t.record(nameless))).toBe("Record<string, unknown>");
    expect(nameOf(t.tuple(nameless, t.string()))).toBe("[unknown, string]");
  });
});
