/**
 * L4a: `system.effects.disable`, `enable` and `isEnabled` (RFC L4, C1–C4),
 * with the owner's (x) and (y), approved 2026-11-01.
 *
 * - (x) `disable` runs the effect's cleanup at once. 1.35 keeps it until the
 *   first run after `enable`, or `stop()`.
 * - (y) `disable` keeps the dependency record (declared deps, derivation
 *   deps, the last auto-tracked read set) and releases only the derivation
 *   watching; `enable` watches again, does not run the effect and replays
 *   nothing. 1.35 drops the record, so after `enable` the effect runs on
 *   every change. The `on` gate is part of the record too, but core-next has
 *   no predicate evaluator before L11, so that case waits for L11.
 *
 * Each trace's 1.35 behaviour is the RFC's probe of the same name (XY, Yd,
 * Ya, EB), noted where it differs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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
const schema = {
  facts: { a: t.number(), b: t.number(), c: t.number() },
  derivations: { d: t.number() },
  events: {},
  requirements: {},
};
const init = (f: any) => {
  f.a = 0;
  f.b = 0;
  f.c = 0;
};
const mod = (
  effects: Record<string, unknown>,
  constraints?: Record<string, unknown>,
) =>
  createModule("m", {
    schema: { ...schema, requirements: { R: {} } },
    init,
    derive: { d: (f: any) => f.a + 1 },
    effects,
    constraints,
  } as any);

/** A write `[key, value]`, a control on effect `e`, or a look. */
type Step =
  | [string, number]
  | "disable"
  | "enable"
  | "stop"
  | ((system: any) => void);

async function play(system: any, log: unknown[], steps: Step[]) {
  system.start();
  await flush();
  for (const step of steps) {
    if (typeof step === "function") {
      step(system);
    } else if (Array.isArray(step)) {
      log.push(`${step[0]}=${step[1]}`);
      system.facts[step[0]] = step[1];
    } else {
      log.push(step);
      step === "stop" ? system.stop() : system.effects[step]("e");
    }
    await flush();
  }
  system.destroy();

  return log;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("C1: the controls", () => {
  it("an unknown id throws 1.35's error from all three", () => {
    const system: any = createSystem({ module: mod({}) } as any);
    for (const method of ["disable", "enable", "isEnabled"]) {
      expect(() => system.effects[method]("ghost")).toThrow(
        "[Directive] Unknown effect: ghost",
      );
    }
    system.destroy();
  });
});

describe("(x): disable runs the cleanup at once", () => {
  it("at disable, once for two disables, not at enable; the next run starts clean (probe XY)", async () => {
    const log: unknown[] = [];
    const system = createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: (f: any) => {
            const a = f.a;
            log.push(`run a=${a}`);
            return () => log.push(`cleanup a=${a}`);
          },
        },
      }),
    } as any);
    await play(system, log, [
      ["a", 1],
      "disable",
      "disable",
      ["a", 2],
      ["b", 1],
      "enable",
      ["b", 2],
      ["c", 3],
      ["a", 4],
      "stop",
    ]);
    // 1.35: nothing at disable or enable; "cleanup a=1" just before the run
    // at b=2, which runs ungated, as do c=3 and a=4 (the record is lost).
    expect(log).toEqual([
      "run a=0",
      "a=1",
      "cleanup a=0",
      "run a=1",
      "disable",
      "cleanup a=1",
      "disable",
      "a=2",
      "b=1",
      "enable",
      "b=2",
      "c=3",
      "a=4",
      "run a=4",
      "stop",
      "cleanup a=4",
    ]);
  });

  it("disabled during its own run: the cleanup that run returns runs when it returns", async () => {
    const log: unknown[] = [];
    const holder: { system?: any } = {};
    const system = createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: (f: any) => {
            const a = f.a;
            log.push(`run a=${a}`);
            if (a === 1) {
              holder.system.effects.disable("e");
            }
            return () => log.push(`cleanup a=${a}`);
          },
        },
      }),
    } as any);
    holder.system = system;
    await play(system, log, [["a", 1], ["a", 2], "enable", ["a", 3], "stop"]);
    expect(log).toEqual([
      "run a=0",
      "a=1",
      "cleanup a=0",
      "run a=1",
      "cleanup a=1",
      "a=2",
      "enable",
      "a=3",
      "run a=3",
      "stop",
      "cleanup a=3",
    ]);
  });

  it("an async run disabled in flight: its cleanup runs when it settles", async () => {
    const log: unknown[] = [];
    let release!: () => void;
    const system: any = createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: async (f: any) => {
            const a = f.a;
            if (a === 1) {
              await new Promise<void>((r) => (release = r));
            }
            log.push(`settled a=${a}`);
            return () => log.push(`cleanup a=${a}`);
          },
        },
      }),
    } as any);
    system.start();
    await flush();
    system.facts.a = 1;
    await flush();
    system.effects.disable("e");
    log.push("disabled");
    release();
    await flush();
    expect(log).toEqual([
      "settled a=0",
      "cleanup a=0",
      "disabled",
      "settled a=1",
      "cleanup a=1",
    ]);
    system.destroy();
  });

  it("a cleanup that throws under the boundary's disable is not called again from inside itself", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const system: any = createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: () => () => {
            calls++;
            throw new Error("cleanup boom");
          },
        },
      }),
      errorBoundary: { onEffectError: "disable" },
    } as any);
    system.start();
    await flush();
    system.facts.a = 1;
    await flush();
    // The start run's cleanup throws as a=1's run begins; the boundary's
    // disable must not call it again (it recursed until the stack ran out).
    // The run goes on, as in 1.35, and its cleanup runs as it returns (x).
    expect(calls).toBe(2);
    expect(system.effects.isEnabled("e")).toBe(false);
    system.destroy();
  });
});

