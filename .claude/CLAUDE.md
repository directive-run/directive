# Directive

**Type:** Open Source Library (npm package)
**Domain:** directive.run
**Status:** Phase 1 - Project Setup
**Goal:** Constraint-driven runtime library for TypeScript

**Tagline:** "Declare requirements. Let the runtime resolve them."

## What Is Directive

A runtime that automatically resolves what your system needs. Declare constraints (what must be true), let resolvers fulfill requirements (how to make it true), inspect everything.

## All Features (18 Total)

### High-Impact (5)
1. **Auto-Tracking Derivations** - No manual deps, signals-style reactivity
2. **Typed Requirement Identity** - Custom dedupe keys, parallel vs sequential control
3. **Effects System** - Fire-and-forget side effects, separate from resolvers
4. **Plugin Architecture** - Lifecycle hooks, built-in logging/devtools/persistence
5. **Async Constraint Evaluation** - Async preconditions with timeout handling

### Medium-Impact (5)
6. **Selector Composition** - Derivations depend on other derivations
7. **Constraint Priority** - Numbers for conflict resolution, emergency overrides
8. **Time-Travel Debugging** - Snapshots, go back/forward, replay, export/import
9. **Schema Validation (Dev Mode)** - Runtime type checking, tree-shaken in prod
10. **Batched Resolution** - Group similar requirements, prevent N+1 problems

### Architecture (3)
11. **Proxy-Based Facts** - Clean `facts.phase` access, full TypeScript inference
12. **Web Worker Support** - Run engine off main thread (opt-in)
13. **SSR-Ready Design** - Serializable state, hydration API, no singletons

### Robustness (3)
14. **Error Boundaries** - Catch errors, configurable recovery strategies
15. **Retry Policies** - Exponential backoff, max attempts, timeouts
16. **Lifecycle Hooks** - onInit, onStart, onStop, onError, onRequirementMet

### Developer Experience (2)
17. **Testing Utilities** - Mock resolvers, fake timers, assertion helpers
18. **Migration Codemods** - Redux/Zustand/XState → Directive transforms

## Tech Stack

| Tool | Purpose |
|------|---------|
| pnpm | Package manager |
| TypeScript 5.3+ | Language |
| tsup | Build (ESM + CJS) |
| Vitest | Testing |
| Biome | Lint/Format |
| Changesets | Versioning |
| jscodeshift | Codemods |

## Package Structure

Single package for MVP: `packages/directive/`
- Main: `directive`
- React: `directive/react`
- Plugins: `directive/plugins`
- Testing: `directive/testing`

## Build Order

```
Week 1: Foundation (types, tracking, facts)
Week 2: Computed Layer (derivations, effects)
Week 3: Constraint System (requirements, constraints)
Week 4: Resolution Layer (resolvers, errors)
Week 5: Orchestration (engine, plugins, time-travel)
Week 6: Integration (module, system, react, testing)
Week 7+: Examples & Docs
```

## Key Files

```
src/
├── types.ts         # All type definitions
├── tracking.ts      # Dependency tracking context
├── facts.ts         # Proxy-based store + auto-tracking
├── derivations.ts   # Auto-tracked + composition
├── effects.ts       # Side effect system
├── constraints.ts   # Sync + async, priority
├── requirements.ts  # Typed identity, custom keys
├── resolvers.ts     # Execution + retry + batch
├── engine.ts        # Reconciliation loop
├── plugins.ts       # Plugin architecture
├── time-travel.ts   # Debugging support
├── errors.ts        # Error boundaries
├── module.ts        # createModule API
├── system.ts        # createSystem API
├── testing.ts       # Test utilities
├── react.ts         # React adapter
├── index.ts         # Public exports
└── plugins/
    ├── logging.ts
    ├── devtools.ts
    └── persistence.ts
```

## API Example

```typescript
import { createModule, createSystem, t } from 'directive';
import { loggingPlugin, devtoolsPlugin } from 'directive/plugins';

const trafficLight = createModule("traffic-light", {
  schema: {
    phase: t.string<"red" | "green" | "yellow">(),
    elapsed: t.number(),
  },

  init: (facts) => {
    facts.phase = "red";
    facts.elapsed = 0;
  },

  // Auto-tracked (no deps)
  derive: {
    isRed: (facts) => facts.phase === "red",
    // Composition
    status: (facts, derive) => ({ phase: facts.phase, isRed: derive.isRed }),
  },

  // Fire-and-forget
  effects: {
    log: {
      run: (facts, prev) => {
        if (prev?.phase !== facts.phase) console.log(`→ ${facts.phase}`);
      },
    },
  },

  // With priority
  constraints: {
    transition: {
      priority: 50,
      when: (facts) => facts.phase === "red" && facts.elapsed > 30,
      require: { type: "TRANSITION", to: "green" },
    },
  },

  // With retry + custom key
  resolvers: {
    transition: {
      handles: (req) => req.type === "TRANSITION",
      key: (req) => `transition-${req.to}`,
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, ctx) => {
        ctx.facts.phase = req.to;
        ctx.facts.elapsed = 0;
      },
    },
  },
});

const system = createSystem({
  modules: [trafficLight],
  plugins: [loggingPlugin(), devtoolsPlugin()],
  debug: { timeTravel: true, maxSnapshots: 100 },
});
```

## Commands

```bash
pnpm install        # Install dependencies
pnpm build          # Build package
pnpm test           # Run tests
pnpm lint           # Lint/format
```

## Resources

- Full Plan: `docs/PLAN.md`
- MVP Spec: `/Users/jasonwcomes/Desktop/Sizls/MVP_TOOL.md`
