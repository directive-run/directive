---
title: "A/B Testing with Directive"
description: Build a complete A/B testing engine using constraints, resolvers, and effects. Deterministic assignment, exposure tracking, and variant gating – no third-party service required.
layout: blog
date: 2026-02-16
dateModified: 2026-02-16
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

## The full module

Here's the complete A/B testing module &ndash; experiment registration, deterministic assignment, automatic exposure tracking, and pause/resume:

```typescript
import { createModule, t, type ModuleSchema } from "@directive-run/core";

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

  events: {
    registerExperiment: (facts, { id, name, variants }) => {
      facts.experiments = [
        ...facts.experiments,
        { id, name, variants, active: true },
      ];
    },
    assignVariant: (facts, { experimentId, variantId }) => {
      facts.assignments = { ...facts.assignments, [experimentId]: variantId };
    },
    pauseAll: (facts) => {
      facts.paused = true;
    },
    resumeAll: (facts) => {
      facts.paused = false;
    },
    reset: (facts) => {
      facts.assignments = {};
      facts.exposures = {};
    },
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
      // Safe: `when` guarantees at least one unassigned active experiment exists
      require: (facts) => {
        const unassigned = facts.experiments.find(
          (e) => e.active && !facts.assignments[e.id],
        );

        return { type: "ASSIGN_VARIANT", experimentId: unassigned!.id };
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
          experimentId: experimentId!,
          variantId: facts.assignments[experimentId!],
        };
      },
    },
  },

  resolvers: {
    assignVariant: {
      requirement: "ASSIGN_VARIANT",
      resolve: async (req, context) => {
        const experiment = context.facts.experiments.find((e) => e.id === req.experimentId);
        const variantId = pickVariant(
          context.facts.userId,
          req.experimentId,
          experiment!.variants,
        );
        context.facts.assignments = {
          ...context.facts.assignments,
          [req.experimentId]: variantId,
        };
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

  effects: {
    logAssignment: {
      deps: ["assignments"],
      run: (facts, prev) => {
        if (!prev) {
          return;
        }

        for (const [id, variant] of Object.entries(facts.assignments)) {
          if (!prev.assignments[id]) {
            console.log(`[ab-testing] Assigned ${id} → ${variant}`);
          }
        }
      },
    },
  },
});
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
  // Safe: `when` guarantees at least one unassigned active experiment exists.
  // The `require` function only runs when `when` returns true, so
  // `unassigned` is always defined here.
  require: (facts) => {
    const unassigned = facts.experiments.find(
      (e) => e.active && !facts.assignments[e.id],
    );

    return { type: "ASSIGN_VARIANT", experimentId: unassigned!.id };
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
      experimentId: experimentId!,
      variantId: facts.assignments[experimentId!],
    };
  },
},
```

Once assigned, if the experiment hasn't been exposed yet, the second constraint fires. This records the timestamp automatically &ndash; no manual `trackExposure()` calls scattered across your codebase.

The full chain looks like this:

```
registerExperiment → needsAssignment → ASSIGN_VARIANT → needsExposure → TRACK_EXPOSURE → settled
```

---

## Deterministic assignment

The resolver uses a hash function to ensure the same user always gets the same variant for a given experiment:

```typescript
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return Math.abs(hash);
}

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

`hashCode` is a standard DJB2-style hash &ndash; it produces a stable 32-bit integer from any string. The `pickVariant` function maps that integer into the weighted variant space. Same user + same experiment = same variant, every time. No external service needed.

---

## React integration

Components consume experiment state through hooks:

```typescript
import { useFact, useDerived } from "@directive-run/react";
import { getAbTestingSystem } from "./config";

export function useVariant(experimentId: string): string | null {
  const assignments = useFact(getAbTestingSystem(), "assignments");

  return assignments?.[experimentId] ?? null;
}

export function useActiveExperiments() {
  return useDerived(getAbTestingSystem(), "activeExperiments");
}

