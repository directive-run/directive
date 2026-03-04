# Directive Project Plan

## Executive Summary

**Project:** Directive - A constraint-driven runtime library for TypeScript
**Type:** Open Source Library (npm packages + website + docs)
**Domain:** directive.run
**Goal:** Create "the next runtime tool" - a significant open source contribution to the state management ecosystem

### What Directive Is
A runtime that automatically resolves what your system needs. Declare constraints (what must be true), let resolvers fulfill requirements (how to make it true), inspect everything.

**Core Concepts:**
- **Facts Store** - Typed key-value store with proxy access and auto-tracking
- **Derivations** - Computed values with automatic dependency tracking (signals-style)
- **Effects** - Fire-and-forget side effects (logging, analytics, external notifications)
- **Constraints** - Rules that produce requirements when conditions aren't met (sync or async)
- **Requirements** - Typed identity with custom dedupe keys, met/unmet evaluation
- **Resolvers** - Capability-based handlers (cancelable, deduped, batchable, with retry policies)
- **Engine** - Event-driven reconciliation loop with time-travel debugging
- **Plugins** - Extensible middleware for devtools, persistence, logging

---

## Phase 1: Project Setup

### 1.1 Create Project Structure

**Location:** `/Users/jasonwcomes/Desktop/Sizls/projects/directive/`

```
directive/
├── .claude/
│   ├── CLAUDE.md              # Project context
│   └── session-log.md         # Session tracking
├── packages/
│   ├── core/                  # @directive-run/core – runtime, modules, systems
│   │   ├── src/
│   │   │   ├── core/          # Core primitives
│   │   │   │   ├── types.ts
│   │   │   │   ├── tracking.ts
│   │   │   │   ├── facts.ts
│   │   │   │   ├── derivations.ts
│   │   │   │   ├── effects.ts
│   │   │   │   ├── constraints.ts
│   │   │   │   ├── requirements.ts
│   │   │   │   ├── resolvers.ts
│   │   │   │   ├── engine.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── module.ts
│   │   │   │   ├── system.ts
│   │   │   │   └── composition.ts
│   │   │   ├── plugins/       # Built-in plugins
│   │   │   ├── utils/         # Helpers, testing utilities
│   │   │   ├── adapters/      # Adapter utilities
│   │   │   └── index.ts       # Public exports
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   ├── react/                 # @directive-run/react – React hooks
│   ├── vue/                   # @directive-run/vue – Vue composables
│   ├── svelte/                # @directive-run/svelte – Svelte stores
│   ├── solid/                 # @directive-run/solid – Solid signals
│   ├── lit/                   # @directive-run/lit – Lit controllers
│   ├── ai/                    # @directive-run/ai – AI agent orchestration
│   └── directive/             # Deprecated – redirects to @directive-run/core
├── examples/
│   ├── traffic-light/
│   └── data-fetching/
├── docs/                      # Documentation
├── website/                   # Marketing landing page (directive.run)
├── codemods/                  # Migration tools
│   ├── from-redux/
│   ├── from-zustand/
│   └── from-xstate/
├── package.json               # Workspace root
├── pnpm-workspace.yaml
├── vitest.config.ts
├── biome.json
└── README.md
```

### 1.2 Tech Stack

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm | Package manager | Fast, disk-efficient |
| TypeScript 5.3+ | Language | For const type params, improved inference |
| tsup | Build | ESM + CJS output, tree-shaking |
| Vitest | Testing | Fast, native ESM |
| Biome | Lint/Format | Faster than ESLint + Prettier |
| Changesets | Versioning | npm publishing workflow |
| jscodeshift | Codemods | Migration tooling |

### 1.3 Naming & Branding

**Name:** Directive
**Domain:** directive.run

**Assets to secure:**
- directive.run (primary domain)
- @directive-run/core on npm (or just `directive`)
- directive-run org on GitHub
- @directiverun on Twitter/X

**Tagline:** "Declare requirements. Let the runtime resolve them."

---

## Phase 2: Core Implementation

### 2.1 All Features (Complete List)

#### High-Impact Features

1. **Auto-Tracking Derivations** (Signals-style)
   - No manual `deps` arrays
   - Dependencies detected at runtime via Proxy
   - Dynamic re-tracking when access patterns change

2. **Typed Requirement Identity**
   - Custom `key` function for dedupe control
   - Type-safe requirement definitions
   - Explicit control over parallel vs sequential resolution

