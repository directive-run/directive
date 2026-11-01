/**
 * Two 1.35 rules for constraints and the watched set.
 *
 * 1. `constraints.enable(id)` marks the constraint dirty and asks for no
 *    pass (constraints.ts:1600–1614; engine.ts:2610 calls it directly). The
 *    next pass, whatever starts it, evaluates the constraint. Each trace
 *    below is 1.35's.
 * 2. The watched set shrinks. At each pass end 1.35 keeps only the
 *    derivations a constraint or an effect still reads (engine.ts:2244–2250,
 *    retainObserved), so a derivation asked about once stops being scanned on
 *    every later write. Nothing a user sees changes; the pass's changed keys
 *    show the scan's result, so the test reads them through a part.
 */
import { describe, expect, it } from "vitest";
import {
  type SystemPart,
  createModule,
  createSystemCore,
} from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { DERIVATION_DEP_PREFIX } from "../api/facts.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const R = { type: "R" };
const schema = {
  facts: { a: t.number(), b: t.number(), mode: t.boolean() },
  derivations: { d: t.number() },
  events: {},
  requirements: { R: {} },
};
const init = (f: any) => {
  f.a = 0;
  f.b = 0;
  f.mode = false;
};

describe("constraints.enable() asks for no pass (1.35)", () => {
  async function trace(
    when: (f: any) => boolean,
    resolve: () => Promise<void>,
    steps: [string, (s: any) => void][],
  ) {
    const log: unknown[] = [];
    let passes = 0;
    const system: any = createSystem({
      module: createModule("m", {
        schema,
        init,
        derive: { d: (f: any) => f.a + 1 },
        constraints: {
          c: {
            when: (f: any) => {
              const active = when(f);
              log.push(["c", f.a, active]);
              return active;
            },
            require: R,
          },
        },
        resolvers: { r: { requirement: "R", resolve } },
      } as any),
      plugins: [
        {
          name: "p",
          onReconcileStart: () => {
            passes++;
          },
          onConstraintEvaluate: (id: string, active: boolean) =>
            log.push(["eval", id, active]),
          onRequirementCreated: () => log.push("created"),
          onRequirementCanceled: () => log.push("canceled"),
          onResolverStart: (id: string) => log.push(["start", id]),
          onResolverCancel: (id: string) => log.push(["cancel", id]),
        },
      ],
    } as any);
    system.start();
    await flush();
    passes = 0;
    log.length = 0;
    for (const [label, step] of steps) {
      log.push(label);
      step(system);
      await flush();
      log.push(`passes ${passes}`);
      passes = 0;
    }
    system.destroy();

    return log;
  }
  const write = (key: string, value: unknown): [string, (s: any) => void] => [
    `${key}=${value}`,
    (s) => {
      s.facts[key] = value;
    },
  ];
  const disable: [string, (s: any) => void] = [
    "disable",
    (s) => s.constraints.disable("c"),
  ];
  const enable: [string, (s: any) => void] = [
    "enable",
    (s) => s.constraints.enable("c"),
  ];

  it("waits for the next pass, which evaluates it whatever woke it, with what changed while disabled", async () => {
    const log = await trace(
      () => false,
      async () => {},
      [disable, write("a", 5), enable, write("b", 1), write("b", 2)],
    );
    expect(log).toEqual([
      "disable",
      "passes 0",
      "a=5",
      "passes 1",
      "enable",
      "passes 0",
      "b=1",
      ["c", 5, false],
      ["eval", "c", false],
      "passes 1",
      "b=2",
      "passes 1",
    ]);
  });

  it("an unmet requirement left with disable comes back at the next pass, not at enable", async () => {
    const log = await trace(
      (f) => f.a > 0,
      () => new Promise(() => {}),
      [write("a", 1), disable, write("b", 1), enable, write("b", 2)],
    );
    expect(log).toEqual([
      "a=1",
      ["c", 1, true],
      ["eval", "c", true],
      "created",
      ["start", "r"],
      "passes 1",
      "disable",
      "passes 0",
      "b=1",
      ["cancel", "r"],
      "canceled",
      "passes 1",
      "enable",
      "passes 0",
      "b=2",
      ["c", 1, true],
      ["eval", "c", true],
      "created",
      ["start", "r"],
      "passes 1",
      // destroy() cancels the run still in flight.
      ["cancel", "r"],
      "canceled",
    ]);
  });
});

