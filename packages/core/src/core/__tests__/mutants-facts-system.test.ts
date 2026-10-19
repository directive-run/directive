import { describe, expect, it, vi } from "vitest";
import type { ObservationEvent } from "../../index.js";
import { createModule, createSystem, t } from "../../index.js";

// Written to kill surviving Stryker mutants of facts.ts through the system.
// Black-box only: what a consumer of createSystem can see.

describe("fact store behaviour seen through a system", () => {
  it("re-derives when a derivation asks whether a fact exists", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { flag: t.number(), seed: t.number() },
        derivations: { hasFlag: t.boolean() },
      },
      init: (facts) => {
        facts.seed = 0;
      },
      derive: {
        hasFlag: (facts) => "flag" in facts,
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    expect(system.derive.hasFlag).toBe(false);

    system.facts.flag = 1;

    expect(system.derive.hasFlag).toBe(true);
    await system.stop();
  });

  it("stops delivering a batch to an observer once its own write runs away", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), m1: t.number(), m2: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.m1 = 0;
        facts.m2 = 0;
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    let armed = false;
    system.subscribe(["n"], () => {
      if (armed) {
        system.facts.n = (system.facts.n as number) + 1;
      }
    });
    const delivered: string[] = [];
    system.observe((event) => {
      if (event.type !== "fact.change") {
        return;
      }
      delivered.push(event.key);
      if (event.key === "m1") {
        armed = true;
        system.facts.n = 1000;
      }
    });

    system.batch(() => {
      system.facts.m1 = 1;
      system.facts.m2 = 1;
    });
    armed = false;

    // The runaway guard is a stop, not a per-key failure to be logged and
    // stepped over: m2 is not delivered after m1's observer ran away.
    expect(delivered.filter((k) => k !== "n")).toEqual(["m1"]);
    vi.restoreAllMocks();
    await system.stop();
  });

  it("reports an unregistered module's facts as deletions, with their previous values", async () => {
    const mod = createModule("gone", {
      schema: { facts: { a: t.number(), b: t.string() } },
      init: (facts) => {
        facts.a = 7;
        facts.b = "x";
      },
    });
    const keeper = createModule("keeper", {
      schema: { facts: { k: t.number() } },
      init: (facts) => {
        facts.k = 1;
      },
    });
    const system = createSystem({ modules: { gone: mod, keeper } });
    await system.start();
    const events: ObservationEvent[] = [];
    system.observe((e) => events.push(e));
    const listener = vi.fn();
    system.subscribe(["gone::a"] as never, listener);

    await (system as any).unregisterModule("gone");

    const deletions = events.filter((e) => e.type === "fact.change") as Array<
      Extract<ObservationEvent, { type: "fact.change" }>
    >;
    expect(deletions).toHaveLength(2);
    expect(deletions.map((e) => [e.key, e.prev, e.next, e.origin]).sort()).toEqual([
      ["gone::a", 7, undefined, "authored"],
      ["gone::b", "x", undefined, "authored"],
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    await system.stop();
  });

  it("keeps a nested object, Date and Map in history when the fact holds read-back wrappers", async () => {
    type Doc = {
      list: Array<{ n: number }>;
      when: Date;
      nested: { map: Map<string, number>; at: Date };
    };
    const mod = createModule("m", {
      schema: { facts: { doc: t.object<Doc>(), tick: t.number() } },
      init: (facts) => {
        facts.tick = 0;
        facts.doc = {
          list: [{ n: 1 }],
          when: new Date(5),
          nested: { map: new Map([["a", 1]]), at: new Date(9) },
        };
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 20 } });
    await system.start();
    // The documented immutable update: reads go through the wrappers and the
    // wrappers are what gets stored.
    system.facts.doc = { ...system.facts.doc };
    system.facts.tick = 1;
    await system.settle();

    const latest = system.history!.snapshots.at(-1)!.facts as {
      doc: Doc;
    };

    expect(latest.doc.list).toEqual([{ n: 1 }]);
    expect(latest.doc.when).toBeInstanceOf(Date);
    expect(latest.doc.nested.at).toBeInstanceOf(Date);
    expect(latest.doc.nested.map).toBeInstanceOf(Map);
    expect(latest.doc.nested.map.get("a")).toBe(1);
    await system.stop();
  });

  it("keeps a cyclic object fact in history", async () => {
    type Node = { name: string; child: { up?: Node } };
    const mod = createModule("m", {
      schema: { facts: { node: t.object<Node>(), tick: t.number() } },
      init: (facts) => {
        facts.tick = 0;
        const node: Node = { name: "root", child: {} };
        node.child.up = node;
        facts.node = node;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 20 } });
    await system.start();
    system.facts.node = { ...system.facts.node };
    system.facts.tick = 1;
    await system.settle();

    const latest = system.history!.snapshots.at(-1)!.facts as { node?: Node };

    expect(latest.node?.name).toBe("root");
    expect(latest.node?.child.up?.name).toBe("root");
    await system.stop();
  });
});
