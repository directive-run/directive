import { describe, expect, it } from "vitest";
import { doctor } from "../doctor.js";

describe("doctor.checkAgainst — direct contradictions", () => {
  it("$gte vs $lt with no overlap → direct", () => {
    const result = doctor.checkAgainst(
      { cartTotal: { $gte: 100 } },
      [
        {
          id: "freeShipping",
          whenSpec: { cartTotal: { $lt: 50 } },
        },
      ],
    );
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.type).toBe("direct");
    expect(result.contradictions[0]?.constraintId).toBe("freeShipping");
  });

  it("$gt 50 vs $lt 50 (boundary) → direct", () => {
    const result = doctor.checkAgainst(
      { x: { $gt: 50 } },
      [{ id: "cap", whenSpec: { x: { $lt: 50 } } }],
    );
    expect(result.contradictions).toHaveLength(1);
  });

  it("$eq vs different $eq → direct", () => {
    const result = doctor.checkAgainst(
      { status: { $eq: "active" } },
      [{ id: "block", whenSpec: { status: { $eq: "banned" } } }],
    );
    expect(result.contradictions[0]?.type).toBe("direct");
  });

  it("$eq vs matching $ne → direct", () => {
    const result = doctor.checkAgainst(
      { status: { $eq: "active" } },
      [{ id: "exclude", whenSpec: { status: { $ne: "active" } } }],
    );
    expect(result.contradictions[0]?.type).toBe("direct");
  });

  it("$in vs $in with no shared values → direct", () => {
    const result = doctor.checkAgainst(
      { region: { $in: ["ASIA", "AFRICA"] } },
      [{ id: "geo", whenSpec: { region: { $in: ["US", "EU"] } } }],
    );
    expect(result.contradictions[0]?.type).toBe("direct");
  });
});

describe("doctor.checkAgainst — subset", () => {
  it("candidate $gte 100 vs existing $gte 50 → subset", () => {
    const result = doctor.checkAgainst(
      { cartTotal: { $gte: 100 } },
      [{ id: "discount", whenSpec: { cartTotal: { $gte: 50 } } }],
    );
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.type).toBe("subset");
  });

  it("two identical $eq clauses → subset (candidate redundant)", () => {
    const result = doctor.checkAgainst(
      { status: { $eq: "active" } },
      [{ id: "echo", whenSpec: { status: { $eq: "active" } } }],
    );
    expect(result.contradictions[0]?.type).toBe("subset");
  });

  it("candidate $in [US] vs existing $in [US,EU] → subset", () => {
    const result = doctor.checkAgainst(
      { region: { $in: ["US"] } },
      [{ id: "geo", whenSpec: { region: { $in: ["US", "EU"] } } }],
    );
    expect(result.contradictions[0]?.type).toBe("subset");
  });
});

describe("doctor.checkAgainst — overlap (warning, not error)", () => {
  it("shared fact with non-comparable ops → overlap warning", () => {
    const result = doctor.checkAgainst(
      { name: { $startsWith: "Mr" } },
      [{ id: "x", whenSpec: { name: { $contains: "Smith" } } }],
    );
    expect(result.contradictions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe("overlap");
  });

  it("$gte vs $lt with non-empty intersection → overlap (not direct)", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 50 } },
      [{ id: "cap", whenSpec: { x: { $lt: 100 } } }],
    );
    expect(result.contradictions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("doctor.checkAgainst — clean cases", () => {
  it("disjoint fact paths → no findings", () => {
    const result = doctor.checkAgainst(
      { cartTotal: { $gte: 50 } },
      [{ id: "other", whenSpec: { region: { $eq: "US" } } }],
    );
    expect(result.contradictions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("empty existing set → no findings", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 50 } },
      [],
    );
    expect(result.contradictions).toEqual([]);
  });

  it("constraint without whenSpec (function-form) → skipped, no findings", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 50 } },
      [{ id: "fnform" }], // no whenSpec
    );
    expect(result.contradictions).toEqual([]);
  });

  it("accepts the inspect()-style { constraints: [...] } wrapper", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 100 } },
      { constraints: [{ id: "x", whenSpec: { x: { $lt: 50 } } }] },
    );
    expect(result.contradictions).toHaveLength(1);
  });
});

describe("doctor.checkAgainst — reason quality", () => {
  it("reason cites both sides of the conflict", () => {
    const result = doctor.checkAgainst(
      { cartTotal: { $gte: 100 } },
      [{ id: "cap", whenSpec: { cartTotal: { $lt: 50 } } }],
    );
    const reason = result.contradictions[0]?.reason ?? "";
    expect(reason).toContain("100");
    expect(reason).toContain("50");
    expect(reason).toContain("cartTotal");
  });
});
