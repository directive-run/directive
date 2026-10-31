/**
 * What `system.inspect()` lists about the definitions a system was built
 * from: its facts, events, derivations, effects, modules, constraints and
 * resolvers. Black-box: only the public shape a user reads.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

function build() {
  const mod = createModule("inspected", {
    schema: {
      facts: { go: t.boolean(), n: t.number() },
      derivations: { double: t.number() },
      events: { bump: {} },
      requirements: { LOAD: {}, OTHER: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.n = 0;
    },
    derive: { double: (facts: any) => facts.n * 2 },
    events: {
      bump: (facts: any) => {
        facts.n = facts.n + 1;
      },
    },
    effects: { log: { run: () => undefined } },
    constraints: {
      watched: {
        when: (facts: any) => facts.go,
        require: { type: "LOAD" },
        abortOn: ["n"],
      },
      unwatched: {
        when: (facts: any) => facts.go,
        require: { type: "LOAD" },
        abortOn: [],
      },
      plain: {
        when: (facts: any) => facts.go,
        require: { type: "OTHER" },
      },
    },
    resolvers: {
      load: { requirement: "LOAD", resolve: async () => undefined },
      other: {
        requirement: (req: any) => req.type === "OTHER",
        resolve: async () => undefined,
      },
    },
  } as never);

  return createSystem({ module: mod }) as any;
}

describe("inspect() lists the definitions", () => {
  it("names every fact, event, derivation, effect and module", () => {
    const system = build();
    const info = system.inspect();

    expect(info.facts.map((f: any) => f.key).sort()).toEqual(["go", "n"]);
    expect(info.events.map((e: any) => e.name)).toEqual(["bump"]);
    expect(info.derivations.map((d: any) => d.id)).toEqual(["double"]);
    expect(info.effects.map((e: any) => e.id)).toEqual(["log"]);
    expect(info.modules.map((m: any) => m.id)).toEqual(["inspected"]);
    system.destroy();
  });

  it("lists each constraint, with abortOn only when it names facts", () => {
    const system = build();
    const byId = Object.fromEntries(
      system.inspect().constraints.map((c: any) => [c.id, c]),
    );

    expect(Object.keys(byId).sort()).toEqual(["plain", "unwatched", "watched"]);
    expect(byId.watched.abortOn).toEqual(["n"]);
    expect("abortOn" in byId.unwatched).toBe(false);
    expect("abortOn" in byId.plain).toBe(false);
    // Nothing has been evaluated yet.
    expect(byId.watched.active).toBe(false);
    system.destroy();
  });

  it("names the requirement a resolver answers, and marks a predicate", () => {
    const system = build();
    const byId = Object.fromEntries(
      system.inspect().resolverDefs.map((r: any) => [r.id, r]),
    );

    expect(byId.load.requirement).toBe("LOAD");
    expect(typeof byId.other.requirement).toBe("string");
    expect(byId.other.requirement.length).toBeGreaterThan(0);
    expect(byId.other.requirement).not.toBe("OTHER");
    system.destroy();
  });
});
