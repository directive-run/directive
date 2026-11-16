/**
 * L9a: the seam the trace reads (four record fields), the meta part, the
 * inspect() counters, the observer cap and runaway rethrow, and notify's
 * clobber-loop pair. The 1.35 behaviour is pinned by the conformance suite;
 * these pin what it cannot see before the trace exists: the records.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type SystemPart,
  createModule,
  createSystemCore,
} from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { withObserve } from "../api/observe.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Rec = { at: string; [key: string]: unknown };
/** A part that keeps every record of kind `at` from the kernel's stream. */
const recorder = (at: string) => {
  const seen: Rec[] = [];
  const part: SystemPart = ({ kernel }) => {
    kernel.hooks.on((event) => {
      if (event.at === at) {
        seen.push(event as unknown as Rec);
      }
    });
  };

  return { seen, part };
};
const build = (rec: SystemPart, ...more: SystemPart[]) =>
  createSystemCore({ module: counter() } as never, [
    rec,
    ...more,
    withEffects,
    withReconcile,
    withPlugins([]),
  ]) as any;

const counter = () =>
  createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: { double: t.number() },
      requirements: { BIG: {} },
    },
    init: (facts) => {
      facts.n = 1;
    },
    derive: { double: (facts) => facts.n * 2 },
    constraints: {
      big: {
        priority: 7,
        when: (_facts, derive) => derive.double > 4,
        require: { type: "BIG" },
      },
    },
    resolvers: { big: { requirement: "BIG", resolve: async () => {} } },
    effects: { log: { run: (facts) => void facts.n } },
  });

describe("the seam: what each record carries (L9a)", () => {
  it("derivation.compute carries the value before the compute", async () => {
    const raw = recorder("derivation.compute");
    const system = build(raw.part);
    system.start();
    expect(system.derive.double).toBe(2);
    system.facts.n = 2;
    expect(system.derive.double).toBe(4);
    await system.settle();
    const rows = raw.seen.map((r) => [r.value, r.oldValue]);
    expect(rows[0]).toEqual([2, undefined]);
    expect(rows).toContainEqual([4, 2]);
    system.destroy();
  });

  it("requirement.diff lists what a pass added and removed, and each constraint hit", async () => {
    const raw = recorder("requirement.diff");
    const system = build(raw.part);
    system.start();
    await system.settle();
    system.facts.n = 3;
    await system.settle();
    const added = raw.seen.find((r) => (r.added as unknown[]).length > 0)!;
    expect((added.added as { id: string }[]).map((r) => r.id)).toEqual([
      "BIG:{}",
    ]);
    expect(added.hit).toEqual([
      { id: "big", priority: 7, deps: ["derive.double"] },
    ]);
    system.facts.n = 0;
    await system.settle();
    const removed = raw.seen.find((r) => (r.removed as unknown[]).length > 0)!;
    expect((removed.removed as { id: string }[]).map((r) => r.id)).toEqual([
      "BIG:{}",
    ]);
    expect(removed.hit).toEqual([]);
    system.destroy();
  });

  it("effect.run lists what the effect read only while the trace is on", async () => {
    const run = async (tracing: boolean) => {
      const raw = recorder("effect.run");
      const trace: SystemPart = (context) => {
        if (tracing) {
          context.trace_ = {};
        }
      };
      const system = build(raw.part, trace);
      system.start();
      await system.settle();
      system.facts.n = 2;
      await system.settle();
      system.destroy();

      return raw.seen.map((r) => r.deps);
    };
    const on = await run(true);
    expect(on.at(-1)).toEqual(["n"]);
    const off = await run(false);
    // No reader of the list: every run hands the one shared, empty list.
    expect(off.length).toBeGreaterThan(1);
    expect(off.every((deps) => deps === off[0] && Object.isFrozen(deps))).toBe(
      true,
    );
    expect(off[0]).toEqual([]);
  });
});

