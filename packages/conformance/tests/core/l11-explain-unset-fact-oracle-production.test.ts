// Ported from packages/core/src/core/__tests__/l11-explain-unset-fact-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// L11 gate pin (mutation run 44431606561, engine.ts 3950:15 NoCoverage):
// explain(requirementId) renders a data-form `when` leaf whose fact was never
// set. The clause's actual is `undefined`, and the breakdown prints it as the
// word "undefined" (not an empty string, not JSON). Two leaves on the unset
// fact, `$exists: false` and `$ne`, both pass. Pins what 1.35 does, through
// the public API only. The production half of l11-explain-unset-fact-oracle:
// the same text.

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function makeSystem() {
  const mod = createModule("unset", {
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
      facts.b = 2;
    },
    constraints: {
      go: {
        when: { $all: [{ a: { $exists: false } }, { a: { $ne: 1 } }] },
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

describe("explain() — a data-form leaf on an unset fact (production)", () => {
  it("renders the unset fact's actual as undefined", async () => {
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
        "│     ├─ ✓ a $exists false (actual: undefined)",
        "│     └─ ✓ a $ne 1 (actual: undefined)",
        "└─ Relevant facts:",
        "   └─ a = undefined",
      ].join("\n"),
    );

    system.destroy();
  });
});
