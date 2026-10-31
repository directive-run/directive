/**
 * L3d: the places the L3 diff scenarios showed 2.0 differing from 1.35, each
 * pinned through the public API, plus the plugin snapshot a broadcast walks.
 */
import { describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("loaded facts are filed as hydrate (1.35)", () => {
  it("initialFacts and hydrate() write with origin hydrate; later writes are authored", async () => {
    const batched: string[] = [];
    const observed: string[] = [];
    const system = createSystem({
      module: createModule("ssr", {
        schema: { facts: { user: t.string(), n: t.number() } },
        init: (f: any) => {
          f.user = "";
          f.n = 0;
        },
      }),
      initialFacts: { n: 5 },
      plugins: [
        {
          name: "rec",
          onFactsBatch: (changes: any[]) => {
            for (const c of changes) {
              batched.push(`${c.key}=${c.value}:${c.origin}`);
            }
          },
        },
      ],
    } as any) as any;
    system.observe((e: any) => {
      if (e.type === "fact.change") {
        observed.push(`${e.key}=${e.next}:${e.origin}`);
      }
    });
    await system.hydrate(async () => ({ user: "u1" }));
    system.start();
    system.facts.n = 6;
    await flush();
    expect(batched.filter((s) => !s.endsWith(":authored"))).toEqual([
      "n=5:hydrate",
      "user=u1:hydrate",
    ]);
    expect(observed.filter((s) => !s.endsWith(":authored"))).toEqual([
      "n=5:hydrate",
      "user=u1:hydrate",
    ]);
    expect(observed).toContain("n=6:authored");
    system.destroy();
  });
});

describe("stop() keeps the requirements it cancels (1.35)", () => {
  const slow = () =>
    createModule("m", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { SLOW: {} },
      },
      init: (f: any) => {
        f.go = false;
        f.done = false;
      },
      constraints: {
        slow: {
          when: (f: any) => f.go && !f.done,
          require: { type: "SLOW" },
        },
      },
      resolvers: {
        slow: { requirement: "SLOW", resolve: () => new Promise(() => {}) },
      },
    } as any);

  it("inspect() lists it after stop(); the pass after start() cancels it once unwanted", async () => {
    const ends: any[] = [];
    const observed: any[] = [];
    const system = createSystem({
      module: slow(),
      plugins: [{ name: "p", onReconcileEnd: (r: any) => ends.push(r) }],
    } as any) as any;
    system.observe((e: any) => {
      if (e.type === "reconcile.end") {
        observed.push(e.resolversCanceled);
      }
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.stop();
    expect(system.inspect().unmet.map((r: any) => r.id)).toEqual(["SLOW:{}"]);
    system.facts.done = true;
    expect(system.inspect().unmet.map((r: any) => r.id)).toEqual(["SLOW:{}"]);
    const before = ends.length;
    system.start();
    await flush();
    expect(ends.length).toBeGreaterThan(before);
    expect(ends[before].canceled).toEqual([
      { id: "SLOW:{}", resolverId: "unknown" },
    ]);
    expect(observed).toContain(1);
    expect(system.inspect().unmet).toEqual([]);
    system.destroy();
  });

  it("quirk j still holds: one still wanted runs again after start()", async () => {
    const starts = vi.fn();
    const system = createSystem({
      module: slow(),
      plugins: [{ name: "p", onResolverStart: starts }],
    } as any) as any;
    system.start();
    system.facts.go = true;
    await flush();
    system.stop();
    system.start();
    await flush();
    expect(starts).toHaveBeenCalledTimes(2);
    expect(system.inspect().unmet.map((r: any) => r.id)).toEqual(["SLOW:{}"]);
    system.destroy();
  });
});

describe("a broadcast walks the plugins as they were when it began (1.35)", () => {
  it("one leaving or joining inside a hook does not change who hears that record", () => {
    const heard: string[] = [];
    const system = createSystem({
      module: createModule("c", {
        schema: { facts: { n: t.number() } },
        init: (f: any) => {
          f.n = 0;
        },
      }),
    }) as any;
    const off = system.observe((e: any) => {
      if (e.type === "fact.change") {
        heard.push(`one:${e.next}`);
        off();
        system.observe((e2: any) => {
          if (e2.type === "fact.change") {
            heard.push(`three:${e2.next}`);
          }
        });
      }
    });
    system.observe((e: any) => {
      if (e.type === "fact.change") {
        heard.push(`two:${e.next}`);
      }
    });
    // The first record is the init write (n = 0): one leaves and three
    // joins while it is delivered, so two hears it and three does not.
    system.start();
    system.facts.n = 1;
    expect(heard).toEqual(["one:0", "two:0", "two:1", "three:1"]);
    system.destroy();
  });
});
