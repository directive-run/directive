import { describe, expect, it } from "vitest";
import {
  RequirementSet,
  createRequirementWithId,
  forType,
  generateRequirementId,
  isRequirementType,
  req,
} from "../requirements.js";

describe("generateRequirementId", () => {
  it("generates a stable ID from type + properties", () => {
    const r = { type: "FETCH", userId: 1 };
    const id = generateRequirementId(r);

    expect(id).toContain("FETCH:");
    expect(typeof id).toBe("string");
  });

  it("produces the same ID for same properties in different order", () => {
    const a = { type: "FETCH", userId: 1, priority: "high" };
    const b = { type: "FETCH", priority: "high", userId: 1 };
    const idA = generateRequirementId(a);
    const idB = generateRequirementId(b);

    expect(idA).toBe(idB);
  });

  it("uses custom keyFn when provided", () => {
    const r = { type: "FETCH", userId: 42 };
    const keyFn = (req: { type: string; [key: string]: unknown }) =>
      `custom-${req.userId}`;
    const id = generateRequirementId(r, keyFn);

    expect(id).toBe("custom-42");
  });

  it("caches results for same object reference (WeakMap)", () => {
    const r = { type: "FETCH", userId: 1 };
    const first = generateRequirementId(r);
    const second = generateRequirementId(r);

    expect(first).toBe(second);
  });

  it("different objects with same content get same ID string", () => {
    const a = { type: "FETCH", userId: 1 };
    const b = { type: "FETCH", userId: 1 };

    expect(a).not.toBe(b);
    expect(generateRequirementId(a)).toBe(generateRequirementId(b));
  });

  it("different types produce different IDs", () => {
    const a = { type: "FETCH", userId: 1 };
    const b = { type: "CREATE", userId: 1 };

    expect(generateRequirementId(a)).not.toBe(generateRequirementId(b));
  });

  it("different properties produce different IDs", () => {
    const a = { type: "FETCH", userId: 1 };
    const b = { type: "FETCH", userId: 2 };

    expect(generateRequirementId(a)).not.toBe(generateRequirementId(b));
  });
});

describe("createRequirementWithId", () => {
  it("returns { requirement, id, fromConstraint }", () => {
    const requirement = { type: "FETCH", userId: 1 };
    const result = createRequirementWithId(requirement, "needsUser");

    expect(result.requirement).toBe(requirement);
    expect(result.fromConstraint).toBe("needsUser");
    expect(typeof result.id).toBe("string");
    expect(result.id).toBe(generateRequirementId(requirement));
  });

  it("forwards keyFn to generateRequirementId", () => {
    const requirement = { type: "FETCH", userId: 42 };
    const keyFn = () => "custom-key";
    const result = createRequirementWithId(requirement, "c1", keyFn);

    expect(result.id).toBe("custom-key");
  });
});

describe("req", () => {
  it("creates a requirement with the given type field", () => {
    const fetchUser = req("FETCH_USER");
    const result = fetchUser({ userId: 123 });

    expect(result.type).toBe("FETCH_USER");
  });

  it("merges additional properties", () => {
    const fetchUser = req("FETCH_USER");
    const result = fetchUser({ userId: 123, priority: "high" });

    expect(result.type).toBe("FETCH_USER");
    expect(result.userId).toBe(123);
    expect(result.priority).toBe("high");
  });

  it("returns a typed requirement", () => {
    const factory = req("LOAD");
    const result = factory({ id: "abc" });

    // Runtime check that the shape is correct
    expect(result).toEqual({ type: "LOAD", id: "abc" });
  });
});

describe("isRequirementType", () => {
  it("returns true when type matches", () => {
    const r = { type: "FETCH" };

    expect(isRequirementType(r, "FETCH")).toBe(true);
  });

  it("returns false when type does not match", () => {
    const r = { type: "FETCH" };

    expect(isRequirementType(r, "CREATE")).toBe(false);
  });
});

describe("forType", () => {
  it("returns a predicate function", () => {
    const predicate = forType("FETCH");

    expect(typeof predicate).toBe("function");
  });

  it("predicate returns true for matching type", () => {
    const isFetch = forType("FETCH");

    expect(isFetch({ type: "FETCH" })).toBe(true);
  });

  it("predicate returns false for non-matching type", () => {
    const isFetch = forType("FETCH");

    expect(isFetch({ type: "CREATE" })).toBe(false);
  });
});