3. **Effects System**
   - Fire-and-forget side effects
   - Separate from requirement resolution
   - Error isolation (never breaks reconciliation)

4. **Plugin Architecture**
   - Lifecycle hooks for all engine events
   - Built-in plugins: logging, devtools, persistence
   - Custom plugin API

5. **Async Constraint Evaluation**
   - Constraints can be async (e.g., "is user authenticated?")
   - Async constraints don't block sync constraints
   - Timeout handling for async constraints

#### Medium-Impact Features

6. **Selector Composition**
   - Derivations can depend on other derivations
   - Automatic invalidation cascades
   - Circular dependency detection

7. **Constraint Priority/Ordering**
   - Priority numbers for conflict resolution
   - Explicit ordering when multiple constraints fire
   - Override rules for emergency scenarios

8. **Time-Travel Debugging**
   - Ring buffer of state snapshots
   - Go back/forward through history
   - Replay from any snapshot
   - Export/import state history

9. **Schema Validation (Dev Mode)**
   - Runtime type checking in development
   - Validate fact values against schema
   - Tree-shaken in production builds

10. **Batched Requirement Resolution**
    - Group similar requirements
    - Configurable batch window
    - Prevents N+1 problems in data fetching

#### Architecture Features

11. **Proxy-Based Facts Store**
    - Clean `facts.phase` instead of `facts.get("phase")`
    - Full TypeScript inference
    - Fallback `facts.get()` for edge cases

12. **Web Worker Support**
    - Run engine off main thread
    - Sync facts to main thread
    - Optional opt-in for performance

13. **SSR-Ready Design**
    - Serializable state
    - Hydration API
    - No singleton patterns

#### Robustness Features

14. **Error Boundaries**
    - Catch errors in constraints/resolvers/effects
    - Configurable error recovery strategies
    - Error reporting to plugins

15. **Retry Policies**
    - Configurable retry for failed resolvers
    - Exponential backoff support
    - Max attempts, timeout handling

16. **Lifecycle Hooks**
    - `onInit`, `onStart`, `onStop`
    - `onError`, `onRequirementMet`
    - Module-level and system-level hooks

#### Developer Experience

17. **Testing Utilities**
    - Mock resolvers
    - Time control (fake timers)
    - Assertion helpers
    - Snapshot testing support

18. **Migration Codemods**
    - Redux → Directive
    - Zustand → Directive
    - XState → Directive
    - Automated code transformation

### 2.2 Build Order (Dependency Graph)

```
Week 1: Foundation
├── types.ts - All type definitions
├── tracking.ts - Dependency tracking context
├── facts.ts - Proxy-based store with auto-tracking
├── Tests: 90% coverage
└── Deliverable: Facts store that auto-tracks access

Week 2: Computed Layer
├── derivations.ts - Auto-tracked with composition
├── effects.ts - Side effect system
├── Tests: 90% coverage
└── Deliverable: Derivations that just work

Week 3: Constraint System
├── requirements.ts - Typed identity with custom keys
├── constraints.ts - Sync + async evaluation, priority
├── Tests: 90% coverage
└── Deliverable: Constraints produce requirements

Week 4: Resolution Layer
├── resolvers.ts - Execution with retry/batch
├── errors.ts - Error boundaries
├── Tests: 90% coverage
└── Deliverable: Resolvers fulfill requirements

Week 5: Orchestration
├── engine.ts - Reconciliation loop
├── plugins.ts - Plugin architecture
├── time-travel.ts - Debugging support
├── Integration tests
└── Deliverable: Working engine

Week 6: Integration & Polish
├── module.ts - createModule API
├── system.ts - createSystem API
├── react.ts - React adapter
├── testing.ts - Test utilities
├── TypeScript inference polish
└── Bundle size optimization

Week 7+: Examples & Docs
├── Traffic light example
├── Data fetching example
├── Documentation site
├── Codemods (stretch goal)
```

### 2.3 Estimated Complexity

