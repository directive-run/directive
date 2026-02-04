# Directive Architecture

This document provides a deep dive into Directive's module/system architecture and the design rationale behind key decisions.

## Core Concepts

### Module vs System

| Concept | Purpose | Analogy |
|---------|---------|---------|
| `createModule()` | **Blueprint** - type-safe definition, reusable, testable | Class definition |
| `createSystem()` | **Runtime** - creates actual instance with plugins, config | `new Class()` |

```typescript
// Module = reusable blueprint (no state yet)
const authModule = createModule("auth", { ... });
const dataModule = createModule("data", { ... });

// System = runtime instance (actual state created here)
const system = createSystem({
  modules: [authModule, dataModule],
  plugins: [loggingPlugin()],
  debug: { timeTravel: true },
});
```

**Why not combine them?**
- Modules can be shared across multiple systems (testing, different configs)
- System handles runtime concerns (plugins, lifecycle, debugging)
- Separation makes each simpler to reason about

## Flat Merge Architecture

### The Design Decision

All modules in a system share **one facts store**. When you call `createSystem({ modules: [a, b, c] })`, the facts from all modules are merged into a single store.

```
┌─────────────────────────────────────────────────────────┐
│                    createSystem()                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ authModule  │  │ dataModule  │  │  uiModule   │    │
│  │             │  │             │  │             │    │
│  │ isAuth: ●───┼──┼──→ can read │  │ can read ←──┼────│
│  │ token: ●────┼──┼──→ can read │  │ can read ←──┼────│
│  │             │  │ data: ●─────┼──┼──→ can read │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│                         │                              │
│                         ▼                              │
│  ┌─────────────────────────────────────────────────┐  │
│  │           SHARED FACTS STORE                    │  │
│  │  { isAuth, token, data, ... }                   │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Why Flat Merge?

This is **intentional**, not a limitation. Directive's core value proposition is **constraint-driven orchestration**, which requires constraints to have a complete view of system state.

Consider this cross-module constraint:

```typescript
// dataModule needs to know about auth state
constraints: {
  fetchUserData: {
    when: (facts) =>
      facts.auth_isAuthenticated &&     // from authModule
      !facts.data_user &&               // from dataModule
      facts.config_featureEnabled,      // from configModule
    require: { type: "FETCH_USER_DATA" },
  },
},
```

If modules were isolated (like XState actors), you'd need:
1. Message passing between modules
2. Subscription management
3. State synchronization logic

With flat merge, constraints just read what they need.

### Comparison with Other Libraries

| Library | State Model | Module Isolation | Cross-Module Access |
|---------|-------------|------------------|---------------------|
| **Redux** | Single store, slices | Slices isolated | Via selectors, explicit |
| **Zustand** | Multiple stores | Completely isolated | Manual subscription |
| **XState** | Actors | Completely isolated | Message passing |
| **Directive** | Single store, merged | No isolation | Direct read (intentional) |

## Data Flow

When an event occurs, here's how data flows through a Directive system:

```
User Action                    Directive System
──────────────────────────────────────────────────────────────

