/**
 * L11a: the engine side of layer eleven (RFC rev 2). A data form runs with
 * no import: a constraint's `when` (E1–E11), an effect's `on` (D1), a
 * derivation's `compute` as a predicate or a template (D2, through the
 * seam), an event's `patch` (D3), a resolver's list `key` (D4), and the
 * namespaced forms (D5); register and assign normalize as creation does
 * (R1–R5); `whenExplain` and explain()'s clause tree (I2, I3). Rows taken
 * under the owner's "I approve you for to do everything" (2026-11-15):
 * (bp) at registration, (bq), (br).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { evaluatePredicate } from "../api/predicate.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const light = (extra: Record<string, unknown> = {}) =>
  createModule("m", {
    schema: {
      facts: { n: t.number(), phase: t.string(), s: t.string() },
      requirements: { GO: {} },
    },
    init: (facts: Any) => {
      facts.n = 0;
      facts.phase = "red";
      facts.s = "a";
    },
    derive: { dbl: (facts: Any) => facts.n * 2 },
    resolvers: {
      go: { requirement: "GO", resolve: async () => {} },
    },
    ...extra,
  } as never);

const activeOf = (system: Any, id = "c") =>
  system.inspect().constraints.find((c: Any) => c.id === id)?.active;

describe("a data-form when (E1, E2, I1)", () => {
  it("fires, is a function afterwards, and its spec is the caller's, frozen", async () => {
    const spec = { phase: "red", n: { $gte: 1 }, tags: { $in: [1, 2] } };
    const def: Any = { when: spec, require: { type: "GO" }, async: false };
    const system: Any = createSystem({
      module: light({ constraints: { c: def } }),
    });
    system.start();
    await wait();
    expect(activeOf(system)).toBe(false);
    system.facts.n = 3;
    await wait();
    expect(activeOf(system)).toBe(false); // tags is undefined
    expect(typeof def.when).toBe("function");
    const ws = system.inspect().constraints[0].whenSpec;
    expect(ws).toBe(spec);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.n)).toBe(true);
    expect(Object.isFrozen(spec.tags.$in)).toBe(true);
    system.destroy();
  });

  it("drops deps and async with 1.35's two warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const def: Any = {
      when: { n: 1 },
      deps: ["phase"],
      async: true,
      require: { type: "GO" },
    };
    const system: Any = createSystem({
      module: light({ constraints: { c: def } }),
    });
    expect(def.async).toBe(false);
    expect(def.deps).toBeUndefined();
    const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("data `when` is always sync");
    expect(text).toContain("cannot be combined with explicit `deps`");
    system.start();
    system.facts.n = 1;
    await wait();
    expect(activeOf(system)).toBe(true);
    system.destroy();
  });

  it("whenExplain reaches observe(), and explain() prints the clause tree", async () => {
    const system: Any = createSystem({
      module: light({
        constraints: {
          c: {
            when: { $all: [{ phase: "red" }, { n: { $gte: 1 } }] },
            require: { type: "GO" },
          },
        },
        resolvers: {
          go: {
            requirement: "GO",
            resolve: () => new Promise(() => {}),
          },
        },
      }),
    });
    const events: Any[] = [];
    system.observe((e: Any) => {
      if (e.type === "constraint.evaluate") {
        events.push(e);
      }
    });
    system.start();
    system.facts.n = 2;
    await wait();
    const last = events.at(-1);
    expect(last.whenExplain[0].op).toBe("$all");
    expect(last.whenExplain[0].children).toHaveLength(2);
    const req = system.inspect().unmet[0] ?? system.inspect().inflight[0];
    const text = system.explain(req.id ?? req.requirementId);
    expect(text).toContain("├─ Predicate clauses:");
    expect(text).toContain("│  └─ ✓ $all (2/2)");
    expect(text).toContain("✓ n $gte 1 (actual: 2)");
    system.destroy();
  });
});

describe("approved rows at registration", () => {
  it("(bp) a global regex fires inside a system; a direct call alternates", async () => {
    const re = /a/g;
    const system: Any = createSystem({
      module: light({
        constraints: {
          c: { when: { s: { $matches: re } }, require: { type: "GO" } },
        },
      }),
    });
    system.start();
    await wait();
    expect(activeOf(system)).toBe(true);
    system.facts.n = 1; // another pass: still true
    await wait();
    expect(system.inspect().constraints[0].whenSpec.s.$matches).toBe(re);
    system.destroy();
    const direct = /a/g;
    const answers = [1, 2, 3, 4].map(() =>
      evaluatePredicate({ s: { $matches: direct } }, { s: "a" }),
    );
    expect(answers).toEqual([true, false, true, false]);
  });

  it("(bq) a combinator beside a fact key is refused with the compilers' message", () => {
    expect(() =>
      createSystem({
        module: light({
          constraints: {
            c: {
              when: { $any: [{ n: 1 }], phase: "green" },
              require: { type: "GO" },
            },
          },
        }),
      }),
    ).toThrow(
      '[Directive] constraint "c": $any cannot coexist with sibling keys (phase) — wrap them in $all together, or move them inside the $any children',
    );
    // The exported evaluator keeps 1.35's answer.
    expect(
      evaluatePredicate({ $any: [{ n: 1 }], phase: "green" }, { n: 1 }),
    ).toBe(true);
  });

  it("(br) a data form that names a derivation warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSystem({
      module: light({
        constraints: {
          c: { when: { dbl: { $gte: 4 } }, require: { type: "GO" } },
        },
        effects: { e: { on: { dbl: 1 }, run: () => {} } },
      }),
    }).destroy();
    const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain('constraint "c": data-form `when` names "dbl"');
    expect(text).toContain('effect "e": data-form `on` names "dbl"');
  });

  it("(br) reads each system's own module: the hooks are shared, the module is not", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = () => warn.mock.calls.map((c) => String(c[0])).join("\n");
    // `dbl` is a derivation here: the constraint and the compute warn.
    const a: Any = createSystem({
      module: light({
        derive: {
          dbl: (facts: Any) => facts.n * 2,
          hit: { compute: { dbl: 1 } },
        },
        constraints: {
          c: { when: { dbl: { $gte: 4 } }, require: { type: "GO" } },
        },
      }),
    });
    a.start();
    void a.derive.hit;
    expect(text()).toContain('constraint "c": data-form `when` names "dbl"');
    expect(text()).toContain(
      'derivation "hit": data-form `compute` names "dbl"',
    );
    warn.mockClear();
    // `dbl` is a fact here: the same forms name no derivation.
    const b: Any = createSystem({
      module: createModule("f", {
        schema: {
          facts: { dbl: t.number() },
          derivations: { hit: t.boolean() },
          requirements: { GO: {} },
        },
        init: (facts: Any) => {
          facts.dbl = 0;
        },
        derive: { hit: { compute: { dbl: 1 } } } as Any,
        constraints: {
          c: { when: { dbl: { $gte: 4 } }, require: { type: "GO" } },
        },
        resolvers: { go: { requirement: "GO", resolve: async () => {} } },
      }),
    });
    b.start();
    void b.derive.hit;
    expect(text()).not.toContain("a derivation");
    b.destroy();
    a.destroy();
  });
});

describe("the other data forms (D1–D4)", () => {
  it("an on gate runs only while it holds; $changed counts the first run", async () => {
    const gated: number[] = [];
    const changed: number[] = [];
    const spec = { n: { $gte: 2 } };
    const system: Any = createSystem({
      module: light({
        effects: {
          g: { on: spec, run: (f: Any) => gated.push(f.n) },
          c: {
            on: { n: { $changed: true } },
            run: (f: Any) => changed.push(f.n),
          },
        },
      }),
    });
    system.start();
    await wait();
    system.facts.n = 1;
    await wait();
    system.facts.phase = "green";
    await wait();
    system.facts.n = 3;
    await wait();
    expect(gated).toEqual([3]);
    expect(changed).toEqual([0, 1, 3]);
    expect(Object.isFrozen(spec)).toBe(true);
    system.destroy();
  });

  it("compute as a predicate and a template; patch; list key", async () => {
    const runs: unknown[] = [];
    const system: Any = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), name: t.string() },
          requirements: { LOAD: { id: t.number(), x: t.number() } },
        },
        init: (facts: Any) => {
          facts.n = 5;
          facts.name = "Ann";
        },
        derive: {
          big: { compute: { n: { $gte: 3 } } },
          hi: { compute: { $template: "Hi ${name} (${n})" } },
        },
        events: {
          rename: { patch: { $set: { name: { $ref: "to" }, n: 9 } } },
        },
        constraints: {
          a: { when: { n: 9 }, require: { type: "LOAD", id: 1, x: 1 } },
          b: { when: { n: 9 }, require: { type: "LOAD", id: 1, x: 2 } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            key: ["id"],
            resolve: async (req: Any) => {
              runs.push(req.x);
            },
          },
        },
      } as never),
    });
    system.start();
    expect(system.read("big")).toBe(true);
    expect(system.read("hi")).toBe("Hi Ann (5)");
    system.dispatch({ type: "rename", to: "Bo" });
    await wait(5);
    expect(system.facts.name).toBe("Bo");
    expect(system.read("hi")).toBe("Hi Bo (9)");
    expect(runs).toEqual([1]);
    system.destroy();
  });
});

describe("register and assign (R1, R2, R5)", () => {
  it("normalize as creation does; data over function and back swap whenSpec", async () => {
    const system: Any = createSystem({ module: light() });
    system.start();
    system.constraints.register("c", {
      when: { n: 1 },
      require: { type: "GO" },
    });
    await wait();
    const spec = () =>
      system.inspect().constraints.find((c: Any) => c.id === "c")?.whenSpec;
    expect(spec()).toEqual({ n: 1 });
    system.constraints.assign("c", {
      when: () => false,
      require: { type: "GO" },
    });
    expect(spec()).toBeUndefined();
    system.derive.register("pos", { compute: { n: { $gt: 0 } } });
    system.facts.n = 1;
    await wait();
    expect(system.read("pos")).toBe(true);
    expect(activeOf(system)).toBe(false);
    system.destroy();
  });
});

describe("namespaced data forms (D5)", () => {
  it("prefixes when and on, scopes compute and patch, and self pivots", async () => {
    const ran: number[] = [];
    const system: Any = createSystem({
      modules: {
        light: light({
          derive: { big: { compute: { n: { $gte: 3 } } } },
          events: { bump: { patch: { $set: { n: 4 } } } },
          constraints: {
            c: {
              when: { self: { phase: "red" }, n: 4 },
              require: { type: "GO" },
            },
          },
          effects: {
            e: { on: { n: { $gte: 4 } }, run: (f: Any) => ran.push(f.n) },
          },
        }),
      },
    });
    system.start();
    await wait();
    expect(system.read("light.big")).toBe(false);
    system.events.light.bump();
    await wait();
    expect(system.facts.light.n).toBe(4);
    expect(system.read("light.big")).toBe(true);
    const c = system.inspect().constraints[0];
    expect(c.whenSpec).toEqual({ "light::phase": "red", "light::n": 4 });
    expect(c.active).toBe(true);
    expect(ran).toEqual([4]);
    system.destroy();
  });
});
