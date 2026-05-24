import { describe, expect, it } from "vitest";
import { predicateToMongo } from "../predicate-to-mongo.js";
import { predicateToPostgrest } from "../predicate-to-pgrest.js";
import { predicateToSQL, predicateToWhere } from "../predicate-to-sql.js";

// ============================================================================
// predicateToSQL
// ============================================================================

describe("predicateToSQL — basic operators", () => {
  it("translates bare equality", () => {
    const r = predicateToSQL({ name: "ada" }, { table: "users" });
    expect(r.where).toBe("name = $1");
    expect(r.params).toEqual(["ada"]);
    expect(r.sql).toBe("SELECT * FROM users WHERE name = $1");
  });

  it("translates $eq and $ne", () => {
    const r = predicateToSQL(
      { name: { $eq: "ada" }, tier: { $ne: "free" } },
      { table: "users" },
    );
    expect(r.where).toBe("(name = $1 AND tier <> $2)");
    expect(r.params).toEqual(["ada", "free"]);
  });

  it("translates all orderable operators", () => {
    const r = predicateToSQL(
      { a: { $gt: 1 }, b: { $gte: 2 }, c: { $lt: 3 }, d: { $lte: 4 } },
      { table: "t" },
    );
    expect(r.where).toBe("(a > $1 AND b >= $2 AND c < $3 AND d <= $4)");
    expect(r.params).toEqual([1, 2, 3, 4]);
  });

  it("translates $in and $nin with ANY()", () => {
    const r = predicateToSQL(
      { status: { $in: ["a", "b"] }, role: { $nin: ["banned"] } },
      { table: "users" },
    );
    expect(r.where).toBe("(status = ANY($1) AND NOT (role = ANY($2)))");
    expect(r.params).toEqual([["a", "b"], ["banned"]]);
  });

  it("translates $exists", () => {
    const t = predicateToSQL({ email: { $exists: true } }, { table: "users" });
    const f = predicateToSQL({ email: { $exists: false } }, { table: "users" });
    expect(t.where).toBe("email IS NOT NULL");
    expect(f.where).toBe("email IS NULL");
    expect(t.params).toEqual([]);
    expect(f.params).toEqual([]);
  });

  it("translates $between", () => {
    const r = predicateToSQL(
      { age: { $between: [18, 65] } },
      { table: "users" },
    );
    expect(r.where).toBe("age BETWEEN $1 AND $2");
    expect(r.params).toEqual([18, 65]);
  });
});

describe("predicateToSQL — string LIKE operators", () => {
  it("translates $startsWith with ESCAPE clause and escaped wildcards", () => {
    const r = predicateToSQL(
      { name: { $startsWith: "Mr_" } },
      { table: "users" },
    );
    expect(r.where).toBe("name LIKE $1 || '%' ESCAPE '\\'");
    expect(r.params).toEqual(["Mr\\_"]);
  });

  it("translates $endsWith", () => {
    const r = predicateToSQL(
      { name: { $endsWith: ".io" } },
      { table: "users" },
    );
    expect(r.where).toBe("name LIKE '%' || $1 ESCAPE '\\'");
    expect(r.params).toEqual([".io"]);
  });

  it("translates $contains for strings", () => {
    const r = predicateToSQL(
      { bio: { $contains: "50%" } },
      { table: "users" },
    );
    expect(r.where).toBe("bio LIKE '%' || $1 || '%' ESCAPE '\\'");
    expect(r.params).toEqual(["50\\%"]);
  });

  it("rejects $contains on non-strings", () => {
    expect(() =>
      predicateToSQL({ tags: { $contains: "x" } } as never, { table: "t" }),
    ).not.toThrow();
    expect(() =>
      predicateToSQL({ tags: { $contains: 5 } } as never, { table: "t" }),
    ).toThrow(/array containment requires a JOIN/);
  });

  it("translates $matches with case-insensitive RegExp", () => {
    const r1 = predicateToSQL({ name: { $matches: /^ada$/ } }, { table: "t" });
    const r2 = predicateToSQL({ name: { $matches: /^ada$/i } }, { table: "t" });
    expect(r1.where).toBe("name ~ $1");
    expect(r2.where).toBe("name ~* $1");
    expect(r1.params).toEqual(["^ada$"]);
  });
});