describe("the watched set keeps only what a reader still reads (1.35)", () => {
  const D = DERIVATION_DEP_PREFIX + "d";

  /** Each pass's changed keys: whether `d` was among them. */
  async function run(
    parts: (log: unknown[]) => Record<string, unknown>,
    writes: [string, unknown][],
  ) {
    const log: unknown[] = [];
    const spy: SystemPart = (ctx) => {
      const effects = (ctx.kernel.features as any).effects;
      const original = effects.runEffectsFast;
      effects.runEffectsFast = (keys: Set<string>) => {
        log.push(keys.has(D) ? "d in pass" : "-");
        return original.call(effects, keys);
      };
    };
    const system: any = createSystemCore(
      {
        module: createModule("m", {
          schema,
          init,
          derive: { d: (f: any) => f.a + 1 },
          resolvers: { r: { requirement: "R", resolve: async () => {} } },
          ...parts(log),
        } as any),
      } as any,
      [withEffects, withReconcile, spy],
    );
    system.start();
    await flush();
    log.length = 0;
    for (const [key, value] of writes) {
      log.push(`${key}=${value}`);
      system.facts[key] = value;
      await flush();
    }
    system.destroy();

    return log;
  }

  it("a constraint that asks every other time: released when it stops, watched again when it asks", async () => {
    const log = await run(
      (log: unknown[]) => ({
        constraints: {
          c: {
            // Reads `mode`; asks about `d` (never its value) only while on.
            when: (f: any, d: any) => {
              const asking = f.mode && "d" in d;
              log.push(asking ? "c asks" : "c");
              return false;
            },
            require: R,
          },
        },
      }),
      [
        ["mode", true],
        ["a", 1],
        ["a", 2],
        ["mode", false],
        ["a", 3],
        ["a", 4],
        ["mode", true],
        ["a", 5],
        ["a", 6],
      ],
    );
    expect(log).toEqual([
      "mode=true",
      "-",
      "c asks",
      // The first change stales `d`; the next ones reach the asker only
      // through the watch, since `d` stays stale.
      "a=1",
      "d in pass",
      "c asks",
      "a=2",
      "d in pass",
      "c asks",
      "mode=false",
      "-",
      "c",
      // Released at that pass end: no scan, and nothing to wake.
      "a=3",
      "-",
      "a=4",
      "-",
      "mode=true",
      "-",
      "c asks",
      // Asked again, watched again: no change is missed.
      "a=5",
      "d in pass",
      "c asks",
      "a=6",
      "d in pass",
      "c asks",
    ]);
  });

  it("an effect that keeps asking watches nothing and does not re-run (quirk c)", async () => {
    const log = await run(
      (log: unknown[]) => ({
        effects: {
          e: {
            run: (_f: any, _prev: any, d: any) => {
              log.push("d" in d ? "e asks" : "e");
            },
          },
        },
      }),
      [
        ["a", 1],
        ["a", 2],
        ["a", 3],
        ["b", 1],
      ],
    );
    // 1.35 watches `d` and re-runs `e` at every `a` write. 2.0 records the
    // membership of `d`, which nothing changes before L10.
    expect(log).toEqual([
      "a=1",
      // `d`, computed at start, goes stale once; nothing watches it after.
      "d in pass",
      "a=2",
      "-",
      "a=3",
      "-",
      "b=1",
      "-",
    ]);
  });
});