describe("RequirementSet", () => {
  function makeReq(
    type: string,
    props: Record<string, unknown> = {},
    constraint = "c1",
  ) {
    return createRequirementWithId({ type, ...props }, constraint);
  }

  it("add - adds requirements by ID", () => {
    const set = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    set.add(r);

    expect(set.size).toBe(1);
    expect(set.get(r.id)).toBe(r);
  });

  it("add - first-wins deduplication (ignores duplicates)", () => {
    const set = new RequirementSet();
    const first = makeReq("FETCH", { userId: 1 }, "c1");
    const duplicate = createRequirementWithId(
      { type: "FETCH", userId: 1 },
      "c2",
    );
    set.add(first);
    set.add(duplicate);

    expect(set.size).toBe(1);
    expect(set.get(first.id)!.fromConstraint).toBe("c1");
  });

  it("remove - removes by ID", () => {
    const set = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    set.add(r);

    expect(set.remove(r.id)).toBe(true);
    expect(set.size).toBe(0);
  });

  it("remove - returns false for non-existent ID", () => {
    const set = new RequirementSet();

    expect(set.remove("nonexistent")).toBe(false);
  });

  it("has - checks existence", () => {
    const set = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    set.add(r);

    expect(set.has(r.id)).toBe(true);
    expect(set.has("nonexistent")).toBe(false);
  });

  it("get - retrieves by ID", () => {
    const set = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    set.add(r);

    expect(set.get(r.id)).toBe(r);
    expect(set.get("nonexistent")).toBeUndefined();
  });

  it("all - returns array of all requirements", () => {
    const set = new RequirementSet();
    const r1 = makeReq("FETCH", { userId: 1 });
    const r2 = makeReq("CREATE", { name: "test" });
    set.add(r1);
    set.add(r2);

    const all = set.all();

    expect(all).toHaveLength(2);
    expect(all).toContain(r1);
    expect(all).toContain(r2);
  });

  it("ids - returns array of all IDs", () => {
    const set = new RequirementSet();
    const r1 = makeReq("FETCH", { userId: 1 });
    const r2 = makeReq("CREATE", { name: "test" });
    set.add(r1);
    set.add(r2);

    const ids = set.ids();

    expect(ids).toHaveLength(2);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
  });

  it("size - returns count", () => {
    const set = new RequirementSet();

    expect(set.size).toBe(0);

    set.add(makeReq("A"));
    expect(set.size).toBe(1);

    set.add(makeReq("B"));
    expect(set.size).toBe(2);
  });

  it("clear - removes all", () => {
    const set = new RequirementSet();
    set.add(makeReq("A"));
    set.add(makeReq("B"));
    set.clear();

    expect(set.size).toBe(0);
    expect(set.all()).toEqual([]);
  });

  it("clone - creates independent copy", () => {
    const set = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    set.add(r);

    const copy = set.clone();

    expect(copy.size).toBe(1);
    expect(copy.get(r.id)).toBe(r);

    // Mutating original does not affect clone
    set.clear();
    expect(copy.size).toBe(1);
  });

  it("diff - finds added requirements", () => {
    const prev = new RequirementSet();
    const next = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    next.add(r);

    const { added, removed, unchanged } = next.diff(prev);

    expect(added).toEqual([r]);
    expect(removed).toEqual([]);
    expect(unchanged).toEqual([]);
  });

  it("diff - finds removed requirements", () => {
    const prev = new RequirementSet();
    const next = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    prev.add(r);

    const { added, removed, unchanged } = next.diff(prev);

    expect(added).toEqual([]);
    expect(removed).toEqual([r]);
    expect(unchanged).toEqual([]);
  });

  it("diff - finds unchanged requirements", () => {
    const prev = new RequirementSet();
    const next = new RequirementSet();
    const r = makeReq("FETCH", { userId: 1 });
    prev.add(r);
    // Same ID, different object — still counts as unchanged
    const rNext = createRequirementWithId({ type: "FETCH", userId: 1 }, "c1");
    next.add(rNext);

    const { added, removed, unchanged } = next.diff(prev);

    expect(added).toEqual([]);
    expect(removed).toEqual([]);
    expect(unchanged).toEqual([rNext]);
  });

  it("diff - handles mixed added/removed/unchanged", () => {
    const prev = new RequirementSet();
    const next = new RequirementSet();

    const kept = makeReq("KEEP", { id: 1 });
    const old = makeReq("OLD", { id: 2 });
    const fresh = makeReq("NEW", { id: 3 });

    prev.add(kept);
    prev.add(old);

    const keptNext = createRequirementWithId({ type: "KEEP", id: 1 }, "c1");
    next.add(keptNext);
    next.add(fresh);

    const { added, removed, unchanged } = next.diff(prev);

    expect(added).toEqual([fresh]);
    expect(removed).toEqual([old]);
    expect(unchanged).toEqual([keptNext]);
  });
});