export function useIsExperimentPaused() {
  return useFact(getAbTestingSystem(), "paused");
}
```

Use the variant hook to gate UI:

```typescript
function PricingPage() {
  const variant = useVariant("pricing-layout");

  if (variant === "compact") {
    return <CompactPricing />;
  }

  return <DefaultPricing />;
}
```

Each hook subscribes to a single fact or derivation. Assigning a variant to `"pricing-layout"` doesn't re-render components watching `"onboarding-flow"`.

---

## Production configuration

The system singleton sets up the user ID and optionally persists assignments across page reloads:

```typescript
import { createSystem } from "@directive-run/core";
import { persistencePlugin } from "@directive-run/core/plugins";
import { abTesting } from "./module";

let instance: ReturnType<typeof createSystem> | null = null;

export function getAbTestingSystem() {
  if (instance) {
    return instance;
  }

  instance = createSystem({
    module: abTesting,
    plugins: [
      persistencePlugin({ key: "ab-testing", storage: localStorage }),
    ],
  });
  instance.start();

  // Set user ID from your auth layer
  instance.facts.userId = getCurrentUserId();

  return instance;
}
```

The persistence plugin serializes assignments and exposures to `localStorage`. Returning users see the same variants without a server round-trip. For server-side rendering, swap `localStorage` for a cookie-based adapter &ndash; the module code stays the same.

---

## Comparison

| Capability | `Math.random()` | Optimizely | PostHog | Directive |
|---|---|---|---|---|
| Deterministic assignment | No | Yes | Yes | Yes |
| Automatic exposure tracking | No | SDK-managed | SDK-managed | Constraint chain |
| Pause/resume experiments | Delete code | Dashboard | Dashboard | `facts.paused = true` |
| Inspect assignment logic | `console.log` | Dashboard | Dashboard | `system.inspect()` |
| Time-travel debugging | No | No | No | Built-in |
| Client-side only (no server) | Yes | No | No | Yes |
| Custom assignment logic | Yes | Audiences | Feature flags | Resolver functions |
| Offline support | Yes | SDK cache | SDK cache | Persistence plugin |
| Cost | Free | $36k+/yr (starter) | Free tier / $450+/mo | Free (open source) |

Optimizely and PostHog win when you need multi-variate testing with built-in statistical analysis, server-side experiments across multiple services, or a visual editor for non-technical stakeholders. Directive wins when you want the assignment logic in your codebase, debuggable with time-travel, and reactive without manual `trackExposure()` calls at every render boundary.

---

## When NOT to use this

**Multi-variate testing with statistical analysis.** If you're running experiments that need confidence intervals, sample size calculators, and Bayesian analysis, you need a platform like Optimizely or PostHog. Directive handles the assignment and exposure lifecycle, not the statistics.

**Server-side experiments.** API-level experiments (different recommendation algorithms, pricing tiers, backend behavior) belong in a server-side experimentation platform. Directive runs in the browser.

**Large-scale rollouts across services.** If you're rolling out a feature to 5% of users across 12 microservices, you need a centralized feature management platform with server-side evaluation. Directive is a client-side runtime.

**Non-technical experiment management.** Product managers who need a visual interface to create, target, and analyze experiments should use a dedicated experimentation tool. Directive experiments are defined in code.

The sweet spot: **client-side experiments where you control the assignment logic** &ndash; variant gating in React components, UI experiments, onboarding flow tests, and any case where you want the experiment lifecycle inspectable, testable, and colocated with the code it gates.

---

## Try it live

The [Labs page](/labs) on this site runs live A/B experiments powered by this exact module. Register experiments, watch constraints assign variants, toggle pause, and reset. The event log shows every step of the constraint &rarr; resolver cycle.

---

## Get started

```bash
npm install @directive-run/core @directive-run/react
```

- **[A/B Testing Example](/docs/examples/ab-testing)** &ndash; interactive demo with the full module
- **[Constraints](/docs/constraints)** &ndash; how `when` and `require` drive the assignment chain
- **[Resolvers](/docs/resolvers)** &ndash; async requirement fulfillment with retry policies
- **[Effects](/docs/effects)** &ndash; fire-and-forget side effects for logging and analytics
- **[Feature Flags](/blog/feature-flags-without-a-service)** &ndash; a related pattern using the same primitives

Your A/B tests aren't just random assignments. They're a lifecycle &ndash; register, assign, expose, gate &ndash; with dependencies between each step. Model them as constraints and the manual plumbing disappears.