system.dispatch({ type: "login", token: "abc" })
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ 1. EVENT HANDLERS RUN (from all modules)                 │
│    authModule.events.login(facts, { token }) →           │
│      facts.token = "abc"                                 │
│      facts.isAuthenticated = true                        │
└──────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ 2. DERIVATIONS INVALIDATE                                │
│    Any derivation reading changed facts recomputes       │
└──────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ 3. CONSTRAINTS EVALUATE (from all modules)               │
│    dataModule.constraints.needsData:                     │
│      when: facts.isAuthenticated === true → TRUE!        │
│      require: { type: "FETCH_USER_DATA" }                │
└──────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ 4. RESOLVERS RUN (from any module that handles it)       │
│    dataModule.resolvers.fetchData:                       │
│      requirement: "FETCH_USER_DATA"                      │
│      resolve: async (req, ctx) => {                      │
│        const data = await api.fetch();                   │
│        ctx.facts.userData = data;                        │
│      }                                                   │
└──────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ 5. CYCLE REPEATS                                         │
│    New fact change → derivations → constraints → ...     │
└──────────────────────────────────────────────────────────┘
```

### The Reconciliation Loop

1. **Fact Change** - Something modifies `system.facts.x`
2. **Effect Run** - Effects that tracked the changed fact execute
3. **Derivation Invalidation** - Derivations depending on changed facts recompute
4. **Constraint Evaluation** - All constraints evaluate with new state
5. **Requirement Generation** - Active constraints produce requirements
6. **Resolver Execution** - Matching resolvers handle requirements
7. **Repeat** - Resolver may change facts, triggering another cycle

The loop continues until:
- No constraints produce new requirements
- All inflight resolvers complete
- System reaches a stable state (`system.isSettled === true`)

## Scaling Considerations

### Module Count Guidelines

| # Modules | Complexity | Recommended Approach |
|-----------|------------|---------------------|
| 1-3 | Simple | Use as-is |
| 4-6 | Medium | Namespace facts: `auth_token`, `data_users` |
| 7+ | Complex | Consider splitting into separate systems |

### Namespace Convention

For larger applications, prefix fact keys with the module name:

```typescript
const authModule = createModule("auth", {
  schema: {
    facts: {
      auth_token: t.string().nullable(),
      auth_isAuthenticated: t.boolean(),
      auth_user: t.object<User>().nullable(),
    },
  },
});

const dataModule = createModule("data", {
  schema: {
    facts: {
      data_users: t.array<User>(),
      data_loading: t.boolean(),
    },
  },
  constraints: {
    fetchUsers: {
      // Can read auth facts without explicit wiring
      when: (facts) => facts.auth_isAuthenticated && !facts.data_users.length,
      require: { type: "FETCH_USERS" },
    },
  },
});
```

### Collision Detection

Directive detects fact key collisions in dev mode:

```typescript
const mod1 = createModule("a", { schema: { facts: { count: t.number() } } });
const mod2 = createModule("b", { schema: { facts: { count: t.number() } } });

createSystem({ modules: [mod1, mod2] });
// Error: Schema collision: Fact "count" is defined in both module "a" and "b"
```

### Type-Safe Cross-Module Access

The flat merge gives runtime access to all facts, but TypeScript doesn't automatically know about facts from other modules. Use the `asCombined()` pattern for type safety:

```typescript
// types.ts - Define combined facts type
export type CombinedFacts = {
  // Auth module
  auth_isAuthenticated: boolean;
  auth_user: User | null;
  // Data module
  data_users: UserData[];
  data_loading: boolean;
};

export function asCombined<T>(facts: T): CombinedFacts & T {
  return facts as CombinedFacts & T;
}

// data.ts - Type-safe cross-module constraint
import { asCombined } from "./types";

constraints: {
  fetchWhenAuth: {
    when: (facts) => {
      const combined = asCombined(facts);
      // ✅ Autocomplete works, type errors if wrong
      return combined.auth_isAuthenticated && combined.data_users.length === 0;
    },
    require: { type: "FETCH_USERS" },
  },
},
```

This pattern:
- Preserves the module's own fact types
- Adds cross-module types on demand
- Enables full autocomplete and type checking
- Works with both `t.*()` builders and Zod schemas

## Testing Isolated Modules

Despite the flat merge at runtime, you can test modules in isolation:

```typescript
import { createTestSystem, mockResolver } from 'directive/testing';

// Test authModule without dataModule
const testSystem = createTestSystem({
  modules: [authModule],
  mocks: {
    resolvers: {
      VALIDATE_TOKEN: mockResolver(() => ({ valid: true })),
    },
  },
});

testSystem.facts.auth_token = "test-token";
await testSystem.settle();

expect(testSystem.facts.auth_isAuthenticated).toBe(true);
```

## Design Rationale Summary

| Decision | Rationale |
|----------|-----------|
| Flat merge | Constraints need full visibility for cross-cutting concerns |
| Module as blueprint | Enables reuse, testing, and composition |
| System as runtime | Separates configuration from definition |
| Namespace convention | Scales flat merge to larger applications |
| Collision detection | Catches errors early in development |

The flat merge isn't a limitation - it's what makes Directive's constraint-driven model work. When you need modules to coordinate based on shared state, the flat merge gives you that capability with zero boilerplate.