describe("inspect() counters, observe and notify (L9a)", () => {
  it("counts the watched derivations, and what was written while one is watched", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);
    system.facts.n = 2;
    expect(system.inspect().pendingInvalidations).toBe(1);
    await system.settle();
    expect(system.inspect().pendingInvalidations).toBe(0);
    system.destroy();
  });

  it("the 101st observer hears nothing until a place is freed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: counter() });
    const offs = Array.from({ length: 100 }, () => system.observe(() => {}));
    const heard: unknown[] = [];
    system.observe((event) => heard.push(event))();
    expect(warn.mock.calls.flat().join(" ")).toContain(
      "Maximum observer limit (100)",
    );
    offs[0]!();
    offs[0]!();
    system.observe((event) => heard.push(event));
    system.start();
    expect(heard.length).toBeGreaterThan(0);
    system.destroy();
    warn.mockRestore();
  });

  it("notify's clobber-loop pair reaches plugins, capped at depth 4 with guardrailBlocked", async () => {
    let calls = 0;
    const ref: { system?: any } = {};
    const plugin = {
      name: "loop",
      onClobberLoopDetected: (event: unknown) => {
        calls++;
        ref.system!.notify.clobberLoopDetected(event as never);
      },
    };
    const system: any = (ref.system = createSystem({
      module: counter(),
      plugins: [plugin],
    }));
    system.start();
    await system.settle();
    system.notify.clobberLoopDetected({ type: "x" } as never);
    expect(calls).toBe(4);
    system.destroy();
  });

  it("a batch stops at an observer whose own write runs away, and does not log it (S2)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const system = createSystem({
      module: createModule("m", {
        schema: { facts: { n: t.number(), m1: t.number(), m2: t.number() } },
        init: (facts) => {
          facts.n = 0;
          facts.m1 = 0;
          facts.m2 = 0;
        },
      }),
    });
    system.start();
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
      delivered.push(event.key as string);
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
    // m2 is not delivered after m1's observer ran away, and the per-key
    // "Observer threw" line is not written for the runtime's own guard.
    expect(delivered.filter((key) => key !== "n")).toEqual(["m1"]);
    const lines = error.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("Observer threw"))).toBe(false);
    // An ordinary throw is still logged, and the batch goes on.
    const plain = vi.fn((event: { type: string; key?: string }) => {
      if (event.key === "m1") {
        throw new Error("plain");
      }
    });
    system.observe(plain as never);
    system.batch(() => {
      system.facts.m1 = 2;
      system.facts.m2 = 2;
    });
    expect(plain.mock.calls.map((call) => call[0].key)).toContain("m2");
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes("Observer threw"),
      ),
    ).toBe(true);
    system.destroy();
    error.mockRestore();
  });

  it("whenExplain reaches an observer only when the record explains (S6)", () => {
    let emit!: (at: string, data: Record<string, unknown>) => void;
    const grab: SystemPart = ({ kernel }) => {
      emit = (at, data) => kernel.hooks.emit(at as never, data);
    };
    const system = createSystemCore({ module: counter() } as never, [
      grab,
      withPlugins([]),
      withObserve,
    ]) as any;
    const heard: Record<string, unknown>[] = [];
    system.observe((event: Record<string, unknown>) => {
      if (event.type === "constraint.evaluate") {
        heard.push(event);
      }
    });
    system.start();
    const explain = [{ path: "n", pass: true }];
    emit("constraint.evaluate", { id: "big", active: true, explain });
    emit("constraint.evaluate", { id: "big", active: false });
    expect(heard).toStrictEqual([
      {
        type: "constraint.evaluate",
        id: "big",
        active: true,
        whenExplain: explain,
      },
      { type: "constraint.evaluate", id: "big", active: false },
    ]);
    system.destroy();
  });
});

