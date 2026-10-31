/**
 * Test placement signals (lib/layers.ts) on a tiny in-memory test file.
 * The fixture registers its cases with `check(…)`, not the usual test
 * call, so the census does not count them as tests of this file.
 */

import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { layerTests } from "../../lib/layers.js";
import { staticTests } from "../../lib/tests.js";

function place(body: string) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    "/t/a.test.ts",
    `declare const system: any; declare const check: any;\n${body}`,
  );

  return layerTests(
    sf,
    staticTests(sf, ["check"]),
    { rule: "L0" },
    "/core/src",
    () => false,
  );
}

describe("layer placement", () => {
  it("places effect controls on system.effects at L4", () => {
    // One file per case: file-level code is reachable from every case.
    const out = {
      ...place(`check("disable", () => { system.effects.disable("a"); });`),
      ...place(
        `check("enable", () => { const e = system.effects; e.enable("a"); });`,
      ),
      ...place(
        `check("isEnabled", () => { (system.effects as any).isEnabled("a"); });`,
      ),
    };
    expect(out.disable).toMatchObject({
      layer: "L4",
      by: ["member .effects.disable"],
    });
    expect(out.enable).toMatchObject({
      layer: "L4",
      by: ["member .effects.enable"],
    });
    expect(out.isEnabled).toMatchObject({
      layer: "L4",
      by: ["member .effects.isEnabled"],
    });
  });

  it("does not raise an enable or disable on anything else", () => {
    const out = place(`
      declare const toggle: any;
      check("own helper", () => { toggle.enable(); system.facts.disable = 1; });
    `);
    expect(out["own helper"]!.layer).toBe("L0");
  });

  it("places a data-form predicate at L11", () => {
    const out = {
      ...place(
        `check("when object", () => { system.compose({ constraints: { c: { when: { phase: "red" }, require: { type: "T" } } } }); });`,
      ),
      ...place(
        `check("on object", () => { system.compose({ effects: { e: { on: { elapsed: { $gte: 30 } }, run: () => {} } } }); });`,
      ),
      // The operators place the test wherever the object is built: a helper
      // that passes `when` through by name hides the shape of `when` itself.
      ...place(`
        const clause = (when: unknown) => ({ when, require: { type: "T" } });
        check("operators", () => { system.compose({ constraints: { any: clause({ $any: [{ phase: "yellow" }] }) } }); });
      `),
      ...place(
        `check("array op", () => { system.compose({ constraints: { c: { when: [{ fact: "phase", op: "$eq", value: "red" }], require: { type: "T" } } } }); });`,
      ),
    };
    for (const name of ["when object", "on object", "operators", "array op"]) {
      expect(out[name]).toMatchObject({
        layer: "L11",
        by: ["option predicate data form"],
      });
    }
  });

  it("leaves function-form when and on, and $-named facts, where they were", () => {
    const out = {
      ...place(
        `check("when fn", () => { system.compose({ constraints: { c: { when: (f: any) => f.ok, require: { type: "T" } } } }); });`,
      ),
      ...place(
        `check("on fn", () => { system.compose({ effects: { e: { on: (f: any) => f.ok, run: () => {} } } }); });`,
      ),
      ...place(
        `check("schema key", () => { system.compose({ schema: { facts: { $gte: 1 } } }); });`,
      ),
      // A function the test picks at run time is still a function.
      ...place(`
        declare const options: any;
        check("when chosen", () => { system.compose({ constraints: { c: { when: options.when ?? ((f: any) => f.ok), require: { type: "T" } } } }); });
      `),
      ...place(`
        declare const viaDerivation: boolean;
        check("when either", () => { system.compose({ constraints: { c: { when: viaDerivation ? (f: any) => f.a : (f: any) => f.b, require: { type: "T" } } } }); });
      `),
    };
    expect(out["when fn"]!.layer).toBe("L2");
    expect(out["on fn"]!.layer).toBe("L4");
    expect(out["schema key"]!.layer).toBe("L0");
    expect(out["when chosen"]!.layer).toBe("L2");
    expect(out["when either"]!.layer).toBe("L2");
  });
  it("places a batch option built through a helper at L7", () => {
    const out = {
      // The resolver's options are an argument of the helper, so no
      // `resolvers.<id>` stands above `batch` in the key path.
      ...place(`
        declare const build: (resolver: Record<string, unknown>) => any;
        check("argument", () => { build({ batch: { enabled: true, windowMs: 10 } }); });
      `),
      // Named: a file-level constant, a local constant, a shorthand.
      ...place(`
        declare const build: (resolver: Record<string, unknown>) => any;
        const common = { batch: { enabled: true, windowMs: 10 } };
        check("constant", () => { build({ ...common }); });
      `),
      ...place(`
        declare const build: (resolver: Record<string, unknown>) => any;
        check("shorthand", () => {
          const batch = { enabled: true, windowMs: 10 } as const;
          build({ batch });
        });
      `),
      // The helper itself builds the definition and passes `batch` on.
      ...place(`
        const define = (batch: unknown) => ({ resolvers: { r: { requirement: "R", batch } } });
        check("passed on", () => { system.compose(define({ enabled: true })); });
      `),
    };
    for (const name of ["argument", "constant", "shorthand"]) {
      expect(out[name]).toMatchObject({
        layer: "L7",
        by: ["option batch resolver"],
      });
    }
    // `batch` handed on by name is a value we cannot see: still the resolver
    // definition's own `resolvers.<id>.batch` key, which is how it was found.
    expect(out["passed on"]!.layer).toBe("L7");
  });

  it("places the L9 members trace and meta read through a helper at L9", () => {
    const out = {
      ...place(`
        const status = (s: any) => s.trace;
        check("trace", () => { status(system); });
      `),
      ...place(`
        const read = () => system.meta;
        check("meta", () => { read(); });
      `),
    };
    expect(out.trace).toMatchObject({ layer: "L9", by: ["member .trace"] });
    expect(out.meta).toMatchObject({ layer: "L9", by: ["member .meta"] });
  });

  it("leaves a batch that is not a resolver's batch config at L0", () => {
    const out = {
      // The L0 batch of facts, a flag, a function and an array of items.
      ...place(`
        check("system batch", () => { system.batch(() => {}); });
      `),
      ...place(`
        declare const withOptions: (a: unknown, b: unknown) => void;
        check("flag", () => { withOptions({}, { batch: true }); });
      `),
      ...place(`
        check("function", () => { const store = { batch: (fn: () => void) => fn() }; store.batch(() => {}); });
      `),
      ...place(`
        declare const rows: unknown[];
        check("array", () => { const payload = { batch: rows }; void payload; });
      `),
      // A fact named like the option.
      ...place(`
        check("fact", () => { system.compose({ schema: { facts: { batch: { enabled: true } } } }); });
      `),
    };
    for (const name of ["system batch", "flag", "function", "array", "fact"]) {
      expect(out[name]!.layer).toBe("L0");
    }
  });
});