describe('a cleanup that throws under onEffectError: "throw"', () => {
  const throwing = (calls: { n: number }) =>
    createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: (f: any) => {
            calls.n += f.a === 0 ? 0 : 100;
            return () => {
              calls.n++;
              throw new Error("cleanup boom");
            };
          },
        },
      }),
      errorBoundary: { onEffectError: "throw" },
    } as any) as any;

  it("disable throws it to the caller, and the effect is off all the same (probe C6)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = { n: 0 };
    const system = throwing(calls);
    system.start();
    await flush();
    expect(() => system.effects.disable("e")).toThrow("cleanup boom");
    // 1.35 is off too (it runs the cleanup later, (x)).
    expect(system.effects.isEnabled("e")).toBe(false);
    system.facts.a = 1;
    await flush();
    expect(calls.n).toBe(1);
    expect(() => system.destroy()).toThrow("cleanup boom");
  });

  it("the cleanup is kept and called again at destroy, as 1.35 does (probe C6)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = { n: 0 };
    const system = throwing(calls);
    system.start();
    await flush();
    expect(() => system.effects.disable("e")).toThrow("cleanup boom");
    expect(calls.n).toBe(1);
    // 1.35's destroy calls the cleanup that threw and throws again.
    expect(() => system.destroy()).toThrow("cleanup boom");
    expect(calls.n).toBe(2);
  });
});

describe("(y): after disable and enable, the effect wakes only on its own record", () => {
  it("declared deps: not on unrelated writes, nor for the write made while disabled", async () => {
    const log: unknown[] = [];
    const system = createSystem({
      module: mod({
        e: { deps: ["a"], run: (f: any) => void log.push(`run a=${f.a}`) },
      }),
    } as any);
    await play(system, log, [
      "disable",
      ["a", 1],
      "enable",
      ["b", 1],
      ["a", 2],
    ]);
    // 1.35 (probe XY): runs at b=1 too.
    expect(log).toEqual([
      "run a=0",
      "disable",
      "a=1",
      "enable",
      "b=1",
      "a=2",
      "run a=2",
    ]);
  });

  it("a declared derivation dep (probe Yd)", async () => {
    const log: unknown[] = [];
    const system = createSystem({
      module: mod({
        e: {
          deps: ["d"],
          run: (_f: any, _p: any, dd: any) => void log.push(`run d=${dd.d}`),
        },
      }),
    } as any);
    await play(system, log, [
      ["a", 1],
      "disable",
      "enable",
      ["b", 1],
      ["a", 2],
    ]);
    // 1.35: runs at b=1 (ungated).
    expect(log).toEqual([
      "a=1",
      "run d=2",
      "disable",
      "enable",
      "b=1",
      "a=2",
      "run d=3",
    ]);
  });

  it("the last auto-tracked read set (probe Ya)", async () => {
    const log: unknown[] = [];
    const system = createSystem({
      module: mod({ e: { run: (f: any) => void log.push(`run a=${f.a}`) } }),
    } as any);
    await play(system, log, [
      ["a", 1],
      "disable",
      "enable",
      ["b", 1],
      ["b", 2],
      ["a", 2],
      ["b", 3],
    ]);
    // 1.35: runs once at b=1, then tracks `a` again.
    expect(log).toEqual([
      "run a=0",
      "a=1",
      "run a=1",
      "disable",
      "enable",
      "b=1",
      "b=2",
      "a=2",
      "run a=2",
      "b=3",
    ]);
  });

  it("disabled by the error boundary, then enabled (probe EB)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log: unknown[] = [];
    const system: any = createSystem({
      module: mod({
        e: {
          deps: ["a"],
          run: (f: any) => {
            log.push(`run a=${f.a}`);
            if (f.a === 1) {
              throw new Error("boom");
            }
          },
        },
      }),
      errorBoundary: { onEffectError: "disable" },
    } as any);
    const look = (s: any) => log.push(`enabled ${s.effects.isEnabled("e")}`);
    await play(system, log, [
      ["a", 1],
      look,
      ["a", 2],
      "enable",
      look,
      ["b", 1],
      ["a", 3],
    ]);
    // 1.35: runs at b=1.
    expect(log).toEqual([
      "run a=0",
      "a=1",
      "run a=1",
      "enabled false",
      "a=2",
      "enable",
      "enabled true",
      "b=1",
      "a=3",
      "run a=3",
    ]);
  });
});

