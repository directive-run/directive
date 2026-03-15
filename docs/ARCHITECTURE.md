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
// For multiple modules, use object syntax (namespaced access):
const system = createSystem({
  modules: { auth: authModule, data: dataModule },
  plugins: [loggingPlugin()],
  history: true,
});
// Access: system.facts.auth.token, system.facts.data.users
```

**Why not combine them?**
- Modules can be shared across multiple systems (testing, different configs)
- System handles runtime concerns (plugins, lifecycle, debugging)
- Separation makes each simpler to reason about

## Flat Merge Architecture

### The Design Decision

All modules in a system share **one facts store**. When you call `createSystem({ modules: { a, b, c } })`, the facts from all modules are merged into a single store, accessible via their namespaces (`system.facts.a.count`, `system.facts.b.count`).

```
┌─────────────────────────────────────────────────────────┐
│                    createSystem()                       │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ authModule  │  │ dataModule  │  │  uiModule   │      │
│  │             │  │             │  │             │      │
│  │ isAuth: ●───┼──┼──→ can read │  │ can read ←──┼──────│
│  │ token: ●────┼──┼──→ can read │  │ can read ←──┼──────│
│  │             │  │ data: ●─────┼──┼──→ can read │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │           SHARED FACTS STORE                    │    │
│  │  { isAuth, token, data, ... }                   │    │
│  └─────────────────────────────────────────────────┘    │
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

## Mutating Facts

### The Reactive Proxy

Facts in Directive are accessed through a **reactive Proxy**. When you write `facts.token = "abc"`, you're not mutating a plain object - the Proxy intercepts the assignment and:

1. Stores the new value
2. Tracks the change for reconciliation
3. Notifies subscribers (watchers, React hooks)
4. Triggers constraint re-evaluation
5. Creates a snapshot (if time-travel enabled)

### Where You Can Mutate Facts

Facts can be mutated in three places:

```typescript
const module = createModule("auth", {
  // 1. Module init - set initial values
  init: (facts) => {
    facts.token = null;
    facts.isAuthenticated = false;
  },

  // 2. Event handlers - respond to user actions
  events: {
    login: (facts, payload) => {
      facts.token = payload.token;
      facts.isAuthenticated = true;
    },
    logout: (facts) => {
      facts.token = null;
      facts.isAuthenticated = false;
    },
  },

  // 3. Resolvers - fulfill requirements
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, ctx) => {
        const user = await api.getUser(req.id);
        ctx.facts.user = user;        // ✅ Safe - goes through Proxy
        ctx.facts.loading = false;
      },
    },
  },
});
```

### Top-Level vs Nested Mutation

**Important:** The Proxy only tracks top-level fact keys. Nested mutations won't trigger reactivity:

```typescript
// ❌ Won't trigger reactivity (mutating nested property)
ctx.facts.user.name = "John";
ctx.facts.config.timeout = 5000;
ctx.facts.items.push("new item");

// ✅ Replace the entire object/array instead
ctx.facts.user = { ...ctx.facts.user, name: "John" };
ctx.facts.config = { ...ctx.facts.config, timeout: 5000 };
ctx.facts.items = [...ctx.facts.items, "new item"];
```

In dev mode (`NODE_ENV !== "production"`), Directive wraps returned objects in a recursive Proxy that warns on nested sets:

```
[Directive] Nested mutation on "facts.user.name" will not trigger reactivity.
Use: facts.user = { ...facts.user, ... }
```

The warning proxy is tree-shaken in production builds. The mutation still applies — it just won't be reactive.

This is the same pattern used by:
- **React useState**: `setUser({ ...user, name: "John" })`
- **Redux**: Reducers return new state objects
- **Zustand**: `set({ items: [...items, newItem] })`

### Batching Multiple Changes

When you mutate multiple facts in a handler, they're automatically batched:

```typescript
events: {
  reset: (facts) => {
    // All three changes trigger ONE reconciliation cycle
    facts.token = null;
    facts.user = null;
    facts.isAuthenticated = false;
  },
},
```

For mutations outside handlers (rare), use `system.batch()`:

```typescript
system.batch(() => {
  system.facts.a = 1;
  system.facts.b = 2;
  system.facts.c = 3;
}); // Single reconciliation after batch completes
```

