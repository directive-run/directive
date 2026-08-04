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

  // ==========================================================================
  // Explicit `deps`
  // ==========================================================================
  //
  // Auto-tracking files a derivation read under an internal namespace. A `deps`
  // array is written by hand and arrives as a bare name, so the two have to be
  // brought onto one keyspace before they are compared — otherwise the
  // documented escape hatch is dead for exactly the dependency it is most often
  // reached for, and it is dead silently: the auto-tracked equivalent works, so
  // it reads as correct until someone declares the dependency they were told to
  // declare.

  // A body that reads the derivation it declared is the easy half, and it is
  // the half that hides the hard one: reading puts the derivation back in a
  // valid state, so the next fact change is a fresh valid-to-stale transition.
  // A body that only *declares* the dependency never does that, so every test
  // below runs several fact changes with a body that reads nothing derived.

  it("re-runs an effect whose explicit deps name a derivation", async () => {
    const runs: number[] = [];
    let readDoubled: () => number = () => 0;

    const mod = createModule("explicit-effect", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { doubled: (facts) => facts.count * 2 },
      effects: {
        watch: {
          deps: ["doubled"],
          run: () => {
            runs.push(readDoubled());
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    readDoubled = () => system.derive.doubled;
    system.start();
    await settle();

    const afterStart = runs.length;

    system.facts.count = 4;
    await settle();

    expect(runs.length).toBeGreaterThan(afterStart);
    expect(runs.at(-1)).toBe(8);

    system.destroy();
  });

  it("keeps waking an effect whose body never reads the derivation it named", async () => {
    const runs: number[] = [];

    const mod = createModule("explicit-effect-blind", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { doubled: (facts) => facts.count * 2 },
      effects: {
        watch: {
          deps: ["doubled"],
          // Reads the fact, never the derivation. Nothing here brings
          // `doubled` back to a valid state, so nothing re-arms an
          // announcement that only fires on the way to stale.
          run: (facts) => {
            runs.push(facts.count);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await settle();
    runs.length = 0;

    system.facts.count = 1;
    await settle();
    system.facts.count = 2;
    await settle();
    system.facts.count = 3;
    await settle();

    expect(runs).toEqual([1, 2, 3]);

    system.destroy();
  });

  it("re-evaluates an async constraint whose explicit deps name a derivation", async () => {
    const evaluations: boolean[] = [];
    let readReady: () => boolean = () => false;

    const mod = createModule("explicit-async", {
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
          // An async `when()` cannot auto-track — the tracking context closes
          // when the body returns its promise — so `deps` is the only way it
          // can say what it reads, and core's own warning says to use it.
          async: true,
          deps: ["ready"],
          when: async () => {
            const value = readReady();
            evaluations.push(value);

            return value;
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
    });

    const system = createSystem({ module: mod });
    readReady = () => system.derive.ready;
    system.start();
    await settle();

    const afterStart = evaluations.length;

    system.facts.count = 2;
    await settle();

    expect(evaluations.length).toBeGreaterThan(afterStart);
    expect(system.facts.fired).toBe(true);

    system.destroy();
  });

  it("keeps re-evaluating an async constraint that never reads the derivation", async () => {
    const evaluations: number[] = [];

    const mod = createModule("explicit-async-blind", {
      schema: {
        facts: { count: t.number() },
        derivations: { ready: t.boolean() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.count = 0;
      },
      derive: { ready: (facts) => facts.count >= 2 },
      constraints: {
        go: {
          async: true,
          deps: ["ready"],
          when: async (facts) => {
            evaluations.push(facts.count);

            return false;
          },
          require: { type: "GO" },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await settle();
    evaluations.length = 0;

    system.facts.count = 1;
    await settle();
    system.facts.count = 2;
    await settle();
    system.facts.count = 3;
    await settle();
    system.facts.count = 4;
    await settle();

    expect(evaluations).toEqual([1, 2, 3, 4]);

    system.destroy();
  });

  it("resolves an effect's declared derivation name when the derivation arrives after it", async () => {
    const runs: number[] = [];

    // Declared in the schema and supplied at runtime, which is what the
    // piecemeal API is for. Nothing implements `doubled` until `register` does.
    const mod = createModule("late-derivation", {
      schema: {
        facts: { count: t.number(), other: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.count = 0;
        facts.other = 0;
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    // The effect first, naming something that means nothing yet. A `deps` name
    // is resolved against the derivations the system holds when the effect is
    // considered, not the ones it held when the effect was registered.
    system.effects.register("watch", {
      deps: ["doubled"],
      run: (facts) => {
        runs.push(facts.count as number);
      },
    });
    system.derive.register("doubled", (facts) => (facts.count as number) * 2);
    // A derivation registered at runtime is lazy — it records what it reads
    // when it first computes, so read it once to give it a dependency on
    // `count` at all.
    expect(system.derive.doubled).toBe(0);
    await settle();
    runs.length = 0;

    system.facts.count = 5;
    await settle();

    expect(runs).toEqual([5]);

    // And a fact the derivation does not read still leaves the effect alone.
    system.facts.other = 1;
    await settle();
    expect(runs).toEqual([5]);

    system.destroy();
  });

  it("keeps an explicit dep that names a fact working", async () => {
    const runs: number[] = [];

    const mod = createModule("explicit-fact", {
      schema: {
        facts: { count: t.number(), other: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (facts) => {
        facts.count = 0;
        facts.other = 0;
      },
      derive: { doubled: (facts) => facts.count * 2 },
      effects: {
        watch: {
          deps: ["count"],
          run: (facts) => {
            runs.push(facts.count);
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();
    await settle();

    const afterStart = runs.length;

    system.facts.count = 3;
    await settle();

    expect(runs.length).toBeGreaterThan(afterStart);
    expect(runs.at(-1)).toBe(3);

    // And a fact it did not name still leaves it alone.
    const afterCount = runs.length;
    system.facts.other = 9;
    await settle();
    expect(runs.length).toBe(afterCount);

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

/**
 * What an invalidation costs, and what it says.
 *
 * Two questions ride on one fact change, and they have different shapes. "Which
 * derivations are now stale" is an edge — staleness latches, and a derivation
 * that is already stale stays stale, so the answer stops at the frontier. "Which
 * watched derivations may have moved" repeats for as long as a derivation stays
 * stale, because a consumer that never reads the value back has no other way to
 * hear about it.
 *
 * Answering both with one walk made the second correct and the first linear in
 * the size of the graph, per fact write, forever. These hold the two apart: the
 * announcement stays flat while the waking keeps happening.
 */
describe("invalidation cost", () => {
  /** A chain of `n` derivations over one fact, with nothing reading it back. */
  function chainModule(n: number, effects: Record<string, unknown> = {}) {
    const derive: Record<string, (facts: never, derived: never) => unknown> = {
      d0: (facts: { x: number }) => facts.x + 1,
    };
    const derivations: Record<string, ReturnType<typeof t.number>> = {
      d0: t.number(),
    };
    for (let i = 1; i < n; i++) {
      const previous = `d${i - 1}`;
      derive[`d${i}`] = (_facts: never, derived: Record<string, number>) =>
        derived[previous]! + 1;
      derivations[`d${i}`] = t.number();
    }

    return createModule("chain", {
      schema: { facts: { x: t.number() }, derivations },
      init: (facts) => {
        facts.x = 0;
      },
      derive: derive as never,
      effects: effects as never,
    });
  }

  /** A plugin that counts what the derivation channel says. */
  function countingPlugin(counts: { invalidate: number }) {
    return {
      name: "counter",
      onDerivationInvalidate: () => {
        counts.invalidate++;
      },
    };
  }

  it("announces a derivation going stale once, not once per later write", async () => {
    const counts = { invalidate: 0 };
    const size = 60;

    const system = createSystem({
      module: chainModule(size),
      plugins: [countingPlugin(counts)] as never,
    });
    system.start();
    // Compute the whole chain once so every edge exists.
    void system.derive[`d${size - 1}` as never];
    await settle();

    counts.invalidate = 0;
    for (let i = 1; i <= 10; i++) {
      system.facts.x = i;
      await settle();
    }

    // The first write takes the chain from valid to stale, which is `size`
    // transitions. Nothing reads it back, so the nine writes after it change no
    // derivation's state and have nothing to announce. A walk that repeated the
    // announcement through stale nodes reported ten times this.
    expect(counts.invalidate).toBe(size);

    system.destroy();
  });

  it("keeps waking a watcher while the derivation it named stays stale", async () => {
    const counts = { invalidate: 0 };
    const runs: number[] = [];
    const size = 60;
    const tip = `d${size - 1}`;

    const system = createSystem({
      module: chainModule(size, {
        // Names the far end of the chain and never reads it, so nothing ever
        // takes it back out of the stale state.
        watch: {
          deps: [tip],
          run: (facts: { x: number }) => {
            runs.push(facts.x);
          },
        },
      }),
      plugins: [countingPlugin(counts)] as never,
    });
    system.start();
    void system.derive[tip as never];
    await settle();

    runs.length = 0;
    counts.invalidate = 0;

    for (let i = 1; i <= 5; i++) {
      system.facts.x = i;
      await settle();
    }

    // Woken every time, and told once.
    expect(runs).toEqual([1, 2, 3, 4, 5]);
    expect(counts.invalidate).toBe(size);

    system.destroy();
  });

  it("says nothing about a derivation no dependency set names", async () => {
    const runs: number[] = [];
    const size = 40;

    const system = createSystem({
      module: chainModule(size, {
        // A fact dependency only. The chain is invalidated by the same write
        // and no part of it is anyone's dependency.
        watch: {
          deps: ["x"],
          run: (facts: { x: number }) => {
            runs.push(facts.x);
          },
        },
      }),
    });
    system.start();
    void system.derive[`d${size - 1}` as never];
    await settle();
    runs.length = 0;

    system.facts.x = 1;
    await settle();

    expect(runs).toEqual([1]);
    // Nothing watches a derivation, so no derivation name reaches the
    // dependency comparison and the closure is never walked. Observable only
    // as the effect still running on the fact it did name.
    system.destroy();
  });

  it("carries a reassigned derivation through to what composes it", () => {
    const mod = createModule("reassign", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number(), quadrupled: t.number() },
      },
      init: (facts) => {
        facts.count = 2;
      },
      derive: {
        doubled: (facts) => facts.count * 2,
        quadrupled: (_facts, derived) => derived.doubled * 2,
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    expect(system.derive.quadrupled).toBe(8);

    system.derive.assign("doubled", (facts) => facts.count * 10);

    // The composed value was computed from the old function and has to go with
    // it — and, less visibly, a valid derivation must not be left sitting
    // downstream of a stale one, because the invalidation walk stops at the
    // stale frontier on the grounds that it cannot be.
    expect(system.derive.quadrupled).toBe(40);

    system.destroy();
  });
});
