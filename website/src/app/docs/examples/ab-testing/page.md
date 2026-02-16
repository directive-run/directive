---
title: A/B Testing Example
description: A constraint-driven A/B testing engine with deterministic assignment, automatic exposure tracking, and pause/resume — all powered by Directive.
---

A complete experiment engine. Register experiments, assign variants deterministically, track exposures automatically &ndash; with two constraints and two resolvers. {% .lead %}

---

## Overview

This example builds a self-contained A/B testing system:

- **Experiment registry** &ndash; register experiments with weighted variants at runtime
- **Deterministic assignment** &ndash; hash-based variant selection (same user always gets same variant)
- **Automatic exposure tracking** &ndash; constraint chain records exposures without manual instrumentation
- **Pause/resume** &ndash; flip one fact to halt all constraint evaluation
- **Reset** &ndash; clear assignments and exposures, let the engine re-assign

---

## The Module

```typescript
import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";

interface Variant { id: string; weight: number; label: string }
interface Experiment { id: string; name: string; variants: Variant[]; active: boolean }

const schema = {
  facts: {
    experiments: t.object<Experiment[]>(),
    assignments: t.object<Record<string, string>>(),
    exposures: t.object<Record<string, number>>(),
    userId: t.string(),
    paused: t.boolean(),
  },
  derivations: {
    activeExperiments: t.object<Experiment[]>(),
    assignedCount: t.number(),
    exposedCount: t.number(),
  },
  events: {
    registerExperiment: { id: t.string(), name: t.string(), variants: t.object<Variant[]>() },
    assignVariant: { experimentId: t.string(), variantId: t.string() },
    pauseAll: {},
    resumeAll: {},
    reset: {},
  },
  requirements: {
    ASSIGN_VARIANT: { experimentId: t.string() },
    TRACK_EXPOSURE: { experimentId: t.string(), variantId: t.string() },
  },
} satisfies ModuleSchema;

const abTesting = createModule("ab-testing", {
  schema,

  init: (facts) => {
    facts.experiments = [];
    facts.assignments = {};
    facts.exposures = {};
    facts.userId = "user-abc123";
    facts.paused = false;
  },

  derive: {
    activeExperiments: (facts) =>
      facts.experiments.filter((e) => e.active && !facts.paused),
    assignedCount: (facts) => Object.keys(facts.assignments).length,
    exposedCount: (facts) => Object.keys(facts.exposures).length,
  },

  constraints: {
    needsAssignment: {
      priority: 100,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }

        return facts.experiments.some((e) => e.active && !facts.assignments[e.id]);
      },
      require: (facts) => {
        const unassigned = facts.experiments.find(
          (e) => e.active && !facts.assignments[e.id],
        );

        return { type: "ASSIGN_VARIANT", experimentId: unassigned.id };
      },
    },

    needsExposure: {
      priority: 50,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }

        return Object.keys(facts.assignments).some((id) => !facts.exposures[id]);
      },
      require: (facts) => {
        const experimentId = Object.keys(facts.assignments).find(
          (id) => !facts.exposures[id],
        );

        return {
          type: "TRACK_EXPOSURE",
          experimentId,
          variantId: facts.assignments[experimentId],
        };
      },
    },
  },

  resolvers: {
    assignVariant: {
      requirement: "ASSIGN_VARIANT",
      resolve: async (req, context) => {
        const experiment = context.facts.experiments.find((e) => e.id === req.experimentId);
        const variantId = pickVariant(context.facts.userId, req.experimentId, experiment.variants);
        context.facts.assignments = { ...context.facts.assignments, [req.experimentId]: variantId };
      },
    },

    trackExposure: {
      requirement: "TRACK_EXPOSURE",
      resolve: async (req, context) => {
        context.facts.exposures = {
          ...context.facts.exposures,
          [req.experimentId]: Date.now(),
        };
      },
    },
  },
});
```

---

## How It Works

The engine runs a two-step constraint chain:

1. **Register** &ndash; `events.registerExperiment()` adds to the `experiments` array
2. **Assign** &ndash; `needsAssignment` constraint fires: active experiment + no assignment &rarr; `ASSIGN_VARIANT`
3. **Resolve** &ndash; `assignVariant` resolver hashes `userId + experimentId` &rarr; weighted variant pick
4. **Expose** &ndash; `needsExposure` constraint fires: assigned + no exposure &rarr; `TRACK_EXPOSURE`
5. **Record** &ndash; `trackExposure` resolver stores timestamp in `exposures`

The engine settles automatically. No manual orchestration needed.

---

## Key Patterns

### Deterministic hashing

The same `userId + experimentId` always produces the same variant:

```typescript
function pickVariant(userId: string, experimentId: string, variants: Variant[]): string {
  const hash = hashCode(`${userId}:${experimentId}`);
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = hash % totalWeight;

  for (const variant of variants) {
    roll -= variant.weight;
    if (roll < 0) {
      return variant.id;
    }
  }

  return variants[variants.length - 1].id;
}
```

### Automatic exposure tracking

No manual `trackExposure()` calls. The constraint chain fires automatically after assignment:

```
needsAssignment → ASSIGN_VARIANT → needsExposure → TRACK_EXPOSURE → settled
```

### Pause guard

Both constraints check `facts.paused` first. Flipping one boolean halts the entire experiment engine without clearing assignments.

---

## Try It

```bash
cd examples/ab-testing
pnpm install
pnpm dev
```

Register experiments, watch the constraint chain assign variants and track exposures. Use "Pause All" to halt evaluation. Use "Reset" to clear assignments and watch re-assignment happen automatically.

---

## Related

- [A/B Testing with Directive](/blog/ab-testing-with-directive) &ndash; full blog post with detailed walkthrough
- [Feature Flags Example](/docs/examples/feature-flags) &ndash; simpler variant without weighted assignment
- [Constraints](/docs/constraints) &ndash; how `when` / `require` works
- [Resolvers](/docs/resolvers) &ndash; async requirement fulfillment
- [Labs](/labs) &ndash; live A/B experiments on this site