## Derivations (Computed Values)

Derivations are **computed values derived from facts**. They're like selectors in Redux, computed properties in Vue/MobX, or useMemo in React - but with automatic dependency tracking.

### Defining Derivations

```typescript
const module = createModule("data", {
  schema: {
    facts: {
      users: t.array<User>(),
      filter: t.string(),
      isLoading: t.boolean(),
    },
    derivations: {
      // Declare the return type
      userCount: t.number(),
      filteredUsers: t.array<User>(),
      status: t.string<"idle" | "loading" | "ready">(),
    },
  },

  derive: {
    // Simple computation
    userCount: (facts) => facts.users.length,

    // Filtering
    filteredUsers: (facts) =>
      facts.users.filter(u => u.name.includes(facts.filter)),

    // Conditional logic
    status: (facts) => {
      if (facts.isLoading) return "loading";
      if (facts.users.length > 0) return "ready";
      return "idle";
    },
  },
});
```

### Accessing Derivations

```typescript
// Via the derive accessor (type-safe)
const count = system.derive.userCount;           // number
const status = system.derive.status;             // "idle" | "loading" | "ready"

// Via read() method
const count = system.read("userCount");          // number
const status = system.read<string>("status");    // with type hint

// Namespaced systems
const count = system.derive.data.userCount;      // number
```

### Auto-Tracking (No Manual Dependencies)

Unlike React's useMemo or Redux selectors, you don't declare dependencies - Directive tracks them automatically:

```typescript
derive: {
  // Directive automatically knows this depends on `users` and `filter`
  // When either changes, this recomputes
  filteredUsers: (facts) =>
    facts.users.filter(u => u.name.includes(facts.filter)),
}
```

How it works:
1. When you access `system.derive.filteredUsers`, Directive runs the function
2. During execution, it tracks which facts are read (`users`, `filter`)
3. When those facts change, the derivation is marked stale
4. Next access recomputes the value

### Subscribing to Derivation Changes

```typescript
// Subscribe to be notified when derivation changes
const unsubscribe = system.subscribe(["userCount", "status"], () => {
  console.log("Count or status changed!");
  console.log("New count:", system.derive.userCount);
});

// Watch with old/new values
const unwatch = system.watch("userCount", (newValue, oldValue) => {
  console.log(`Count changed from ${oldValue} to ${newValue}`);
});

// Clean up
unsubscribe();
unwatch();
```

### Using Derivations in Constraints

Derivations can be used in constraint conditions:

```typescript
constraints: {
  fetchMoreWhenLow: {
    when: (facts, derived) =>
      derived.userCount < 10 && !facts.isLoading,
    require: { type: "FETCH_MORE_USERS" },
  },
}
```

### Derivations vs Facts

| | Facts | Derivations |
|---|---|---|
| **Storage** | Stored in memory | Computed on demand |
| **Mutation** | Can be mutated | Read-only (computed) |
| **Source** | Set by init, events, resolvers | Calculated from facts |
| **Use case** | Raw state | Transformed/filtered views |

```typescript
// Facts = raw data
facts.users = [{ name: "Alice" }, { name: "Bob" }];
facts.filter = "Ali";

// Derivations = computed views
derive.userCount      // 2 (computed from facts.users)
derive.filteredUsers  // [{ name: "Alice" }] (computed from users + filter)
```

### React Integration

The `useDirective` hook automatically subscribes to derivations:

```tsx
import { useDirective } from "@directive-run/react";

function UserList() {
  // Component re-renders when userCount changes
  const count = useDirective(system, (s) => s.derive.userCount);
  const users = useDirective(system, (s) => s.derive.filteredUsers);

  return (
    <div>
      <p>Showing {count} users</p>
      {users.map(u => <UserCard key={u.id} user={u} />)}
    </div>
  );
}
```

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

// With namespaced modules (object syntax), facts are accessed via their namespace:
createSystem({ modules: { a: mod1, b: mod2 } });
// system.facts.a.count, system.facts.b.count - no collision!
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
import { createTestSystem, mockResolver } from '@directive-run/core/testing';