describe("predicateToSQL — combinators", () => {
  it("$all flattens to AND", () => {
    const r = predicateToSQL({ $all: [{ a: 1 }, { b: 2 }] }, { table: "t" });
    expect(r.where).toBe("(a = $1 AND b = $2)");
  });

  it("$any becomes OR", () => {
    const r = predicateToSQL({ $any: [{ a: 1 }, { b: 2 }] }, { table: "t" });
    expect(r.where).toBe("(a = $1 OR b = $2)");
  });

  it("$not wraps in NOT()", () => {
    const r = predicateToSQL({ $not: { tier: "free" } }, { table: "t" });
    expect(r.where).toBe("NOT (tier = $1)");
  });

  it("nests combinators", () => {
    const r = predicateToSQL(
      { $any: [{ a: 1 }, { $all: [{ b: 2 }, { c: 3 }] }] },
      { table: "t" },
    );
    expect(r.where).toBe("(a = $1 OR (b = $2 AND c = $3))");
    expect(r.params).toEqual([1, 2, 3]);
  });

  it("empty $all → TRUE, empty $any → FALSE", () => {
    expect(predicateToSQL({ $all: [] }, { table: "t" }).where).toBe("TRUE");
    expect(predicateToSQL({ $any: [] }, { table: "t" }).where).toBe("FALSE");
  });

  it("rejects combinator with sibling keys", () => {
    expect(() =>
      predicateToSQL(
        { $all: [{ a: 1 }], evil: 2 } as never,
        { table: "t" },
      ),
    ).toThrow(/\$all cannot coexist with sibling keys \(evil\)/);
    expect(() =>
      predicateToSQL(
        { $any: [{ a: 1 }], tenant_id: "evil" } as never,
        { table: "t" },
      ),
    ).toThrow(/\$any cannot coexist with sibling keys/);
    expect(() =>
      predicateToSQL(
        { $not: { tier: "free" }, role: "admin" } as never,
        { table: "t" },
      ),
    ).toThrow(/\$not cannot coexist with sibling keys/);
  });
});

describe("predicateToSQL — array form", () => {
  it("array of clauses ANDs together", () => {
    const r = predicateToSQL(
      [
        { fact: "age", op: "$gte", value: 18 },
        { fact: "status", op: "$eq", value: "active" },
      ],
      { table: "users" },
    );
    expect(r.where).toBe("(age >= $1 AND status = $2)");
    expect(r.params).toEqual([18, "active"]);
  });

  it("single-clause array stays flat", () => {
    const r = predicateToSQL(
      [{ fact: "x", op: "$eq", value: 1 }],
      { table: "t" },
    );
    expect(r.where).toBe("x = $1");
  });
});

describe("predicateToSQL — security", () => {
  it("rejects table identifier with semicolon", () => {
    expect(() =>
      predicateToSQL({ x: 1 }, { table: "users; DROP TABLE x" }),
    ).toThrow(/invalid table identifier/);
  });

  it("rejects column identifier with quotes", () => {
    expect(() =>
      predicateToSQL({ 'x"; DROP': 1 } as never, { table: "users" }),
    ).toThrow(/invalid column identifier/);
  });

  it("rejects column not in allowlist", () => {
    expect(() =>
      predicateToSQL(
        { age: 1, evil: 2 } as never,
        { table: "users", allowedKeys: ["age"] },
      ),
    ).toThrow(/"evil" is not in the allowedKeys list/);
  });

  it("operand values never appear in SQL string", () => {
    const r = predicateToSQL(
      { name: "Robert'); DROP TABLE Students;--" },
      { table: "users" },
    );
    expect(r.sql).not.toContain("DROP TABLE");
    expect(r.sql).not.toContain("Robert");
    expect(r.params[0]).toBe("Robert'); DROP TABLE Students;--");
  });

  it("rejects $changed (effects-only)", () => {
    expect(() =>
      predicateToSQL({ x: { $changed: true } } as never, { table: "t" }),
    ).toThrow(/effects-only/);
  });

  it("rejects nested predicate", () => {
    expect(() =>
      predicateToSQL(
        { user: { name: "ada" } } as never,
        { table: "t" },
      ),
    ).toThrow(/nested predicate/);
  });

  it("rejects unknown operator", () => {
    expect(() =>
      predicateToSQL({ x: { $weirdo: 1 } } as never, { table: "t" }),
    ).toThrow(/unknown operator "\$weirdo"/);
  });

  it("validates select projection — array of columns", () => {
    const r = predicateToSQL(
      { age: { $gte: 18 } },
      { table: "users", select: ["id", "name"] },
    );
    expect(r.sql).toBe("SELECT id, name FROM users WHERE age >= $1");
  });

  it("rejects free-form select with SQL injection", () => {
    expect(() =>
      predicateToSQL(
        { x: 1 },
        { table: "users", select: "*, password FROM admin --" },
      ),
    ).toThrow(/invalid column identifier/);
  });

  it("rejects deep recursion (DoS guard)", () => {
    // Build a 70-deep $not chain that exceeds MAX_PREDICATE_DEPTH (64).
    let spec: unknown = { x: 1 };
    for (let i = 0; i < 70; i++) {
      spec = { $not: spec };
    }
    expect(() =>
      predicateToSQL(spec as never, { table: "t" }),
    ).toThrow(/depth limit/);
  });

  it("rejects cyclic spec (DoS guard via depth limit)", () => {
    const spec: Record<string, unknown> = {};
    spec.$all = [spec];
    expect(() =>
      predicateToSQL(spec as never, { table: "t" }),
    ).toThrow(/depth limit|cyclic/);
  });
});