describe("watching: a disabled effect pins nothing, and enable watches again", () => {
  const D = DERIVATION_DEP_PREFIX + "d";

  /** Each pass's changed keys (whether `d` was among them), and the runs. */
  async function trace(
    effects: (log: unknown[]) => Record<string, unknown>,
    constraints?: (log: unknown[]) => Record<string, unknown>,
  ) {
    const log: unknown[] = [];
    const spy: SystemPart = (ctx) => {
      const feature = (ctx.kernel.features as any).effects;
      const original = feature.runEffectsFast;
      feature.runEffectsFast = (keys: Set<string>) => {
        log.push(keys.has(D) ? "d in pass" : "-");
        return original.call(feature, keys);
      };
    };
    const system: any = createSystemCore(
      { module: mod(effects(log), constraints?.(log)) } as any,
      [withEffects, withReconcile, spy],
    );
    system.start();
    await flush();
    log.length = 0;
    for (const step of [
      ["a", 1],
      "disable",
      ["a", 2],
      ["a", 3],
      "enable",
      ["a", 4],
      ["a", 5],
    ] as Array<[string, number] | "disable" | "enable">) {
      if (Array.isArray(step)) {
        log.push(`${step[0]}=${step[1]}`);
        system.facts[step[0]] = step[1];
      } else {
        log.push(step);
        system.effects[step]("e");
      }
      await flush();
    }
    system.destroy();

    return log;
  }
  const e = (log: unknown[]) => ({
    deps: ["d"],
    run: (_f: any, _p: any, dd: any) => void log.push(`e d=${dd.d}`),
  });

  it("a declared derivation dep: released at the pass end after disable, watched again at enable", async () => {
    expect(await trace((log) => ({ e: e(log) }))).toEqual([
      "a=1",
      "d in pass",
      "e d=2",
      "disable",
      // `d` goes stale; the pass end releases it (no enabled reader).
      "a=2",
      "d in pass",
      // Stale and unwatched: nothing scans it, nothing wakes.
      "a=3",
      "-",
      "enable",
      // Without the watch at enable, `d` stays stale and `e` never wakes.
      "a=4",
      "d in pass",
      "e d=5",
      "a=5",
      "d in pass",
      "e d=6",
    ]);
  });

  // A constraint: under quirk (c) an effect that asks watches nothing.
  it("another reader that asks about it keeps it watched", async () => {
    expect(
      await trace(
        (log) => ({ e: e(log) }),
        (log) => ({
          f: {
            when: (_f: any, dd: any) => {
              log.push("d" in dd ? "f asks" : "f");
              return false;
            },
            require: { type: "R" },
          },
        }),
      ),
    ).toEqual([
      "a=1",
      "d in pass",
      "e d=2",
      "f asks",
      "disable",
      "a=2",
      "d in pass",
      "f asks",
      "a=3",
      "d in pass",
      "f asks",
      "enable",
      "a=4",
      "d in pass",
      "e d=5",
      "f asks",
      "a=5",
      "d in pass",
      "e d=6",
      "f asks",
    ]);
  });
});
