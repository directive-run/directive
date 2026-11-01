/**
 * A membership test (`"d" in derived`) is a read: in 1.35 a constraint or an
 * effect that asks it watches the derivation (derivations.ts:817–819), so the
 * asker re-runs on every change upstream even though the asking never
 * computes it. A derivation that asks is an edge instead, and whoever reads
 * that derivation hears every change past it (collectInvalidated). Each
 * trace below is 1.35's, across three changes to what `d` reads.
 *
 * Effects pin 1.35 as it is today; GATE-1 quirk (c) (L4) changes their rule.
 */
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

async function trace(parts: (log: unknown[]) => Record<string, unknown>) {
  const log: unknown[] = [];
  const system = createSystem({
    module: createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { d: t.number(), asks: t.number() },
        events: {},
        requirements: { R: {} },
      },
      init: (f: any) => {
        f.a = 0;
        f.b = 0;
      },
      derive: {
        d: (f: any) => f.a + 1,
        // Membership only: computing `asks` never computes `d`.
        asks: (_f: any, d: any) => {
          log.push("compute asks");
          return "d" in d ? 1 : 0;
        },
      },
      resolvers: { r: { requirement: "R", resolve: async () => {} } },
      ...parts(log),
    } as any),
  } as any) as any;
  system.start();
  await flush();
  for (const a of [1, 2, 3]) {
    log.push(`a=${a}`);
    system.facts.a = a;
    await flush();
  }
  // Nothing `d` reads: no one wakes.
  log.push("b=1");
  system.facts.b = 1;
  await flush();
  system.destroy();

  return log;
}

const never = { type: "R" };

describe("a membership test watches the derivation (1.35)", () => {
  it("a constraint's when that only asks re-evaluates on every change", async () => {
    const log = await trace((log) => ({
      constraints: {
        c: {
          when: (_f: any, d: any) => {
            log.push(["when", "d" in d]);
            return false;
          },
          require: never,
        },
      },
    }));
    expect(log).toEqual([
      "compute asks",
      ["when", true],
      "a=1",
      ["when", true],
      "a=2",
      ["when", true],
      "a=3",
      ["when", true],
      "b=1",
    ]);
  });

  it("a derivation that only asks: its reader hears every change, and it does not recompute", async () => {
    const log = await trace((log) => ({
      constraints: {
        c: {
          when: (_f: any, d: any) => {
            log.push(["when", d.asks]);
            return false;
          },
          require: never,
        },
      },
    }));
    expect(log).toEqual([
      "compute asks",
      ["when", 1],
      "a=1",
      "compute asks",
      ["when", 1],
      "a=2",
      ["when", 1],
      "a=3",
      ["when", 1],
      "b=1",
    ]);
  });

  it("an effect that only asks re-runs on every change (1.35 today; quirk c is L4)", async () => {
    const log = await trace((log) => ({
      effects: {
        e: {
          run: (_f: any, _prev: any, d: any) => {
            log.push(["run", "d" in d]);
          },
        },
      },
    }));
    expect(log).toEqual([
      "compute asks",
      ["run", true],
      "a=1",
      ["run", true],
      "a=2",
      ["run", true],
      "a=3",
      ["run", true],
      "b=1",
    ]);
  });
});