| Component | Complexity | LOC Estimate |
|-----------|------------|--------------|
| Types | Medium | 200-300 |
| Tracking Context | Medium | 100-150 |
| Facts Store + Proxy | High | 350-450 |
| Derivations + Composition | High | 450-550 |
| Effects | Medium | 150-200 |
| Constraints (sync + async) | High | 300-400 |
| Requirements | Medium | 200-250 |
| Resolvers + Retry + Batch | High | 450-550 |
| Engine | High | 500-600 |
| Plugins | Medium | 250-300 |
| Time-Travel | Medium | 200-250 |
| Error Boundaries | Medium | 150-200 |
| React Adapter | Low | 100-150 |
| Testing Utilities | Medium | 200-250 |
| **Total** | | **~3600-4600 LOC** |

### 2.4 Complete API Design

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { loggingPlugin, devtoolsPlugin, persistencePlugin } from '@directive-run/core/plugins';

const trafficLight = createModule("traffic-light", {
  // 1. Schema with optional dev-mode validation
  schema: {
    phase: t.string<"red" | "green" | "yellow">()
      .validate(v => ["red", "green", "yellow"].includes(v)),
    elapsed: t.number().min(0),
  },

  // 2. Initialize facts (proxy-based access)
  init: (facts) => {
    facts.phase = "red";
    facts.elapsed = 0;
  },

  // 3. Event handlers
  events: {
    tick: (facts) => {
      facts.elapsed += 1;
    },
  },

  // 4. Auto-tracked derivations with composition
  derive: {
    isRed: (facts) => facts.phase === "red",
    isGreen: (facts) => facts.phase === "green",
    shouldTransition: (facts) => facts.phase === "red" && facts.elapsed > 30,
    // Compose derivations
    status: (facts, derive) => ({
      phase: facts.phase,
      isRed: derive.isRed,
      waiting: derive.shouldTransition,
    }),
  },

  // 5. Fire-and-forget side effects
  effects: {
    logTransition: {
      run: (facts, prev) => {
        if (prev?.phase !== facts.phase) {
          console.log(`Phase changed: ${prev?.phase} → ${facts.phase}`);
        }
      },
    },
    analytics: {
      run: (facts, prev) => {
        if (prev?.phase !== facts.phase) {
          analytics.track("phase_changed", { to: facts.phase });
        }
      },
    },
  },

  // 6. Constraints with priority and async support
  constraints: {
    shouldTransition: {
      priority: 50,  // Higher runs first
      when: (facts) => facts.phase === "red" && facts.elapsed > 30,
      require: { type: "TRANSITION", to: "green" },
    },
    emergency: {
      priority: 100,  // Emergency overrides
      when: (facts) => facts.emergency === true,
      require: { type: "TRANSITION", to: "red" },
    },
    // Async constraint
    requireAuth: {
      when: async (facts) => {
        if (!facts.route?.startsWith("/admin")) return false;
        return !(await checkAuthStatus());
      },
      require: { type: "AUTH_REDIRECT" },
    },
  },

  // 7. Resolvers with retry, batch, custom keys
  resolvers: {
    transition: {
      requirement: (req) => req.type === "TRANSITION",
      // Custom dedupe key
      key: (req) => `transition-to-${req.to}`,
      // Retry policy
      retry: { attempts: 3, backoff: "exponential", maxDelay: 5000 },
      resolve: async (req, ctx) => {
        ctx.facts.phase = req.to;
        ctx.facts.elapsed = 0;
      },
    },
    fetchUsers: {
      requirement: (req) => req.type === "FETCH_USER",
      // Batch similar requirements
      batch: { enabled: true, windowMs: 50 },
      resolve: async (reqs, ctx) => {
        const ids = reqs.map(r => r.userId);
        const users = await api.getUsers(ids);
        users.forEach(u => ctx.facts.users[u.id] = u);
      },
    },
  },

  // 8. Lifecycle hooks
  hooks: {
    onInit: (system) => console.log("Module initialized"),
    onError: (error, context) => reportError(error),
  },
});

// Create system with plugins (single module mode)
const system = createSystem({
  module: trafficLight,
  plugins: [
    loggingPlugin({ level: 'debug' }),
    persistencePlugin({
      storage: localStorage,
      key: 'traffic-light',
      include: ['phase', 'elapsed'],  // Only persist these
    }),
    devtoolsPlugin(),
  ],
  // Time-travel debugging
  debug: {
    timeTravel: true,
    maxSnapshots: 100,
  },
  tickMs: 1000,
});

// Start the system
system.start();

