/**
 * B5 (module-churn at steady state): the register and unregister paths made
 * cheaper keep their behaviour. Each test pins one change: the effects'
 * counted prevFacts readers (effects.ts), the key-function lookup on a
 * resolver's unregister (dynamic.ts), and the lazily built `onReconcileEnd`
 * result (reconcile.ts, core.ts).
 */
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

const host = () =>
  createModule("host", {
    schema: { facts: { n: t.number() } },
    init: (facts: Any) => {
      facts.n = 0;
    },
  } as never);

const reader = (name: string, seen: unknown[]) =>
  createModule(name, {
    schema: { facts: { [`${name}_x`]: t.number() } },
    init: (facts: Any) => {
      facts[`${name}_x`] = 0;
    },
    effects: {
      [`see_${name}`]: {
        run: (facts: Any, prev: Any) => {
          seen.push([facts.n, prev?.n]);
        },
      },
    },
  } as never);

describe("B5: counted prevFacts readers", () => {
  it("a reader registered later gets prevFacts; one left keeps them when the other goes", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const system = createSystem({ module: host() } as never) as Any;
    system.start();
    await system.settle();
    system.registerModule(reader("a", a));
    system.registerModule(reader("b", b));
    await system.settle();
    system.facts.n = 1;
    await system.settle();
    expect(a.at(-1)).toEqual([1, 0]);
    await system.unregisterModule("a");
    system.facts.n = 2;
    await system.settle();
    expect(b.at(-1)).toEqual([2, 1]);
    await system.unregisterModule("b");
    system.facts.n = 3;
    await system.settle();
    // The last reader gone, a new one starts the copying again.
    const c: unknown[] = [];
    system.registerModule(reader("c", c));
    await system.settle();
    system.facts.n = 4;
    await system.settle();
    expect(c.at(-1)).toEqual([4, 3]);
    system.destroy();
  });
});

const resolving = (name: string, keyed: string[] | null) =>
  createModule(name, {
    schema: { facts: { [`${name}_go`]: t.boolean() } },
    init: (facts: Any) => {
      facts[`${name}_go`] = false;
    },
    constraints: {
      [`c_${name}`]: {
        when: (f: Any) => f[`${name}_go`],
        require: { type: "SHARED" },
      },
    },
    resolvers: {
      [`r_${name}`]: {
        requirement: "SHARED",
        ...(keyed && {
          key: () => {
            keyed.push(name);

            return `k-${name}`;
          },
        }),
        resolve: async () => undefined,
      },
    },
  } as never);

describe("B5: a resolver's key function on unregister", () => {
  it("a keyless resolver leaving keeps another's key function", async () => {
    const keyed: string[] = [];
    const system = createSystem({ module: host() } as never) as Any;
    system.start();
    system.registerModule(resolving("keyed", keyed));
    system.registerModule(resolving("plain", null));
    await system.settle();
    await system.unregisterModule("plain");
    system.facts.keyed_go = true;
    await system.settle();
    expect(keyed).toContain("keyed");
    system.destroy();
  });

  it("the only keyed resolver leaving takes its key function with it", async () => {
    const keyed: string[] = [];
    const system = createSystem({ module: host() } as never) as Any;
    system.start();
    system.registerModule(resolving("keyed", keyed));
    await system.settle();
    await system.unregisterModule("keyed");
    system.registerModule(resolving("plain", null));
    keyed.length = 0;
    system.facts.plain_go = true;
    await system.settle();
    expect(keyed).toEqual([]);
    system.destroy();
  });
});

describe("B5: the onReconcileEnd result, built when wanted", () => {
  it("lists the run in flight and the unmet requirement", async () => {
    const ends: Any[] = [];
    let release = () => {};
    const system = createSystem({
      module: createModule("m", {
        schema: { facts: { go: t.boolean() }, requirements: { HOLD: {} } },
        init: (facts: Any) => {
          facts.go = true;
        },
        constraints: {
          hold: { when: (f: Any) => f.go, require: { type: "HOLD" } },
        },
        resolvers: {
          hold: {
            requirement: "HOLD",
            resolve: () =>
              new Promise<void>((done) => {
                release = done;
              }),
          },
        },
      } as never),
      plugins: [{ name: "ends", onReconcileEnd: (r: Any) => ends.push(r) }],
    } as never) as Any;
    system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const last = ends.at(-1);
    expect(last.inflight.map((r: Any) => r.resolverId)).toEqual(["hold"]);
    expect(last.unmet).toEqual([]);
    expect(last.completed).toEqual([]);
    expect(last.canceled).toEqual([]);
    release();
    system.destroy();
  });
});
