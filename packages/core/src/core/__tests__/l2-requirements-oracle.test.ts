import { afterEach, describe, expect, it } from "vitest";
import {
  RequirementSet,
  createModule,
  createSystem,
  forType,
  generateRequirementId,
  isRequirementType,
  req,
  t,
} from "../../index.js";

// Black-box tests for requirement identity at L2: how a requirement is named,
// how two requirements become one, how the engine tells a requirement that is
// still required from one that went away, and the public helpers that build
// and recognise requirements. Public API only: constraints with function
// when/require, resolvers, keys, priority, and the requirement state that
// system.inspect() reports. No batch resolvers, history, trace, dynamic
// definitions or predicates, and no message text.

const systems: { destroy: () => unknown }[] = [];

afterEach(() => {
  for (const system of systems.splice(0)) {
    system.destroy();
  }
});

function build(defs: {
  constraints: Record<string, unknown>;
  resolvers: Record<string, unknown>;
}) {
  const mod = createModule("m", {
    schema: {
      facts: { go: t.boolean(), keep: t.boolean(), noise: t.number() },
      derivations: {},
      events: {},
    },
    init: (facts: any) => {
      facts.go = false;
      facts.keep = true;
      facts.noise = 0;
    },
    constraints: defs.constraints as never,
    resolvers: defs.resolvers as never,
  });
  const system = createSystem({ module: mod } as never) as any;
  systems.push(system);

  return system;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

// Resolvers in these tests wait on a gate, so settle() would wait with them.
const flush = async () => {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
  }
};

const unmetIds = (system: any): string[] =>
  system.inspect().unmet.map((u: any) => u.id);

function entry(id: string, fromConstraint = "c") {
  return { requirement: { type: "T", id }, id, fromConstraint };
}

