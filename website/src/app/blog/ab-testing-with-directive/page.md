---
title: "A/B Testing with Directive"
description: Build a complete A/B testing engine using constraints, resolvers, and effects. Deterministic assignment, exposure tracking, and variant gating — no third-party service required.
layout: blog
date: 2026-05-18
dateModified: 2026-05-18
slug: ab-testing-with-directive
author: directive-labs
categories: [Tutorial, Architecture]
---

Most A/B testing setups involve a third-party service, an opaque SDK, and a lot of manual plumbing. You call `getVariant()`, hope the assignment is deterministic, sprinkle exposure tracking into component lifecycle hooks, and debug the whole thing with console logs.

What if your experiment engine was inspectable, reactive, and declarative?

---

## The problem with traditional A/B testing

A typical feature flag or experimentation SDK gives you a function: `getVariant(userId, experimentId) → string`. Everything else is your problem:

- **Assignment logic** is hidden inside the SDK
- **Exposure tracking** requires manual instrumentation at every call site
- **Pausing experiments** means touching configuration in a separate dashboard
- **Debugging** means reading logs from a third-party service

With Directive, every piece of the experiment lifecycle maps to a primitive you already know.

---

## Mapping to Directive primitives

| A/B Testing Concept | Directive Primitive |
|---------------------|---------------------|
| Experiment registry | Facts (`experiments`) |
| Variant assignments | Facts (`assignments`) |
| Exposure log | Facts (`exposures`) |
| "Needs assignment" rule | Constraint |
| Deterministic assignment | Resolver |
| "Needs exposure" rule | Constraint |
| Exposure recording | Resolver |
| Active experiment list | Derivation |
| Pause/resume | Facts (`paused`) + constraint guard |

---

## The schema

```typescript
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
```

Every experiment, assignment, and exposure is a fact. The runtime watches for gaps and fills them automatically.

---

## The constraint chain

Two constraints drive the entire lifecycle:

### 1. Assignment constraint

```typescript
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
```

When an active experiment has no assignment, the constraint fires. The resolver uses a deterministic hash to pick a variant.

### 2. Exposure constraint

```typescript
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
```

Once assigned, if the experiment hasn't been exposed yet, the second constraint fires. This records the timestamp automatically &ndash; no manual `trackExposure()` calls scattered across your codebase.

---

## Deterministic assignment

The resolver uses a simple hash function to ensure the same user always gets the same variant for a given experiment:

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

Weighted random. Deterministic. No external service needed.

---

## What you get

With this setup, you get capabilities that would normally require a dedicated experimentation platform:

- **Time-travel debugging** &ndash; step through the assignment and exposure lifecycle
- **Inspect everything** &ndash; every fact, derivation, and constraint is visible in the devtools plugin
- **Pause/resume** &ndash; flip `paused = true` and all constraints stop evaluating
- **Zero dependencies** &ndash; no SDK, no API calls, no dashboard
- **Automatic exposure tracking** &ndash; the constraint chain guarantees every assignment gets an exposure record

---

## Try it

```bash
cd examples/ab-testing
pnpm install
pnpm dev
```

Register experiments, watch constraints assign variants, toggle pause, and reset. The event log shows every step of the constraint &rarr; resolver cycle.

---

## Related

- [A/B Testing Example](/docs/examples/ab-testing) &ndash; docs walkthrough
- [Feature Flags Example](/docs/examples/feature-flags) &ndash; similar pattern without weighted assignment
- [Constraints](/docs/constraints) &ndash; how `when` / `require` works
- [Resolvers](/docs/resolvers) &ndash; async requirement fulfillment
- [Labs](/labs) &ndash; try the live A/B experiments on this site
