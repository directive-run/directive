/**
 * All five Directive definition surfaces written as DATA.
 *
 * Run with: `pnpm --filter @directive-run/example-data-triggers start`
 *
 * Demonstrates:
 *   - constraint `when: { ... }`
 *   - effect    `on:   { ... }`
 *   - resolver  `key:  [ ... ]`
 *   - event     `patch: { $set: { ... } }`
 *   - derive    `compute: { ... }` (predicate + template)
 *
 * And the introspection that only a data form makes possible:
 *   - `system.inspect().constraints[].whenSpec` — the raw predicate
 *   - `constraint.evaluate` observer event with `whenExplain`, rendered
 *     below as a clause-by-clause ✓/✗ tree
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";

// ----------------------------------------------------------------------------
// Module
// ----------------------------------------------------------------------------

const schema = {
  facts: {
    phase: t.string<"red" | "yellow" | "green">(),
    elapsed: t.number(),
    transitionCount: t.number(),
    label: t.string(),
    firstName: t.string(),
    lastName: t.string(),
    age: t.number(),
  },
  derivations: {
    isAdult: t.boolean(),
    fullName: t.string(),
  },
  events: {
    advanceTo: { value: t.string(), userName: t.string() },
  },
  requirements: {
    TRANSITION: { to: t.string<"red" | "yellow" | "green">() },
  },
} satisfies ModuleSchema;

const trafficLight = createModule("traffic", {
  schema,

  init: (facts) => {
    facts.phase = "red";
    facts.elapsed = 0;
    facts.transitionCount = 0;
    facts.label = "";
    facts.firstName = "Grace";
    facts.lastName = "Hopper";
    facts.age = 30;
  },

  // ── Derivations — predicate + template, no functions ─────────────────────
  derive: {
    isAdult: { compute: { age: { $gte: 18 } } },
    fullName: { compute: { $template: "${firstName} ${lastName}" } },
  },

  // ── Event — declarative patch instead of a handler ────────────────────────
  events: {
    advanceTo: {
      patch: {
        $set: {
          phase: { $ref: "value" },
          elapsed: 0,
          label: { $template: "Set by ${userName} → ${value}" },
        },
      },
    },
  },

  // ── Constraint — data `when`, declarative `require` ──────────────────────
  constraints: {
    transition: {
      when: { phase: "red", elapsed: { $gte: 30 } },
      require: { type: "TRANSITION", to: "green" },
    },
  },

  // ── Resolver — KeySelector array dedups by requirement field ─────────────
  resolvers: {
    transition: {
      requirement: "TRANSITION",
      key: ["to"],
      resolve: async (req, context) => {
        context.facts.phase = req.to;
        context.facts.elapsed = 0;
        context.facts.transitionCount = context.facts.transitionCount + 1;
      },
    },
  },
});

// ----------------------------------------------------------------------------
// System + observer
// ----------------------------------------------------------------------------

const system = createSystem({ module: trafficLight });

system.observe((event) => {
  if (event.type === "constraint.evaluate" && event.whenExplain) {
    console.log(
      `\n[observe] constraint.evaluate ${event.id} → ${event.active}`,
    );
    for (const clause of event.whenExplain) {
      const mark = clause.pass ? "✓" : "✗";
      console.log(
        `  ${mark} ${clause.path} ${clause.op} ${JSON.stringify(clause.expected)} (actual: ${JSON.stringify(clause.actual)})`,
      );
    }
  }
});

system.start();

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

console.log("--- Initial derivations (data forms) ---");
console.log(`isAdult:  ${system.derive.isAdult}`);
console.log(`fullName: ${system.derive.fullName}`);

console.log("\n--- inspect().constraints[] surfaces whenSpec ---");
for (const c of system.inspect().constraints) {
  console.log(`${c.id}: whenSpec = ${JSON.stringify(c.whenSpec)}`);
}

// Trip the predicate: elapsed goes from 0 → 30, so the constraint fires.
console.log("\n--- elapsed → 30 (predicate now holds) ---");
system.facts.elapsed = 30;
await settle();

console.log(`phase after resolver: ${system.facts.phase}`);
console.log(`transitionCount:      ${system.facts.transitionCount}`);

// Two writes: phase ← "red" satisfies the first clause; elapsed ← 5 fails the
// `$gte: 30` clause, so the predicate as a whole is false and the constraint
// does not fire.
console.log("\n--- phase = red, elapsed → 5 (predicate fails on elapsed) ---");
system.facts.phase = "red";
system.facts.elapsed = 5;
await settle();

// Dispatch the data-form event — sets multiple facts from the payload.
console.log("\n--- dispatch advanceTo (patch) ---");
system.events.advanceTo({ value: "yellow", userName: "Ada" });
await settle();
console.log(`phase: ${system.facts.phase}`);
console.log(`label: ${system.facts.label}`);

system.destroy();

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
