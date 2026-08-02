import { describe, expect, it, vi } from "vitest";
import { t } from "../schema-builders.js";
import {
  type SchemaKindNode,
  getKind,
  getOperatorsForKind,
  getSchemaFieldKinds,
  listAllPredicateOperators,
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

// ============================================================================
// M5 — hostile getter safety
// ============================================================================

describe("getKind — hostile-getter safety", () => {
  it("returns { kind: 'unknown' } if _kind getter throws", () => {
    const hostile = {
      get _kind(): never {
        throw new Error("boom");
      },
    };
    expect(getKind(hostile)).toEqual({ kind: "unknown" });
  });

  it("returns { kind: 'unknown' } if _typeName getter throws", () => {
    const hostile = {
      get _typeName(): never {
        throw new Error("boom");
      },
    };
    expect(getKind(hostile)).toEqual({ kind: "unknown" });
  });

  it("does NOT throw even when both getters are hostile", () => {
    const hostile = {
      get _kind(): never {
        throw new Error("kind boom");
      },
      get _typeName(): never {
        throw new Error("name boom");
      },
    };
    expect(() => getKind(hostile)).not.toThrow();
    expect(getKind(hostile)).toEqual({ kind: "unknown" });
  });
});

describe("getSchemaFieldKinds — hostile-getter resilience", () => {
  it("one hostile builder does not abort the whole walk", () => {
    const hostile = {
      get _kind(): never {
        throw new Error("boom");
      },
    };
    const map = getSchemaFieldKinds({
      facts: {
        good: t.number(),
        also: t.string(),
        bad: hostile,
      },
    });
    // The good builders are still walked.
    expect(map.get("good")).toEqual({ kind: "number" });
    expect(map.get("also")).toEqual({ kind: "string" });
    // The hostile builder is captured as 'unknown' (from getKind's own guard),
    // or silently skipped — either is acceptable.
    const badEntry = map.get("bad");
    if (badEntry !== undefined) {
      expect(badEntry).toEqual({ kind: "unknown" });
    }
  });
});

// ============================================================================
// M12 — dev-mode warnings on misuse
// ============================================================================

describe("getKind — dev-mode warning on function input", () => {
  it("warns when a t.* factory is passed without ()", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Pass `t.number` as a function reference (forgot the call).
      const result = getKind(t.number);
      expect(result).toEqual({ kind: "unknown" });
      // Dev mode may or may not be on in test runs — only assert when warned.
      if (warnSpy.mock.calls.length > 0) {
        const msg = warnSpy.mock.calls[0]![0] as string;
        expect(msg).toContain("did you forget () on a t.* builder");
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("getSchemaFieldKinds — dev-mode warning on empty result", () => {
  it("warns when schema yields zero introspectable keys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const map = getSchemaFieldKinds({});
      expect(map.size).toBe(0);
      if (warnSpy.mock.calls.length > 0) {
        const msg = warnSpy.mock.calls[0]![0] as string;
        expect(msg).toContain("schema appears empty");
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