describe("predicateToSQL — placeholder customization", () => {
  it("supports MySQL/SQLite `?` placeholders", () => {
    const r = predicateToSQL(
      { age: { $gte: 18 } },
      { table: "users", placeholder: () => "?" },
    );
    expect(r.where).toBe("age >= ?");
    expect(r.params).toEqual([18]);
  });

  it("supports single-column select", () => {
    const r = predicateToSQL(
      { age: { $gte: 18 } },
      { table: "users", select: "id" },
    );
    expect(r.sql).toBe("SELECT id FROM users WHERE age >= $1");
  });
});

describe("predicateToWhere — embeddable WHERE", () => {
  it("returns just the WHERE body + params", () => {
    const { where, params } = predicateToWhere({ age: { $gte: 18 } });
    expect(where).toBe("age >= $1");
    expect(params).toEqual([18]);
  });
});

// ============================================================================
// predicateToMongo
// ============================================================================

describe("predicateToMongo — basic", () => {
  it("translates bare equality", () => {
    expect(predicateToMongo({ name: "ada" })).toEqual({ name: "ada" });
  });

  it("passes through Mongo-native operators", () => {
    expect(
      predicateToMongo({
        age: { $gte: 18 },
        status: { $in: ["a", "b"] },
        email: { $exists: true },
      }),
    ).toEqual({
      age: { $gte: 18 },
      status: { $in: ["a", "b"] },
      email: { $exists: true },
    });
  });

  it("translates $between to $gte + $lte", () => {
    expect(predicateToMongo({ age: { $between: [18, 65] } })).toEqual({
      age: { $gte: 18, $lte: 65 },
    });
  });

  it("translates $startsWith / $endsWith / $contains to $regex", () => {
    expect(predicateToMongo({ name: { $startsWith: "Al" } })).toEqual({
      name: { $regex: "^Al" },
    });
    expect(predicateToMongo({ name: { $endsWith: ".io" } })).toEqual({
      name: { $regex: "\\.io$" },
    });
    expect(predicateToMongo({ bio: { $contains: "rust" } })).toEqual({
      bio: { $regex: "rust" },
    });
  });

  it("escapes regex metacharacters", () => {
    expect(predicateToMongo({ x: { $startsWith: "a.b" } })).toEqual({
      x: { $regex: "^a\\.b" },
    });
  });

  it("translates $matches RegExp to plain JSON $regex + $options", () => {
    expect(predicateToMongo({ x: { $matches: /^foo/i } })).toEqual({
      x: { $regex: "^foo", $options: "i" },
    });
  });
});

describe("predicateToMongo — combinators", () => {
  it("$all → $and", () => {
    expect(predicateToMongo({ $all: [{ a: 1 }, { b: 2 }] })).toEqual({
      $and: [{ a: 1 }, { b: 2 }],
    });
  });

  it("$any → $or", () => {
    expect(predicateToMongo({ $any: [{ a: 1 }, { b: 2 }] })).toEqual({
      $or: [{ a: 1 }, { b: 2 }],
    });
  });

  it("$not → $nor", () => {
    expect(predicateToMongo({ $not: { tier: "free" } })).toEqual({
      $nor: [{ tier: "free" }],
    });
  });

  it("empty $any → stable tautological-false via $expr", () => {
    expect(predicateToMongo({ $any: [] })).toEqual({ $expr: { $eq: [1, 0] } });
  });

  it("collapses single-element $all/$any", () => {
    expect(predicateToMongo({ $all: [{ a: 1 }] })).toEqual({ a: 1 });
    expect(predicateToMongo({ $any: [{ a: 1 }] })).toEqual({ a: 1 });
  });

  it("rejects combinator with sibling keys", () => {
    expect(() =>
      predicateToMongo({ $all: [{ a: 1 }], evil: 2 } as never),
    ).toThrow(/\$all cannot coexist with sibling keys/);
  });
});

