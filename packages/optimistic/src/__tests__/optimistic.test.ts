// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSnapshot, withOptimistic } from "../index.js";

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
    const facts = { values: ["a"] };
    const wrapped = withOptimistic<typeof facts, "values", { facts: typeof facts }>(
      ["values"],
      async ({ facts }) => {
        facts.values = ["b", "c"];
      },
    );
    await wrapped({ facts });
    expect(facts.values).toEqual(["b", "c"]);
  });

  it("rolls back on throw, then propagates", async () => {
    const facts = { values: ["a"] };
    const wrapped = withOptimistic<typeof facts, "values", { facts: typeof facts }>(
      ["values"],
      async ({ facts }) => {
        facts.values = ["optimistic"];
        throw new Error("network exploded");
      },
    );

    await expect(wrapped({ facts })).rejects.toThrow("network exploded");
    expect(facts.values).toEqual(["a"]);
  });

  it("rolls back even if the throw happens mid-resolve", async () => {
    const facts = { values: ["original"], pending: false };
    const wrapped = withOptimistic<
      typeof facts,
      "values" | "pending",
      { facts: typeof facts }
    >(["values", "pending"], async ({ facts }) => {
      facts.pending = true;
      facts.values = ["optimistic"];
      // Simulate awaited work that fails:
      await new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("500")), 0),
      );
    });

    await expect(wrapped({ facts })).rejects.toThrow("500");
    expect(facts.values).toEqual(["original"]);
    expect(facts.pending).toBe(false);
  });

  it("only rolls back listed keys", async () => {
    const facts = { a: 1, b: 2 };
    const wrapped = withOptimistic<typeof facts, "a", { facts: typeof facts }>(
      ["a"],
      async ({ facts }) => {
        facts.a = 100;
        facts.b = 200;
        throw new Error("boom");
      },
    );

    await expect(wrapped({ facts })).rejects.toThrow("boom");
    expect(facts.a).toBe(1); // restored
    expect(facts.b).toBe(200); // not in keys list, stays mutated
  });
});