// Test authModule in isolation
const testSystem = createTestSystem({
  modules: { auth: authModule },
  mocks: {
    resolvers: {
      VALIDATE_TOKEN: mockResolver(() => ({ valid: true })),
    },
  },
});

testSystem.facts.auth.token = "test-token";
await testSystem.settle();

expect(testSystem.facts.auth.isAuthenticated).toBe(true);
```

## Naming Decisions

### Why "Derivations" (Not "Computed" or "Selectors")

The primitive family uses simple nouns: **facts**, **constraints**, **resolvers**, **effects**. "Derive" is a verb used as a noun, but the API surface (`derive:`, `system.derive`) reads cleanly in code.

**Alternatives considered:**

| Term | Why Not |
|------|---------|
| **computed** | Generic adjective, collides with Vue/MobX terminology |
| **selectors** | Implies filtering, not computing &ndash; Redux/Zustand baggage |
| **formulas** | Uncommon in JS ecosystem |
| **views** | Overloaded with UI meaning |
| **projections** | Niche (event sourcing), even harder to say |

**Decision: Keep "derivations."** The precision and uniqueness outweigh the 4-syllable pronunciation friction. The word is typed far more than spoken. `derive` and `system.derive` are concise in code. Renaming to "computed" would cost a major version bump across 150+ files for marginal gain &ndash; and would lose the distinctive identity that sets Directive apart.

If pronunciation becomes a real adoption blocker (conference talks, video tutorials), "computed" is the strongest alternative &ndash; but that's a v2 conversation.

## Feature Lifecycle: Lab → Prod → Deprecated

Directive uses file suffixes to manage feature readiness across source code, docs, navigation, and search indexing.

### Phases

| Phase | Source | Docs | Nav | Embeddings | Bundle |
|-------|--------|------|-----|------------|--------|
| **Lab** | `file.lab.ts` | `page.lab.md` | Commented out | Skipped | Excluded |
| **Prod** | `file.ts` | `page.md` | Listed | Indexed | Included |
| **Deprecated** | `file.deprecated.ts` | `page.md` + banner | Listed with badge | Indexed (migration info) | Included, warns at runtime |

### How It Works

- **Source code:** Barrel files (`index.ts`) only export from `.ts` files. `.lab.ts` files are never referenced in exports, so bundlers exclude them. Type-only imports (`import type`) from `.lab.ts` are fine — they're erased at compile time.
- **Docs pages:** Next.js routes from `page.md`. Renaming to `page.lab.md` removes the route. The embedding generator globs `**/page.md`, so `.lab.md` files are automatically skipped.
- **Navigation:** Comment out the nav entry in `directive-docs: src/lib/navigation.ts` with a note: `// Feature — lab (reason)`.
- **Examples:** Private examples can import directly from `.lab.ts` via relative path. Published packages never reference lab files.

### Conventions

- Always leave a comment at the old export site explaining why it's in lab: `// createObservability moved to observability.lab.ts — re-evaluating vs OTel`
- Keep types exported from the barrel even when runtime code is in lab (other modules may need the types)
- Track all lab/deprecated items in `LAB.md` at the repo root

### Promoting Lab → Prod

1. Rename `file.lab.ts` → `file.ts` and `page.lab.md` → `page.md`
2. Add runtime exports back to barrel files
3. Uncomment nav entry
4. Remove from `LAB.md`

### Demoting Prod → Deprecated

1. Rename `file.ts` → `file.deprecated.ts`
2. Add deprecation banner to docs page
3. Add runtime warning: `console.warn("[Directive] X is deprecated. Use Y instead.")`
4. Add to `LAB.md` with removal target version

## Security: Prototype Pollution Defense

Directive uses a consistent defense-in-depth strategy against prototype pollution across both `@directive-run/core` and `@directive-run/ai`.

### The Threat

Prototype pollution occurs when an attacker injects properties into `Object.prototype`, causing them to appear on every object in the runtime. In a constraint-driven system where objects are merged, iterated, and used as lookup tables, this is especially dangerous:

```typescript
// Attacker pollutes prototype
(Object.prototype as any).__proto__ = maliciousPayload;
(Object.prototype as any).constructor = evilFunction;

// Now every {} has these properties
const merged = {};
merged.constructor; // evilFunction (!)
```

