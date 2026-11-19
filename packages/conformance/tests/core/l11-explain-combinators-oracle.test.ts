// Ported from packages/core/src/core/__tests__/l11-explain-combinators-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

// L11 gate pin (mutation run 44259509948): explain(requirementId) renders a
// data-form `when` whose clauses are combinators. `$all`, `$any` and `$not`
// each have a passing and a failing child, so every branch of the combinator
// rendering (the header with its fraction, `$not`'s "(child failed)" and
// "(child passed)" notes, the nested indent under a last and a not-last
// clause) shows in the exact text. (A combinator key beside a plain key in
// one object leaves the plain key out of the breakdown, so the plain
// clause sits inside the outer $all here.) Pins what 1.35 does, through the public
// API only.

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeSystem() {
  const mod = createModule("combo", {
    schema: {
      facts: {
        a: t.number(),
        b: t.number(),
      },
      derivations: {},
      events: {},
      requirements: {
        GO: {},
      },
    },
    init: (facts) => {
      facts.a = 1;
      facts.b = 2;
    },
    constraints: {
      go: {
        when: {
          $all: [
            {
              $any: [
                { $all: [{ a: 1 }, { b: { $gte: 5 } }] },
                { $not: { a: 1 } },
                { $not: { b: { $gte: 5 } } },
              ],
            },
            { a: { $lt: 10 } },
          ],
        },
        require: { type: "GO" },
      },
    },
    resolvers: {
      go: {
        requirement: "GO",
        resolve: () => new Promise<void>(() => {}),
      },
    },
  });

  return createSystem({ module: mod });
}

describe("explain() — combinator clauses in a data-form when", () => {
  it("renders $all, $any and $not with a passing and a failing child", async () => {
    const system = makeSystem();
    system.start();
    await flush();

    const unmet = system.inspect().unmet;
    expect(unmet.length).toBe(1);
    const explanation = system.explain(unmet[0]!.id);
    expect(explanation).toBe(
      [
        'Requirement "GO" (id: GO:{})',
        "├─ Produced by constraint: go",
        "├─ Constraint priority: 0",
        "├─ Constraint active: true",
        "├─ Resolver status: running",
        "├─ Predicate clauses:",
        "│  └─ ✓ $all (2/2)",
        "│     ├─ ✓ $any (1/3)",
        "│     │  ├─ ✗ $all (1/2)",
        "│     │  │  ├─ ✓ a $eq 1 (actual: 1)",
        "│     │  │  └─ ✗ b $gte 5 (actual: 2)",
        "│     │  ├─ ✗ $not (child passed)",
        "│     │  │  └─ ✓ a $eq 1 (actual: 1)",
        "│     │  └─ ✓ $not (child failed)",
        "│     │     └─ ✗ b $gte 5 (actual: 2)",
        "│     └─ ✓ a $lt 10 (actual: 1)",
        "└─ Relevant facts:",
        "   ├─ a = 1",
        "   └─ b = 2",
      ].join("\n"),
    );

    system.destroy();
  });
});