describe("requirement identity in a running system", () => {
  it("requirements of one type that differ in content are separate requirements", async () => {
    const seen: number[] = [];
    const system = build({
      constraints: {
        many: {
          when: (facts: any) => facts.go,
          require: () => [
            { type: "LOAD", n: 1 },
            { type: "LOAD", n: 2 },
            { type: "LOAD", n: 3 },
          ],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (r: any) => {
            seen.push(r.n);
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await system.settle();

    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(new Set(unmetIds(system)).size).toBe(3);
  });

  it("the same requirement from two constraints is one requirement, owned by the one evaluated first", async () => {
    const seen: number[] = [];
    const system = build({
      constraints: {
        late: {
          priority: 1,
          when: (facts: any) => facts.go,
          require: () => ({ type: "LOAD", n: 1 }),
        },
        early: {
          priority: 10,
          when: (facts: any) => facts.go,
          require: () => ({ type: "LOAD", n: 1 }),
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (r: any) => {
            seen.push(r.n);
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await system.settle();

    expect(seen).toEqual([1]);
    const unmet = system.inspect().unmet;
    expect(unmet).toHaveLength(1);
    expect(unmet[0].fromConstraint).toBe("early");
    expect(unmet[0].requirement).toEqual({ type: "LOAD", n: 1 });
  });

  it("the id is built from the content: the same in two systems and in any key order", async () => {
    const idsByOrder: string[][] = [];
    for (const flipped of [false, true]) {
      const system = build({
        constraints: {
          c: {
            when: (facts: any) => facts.go,
            require: () =>
              flipped
                ? { b: { y: [1, 2], x: 1 }, type: "LOAD", a: 1 }
                : { type: "LOAD", a: 1, b: { x: 1, y: [1, 2] } },
          },
        },
        resolvers: {
          load: { requirement: "LOAD", resolve: async () => undefined },
        },
      });
      system.start();
      system.facts.go = true;
      await system.settle();
      idsByOrder.push(unmetIds(system));
    }

    expect(idsByOrder[0]).toHaveLength(1);
    expect(idsByOrder[0]?.[0]?.startsWith("LOAD:")).toBe(true);
    expect(idsByOrder[1]).toEqual(idsByOrder[0]);
  });

  it("a resolver key is the requirement's identity: a shared key is one requirement and the first wins", async () => {
    const gate = deferred();
    const started: string[] = [];
    const system = build({
      constraints: {
        users: {
          when: (facts: any) => facts.go,
          require: () => [
            { type: "LOAD", userId: 1, tag: "first" },
            { type: "LOAD", userId: 1, tag: "second" },
            { type: "LOAD", userId: 2, tag: "third" },
          ],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          key: (r: any) => `user-${r.userId}`,
          resolve: async (r: any) => {
            started.push(r.tag);
            await gate.promise;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();

    expect([...started].sort()).toEqual(["first", "third"]);
    expect([...unmetIds(system)].sort()).toEqual(["user-1", "user-2"]);
    expect(
      system
        .inspect()
        .inflight.map((i: any) => i.id)
        .sort(),
    ).toEqual(["user-1", "user-2"]);
    expect(
      system.inspect().unmet.find((u: any) => u.id === "user-1")?.requirement
        .tag,
    ).toBe("first");

    gate.resolve();
    await system.settle();
  });

  it("a requirement that is still required keeps its run, and one no longer required is canceled", async () => {
    const gate = deferred();
    const started: number[] = [];
    const signals: Record<number, AbortSignal> = {};
    const system = build({
      constraints: {
        both: {
          when: (facts: any) => facts.go,
          require: (facts: any) =>
            facts.keep
              ? [
                  { type: "LOAD", n: 1 },
                  { type: "LOAD", n: 2 },
                ]
              : [{ type: "LOAD", n: 1 }],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (r: any, ctx: any) => {
            started.push(r.n);
            signals[r.n] = ctx.signal;
            await gate.promise;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();
    expect(started).toEqual([1, 2]);

    // Nothing the constraint reads changed: nothing starts, nothing stops.
    system.facts.noise = 1;
    await flush();
    expect(started).toEqual([1, 2]);
    expect(signals[1]?.aborted).toBe(false);
    expect(signals[2]?.aborted).toBe(false);

    // Only the second requirement went away.
    system.facts.keep = false;
    await flush();
    expect(signals[1]?.aborted).toBe(false);
    expect(signals[2]?.aborted).toBe(true);
    expect(system.inspect().unmet.map((u: any) => u.requirement.n)).toEqual([
      1,
    ]);
    expect(started).toEqual([1, 2]);

    gate.resolve();
    await system.settle();
  });

  it("a requirement that comes back after going away starts a new run", async () => {
    const gate = deferred();
    const started: number[] = [];
    const system = build({
      constraints: {
        both: {
          when: (facts: any) => facts.go,
          require: (facts: any) =>
            facts.keep
              ? [
                  { type: "LOAD", n: 1 },
                  { type: "LOAD", n: 2 },
                ]
              : [{ type: "LOAD", n: 1 }],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (r: any) => {
            started.push(r.n);
            await gate.promise;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.keep = false;
    await flush();
    expect(started).toEqual([1, 2]);

    system.facts.keep = true;
    await flush();
    expect(started).toEqual([1, 2, 2]);

    gate.resolve();
    await system.settle();
  });

  it("a requirement stops being unmet when its constraint stops requiring it", async () => {
    const system = build({
      constraints: {
        c: {
          when: (facts: any) => facts.go,
          require: () => ({ type: "LOAD", n: 1 }),
        },
      },
      resolvers: {
        load: { requirement: "LOAD", resolve: async () => undefined },
      },
    });
    system.start();
    await system.settle();
    expect(system.inspect().unmet).toEqual([]);

    system.facts.go = true;
    await system.settle();
    expect(system.inspect().unmet).toHaveLength(1);
    expect(system.inspect().unmet[0].fromConstraint).toBe("c");

    system.facts.go = false;
    await system.settle();
    expect(system.inspect().unmet).toEqual([]);
  });

  it("req() builds what a constraint requires and forType() routes it to its resolver", async () => {
    const loadUser = req("LOAD_USER");
    const seen: unknown[] = [];
    const system = build({
      constraints: {
        needUser: {
          when: (facts: any) => facts.go,
          require: () => loadUser({ userId: 7, priority: "high" }),
        },
      },
      resolvers: {
        user: {
          requirement: forType("LOAD_USER"),
          resolve: async (r: any) => {
            seen.push(r);
          },
        },
        other: {
          requirement: forType("OTHER"),
          resolve: async () => {
            seen.push("wrong resolver");
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await system.settle();

    const expected = { type: "LOAD_USER", userId: 7, priority: "high" };
    expect(seen).toEqual([expected]);
    expect(system.inspect().unmet.map((u: any) => u.requirement)).toEqual([
      expected,
    ]);
  });
});

describe("generateRequirementId", () => {
  it("derives the id from the type and the content, whatever the key order", () => {
    const a = { type: "FETCH", userId: 1, filter: { x: 1, y: [1, 2] } };
    const b = { filter: { y: [1, 2], x: 1 }, userId: 1, type: "FETCH" };
    const id = generateRequirementId(a);

    expect(typeof id).toBe("string");
    expect(id.startsWith("FETCH:")).toBe(true);
    expect(generateRequirementId(a)).toBe(id);
    expect(generateRequirementId(b)).toBe(id);
  });

  it("differs when the type or any property differs", () => {
    const ids = [
      { type: "FETCH", userId: 1 },
      { type: "FETCH", userId: 2 },
      { type: "CREATE", userId: 1 },
      { type: "FETCH" },
      { type: "FETCH", userId: 1, extra: true },
    ].map((r) => generateRequirementId(r));

    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the key function instead when one is given", () => {
    const r = { type: "FETCH", userId: 42 };
    const seen: unknown[] = [];
    const keyed = generateRequirementId(r, (x) => {
      seen.push(x);

      return `user-${x.userId}`;
    });

    expect(keyed).toBe("user-42");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(r);

    // A key function never leaks into the default id, and wins even after a
    // default id was made for the same object.
    const plain = generateRequirementId(r);
    expect(plain.startsWith("FETCH:")).toBe(true);
    expect(generateRequirementId(r, () => "other")).toBe("other");
    expect(generateRequirementId(r)).toBe(plain);
  });
});

describe("req", () => {
  it("builds a requirement from its type and properties", () => {
    const fetchUser = req("FETCH_USER");
    const built = fetchUser({ userId: 123, priority: "high" });

    expect(built).toEqual({
      type: "FETCH_USER",
      userId: 123,
      priority: "high",
    });
    expect(Object.keys(built).sort()).toEqual(["priority", "type", "userId"]);
    expect(req("PING")({})).toEqual({ type: "PING" });
  });

  it("makes a new object on each call and leaves its input alone", () => {
    const make = req("LOAD");
    const props = { id: 1 };
    const a = make(props);
    const b = make(props);

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a).not.toBe(props);
    expect(props).toEqual({ id: 1 });
  });
});

describe("isRequirementType", () => {
  it("is true only for a requirement of that type", () => {
    expect(isRequirementType({ type: "FETCH", id: 1 }, "FETCH")).toBe(true);
    expect(isRequirementType({ type: "FETCH" }, "CREATE")).toBe(false);
    expect(isRequirementType({ type: "CREATE" }, "FETCH")).toBe(false);
  });
});

describe("forType", () => {
  it("makes a predicate for one requirement type", () => {
    const isFetch = forType("FETCH");

    expect(typeof isFetch).toBe("function");
    expect(isFetch({ type: "FETCH", id: 1 })).toBe(true);
    expect(isFetch({ type: "CREATE" })).toBe(false);
    expect(forType("CREATE")({ type: "CREATE" })).toBe(true);
    expect(forType("CREATE")({ type: "FETCH" })).toBe(false);
  });
});

describe("RequirementSet", () => {
  it("keeps the first requirement added under an id", () => {
    const set = new RequirementSet();
    const first = entry("a", "c1");
    const second = entry("a", "c2");
    set.add(first);
    set.add(second);

    expect(set.size).toBe(1);
    expect(set.get("a")).toBe(first);
    expect(set.all()).toHaveLength(1);
    expect(set.all()[0]).toBe(first);
    expect(set.get("a")?.fromConstraint).toBe("c1");
  });

  it("looks entries up by id and removes them by id", () => {
    const set = new RequirementSet();
    const a = entry("a");
    const b = entry("b");
    set.add(a);
    set.add(b);

    expect(set.has("a")).toBe(true);
    expect(set.has("z")).toBe(false);
    expect(set.get("a")).toBe(a);
    expect(set.get("b")).toBe(b);
    expect(set.get("z")).toBeUndefined();

    expect(set.remove("a")).toBe(true);
    expect(set.remove("a")).toBe(false);
    expect(set.has("a")).toBe(false);
    expect(set.get("a")).toBeUndefined();
    expect(set.get("b")).toBe(b);
  });

  it("lists its ids and entries in insertion order", () => {
    const set = new RequirementSet();
    expect(set.ids()).toEqual([]);
    expect(set.all()).toEqual([]);

    const c = entry("c");
    const a = entry("a");
    const b = entry("b");
    set.add(c);
    set.add(a);
    set.add(b);

    expect(set.ids()).toEqual(["c", "a", "b"]);
    expect(set.all()).toEqual([c, a, b]);

    // Snapshots: changing the set afterwards does not change them.
    const ids = set.ids();
    const all = set.all();
    set.remove("a");
    expect(ids).toEqual(["c", "a", "b"]);
    expect(all).toHaveLength(3);
  });

  it("counts its entries", () => {
    const set = new RequirementSet();
    expect(set.size).toBe(0);

    set.add(entry("a"));
    expect(set.size).toBe(1);
    set.add(entry("b"));
    expect(set.size).toBe(2);
    set.add(entry("a", "other"));
    expect(set.size).toBe(2);
    set.remove("a");
    expect(set.size).toBe(1);
  });

  it("clear empties it", () => {
    const set = new RequirementSet();
    set.add(entry("a"));
    set.add(entry("b"));
    set.clear();

    expect(set.size).toBe(0);
    expect(set.has("a")).toBe(false);
    expect(set.get("b")).toBeUndefined();
    expect(set.ids()).toEqual([]);
    expect(set.all()).toEqual([]);

    set.add(entry("c"));
    expect(set.ids()).toEqual(["c"]);
  });

  it("clone is an independent copy holding the same entries", () => {
    const set = new RequirementSet();
    const a = entry("a");
    const b = entry("b");
    set.add(a);
    set.add(b);
    const copy = set.clone();

    expect(copy).not.toBe(set);
    expect(copy.size).toBe(2);
    expect(copy.ids()).toEqual(["a", "b"]);
    expect(copy.get("a")).toBe(a);
    expect(copy.get("b")).toBe(b);

    copy.add(entry("c"));
    copy.remove("a");
    expect(set.ids()).toEqual(["a", "b"]);
    expect(copy.ids()).toEqual(["b", "c"]);

    set.remove("b");
    expect(copy.has("b")).toBe(true);
  });

  it("diff reports what only this set holds as added and what only the other holds as removed", () => {
    const a = entry("a");
    const b = entry("b");
    const c = entry("c");
    const previous = new RequirementSet();
    previous.add(a);
    previous.add(b);
    const next = new RequirementSet();
    next.add(b);
    next.add(c);

    const { added, removed } = next.diff(previous);
    expect(added).toHaveLength(1);
    expect(added[0]).toBe(c);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(a);

    // Neither set changes.
    expect(next.ids()).toEqual(["b", "c"]);
    expect(previous.ids()).toEqual(["a", "b"]);
  });

  it("diff of two sets with the same ids reports nothing, and an empty side is all added or all removed", () => {
    const a = entry("a");
    const b = entry("b");
    const left = new RequirementSet();
    left.add(a);
    left.add(b);
    const right = left.clone();

    expect(left.diff(right)).toEqual({ added: [], removed: [] });
    expect(right.diff(left)).toEqual({ added: [], removed: [] });

    const empty = new RequirementSet();
    expect(left.diff(empty)).toEqual({ added: [a, b], removed: [] });
    expect(empty.diff(left)).toEqual({ added: [], removed: [a, b] });
    expect(empty.diff(new RequirementSet())).toEqual({
      added: [],
      removed: [],
    });
  });
});