describe("inspect() constraints (L9a, S6)", () => {
  it("whenSpec is the spec of a data-form when, and absent for a function", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: {},
          requirements: { X: {} },
        },
        init: (facts: { n: number }) => {
          facts.n = 0;
        },
        constraints: {
          data: { when: { n: { $gte: 5 } }, require: { type: "X" } },
          fn: {
            when: (facts: { n: number }) => facts.n > 5,
            require: { type: "X" },
          },
        },
      } as never),
    });
    system.start();
    const rows = system.inspect().constraints;
    const row = (id: string) => rows.find((c) => c.id === id)!;
    expect(row("data").whenSpec).toEqual({ n: { $gte: 5 } });
    expect("whenSpec" in row("fn")).toBe(false);
    system.destroy();
  });
});

describe("meta (L9a)", () => {
  const tagged = (tags: unknown) =>
    createModule("m", {
      schema: {
        facts: {
          email: t.string().meta({ tags: tags as string[] }),
          n: t.number(),
        },
        derivations: { shown: t.string(), cost: t.number() },
      },
      init: (facts) => {
        facts.email = "a@b.test";
        facts.n = 1;
      },
      derive: {
        shown: (facts) => facts.email,
        cost: { compute: (facts) => facts.n, meta: { tagBoundary: true } },
      },
    });

  it("copies and freezes tags, and answers from its own copy", () => {
    const tags = ["pii"];
    const system = createSystem({ module: tagged(tags) });
    tags.length = 0;
    expect(system.meta.fact("email")?.tags).toEqual(["pii"]);
    expect(Object.isFrozen(system.meta.fact("email"))).toBe(true);
    expect(system.meta.carriesTag("fact", "email", "pii")).toBe(true);
    expect(system.meta.carriesTag("fact", "n", "pii")).toBe(false);
    expect(system.meta.carriesTag("fact", "nope", "pii")).toBeUndefined();
    expect(
      system.meta.carriesTag("__proto__" as never, "toString", "pii"),
    ).toBeUndefined();
    system.destroy();
  });

  it("refuses tags that are not an array of strings", () => {
    expect(() => createSystem({ module: tagged("pii") })).toThrow(
      "meta.tags must be an array of strings",
    );
  });

  it("a derivation inherits what it read, computed on asking, past no boundary", () => {
    const system = createSystem({ module: tagged(["pii"]) });
    system.start();
    expect(
      system.meta.byTag("pii").map((row) => [row.kind, row.id, row.tagOrigin]),
    ).toEqual([
      ["fact", "email", "authored"],
      ["derivation", "shown", "inherited"],
    ]);
    expect(system.meta.derivation("shown")?.inheritedTags).toEqual(["pii"]);
    expect(system.meta.derivation("cost")).toEqual({ tagBoundary: true });
    expect(system.meta.carriesTag("derivation", "cost", "pii")).toBe(false);
    system.destroy();
  });

  it("tagBoundary stops the walk at the derivation itself and at one read through it", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { email: t.string().meta({ tags: ["pii"] }) },
          derivations: {
            masked: t.string(),
            banner: t.string(),
            plain: t.string(),
          },
        },
        init: (facts) => {
          facts.email = "a@b.test";
        },
        derive: {
          // Reads a tagged fact, but cuts the tag off.
          masked: {
            compute: (facts) => facts.email.replace(/./g, "*"),
            meta: { tagBoundary: true },
          },
          // Reads only the boundary: nothing passes through it.
          banner: (_facts, derive) => derive.masked,
          // The control: reads the tagged fact directly.
          plain: (facts) => facts.email,
        },
      }),
    });
    system.start();
    expect(system.meta.carriesTag("derivation", "plain", "pii")).toBe(true);
    // The first check: the boundary derivation does not inherit from its reads.
    expect(system.meta.carriesTag("derivation", "masked", "pii")).toBe(false);
    // The second check: a reader of the boundary does not walk past it.
    expect(system.meta.carriesTag("derivation", "banner", "pii")).toBe(false);
    expect(system.meta.byTag("pii").map((row) => row.id)).toEqual([
      "email",
      "plain",
    ]);
    system.destroy();
  });
});