// Time-travel API
system.debug.snapshots;      // Get all snapshots
system.debug.goBack(5);      // Rewind 5 steps
system.debug.goTo(snapshot); // Jump to specific snapshot
system.debug.replay();       // Replay from current position
system.debug.export();       // Export history as JSON
system.debug.import(json);   // Import history

// Testing utilities
import { createTestSystem, mockResolver, fakeTimers } from '@directive-run/core/testing';

const testSystem = createTestSystem({
  modules: { traffic: trafficLight },
  mocks: {
    resolvers: {
      transition: mockResolver((req) => ({ phase: req.to, elapsed: 0 })),
    },
  },
  timers: fakeTimers(),
});

await testSystem.dispatch({ type: 'tick' });
testSystem.timers.advance(1000);
expect(testSystem.facts.elapsed).toBe(1);
```

### 2.5 Plugin Architecture Detail

```typescript
interface Plugin {
  name: string;

  // Lifecycle hooks
  onInit?: (system: System) => void | Promise<void>;
  onStart?: (system: System) => void;
  onStop?: (system: System) => void;
  onDestroy?: (system: System) => void;

  // Fact hooks
  onFactSet?: (key: string, value: unknown, prev: unknown) => void;
  onFactDelete?: (key: string, prev: unknown) => void;
  onFactsBatch?: (changes: FactChange[]) => void;

  // Derivation hooks
  onDerivationCompute?: (id: string, value: unknown, deps: string[]) => void;
  onDerivationInvalidate?: (id: string) => void;

  // Reconciliation hooks
  onReconcileStart?: (snapshot: FactsSnapshot) => void;
  onReconcileEnd?: (result: ReconcileResult) => void;

  // Constraint hooks
  onConstraintEvaluate?: (id: string, active: boolean) => void;
  onConstraintError?: (id: string, error: unknown) => void;

  // Requirement hooks
  onRequirementCreated?: (req: Requirement, fromConstraint: string) => void;
  onRequirementMet?: (req: Requirement, byResolver: string) => void;
  onRequirementCanceled?: (req: Requirement) => void;

  // Resolver hooks
  onResolverStart?: (resolver: string, req: Requirement) => void;
  onResolverComplete?: (resolver: string, req: Requirement, duration: number) => void;
  onResolverError?: (resolver: string, req: Requirement, error: unknown) => void;
  onResolverRetry?: (resolver: string, req: Requirement, attempt: number) => void;
  onResolverCancel?: (resolver: string, req: Requirement) => void;

  // Effect hooks
  onEffectRun?: (id: string) => void;
  onEffectError?: (id: string, error: unknown) => void;

  // Time-travel hooks
  onSnapshot?: (snapshot: Snapshot) => void;
  onTimeTravel?: (from: number, to: number) => void;

  // Error boundary hooks
  onError?: (error: DirectiveError) => void;
  onErrorRecovery?: (error: DirectiveError, strategy: RecoveryStrategy) => void;
}

// Built-in plugins
function loggingPlugin(options?: {
  level?: 'debug' | 'info' | 'warn' | 'error';
  filter?: (event: string) => boolean;
}): Plugin;

function devtoolsPlugin(options?: {
  name?: string;
  trace?: boolean;
}): Plugin;

function persistencePlugin(options: {
  storage: Storage;
  key: string;
  include?: string[];
  exclude?: string[];
  debounce?: number;
}): Plugin;

function metricsPlugin(options?: {
  onMetric?: (metric: Metric) => void;
}): Plugin;

function validationPlugin(options?: {
  mode?: 'development' | 'always';
  onViolation?: (violation: Violation) => void;
}): Plugin;
```

### 2.6 Error Boundary Design

```typescript
interface ErrorBoundaryConfig {
  // What to do when a constraint throws
  onConstraintError?: 'skip' | 'disable' | 'throw' | ((error: Error, constraint: string) => void);

  // What to do when a resolver throws (after retries exhausted)
  onResolverError?: 'skip' | 'retry-later' | 'throw' | ((error: Error, resolver: string) => void);

  // What to do when an effect throws
  onEffectError?: 'skip' | 'disable' | 'throw' | ((error: Error, effect: string) => void);

  // What to do when a derivation throws
  onDerivationError?: 'cache-stale' | 'throw' | ((error: Error, derivation: string) => void);

  // Global error handler
  onError?: (error: DirectiveError) => void;
}