describe("predicateToMongo — security", () => {
  it("rejects top-level $where (no-prefix injection)", () => {
    expect(() =>
      predicateToMongo({ $where: "function(){return true}" } as never),
    ).toThrow(/starts with "\$" — reserved for Mongo operators/);
  });

  it("rejects array-form $where via fact key", () => {
    expect(() =>
      predicateToMongo([
        { fact: "$where", op: "$eq", value: "function(){return true}" },
      ] as never),
    ).toThrow(/starts with "\$" — reserved for Mongo operators/);
  });

  it("rejects dotted field by default", () => {
    expect(() =>
      predicateToMongo({ "user.role": "admin" } as never),
    ).toThrow(/invalid field name "user\.role"/);
  });

  it("allows dotted paths when opt-in", () => {
    expect(
      predicateToMongo(
        { "user.role": "admin" } as never,
        { allowDottedPaths: true },
      ),
    ).toEqual({ "user.role": "admin" });
  });

  it("respects allowedKeys", () => {
    expect(() =>
      predicateToMongo(
        { age: 1, evil: 2 } as never,
        { allowedKeys: ["age"] },
      ),
    ).toThrow(/"evil" is not in the allowedKeys list/);
  });

  it("rejects $changed", () => {
    expect(() =>
      predicateToMongo({ x: { $changed: true } } as never),
    ).toThrow(/effects-only/);
  });

  it("rejects deep recursion", () => {
    let spec: unknown = { x: 1 };
    for (let i = 0; i < 70; i++) {
      spec = { $not: spec };
    }
    expect(() => predicateToMongo(spec as never)).toThrow(/depth limit/);
  });
});

// ============================================================================
// predicateToPostgrest
// ============================================================================

describe("predicateToPostgrest — basic", () => {
  it("translates bare equality", () => {
    expect(predicateToPostgrest({ name: "ada" })).toBe("name=eq.ada");
  });

  it("translates comparison operators", () => {
    expect(
      predicateToPostgrest(
        { age: { $gte: 18 }, score: { $lt: 100 } },
        { mode: "raw" },
      ),
    ).toBe("age=gte.18&score=lt.100");
  });

  it("translates $in/$nin with parentheses list", () => {
    expect(
      predicateToPostgrest(
        { status: { $in: ["active", "pending"] } },
        { mode: "raw" },
      ),
    ).toBe("status=in.(active,pending)");
    expect(
      predicateToPostgrest({ role: { $nin: ["banned"] } }, { mode: "raw" }),
    ).toBe("role=not.in.(banned)");
  });

  it("translates $exists", () => {
    expect(
      predicateToPostgrest(
        { email: { $exists: true }, deletedAt: { $exists: false } },
        { mode: "raw" },
      ),
    ).toBe("email=not.is.null&deletedAt=is.null");
  });

  it("decomposes $between to $gte + $lte (portable across all 3 targets)", () => {
    expect(
      predicateToPostgrest({ age: { $between: [18, 65] } }, { mode: "raw" }),
    ).toBe("age=gte.18&age=lte.65");
  });

  it("translates $startsWith/$endsWith/$contains with * wildcard", () => {
    expect(
      predicateToPostgrest({ name: { $startsWith: "Al" } }, { mode: "raw" }),
    ).toBe("name=like.Al*");
    expect(
      predicateToPostgrest({ name: { $endsWith: ".io" } }, { mode: "raw" }),
    ).toBe('name=like."*.io"');
    expect(
      predicateToPostgrest({ bio: { $contains: "rust" } }, { mode: "raw" }),
    ).toBe("bio=like.*rust*");
  });

  it("translates $matches with imatch for case-insensitive", () => {
    expect(
      predicateToPostgrest({ name: { $matches: /^ada/ } }, { mode: "raw" }),
    ).toBe("name=match.^ada");
    expect(
      predicateToPostgrest({ name: { $matches: /^ada/i } }, { mode: "raw" }),
    ).toBe("name=imatch.^ada");
  });

  it("quotes strings with reserved characters", () => {
    expect(
      predicateToPostgrest({ city: "San Francisco" }, { mode: "raw" }),
    ).toBe('city=eq."San Francisco"');
    expect(
      predicateToPostgrest({ city: { $in: ["a,b", "c"] } }, { mode: "raw" }),
    ).toBe('city=in.("a,b",c)');
  });

  it("encodes the querystring by default", () => {
    const s = predicateToPostgrest({ city: "San Francisco" });
    expect(s).toBe("city=" + encodeURIComponent('eq."San Francisco"'));
  });
});

