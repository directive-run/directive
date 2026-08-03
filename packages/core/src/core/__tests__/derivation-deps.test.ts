/**
 * Auto-tracking captures derivation reads as well as fact reads.
 *
 * A constraint's `when()` and an effect's `run()` are both evaluated under
 * dependency tracking, and both can read a derivation through `system.derive`.
 * Incremental evaluation has to honour the resulting dependency the same way it
 * honours a fact dependency — otherwise a constraint or effect gated purely on
 * a derivation runs once, at startup, and is never brought back.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("derivation dependencies", () => {
  it("re-evaluates a constraint gated only on a derivation", async () => {
    const evaluations: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("gate", {
      schema: {
        facts: { count: t.number(), fired: t.boolean() },
        derivations: { ready: t.boolean() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.count = 0;
        facts.fired = false;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      constraints: {
        go: {
          when: () => {
            const value = readReady();
            evaluations.push(value);

            return value;
          },
          // A static `require` reads no facts, so the derivation is the
          // constraint's only tracked dependency.
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async (_req, context) => {
            context.facts.fired = true;
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();

    system.facts.count = 1;
    await settle();
    expect(system.facts.fired).toBe(false);

    system.facts.count = 2;
    await settle();

    expect(system.facts.fired).toBe(true);
    expect(evaluations.length).toBeGreaterThan(1);
    system.destroy();
  });

  it("re-runs an effect that reads a derivation and no facts", async () => {
    const seen: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("watcher", {
      schema: {
        facts: { count: t.number() },
        derivations: { ready: t.boolean() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      effects: {
        watch: {
          run: () => {
            seen.push(readReady());
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();
    await settle();

    system.facts.count = 2;
    await settle();

    expect(seen).toContain(true);
    system.destroy();
  });

  it("leaves a system whose constraints read only facts unchanged", async () => {
    const mod = createModule("plain", {
      schema: {
        facts: { count: t.number(), fired: t.boolean() },
        derivations: { doubled: t.number() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.count = 0;
        facts.fired = false;
      },
      derive: { doubled: (facts) => facts.count * 2 },
      constraints: {
        go: {
          when: (facts) => facts.count >= 2,
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async (_req, context) => {
            context.facts.fired = true;
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    system.facts.count = 3;
    await settle();

    expect(system.facts.fired).toBe(true);
    expect(system.derive.doubled).toBe(6);
    system.destroy();
  });
});

/**
 * A fact and a derivation may share a name.
 *
 * Nothing rejects it, plenty of modules would write it without thinking — a
 * `ready` fact the operator sets and a `ready` derivation that means something
 * narrower — and the two are unrelated values. The invalidation set and the
 * dependency maps carry both kinds of name, so unless they are namespaced the
 * lookup for one returns the union of both: an effect gated on the fact re-runs
 * because the derivation went stale, and a derivation reading the fact is never
 * invalidated when the fact changes because its dependency was filed under
 * derivations.
 */
describe("a fact and a derivation with the same name", () => {
  it("does not re-run a fact-gated effect when the derivation goes stale", async () => {
    const factGated: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("collide", {
      schema: {
        facts: { ready: t.boolean(), count: t.number() },
        derivations: { ready: t.boolean() },
      },
      init: (facts) => {
        facts.ready = false;
        facts.count = 0;
      },
      // Shares its name with the fact above, and means something else.
      derive: { ready: (facts) => facts.count >= 2 },
      effects: {
        onFact: {
          run: (facts) => {
            factGated.push(facts.ready);
          },
        },
        onDerivation: {
          run: () => {
            readReady();
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();
    await settle();

    const afterStart = factGated.length;

    // Moves the derivation and nothing else the fact-gated effect reads.
    system.facts.count = 2;
    await settle();

    expect(system.derive.ready).toBe(true);
    expect(system.facts.ready).toBe(false);
    // The effect reads `facts.ready`, which did not change. Before the
    // namespace, the derivation going stale invalidated the fact's name too and
    // this ran again.
    expect(factGated.length).toBe(afterStart);

    // And the fact still drives it, so the namespace did not simply mute it.
    system.facts.ready = true;
    await settle();
    expect(factGated.length).toBeGreaterThan(afterStart);
    expect(factGated.at(-1)).toBe(true);

    system.destroy();
  });

  it("does not re-evaluate a fact-gated constraint when the derivation goes stale", async () => {
    const evaluations: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("collide-constraint", {
      schema: {
        facts: { ready: t.boolean(), count: t.number(), fired: t.boolean() },
        derivations: { ready: t.boolean() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.ready = false;
        facts.count = 0;
        facts.fired = false;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      constraints: {
        go: {
          // Reads `facts.ready` and nothing else, so `ready` is the whole
          // tracked dependency set and the only thing that should bring it
          // back.
          when: (facts) => {
            evaluations.push(facts.ready);

            return facts.ready;
          },
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async (_req, context) => {
            context.facts.fired = true;
          },
        },
      },
      effects: {
        // Keeps the derivation live, so it is computed and can go stale.
        watch: {
          run: () => {
            readReady();
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();
    await settle();

    const afterStart = evaluations.length;

    system.facts.count = 2;
    await settle();

    expect(system.derive.ready).toBe(true);
    expect(evaluations.length).toBe(afterStart);
    expect(system.facts.fired).toBe(false);

    system.facts.ready = true;
    await settle();

    expect(evaluations.length).toBeGreaterThan(afterStart);
    expect(system.facts.fired).toBe(true);

    system.destroy();
  });

  it("still invalidates a derivation that reads the like-named fact", async () => {
    const mod = createModule("collide-derive", {
      schema: {
        facts: { ready: t.boolean(), count: t.number() },
        derivations: { ready: t.boolean(), mirrors: t.boolean() },
      },
      init: (facts) => {
        facts.ready = false;
        facts.count = 0;
      },
      derive: {
        ready: (facts) => facts.count >= 2,
        // Reads the *fact*, while a sibling derivation owns the same name.
        // The dependency used to be filed under derivations because the name
        // matched one, so the fact changing never brought this back.
        mirrors: (facts) => facts.ready,
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    expect(system.derive.mirrors).toBe(false);

    system.facts.ready = true;
    await settle();

    expect(system.derive.mirrors).toBe(true);

    system.destroy();
  });
});