// Error types
class DirectiveError extends Error {
  type: 'constraint' | 'resolver' | 'effect' | 'derivation' | 'system';
  source: string;  // ID of the failing component
  context: unknown;  // Additional context
  recoverable: boolean;
}
```

### 2.7 Technical Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Auto-tracking performance | High | Use WeakMap for GC, batch dependency updates, profile with large fact stores |
| Proxy compatibility | Medium | Provide fallback `facts.get()` API, document edge cases |
| Async constraint complexity | High | Clear timeout handling, separate sync/async evaluation queues |
| Plugin ordering conflicts | Medium | Document plugin order, provide `before`/`after` hints |
| TypeScript inference complexity | High | Budget 40-60% of dev time for types, use tsd for type testing |
| Bundle size (with all features) | High | Tree-shaking, separate entry points, profile with bundlephobia |
| Time-travel memory usage | Medium | Ring buffer with configurable size, lazy snapshot creation |
| Batched resolver edge cases | Medium | Clear semantics for partial failures, timeout per batch |
| Worker thread communication | Medium | Structured clone awareness, proxy limitations documented |

---

## Phase 3: Examples & Documentation

### 3.1 Example Projects (Priority Order)

1. **Data Fetching** (MVP) - Familiar problem, shows constraint value
2. **Form Validation** - Common use case, constraints shine here
3. **Traffic Light** - Visual showcase, proves the mental model
4. **AI Agent** (v1.1) - MCP integration, differentiator

### 3.2 Documentation Site Structure

**Platform:** VitePress or Starlight (Astro-based)

```
/docs
├── Getting Started
│   ├── Installation
│   ├── Quick Start (5 min)
│   ├── Core Concepts
│   └── Why Directive?
├── Concepts
│   ├── Facts & Schema
│   ├── Auto-Tracking
│   ├── Derivations & Composition
│   ├── Effects
│   ├── Constraints (Sync & Async)
│   ├── Requirements & Identity
│   ├── Resolvers (Retry, Batch)
│   ├── Plugins
│   ├── Error Boundaries
│   ├── Time-Travel Debugging
│   └── Engine Lifecycle
├── React Integration
│   ├── Setup
│   ├── useDerived
│   ├── useFacts
│   └── SSR & Hydration
├── Plugins
│   ├── Built-in Plugins
│   ├── Writing Custom Plugins
│   └── Plugin API Reference
├── Testing
│   ├── Test Utilities
│   ├── Mocking Resolvers
│   ├── Fake Timers
│   └── Snapshot Testing
├── Patterns
│   ├── Data Fetching
│   ├── Form Validation
│   ├── Phase-Based Systems
│   ├── Optimistic Updates
│   └── AI Agent Orchestration
├── Migration
│   ├── From Redux
│   ├── From Zustand
│   ├── From XState
│   └── Using Codemods
├── Advanced
│   ├── Web Workers
│   ├── Custom Requirement Keys
│   ├── Constraint Priority
│   └── Performance Tuning
├── Examples
│   └── [Interactive examples]
└── API Reference
    └── [Auto-generated]