describe("predicateToPostgrest — combinators", () => {
  it("$all at top is flat (multiple top-level filters)", () => {
    expect(
      predicateToPostgrest({ $all: [{ a: 1 }, { b: 2 }] }, { mode: "raw" }),
    ).toBe("a=eq.1&b=eq.2");
  });

  it("$any at top wraps in or=(...)", () => {
    expect(
      predicateToPostgrest({ $any: [{ a: 1 }, { b: 2 }] }, { mode: "raw" }),
    ).toBe("or=(a.eq.1,b.eq.2)");
  });

  it("$not wraps in not.and=(...)", () => {
    expect(
      predicateToPostgrest({ $not: { tier: "free" } }, { mode: "raw" }),
    ).toBe("not.and=(tier.eq.free)");
  });

  it("nests $any inside $all", () => {
    expect(
      predicateToPostgrest(
        {
          $all: [
            { status: "active" },
            { $any: [{ tier: "gold" }, { score: { $gte: 100 } }] },
          ],
        },
        { mode: "raw" },
      ),
    ).toBe("status=eq.active&or=(tier.eq.gold,score.gte.100)");
  });

  it("empty $any → stable contradiction", () => {
    expect(predicateToPostgrest({ $any: [] }, { mode: "raw" })).toBe(
      "id=is.null&id=not.is.null",
    );
  });

  it("rejects combinator with sibling keys", () => {
    expect(() =>
      predicateToPostgrest({ $all: [{ a: 1 }], evil: 2 } as never),
    ).toThrow(/\$all cannot coexist with sibling keys/);
  });
});

describe("predicateToPostgrest — security", () => {
  it("rejects invalid column", () => {
    expect(() =>
      predicateToPostgrest({ "x;DROP": 1 } as never),
    ).toThrow(/invalid column identifier/);
  });

  it("respects allowedKeys", () => {
    expect(() =>
      predicateToPostgrest(
        { age: 1, evil: 2 } as never,
        { allowedKeys: ["age"] },
      ),
    ).toThrow(/"evil" is not in the allowedKeys list/);
  });

  it("rejects $changed", () => {
    expect(() =>
      predicateToPostgrest({ x: { $changed: true } } as never),
    ).toThrow(/effects-only/);
  });

  it("rejects deep recursion", () => {
    let spec: unknown = { x: 1 };
    for (let i = 0; i < 70; i++) {
      spec = { $not: spec };
    }
    expect(() => predicateToPostgrest(spec as never)).toThrow(/depth limit/);
  });
});

// ============================================================================
// Cross-codegen parity (the headline pitch)
// ============================================================================

describe("one predicate, three targets — parity", () => {
  const predicate = {
    age: { $gte: 18 },
    status: { $in: ["active", "pending"] },
  };

  it("produces equivalent filters across targets", () => {
    const sql = predicateToSQL(predicate, { table: "users" });
    const mongo = predicateToMongo(predicate);
    const pg = predicateToPostgrest(predicate, { mode: "raw" });

    expect(sql.where).toBe("(age >= $1 AND status = ANY($2))");
    expect(sql.params).toEqual([18, ["active", "pending"]]);

    expect(mongo).toEqual({
      age: { $gte: 18 },
      status: { $in: ["active", "pending"] },
    });

    expect(pg).toBe("age=gte.18&status=in.(active,pending)");
  });

  it("$between works portably across all three targets", () => {
    const pBetween = { age: { $between: [18, 65] } };
    expect(predicateToSQL(pBetween, { table: "u" }).where).toBe(
      "age BETWEEN $1 AND $2",
    );
    expect(predicateToMongo(pBetween)).toEqual({
      age: { $gte: 18, $lte: 65 },
    });
    expect(predicateToPostgrest(pBetween, { mode: "raw" })).toBe(
      "age=gte.18&age=lte.65",
    );
  });
});
