import { describe, expect, it } from "vitest";
import { t } from "../schema-builders.js";
import {
  getKind,
  getOperatorsForKind,
  getSchemaFieldKinds,
  listAllPredicateOperators,
  type SchemaKindNode,
} from "../schema-introspection.js";

// ============================================================================
// Primitives — _typeName parser path (no explicit _kind needed)
// ============================================================================

describe("getKind — primitive builders", () => {
  it("t.string() → { kind: 'string' }", () => {
    expect(getKind(t.string())).toEqual({ kind: "string" });
  });

  it("t.number() → { kind: 'number' }", () => {
    expect(getKind(t.number())).toEqual({ kind: "number" });
  });

  it("t.boolean() → { kind: 'boolean' }", () => {
    expect(getKind(t.boolean())).toEqual({ kind: "boolean" });
  });

  it("t.string().validate(...) preserves kind", () => {
    expect(getKind(t.string().validate((s) => s.length > 0))).toEqual({
      kind: "string",
    });
  });

  it("t.number().min(0).max(100) preserves kind", () => {
    expect(getKind(t.number().min(0).max(100))).toEqual({ kind: "number" });
  });
});

// ============================================================================
// Wrappers — nullable / optional / branded
// ============================================================================

describe("getKind — chain wrappers", () => {
  it("t.string().nullable() adds nullable: true to inner kind", () => {
    const k = getKind(t.string().nullable());
    expect(k.kind).toBe("string");
    expect(k.nullable).toBe(true);
  });

  it("t.number().optional() adds nullable: true (undefined → null for predicate purposes)", () => {
    const k = getKind(t.number().optional());
    expect(k.kind).toBe("number");
    expect(k.nullable).toBe(true);
  });

  it("t.string().brand<'UserId'>() wraps as branded", () => {
    const k = getKind(t.string().brand<"UserId">());
    expect(k.kind).toBe("branded");
    if (k.kind === "branded") {
      expect(k.inner).toEqual({ kind: "string" });
    }
  });
});

// ============================================================================
// getSchemaFieldKinds — walk a schema
// ============================================================================

describe("getSchemaFieldKinds", () => {
  it("walks a flat facts schema", () => {
    const kinds = getSchemaFieldKinds({
      facts: {
        cartTotal: t.number(),
        region: t.string(),
        active: t.boolean(),
      },
    });
    expect(kinds.get("cartTotal")).toEqual({ kind: "number" });
    expect(kinds.get("region")).toEqual({ kind: "string" });
    expect(kinds.get("active")).toEqual({ kind: "boolean" });
  });

  it("accepts a bare facts record (no facts: wrapper)", () => {
    const kinds = getSchemaFieldKinds({
      cartTotal: t.number(),
      region: t.string(),
    });
    expect(kinds.size).toBe(2);
    expect(kinds.get("cartTotal")).toEqual({ kind: "number" });
  });
});

// ============================================================================
// getOperatorsForKind — operator matrix
// ============================================================================

describe("getOperatorsForKind", () => {
  it("boolean → common ops only (no $gt/$gte/$lt/$lte/$between/$matches)", () => {
    const ops = getOperatorsForKind({ kind: "boolean" });
    expect(ops).toContain("$eq");
    expect(ops).toContain("$ne");
    expect(ops).toContain("$in");
    expect(ops).toContain("$nin");
    expect(ops).toContain("$exists");
    expect(ops).not.toContain("$gt");
    expect(ops).not.toContain("$gte");
    expect(ops).not.toContain("$lt");
    expect(ops).not.toContain("$lte");
    expect(ops).not.toContain("$between");
    expect(ops).not.toContain("$matches");
    expect(ops).not.toContain("$startsWith");
  });

  it("number → common + orderable", () => {
    const ops = getOperatorsForKind({ kind: "number" });
    expect(ops).toContain("$gte");
    expect(ops).toContain("$between");
    expect(ops).not.toContain("$matches"); // string-only
    expect(ops).not.toContain("$startsWith");
  });

  it("string → common + orderable + string-specific", () => {
    const ops = getOperatorsForKind({ kind: "string" });
    expect(ops).toContain("$gte"); // strings are lexicographically orderable
    expect(ops).toContain("$matches");
    expect(ops).toContain("$startsWith");
    expect(ops).toContain("$endsWith");
    expect(ops).toContain("$contains");
  });

  it("bigint → common + orderable (no string ops)", () => {
    const ops = getOperatorsForKind({ kind: "bigint" });
    expect(ops).toContain("$gte");
    expect(ops).not.toContain("$matches");
    expect(ops).not.toContain("$startsWith");
  });

  it("date → common + orderable", () => {
    const ops = getOperatorsForKind({ kind: "date" });
    expect(ops).toContain("$gte");
    expect(ops).toContain("$between");
    expect(ops).not.toContain("$matches");
  });

  it("array → common + $contains (over element type)", () => {
    const ops = getOperatorsForKind({
      kind: "array",
      element: { kind: "number" },
    });
    expect(ops).toContain("$contains");
    expect(ops).toContain("$eq");
    expect(ops).not.toContain("$gte");
  });

  it("union — intersection of operators across members", () => {
    // string | number: common ops + orderable (both have them), but
    // NOT $matches (only string has it).
    const ops = getOperatorsForKind({
      kind: "union",
      members: [{ kind: "string" }, { kind: "number" }],
    });
    expect(ops).toContain("$eq");
    expect(ops).toContain("$gte");
    expect(ops).not.toContain("$matches");
  });

  it("union — empty members fall back to common ops", () => {
    const ops = getOperatorsForKind({ kind: "union", members: [] });
    expect(ops).toContain("$eq");
    expect(ops).not.toContain("$gte");
  });

  it("branded → delegates to inner (UserId-as-string gets string ops)", () => {
    const ops = getOperatorsForKind({
      kind: "branded",
      inner: { kind: "string" },
    });
    expect(ops).toContain("$startsWith");
    expect(ops).toContain("$gte");
  });

  it("literal — operators of the primitive", () => {
    const ops = getOperatorsForKind({
      kind: "literal",
      value: 5,
      primitive: "number",
    });
    expect(ops).toContain("$gte");
    expect(ops).not.toContain("$matches");
  });

  it("enum — operators of the primitive", () => {
    const ops = getOperatorsForKind({
      kind: "enum",
      values: ["red", "green", "yellow"],
      primitive: "string",
    });
    expect(ops).toContain("$startsWith");
    expect(ops).toContain("$gte");
  });

  it("unknown → common ops only", () => {
    const ops = getOperatorsForKind({ kind: "unknown" });
    expect(ops).toContain("$eq");
    expect(ops).not.toContain("$gte");
    expect(ops).not.toContain("$matches");
  });

  it("nullable does not change operator availability", () => {
    const nullableNum: SchemaKindNode = { kind: "number", nullable: true };
    expect(getOperatorsForKind(nullableNum)).toEqual(
      getOperatorsForKind({ kind: "number" }),
    );
  });
});

// ============================================================================
// listAllPredicateOperators — sanity
// ============================================================================

describe("listAllPredicateOperators", () => {
  it("returns the closed PREDICATE_OPERATORS set", () => {
    const all = listAllPredicateOperators();
    expect(all).toContain("$eq");
    expect(all).toContain("$gte");
    expect(all).toContain("$matches");
    expect(all).toContain("$changed");
    // Defensive: ensures the set hasn't been silently emptied.
    expect(all.length).toBeGreaterThan(10);
  });
});
