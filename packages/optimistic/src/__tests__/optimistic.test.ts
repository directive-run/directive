// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSnapshot, OptimisticCloneError, withOptimistic } from "../index.js";

describe("@directive-run/optimistic — createSnapshot", () => {
  it("captures + restores plain values", () => {
    const facts = { name: "alice", count: 3 };
    const restore = createSnapshot(facts, ["name", "count"]);
    facts.name = "bob";
    facts.count = 99;
    restore();
    expect(facts.name).toBe("alice");
    expect(facts.count).toBe(3);
  });

  it("captures + restores nested objects (deep clone)", () => {
    const facts = { user: { id: "u1", tags: ["a", "b"] } };
    const restore = createSnapshot(facts, ["user"]);
    facts.user.id = "u2";
    facts.user.tags.push("c");
    restore();
    expect(facts.user.id).toBe("u1");
    expect(facts.user.tags).toEqual(["a", "b"]);
  });

  it("only restores listed keys; leaves others alone", () => {
    const facts = { a: 1, b: 2, c: 3 };
    const restore = createSnapshot(facts, ["a"]);
    facts.a = 100;
    facts.b = 200;
    facts.c = 300;
    restore();
    expect(facts.a).toBe(1);
    expect(facts.b).toBe(200);
    expect(facts.c).toBe(300);
  });

  it("handles null + undefined values", () => {
    const facts: { a: string | null; b: number | undefined } = {
      a: null,
      b: undefined,
    };
    const restore = createSnapshot(facts, ["a", "b"]);
    facts.a = "set";
    facts.b = 42;
    restore();
    expect(facts.a).toBe(null);
    expect(facts.b).toBe(undefined);
  });

  it("restore() can be called multiple times — each restores to the original", () => {
    const facts = { v: 10 };
    const restore = createSnapshot(facts, ["v"]);
    facts.v = 20;
    restore();
    expect(facts.v).toBe(10);
    facts.v = 30;
    restore();
    expect(facts.v).toBe(10);
  });
});

describe("@directive-run/optimistic — withOptimistic", () => {
  it("runs the handler when no error is thrown", async () => {
    type F = { values: string[] };
    const facts: F = { values: ["a"] };
    const wrapped = withOptimistic<F>(["values"])(async ({ facts }) => {
      facts.values = ["b", "c"];
    });
    await wrapped({ facts });
    expect(facts.values).toEqual(["b", "c"]);
  });

  it("rolls back on throw, then propagates", async () => {
    type F = { values: string[] };
    const facts: F = { values: ["a"] };
    const wrapped = withOptimistic<F>(["values"])(async ({ facts }) => {
      facts.values = ["optimistic"];
      throw new Error("network exploded");
    });

    await expect(wrapped({ facts })).rejects.toThrow("network exploded");
    expect(facts.values).toEqual(["a"]);
  });

  it("rolls back even if the throw happens mid-resolve", async () => {
    type F = { values: string[]; pending: boolean };
    const facts: F = { values: ["original"], pending: false };
    const wrapped = withOptimistic<F>(["values", "pending"])(
      async ({ facts }) => {
        facts.pending = true;
        facts.values = ["optimistic"];
        await new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("500")), 0),
        );
      },
    );

    await expect(wrapped({ facts })).rejects.toThrow("500");
    expect(facts.values).toEqual(["original"]);
    expect(facts.pending).toBe(false);
  });

  it("only rolls back listed keys", async () => {
    type F = { a: number; b: number };
    const facts: F = { a: 1, b: 2 };
    const wrapped = withOptimistic<F>(["a"])(async ({ facts }) => {
      facts.a = 100;
      facts.b = 200;
      throw new Error("boom");
    });

    await expect(wrapped({ facts })).rejects.toThrow("boom");
    expect(facts.a).toBe(1); // restored
    expect(facts.b).toBe(200); // not in keys list, stays mutated
  });

  it("R1: typo in keys array is a compile error (typecheck)", () => {
    type F = { values: string[]; count: number };
    // @ts-expect-error — 'valuess' is not a key of F
    withOptimistic<F>(["valuess"])(async ({ facts }) => {
      facts.values = [];
    });
    // The runtime test is unreachable; this suite exists so a future
    // refactor that breaks the constraint will cause tsc to flag the
    // test file (and CI to fail).
    expect(true).toBe(true);
  });

  it("R1 sec/M2: createSnapshot throws OptimisticCloneError on object containing a function", () => {
    // Functions cannot survive structuredClone — DataCloneError. We
    // re-throw as a typed OptimisticCloneError with the offending key,
    // so the violation is loud rather than silent (the original JSON
    // fallback would drop the function and silently corrupt rollback).
    const facts: { config: { name: string; onSubmit: () => void } } = {
      config: { name: "form", onSubmit: () => {} },
    };
    expect(() => createSnapshot(facts, ["config"])).toThrow(
      /not JSON-roundtrippable/,
    );
    expect(() => createSnapshot(facts, ["config"])).toThrow(
      OptimisticCloneError,
    );
  });

  it("R1 sec/M2: OptimisticCloneError carries the offending key + cause", () => {
    const facts = { x: { fn: () => {} } };
    try {
      createSnapshot(facts, ["x"]);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OptimisticCloneError);
      const e = err as OptimisticCloneError;
      expect(e.key).toBe("x");
      expect(e.cause).toBeDefined();
    }
  });

  it("R1: structuredClone handles cycles natively — no false positives", () => {
    type Node = { name: string; child?: Node };
    const node: Node = { name: "a" };
    node.child = node; // cycle — structuredClone preserves
    const facts = { node };
    expect(() => createSnapshot(facts, ["node"])).not.toThrow();
  });
});