### Defense: `Object.create(null)`

All merged objects, lookup tables, caches, and dynamically-keyed maps use `Object.create(null)` instead of `{}`:

```typescript
// ❌ Vulnerable to prototype pollution
const cache = {};
cache[userInput] = value;        // attacker could set "__proto__"

// ✅ Null-prototype object — no inherited properties
const cache = Object.create(null);
cache[userInput] = value;        // "__proto__" is just a regular key
cache.constructor;               // undefined (no prototype chain)
```

**Where this is applied (53 uses across both packages):**

| Package | File | Count | Purpose |
|---------|------|-------|---------|
| core | `engine.ts` | 7 | Merged schemas, definitions, constraint/resolver maps |
| core | `devtools-ai-bridge.ts` | 1 | Bridge state objects |
| ai | `multi-agent-orchestrator.ts` | 30 | Agent state, DAG contexts, constraint results, internal maps |
| ai | `pattern-serialization.ts` | 3 | Deserialized pattern nodes |
| ai | `pattern-composition.ts` | 5 | DAG execution contexts, upstream outputs |
| ai | `orchestrator-bridge.ts` | 2 | Bridge accessor maps |
| ai | `health-monitor.ts` | 1 | Health state tracking |
| ai | `otel.ts` | 1 | Span attribute maps |
| ai | `provider-routing.ts` | 1 | Provider lookup tables |

### Defense: `BLOCKED_PROPS` Guard

All Proxy `get` handlers check against a `BLOCKED_PROPS` set to prevent prototype-related keys from leaking through:

```typescript
import { BLOCKED_PROPS } from "./tracking.js";
// BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"])

const proxy = new Proxy(target, {
  get(t, prop) {
    if (typeof prop === "string" && BLOCKED_PROPS.has(prop)) {
      return undefined;
    }
    // ... normal handler
  },
});
```

This is applied to all 11 Proxy instances across core (facts, derivations, engine, system).

### Defense: Proxy Trap Hardening

Read-only proxies also define `set`, `deleteProperty`, `defineProperty`, `setPrototypeOf`, and `getPrototypeOf` traps that return safe values:

```typescript
const readOnlyProxy = new Proxy(target, {
  set: () => false,
  deleteProperty: () => false,
  defineProperty: () => false,
  setPrototypeOf: () => false,
  getPrototypeOf: () => null,
});
```

### Defense: Key Validation

- `engine.ts` validates all schema keys against `BLOCKED_PROPS` unconditionally (not gated behind dev mode)
- Schema keys starting with `$` are rejected to prevent collision with internal `$store`/`$snapshot` keys
- The `::` namespace separator cannot appear in JS identifiers, preventing collision with module-namespaced keys
- `patternFromJSON()` filters out `__proto__`, `constructor`, and `prototype` keys when deserializing patterns

### Contributing: Maintaining This Defense

When writing new code that creates objects used as lookup tables or merge targets:

1. **Always** use `Object.create(null)` instead of `{}`
2. **Never** use `Object.assign({}, ...)` — use `Object.assign(Object.create(null), ...)`
3. **Always** add `BLOCKED_PROPS` checks to new Proxy `get` handlers
4. **Always** validate user-provided keys against `BLOCKED_PROPS` before using them as object keys

## Design Rationale Summary

| Decision | Rationale |
|----------|-----------|
| Flat merge | Constraints need full visibility for cross-cutting concerns |
| Module as blueprint | Enables reuse, testing, and composition |
| System as runtime | Separates configuration from definition |
| Namespace convention | Scales flat merge to larger applications |
| Collision detection | Catches errors early in development |
| "Derivations" naming | Precise, unique, clean in code (`derive:`); alternatives are generic or overloaded |
| `Object.create(null)` everywhere | Defense-in-depth against prototype pollution (53 uses) |
| `BLOCKED_PROPS` on all Proxies | Prevents `__proto__`/`constructor` from leaking through reactive layer |

The flat merge isn't a limitation - it's what makes Directive's constraint-driven model work. When you need modules to coordinate based on shared state, the flat merge gives you that capability with zero boilerplate.
