/**
 * L11: the invalidation order after a derivation's reads change on their
 * own, with no dynamic call. 1.35's updateDependencies (derivations.ts:
 * 611-627) moves a derivation whose dependency set changed to the end of
 * each source's reader list, so the next write meets it last. The L11
 * data-form fuzz met it through a predicate `compute`: `$all` stops at its
 * first false clause, so the facts after it drop out of the set. These
 * tests pin dynamic.ts relink, which withDynamic installs (no longer the
 * first dynamic call): they fail when that install is removed.
 */
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

const orderAfterShrink = (d1: unknown): string[] => {
  const order: string[] = [];
  const system = createSystem({
    module: createModule("m", {
      schema: {
        facts: { f0: t.number(), f1: t.number(), f2: t.number() },
        derivations: { d1: t.boolean(), d2: t.number() },
      },
      init: (facts: Any) => {
        facts.f0 = 0;
        facts.f1 = 5;
        facts.f2 = 1;
      },
      derive: {
        d1,
        d2: (facts: Any, derived: Any) =>
          facts.f1 + facts.f2 + Number(derived.d1),
      },
    } as never),
    plugins: [
      { name: "spy", onDerivationInvalidate: (id: string) => order.push(id) },
    ],
  } as never) as Any;
  system.start();
  system.read("d2");
  // d1 now stops at f0: it reads f1 and f0, no longer f2.
  system.facts.f0 = -1;
  system.read("d2");
  order.length = 0;
  system.batch(() => {
    system.facts.f1 = 1;
    system.facts.f2 = -2;
  });

  return order;
};

describe("a derivation whose reads shrink (dynamic.ts relink, 1.35's updateDependencies)", () => {
  it("a predicate compute moves to the end of f1's readers: d2 is invalidated first", () => {
    expect(
      orderAfterShrink({
        compute: {
          $all: [{ f1: { $gte: 0 } }, { f0: { $gte: 0 } }, { f2: { $gte: 0 } }],
        },
      }),
    ).toEqual(["d2", "d1"]);
  });

  it("so does a function compute whose && skips a read", () => {
    expect(
      orderAfterShrink(
        (facts: Any) => facts.f1 >= 0 && facts.f0 >= 0 && facts.f2 >= 0,
      ),
    ).toEqual(["d2", "d1"]);
  });
});