```

### 3.3 Website Landing Page (directive.run)

**Sections:**
1. Hero - "Declare requirements. Let the runtime resolve them." + "Get Started" + "View Demo"
2. Problem - State management solved easy parts, what about async coordination?
3. Solution - 3-step visual (declare → register → react)
4. Code Example - Simple, copy-pasteable (data fetching)
5. Features Grid:
   - Auto-tracking derivations (signals-style)
   - Async constraints
   - Batched resolution
   - Retry policies
   - Plugin architecture
   - Time-travel debugging
   - Error boundaries
   - Testing utilities
   - TypeScript-first
6. Comparison Table - vs XState, React Query, Redux, Zustand
7. Migration - "Coming from Redux/Zustand? We have codemods."
8. Footer CTAs - Docs, GitHub, Discord

---

## Phase 4: Go-to-Market

### 4.1 Launch Timeline

**Week 1-2: Soft Launch**
- GitHub repo public with excellent README
- Basic docs site live at directive.run
- Personal Twitter announcement
- 2-3 blog posts

**Week 3-4: Community Seeding**
- Discord server open
- Posts to r/javascript, r/typescript, r/reactjs
- Dev.to article
- Reach out to 5-10 influencers

**Week 5-6: Preparation**
- Prepare HN post
- Demo video (2-3 min)
- Interactive playground (StackBlitz)
- Have 10+ stars from early adopters

**Week 7: HN Launch**
- Tuesday 10am EST
- Title: "Show HN: Directive - Constraint-driven state orchestration for TypeScript"
- Be available 6+ hours for comments

### 4.2 Target Audience

**Primary:** Senior Frontend/Full-Stack Engineers
- 5+ years experience
- Building complex async applications
- Frustrated with state management sprawl
- Values debuggability over minimal bundle size

**Secondary:** AI/Agent Developers
- Building LLM-powered apps
- Using MCP/function calling
- Need constraint-based guardrails

### 4.3 Positioning

**Elevator pitch (25 words):**
> "Directive is a runtime that automatically resolves what your system needs. Declare constraints, let resolvers fulfill requirements, inspect everything."

**Unique Value Proposition:**
Directive combines features no other library offers together:

| Feature | Redux | Zustand | XState | React Query | Directive |
|---------|-------|---------|--------|-------------|-----------|
| Auto-tracking | ❌ | ❌ | ❌ | ❌ | ✅ |
| Constraint-driven | ❌ | ❌ | Partial | ❌ | ✅ |
| Async constraints | ❌ | ❌ | ❌ | ❌ | ✅ |
| Batched resolution | ❌ | ❌ | ❌ | ✅ | ✅ |
| Retry policies | ❌ | ❌ | ❌ | ✅ | ✅ |
| Time-travel debug | ✅ | ❌ | ✅ | ❌ | ✅ |
| Effects separation | Middleware | ❌ | Actions | ❌ | ✅ |
| Plugin architecture | Middleware | Middleware | ❌ | ❌ | ✅ |
| Error boundaries | ❌ | ❌ | ❌ | ✅ | ✅ |
| Testing utilities | ❌ | ❌ | ✅ | ✅ | ✅ |
| Codemods | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Phase 5: Future Roadmap

### v0.1 (MVP)
All features in this plan

### v0.2
- MCP plugin with validation
- Browser devtools extension
- More codemods (Recoil, Jotai)
- Performance profiler

### v0.3+
- Visual state graph editor
- Collaboration features (multiplayer state)
- Server-side Directive (Node.js optimized)
- Framework adapters (Vue, Svelte, Solid)

### Explicitly Not Building (v1.0)
- CRDT/distributed state
- Linear/constraint solvers
- Multi-agent planning

---

## Verification Plan

### Testing Strategy
1. **Unit tests** - 90% coverage on core primitives
2. **Integration tests** - Traffic light scenario, data fetching
3. **Type tests** - Using tsd for TypeScript inference
4. **Bundle tests** - Size limits per release
5. **Plugin tests** - Each built-in plugin has dedicated tests
6. **Error boundary tests** - All error scenarios covered
7. **Performance tests** - Benchmarks for large fact stores

### Success Metrics
- GitHub stars: 100 in month 1, 500 in month 3
- npm downloads: 100/week in month 1, 1K/week in month 3
- Discord members: 50 in month 1
- Documentation completion: 100% API coverage

### Manual Verification Steps
1. Run full test suite: `pnpm test`
2. Build and verify bundle size: `pnpm build && npx bundlephobia`
3. Test React integration in example app
4. Verify TypeScript inference in VS Code
5. Test auto-tracking with complex derivation chains
6. Test plugin hooks fire in correct order
7. Test cancellation scenarios manually
8. Test time-travel with 100+ snapshots
9. Test async constraint timeouts
10. Test batched resolver with partial failures

---

## Cost Analysis

| Item | Monthly Cost | Notes |
|------|--------------|-------|
| Domain (directive.run) | ~$15/year | One-time |
| npm publishing | $0 | Free |
| GitHub | $0 | Free for public repos |
| Docs hosting (Vercel/Netlify) | $0 | Free tier |
| Website hosting | $0 | Free tier |
| **Total MVP** | **$0/month** | Free tiers cover everything |

---

## Next Actions

1. ✅ Create project directory at `/projects/directive/`
2. ✅ Set up .claude/CLAUDE.md with project context
3. ✅ Create comprehensive plan with all features
4. ⬜ Initialize monorepo with pnpm + single package
5. ⬜ Implement types.ts (all type definitions)
6. ⬜ Implement tracking.ts (dependency tracking context)
7. ⬜ Implement Facts Store with proxy + auto-tracking
8. ⬜ Write tests as we go (90% coverage target)
