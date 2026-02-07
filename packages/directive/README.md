# Directive

**Constraint-driven runtime for TypeScript.** Declare requirements. Let the runtime resolve them.

## What is Directive?

Directive is a state management library that automatically resolves what your system needs. Instead of imperatively managing state transitions, you:

1. **Declare constraints** - What must be true
2. **Define resolvers** - How to make it true
3. **Let the runtime figure out when** - Automatic reconciliation

## Installation

```bash
npm install directive
# or
pnpm add directive
# or
yarn add directive
```

## Quick Start

```typescript
import { createModule, createSystem, t, type ModuleSchema } from 'directive';

// Define your schema (single source of truth for all types)
const schema = {
  facts: {
    userId: t.number(),
    user: t.any<{ id: number; name: string } | null>(),
  },
  derivations: {
    isLoggedIn: t.boolean(),
    greeting: t.string(),
  },
  events: {},
  requirements: {
    FETCH_USER: {},
  },
} satisfies ModuleSchema;

// Create the module
const userModule = createModule("user", {
  schema,

  init: (facts) => {
    facts.userId = 0;
    facts.user = null;
  },

  // Constraints: Declare what must be true
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && facts.user === null,
      require: { type: "FETCH_USER" },
    },
  },

  // Resolvers: Define how to fulfill requirements
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        const response = await fetch(`/api/users/${context.facts.userId}`);
        context.facts.user = await response.json();
      },
    },
  },

  // Derivations: Computed values with auto-tracking
  derive: {
    isLoggedIn: (facts) => facts.user !== null,
    greeting: (facts) => facts.user ? `Hello, ${facts.user.name}!` : "Please log in",
  },

  // Events: Type-safe state mutations
  events: {},
});

// Create and start the system
const system = createSystem({ module: userModule });
system.start();

// Set userId - the constraint will automatically trigger FETCH_USER
system.facts.userId = 123;

// Wait for resolution
await system.settle();
console.log(system.read("greeting")); // "Hello, John!"
```

## React Integration

```tsx
import { DirectiveProvider, useDerived, useDispatch } from 'directive/react';

function App() {
  return (
    <DirectiveProvider system={system}>
      <UserGreeting />
    </DirectiveProvider>
  );
}

function UserGreeting() {
  const greeting = useDerived<string>("greeting");
  const isLoggedIn = useDerived<boolean>("isLoggedIn");

  return (
    <div>
      <p>{greeting}</p>
      {!isLoggedIn && <LoginButton />}
    </div>
  );
}
```

## Framework Support

Directive works with any framework:

- **React** - `directive/react` - Hooks with useSyncExternalStore
- **Vue** - `directive/vue` - Composables with reactive refs
- **Svelte** - `directive/svelte` - Stores with `$` syntax
- **Solid** - `directive/solid` - Signals with fine-grained reactivity
- **Lit** - `directive/lit` - Reactive Controllers for Web Components

## Key Concepts

### Schema (Single Source of Truth)

The schema declares all types for your module. Only `facts` is required - other sections are optional.

**Three ways to define schemas:**

#### Pattern 1: Schema Builders (`t.*()`)

Directive's built-in type builders with optional runtime validation:

```typescript
import { createModule, t, type ModuleSchema } from 'directive';

const schema = {
  facts: {
    count: t.number().min(0).max(100),
    name: t.string(),
    status: t.enum("idle", "loading", "success", "error"),
    user: t.nullable(t.object<User>()),
  },
  derivations: { doubled: t.number() },
  events: { increment: {} },
  requirements: { FETCH: { id: t.string() } },
} satisfies ModuleSchema;
```

Available builders:
- `t.string<T>()` - String (optionally narrowed to literal union)
- `t.number()` - Number with `.min()`, `.max()` chainable validators
- `t.boolean()` - Boolean
- `t.array<T>()` - Array with `.of()`, `.nonEmpty()`, `.minLength()`, `.maxLength()`
- `t.object<T>()` - Object with `.shape()`, `.nonNull()`, `.hasKeys()`
- `t.enum(...values)` - String enum from literal values
- `t.literal(value)` - Exact value matching
- `t.nullable(type)` - `T | null`
- `t.optional(type)` - `T | undefined`
- `t.any<T>()` - Escape hatch (bypasses validation, use sparingly)

#### Pattern 2: Type Assertions (`{} as {}`)

For type-only definitions without runtime validation:

```typescript
const schema = {
  facts: {} as { count: number; name: string },
  derivations: {} as { doubled: number },
  events: {} as { increment: {}; setName: { name: string } },
  requirements: {} as { FETCH: { id: string } },
} satisfies ModuleSchema;
```

**Note:** Type assertion schemas produce console warnings for unknown keys. This is expected behavior - the types exist only at compile time.

#### Pattern 3: Zod Schemas

For rich runtime validation with Zod:

```typescript
import { z } from 'zod';

const schema = {
  facts: {
    email: z.string().email(),
    age: z.number().min(0).max(150),
    user: z.object({ id: z.number(), name: z.string() }).nullable(),
  },
  derivations: { isValid: z.boolean() },
  events: { updateEmail: { email: z.string().email() } },
  requirements: {},
} satisfies ModuleSchema;
```

#### Runtime Validation

Enable runtime validation with the `validate` option:

```typescript
const { facts } = createFacts({
  schema,
  validate: true,  // Default: process.env.NODE_ENV !== 'production'
});

// With validation enabled, this throws:
facts.count = "not a number"; // Error: Validation failed for "count": expected number

// Validation works with t.*(), Zod, but NOT XState-style (no runtime info)
```

Validation is enabled by default in development and disabled in production for performance.

#### Mixing Patterns

You can mix all three patterns in the same schema:

```typescript
const schema = {
  facts: {
    count: t.number(),                    // t.*() for simple types
    email: z.string().email(),            // Zod for complex validation
  },
  derivations: {} as { doubled: number }, // XState-style for type-only
  events: { increment: {} },
  requirements: {},
} satisfies ModuleSchema;
```

### Facts

The source of truth. A typed key-value store with batch updates and subscriptions.

```typescript
system.facts.count = 42;           // Set a fact
const value = system.facts.count;  // Get a fact
```

### Constraints

Rules that produce requirements when conditions aren't met.

```typescript
constraints: {
  needsData: {
    when: (facts) => facts.dataId && !facts.data,
    require: (facts) => ({ type: "FETCH_DATA", id: facts.dataId }),
  },
},
```

#### Constraint Properties

| Property | Type | Description |
|----------|------|-------------|
| `when` | `(facts) => boolean \| Promise<boolean>` | Condition — returns true when the constraint is active |
| `require` | `Requirement \| Requirement[] \| (facts) => Requirement \| Requirement[] \| null` | What to produce when `when` is true |
| `priority` | `number` | Evaluation order (higher runs first, default: 0) |
| `after` | `string[]` | Constraint IDs that must resolve before this one evaluates |
| `async` | `boolean` | Mark as async (avoids runtime detection overhead) |
| `timeout` | `number` | Timeout in ms for async `when()` evaluation (default: 5000) |

#### Auto-Tracking

Constraint `when()` functions are auto-tracked — Directive records which facts are read during evaluation. On subsequent reconciliation cycles, only constraints affected by changed facts are re-evaluated (incremental evaluation).

#### Priority

Higher priority constraints are evaluated first. Use this when evaluation order matters but there's no data dependency between constraints:

```typescript
constraints: {
  emergency: {
    priority: 100,  // Evaluated first
    when: (facts) => facts.temperature > 200,
    require: { type: "EMERGENCY_SHUTDOWN" },
  },
  routine: {
    priority: 10,   // Evaluated after emergency
    when: (facts) => facts.needsMaintenance,
    require: { type: "SCHEDULE_MAINTENANCE" },
  },
},
```

#### Require Variants

The `require` field supports multiple forms:

```typescript
constraints: {
  // Static object — always produces the same requirement
  simple: {
    when: (facts) => !facts.data,
    require: { type: "FETCH_DATA" },
  },

  // Function — dynamic requirement based on current facts
  dynamic: {
    when: (facts) => facts.userId && !facts.user,
    require: (facts) => ({ type: "FETCH_USER", userId: facts.userId }),
  },

  // Array — produce multiple requirements at once
  multiple: {
    when: (facts) => facts.isNewUser,
    require: [
      { type: "SEND_WELCOME_EMAIL" },
      { type: "CREATE_DEFAULT_SETTINGS" },
    ],
  },

  // Conditional — function returning null to skip
  conditional: {
    when: (facts) => facts.needsSync,
    require: (facts) => facts.isCritical
      ? [{ type: "SYNC_NOW" }, { type: "NOTIFY_ADMIN" }]
      : null,  // No requirement produced
  },
},
```

#### Async Constraints

The `when()` function can be async for conditions that require I/O (e.g., checking external state). Mark with `async: true` to avoid runtime detection overhead:

```typescript
constraints: {
  needsRefresh: {
    async: true,
    timeout: 3000,  // Override default 5s timeout
    when: async (facts) => {
      const lastSync = facts.lastSyncAt;
      return Date.now() - lastSync > 60000;
    },
    require: { type: "REFRESH_DATA" },
  },
},
```

If you omit `async: true` and `when()` returns a Promise, Directive detects it at runtime and logs a dev warning. Async constraints within the same evaluation cycle run in parallel.

#### Constraint Ordering (`after`)

Control the sequence of resolver execution using the `after` property. This is useful when one operation must complete before another begins.

```typescript
constraints: {
  // First: Run credit check
  creditCheck: {
    when: (facts) => facts.step >= 2 && !facts.creditScore,
    require: { type: "RUN_CREDIT_CHECK" },
  },
  // Second: Only verify address after credit check completes
  addressVerification: {
    after: ["creditCheck"],  // Wait for creditCheck's resolver to complete
    when: (facts) => facts.step >= 2 && !facts.addressVerified,
    require: { type: "VERIFY_ADDRESS" },
  },
  // Third: Final approval after both previous steps
  finalApproval: {
    after: ["creditCheck", "addressVerification"],
    when: (facts) => facts.creditScore && facts.addressVerified,
    require: { type: "FINAL_APPROVAL" },
  },
},
```

**Behavior:**
- If constraint B has `after: ["A"]`, B's `when()` is not called until A's resolver completes
- If A's `when()` returns false (no requirement), B proceeds immediately—nothing to wait for
- If A's resolver fails, B remains blocked until A succeeds (retries apply)
- Cycles are detected at startup: `"[Directive] Constraint cycle detected: A → B → A"`

**Priority vs `after`:**
- `after` always takes precedence—a constraint with `after: ["A"]` will always wait for A, regardless of priority
- `priority` only affects ordering among constraints that have no `after` dependencies on each other
- Constraints with the same priority and no mutual `after` dependencies may run in parallel

**Use cases:**
- Multi-step workflows (onboarding, checkout, verification)
- Dependent API calls where order matters
- Chained operations where later steps need data from earlier ones


### Resolvers

Async handlers that fulfill requirements with retry, timeout, cancellation, and batching.

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,
    resolve: async (req, context) => {
      context.facts.data = await fetchData(req.id);
    },
  },
},
```

#### Resolver Properties

| Property | Type | Description |
|----------|------|-------------|
| `requirement` | `string \| (req) => req is R` | Which requirements this resolver handles |
| `resolve` | `(req, context) => Promise<void>` | Handler for single requirements |
| `key` | `(req) => string` | Custom deduplication key (prevents duplicate resolution) |
| `retry` | `RetryPolicy` | Retry configuration (see below) |
| `timeout` | `number` | Timeout in ms for resolver execution |
| `batch` | `BatchConfig` | Batching configuration (see below) |
| `resolveBatch` | `(reqs, context) => Promise<void>` | All-or-nothing batch handler |
| `resolveBatchWithResults` | `(reqs, context) => Promise<BatchItemResult[]>` | Per-item batch handler |

#### Resolver Context (`context`)

Every resolver receives a context object with:

```typescript
resolve: async (req, context) => {
  context.facts;        // Read/write facts (mutations are auto-batched)
  context.signal;       // AbortSignal — check context.signal.aborted or pass to fetch()
  context.snapshot();   // Get a read-only snapshot of current facts
}
```

Fact mutations inside `resolve` are automatically batched — all synchronous writes are coalesced into a single notification.

#### Dynamic Requirement Matching

The `requirement` field accepts a string or a function. The string form matches `req.type` directly. The function form lets you match dynamically — useful for wildcards, prefix matching, or matching on payload fields:

```typescript
resolvers: {
  // String: exact match on req.type
  fetchUser: {
    requirement: "FETCH_USER",
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: prefix match — handles any "API_*" requirement
  apiHandler: {
    requirement: (req): req is Requirement => req.type.startsWith("API_"),
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: match on payload fields
  highPriorityFetch: {
    requirement: (req): req is Requirement =>
      req.type === "FETCH" && req.priority === "high",
    resolve: async (req, context) => { /* ... */ },
  },

  // Function: catch-all wildcard
  fallback: {
    requirement: (req): req is Requirement => true,
    resolve: async (req, context) => {
      console.warn(`Unhandled requirement: ${req.type}`);
    },
  },
},
```

**Note:** Resolvers are checked in definition order. The first matching resolver wins, so place specific matchers before wildcards.

#### Deduplication Keys

By default, requirements are deduplicated by `constraintName:type`. Use `key` to customize when the same requirement type can have multiple distinct instances:

```typescript
resolvers: {
  fetchUser: {
    requirement: "FETCH_USER",
    key: (req) => `fetch-user-${req.userId}`,  // Dedupe per user
    resolve: async (req, context) => {
      context.facts.user = await api.getUser(req.userId);
    },
  },
},
```

#### Retry Policies

Configure automatic retries with backoff strategies:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: {
      attempts: 3,            // Max attempts (default: 1)
      backoff: "exponential",  // "none" | "linear" | "exponential"
      initialDelay: 100,       // First retry delay in ms (default: 100)
      maxDelay: 30000,         // Cap delay at 30s (default: 30000)
    },
    resolve: async (req, context) => { /* ... */ },
  },
},
```

Backoff calculation:
- `"none"` — constant delay (`initialDelay` every time)
- `"linear"` — `initialDelay * attempt` (100ms, 200ms, 300ms...)
- `"exponential"` — `initialDelay * 2^(attempt-1)` (100ms, 200ms, 400ms...)

Retries are AbortSignal-aware — cancelling a resolver immediately interrupts retry sleep.

#### Cancellation

Resolvers receive an `AbortSignal` via `context.signal`. Pass it to fetch calls or check it in long-running operations:

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    resolve: async (req, context) => {
      // Automatically cancelled if requirement is no longer needed
      const res = await fetch(`/api/data/${req.id}`, { signal: context.signal });
      context.facts.data = await res.json();
    },
  },
},
```

When a constraint's `when()` becomes false while its resolver is running, the resolver is cancelled via the AbortSignal.

#### Batched Resolution

Prevent N+1 problems by collecting requirements that match the same resolver over a time window, then resolving them in a single call:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: {
      enabled: true,
      windowMs: 50,       // Collect for 50ms before processing
      maxSize: 100,       // Max batch size (default: unlimited)
      timeoutMs: 10000,   // Per-batch timeout (overrides resolver timeout)
    },
    // All-or-nothing: if this throws, all requirements in the batch fail
    resolveBatch: async (reqs, context) => {
      const ids = reqs.map(r => r.userId);
      const users = await api.getUsersBatch(ids);
      users.forEach(user => { context.facts[`user_${user.id}`] = user; });
    },
  },
},
```

For partial failure handling, use `resolveBatchWithResults`:

```typescript
resolvers: {
  fetchUsers: {
    requirement: "FETCH_USER",
    batch: { enabled: true, windowMs: 50 },
    // Per-item results: some can succeed while others fail
    resolveBatchWithResults: async (reqs, context) => {
      return Promise.all(reqs.map(async (req) => {
        try {
          const user = await api.getUser(req.userId);
          context.facts[`user_${user.id}`] = user;
          return { success: true };
        } catch (error) {
          return { success: false, error };
        }
      }));
    },
  },
},
```

The returned results array **must** match the order of the input requirements.

### Derivations

Computed values with automatic dependency tracking.

```typescript
derive: {
  total: (facts) => facts.price * facts.quantity,
  // Derivations can depend on other derivations
  totalWithTax: (facts, derive) => derive.total * 1.1,
},
```

**Note on composition:** When a derivation depends only on other derivations (not facts directly), you should touch at least one fact to establish proper dependency tracking:

```typescript
derive: {
  sum: (facts) => facts.a + facts.b,
  // Touch facts.a to track dependencies, even though we use derive.sum
  doubled: (facts, derive) => { facts.a; return derive.sum * 2; },
},
```

### Events

Type-safe state mutations with payloads from schema.

```typescript
events: {
  increment: (facts) => { facts.count += 1; },
  addItem: (facts, { item }) => { facts.items.push(item); },
},

// Dispatch events
system.dispatch({ type: "increment" });
system.dispatch({ type: "addItem", item: "new item" });
```

### Runtime Control

Disable or enable constraints and effects at runtime:

```typescript
// Constraints
system.constraints.disable("expensiveCheck");
system.constraints.enable("expensiveCheck");

// Effects
system.effects.disable("analytics");
system.effects.enable("analytics");
system.effects.isEnabled("analytics"); // true
```

---

## Multi-Module Architecture

Directive uses a **flat merge** architecture where all modules share one facts store. This is intentional - constraints need a complete view of the world to decide what requirements are needed.

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

If modules were isolated, a constraint couldn't check multiple conditions across domains:

```typescript
// This constraint needs visibility into BOTH auth and data modules
constraints: {
  fetchUserData: {
    when: (facts) => facts.auth_isAuthenticated && !facts.data_user,
    require: { type: "FETCH_USER_DATA" },
  },
},
```

### Collision Protection

If two modules define the same fact key, you'll get a dev-mode error:

```typescript
const mod1 = createModule("a", { schema: { facts: { count: t.number() } } });
const mod2 = createModule("b", { schema: { facts: { count: t.number() } } });

// With namespaced modules (object syntax), facts are accessed via their namespace:
createSystem({ modules: { a: mod1, b: mod2 } });
// system.facts.a.count, system.facts.b.count - no collision!
```

### Comparison with Other Libraries

| Library | State Model | Module Isolation |
|---------|-------------|------------------|
| **Redux** | Single store, slices | Slices isolated, explicit connections |
| **Zustand** | Multiple stores | Completely isolated |
| **XState** | Actors | Completely isolated, message passing |
| **Directive** | Single store, merged modules | No isolation (intentional) |

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for a deep dive into the design rationale.

## Namespace Conventions

For multi-module applications, use the `moduleName_factName` pattern to prevent collisions and improve clarity:

```typescript
const authModule = createModule("auth", {
  schema: {
    facts: {
      auth_token: t.string().nullable(),
      auth_user: t.object<User>().nullable(),
      auth_isAuthenticated: t.boolean(),
    },
    // ...
  },
});

const dataModule = createModule("data", {
  schema: {
    facts: {
      data_items: t.array<Item>(),
      data_loading: t.boolean(),
      data_error: t.string().nullable(),
    },
    // ...
  },
  constraints: {
    fetchItems: {
      // Cross-module constraint - can read auth facts
      when: (facts) => facts.auth_isAuthenticated && facts.data_items.length === 0,
      require: { type: "FETCH_ITEMS" },
    },
  },
});
```

### When to Use Namespacing

| # Modules | Recommendation |
|-----------|----------------|
| 1-2 | Optional - use if you prefer consistency |
| 3-5 | Recommended - prevents accidental collisions |
| 6+ | Required - consider splitting into separate systems |

### Type-Safe Cross-Module Access

When constraints or effects need to read facts from other modules, create a combined type and helper:

```typescript
// types.ts - Define combined facts type
type CombinedFacts = {
  auth_isAuthenticated: boolean;
  auth_user: User | null;
  data_users: UserData[];
  data_loading: boolean;
};

function asCombined<T>(facts: T): CombinedFacts & T {
  return facts as CombinedFacts & T;
}

// data.ts - Type-safe cross-module constraint
import { asCombined } from "./types";

constraints: {
  fetchWhenAuth: {
    when: (facts) => {
      const combined = asCombined(facts);
      return combined.auth_isAuthenticated && combined.data_users.length === 0;
    },
    require: { type: "FETCH_USERS" },
  },
},
```

This pattern gives you:
- Full autocomplete for cross-module facts
- Type errors if you access non-existent facts
- Single source of truth for combined types

## Comparison

| Feature | Directive | XState | Redux | Zustand | React Query |
|---------|-----------|--------|-------|---------|-------------|
| Async built-in | Yes | Via actors | Middleware | Manual | Yes |
| Auto-tracking | Yes | No | No | No | No |
| Retry/timeout | Built-in | Manual | Manual | Manual | Built-in |
| Cancellation | Built-in | Via actors | Manual | Manual | Built-in |
| Type inference | Full | Good | Partial | Good | Good |
| Time-travel | Built-in | Via inspector | DevTools | No | No |

## Plugins

```typescript
import { loggingPlugin, devtoolsPlugin, persistencePlugin } from 'directive/plugins';

const system = createSystem({
  module: myModule,
  plugins: [
    loggingPlugin({ level: "debug" }),
    devtoolsPlugin({ name: "my-app" }),
    persistencePlugin({ storage: localStorage, key: "app-state" }),
  ],
});
```

## Testing

```typescript
import { createTestSystem, mockResolver } from 'directive/testing';

const system = createTestSystem({
  modules: { my: myModule },
  mocks: {
    fetchUser: mockResolver(() => ({ id: 1, name: "Test" })),
  },
});

system.facts.userId = 1;
await system.settle();
expect(system.facts.user).toEqual({ id: 1, name: "Test" });
```

## Distributable Snapshots

Directive centralizes your business rules, but computed state often needs checking in places where running the full runtime is impractical—API routes, edge functions, background jobs. **Distributable snapshots** solve this by producing serializable objects containing computed derivation values.

```typescript
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature', 'limits'],
  ttlSeconds: 3600,
});
// {
//   data: { effectivePlan: "pro", canUseFeature: { api: true, export: true }, limits: {...} },
//   createdAt: 1706745600000,
//   expiresAt: 1706749200000
// }
```

### Use Case: Redis Caching

Cache expensive entitlement computations and check them in API routes without running Directive:

```typescript
// On login or plan change - compute and cache
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature', 'apiRateLimit'],
  ttlSeconds: 3600, // 1 hour
  includeVersion: true, // For cache invalidation
});
await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));

// In API routes - no Directive runtime needed
async function checkEntitlements(userId: string) {
  const cached = await redis.get(`entitlements:${userId}`);
  if (!cached) throw new UnauthorizedError('Session expired');

  const snapshot = JSON.parse(cached);

  // Check expiration
  if (snapshot.expiresAt && Date.now() > snapshot.expiresAt) {
    throw new UnauthorizedError('Session expired');
  }

  return snapshot.data;
}

// Usage in route handler
app.post('/api/export', async (req, res) => {
  const entitlements = await checkEntitlements(req.userId);
  if (!entitlements.canUseFeature.export) {
    return res.status(403).json({ error: 'Export not available on your plan' });
  }
  // ... proceed with export
});
```

### Use Case: JWT Claims

Embed computed permissions in JWTs for stateless authorization:

```typescript
// Token generation
function generateToken(system: System) {
  const snapshot = system.getDistributableSnapshot({
    includeDerivations: ['permissions', 'role'],
    includeFacts: ['userId', 'teamId'],
    metadata: { purpose: 'api-access' },
  });

  return jwt.sign({
    ...snapshot.data,
    iat: Math.floor(snapshot.createdAt / 1000),
  }, SECRET, { expiresIn: '1h' });
}

// Token verification - no database needed
function verifyToken(token: string) {
  const decoded = jwt.verify(token, SECRET);
  // decoded.permissions, decoded.role available directly
  return decoded;
}
```

### Use Case: SSR Hydration

Pass computed state to client without re-running rules:

```typescript
// Server: compute once
export async function getServerSideProps({ req }) {
  const system = await initializeSystem(req.session.userId);
  await system.settle();

  const snapshot = system.getDistributableSnapshot({
    includeDerivations: ['userProfile', 'preferences', 'notifications'],
  });

  return {
    props: {
      initialState: snapshot.data,
    },
  };
}

// Client: use directly, hydrate later if needed
function Page({ initialState }) {
  // Use initialState.userProfile immediately
  // Optionally hydrate full Directive system in background
}
```

### API Reference

```typescript
interface DistributableSnapshotOptions {
  /** Derivation keys to include (default: all) */
  includeDerivations?: string[];
  /** Derivation keys to exclude */
  excludeDerivations?: string[];
  /** Fact keys to include (default: none - derivations only) */
  includeFacts?: string[];
  /** TTL in seconds - sets expiresAt timestamp */
  ttlSeconds?: number;
  /** Custom metadata (e.g., purpose, source) */
  metadata?: Record<string, unknown>;
  /** Include version hash for cache invalidation */
  includeVersion?: boolean;
}

interface DistributableSnapshot<T> {
  data: T;                     // Computed values
  createdAt: number;           // ms since epoch
  expiresAt?: number;          // ms since epoch (if ttlSeconds set)
  version?: string;            // Hash for cache invalidation
  metadata?: Record<string, unknown>;
}
```

### When to Use

| Scenario | Recommended Approach |
|----------|---------------------|
| Checking permissions in API routes | Redis cache with TTL |
| Stateless microservices | JWT claims |
| Server-side rendering | SSR hydration |
| Edge functions | Short-lived cache |
| Background jobs | Redis or message payload |

### Utility Functions

Directive provides helper functions for working with distributable snapshots:

```typescript
import {
  isSnapshotExpired,
  validateSnapshot,
  type DistributableSnapshotLike  // For typing custom snapshot structures
} from 'directive';

// Check if expired (returns boolean)
if (isSnapshotExpired(snapshot)) {
  // Refresh the snapshot
}

// Validate and extract data (throws if malformed or expired)
try {
  const data = validateSnapshot(snapshot);
  // Use data.canUseFeature, etc.
} catch (e) {
  // Snapshot invalid or expired, refresh it
}

// Type your own snapshot structures
interface MySnapshot extends DistributableSnapshotLike<{ permissions: string[] }> {
  // Additional custom fields...
}
```

**Note:** `validateSnapshot` performs structural validation—it will throw if the snapshot is missing required `data` or `createdAt` properties, making it safe to use with untrusted input (e.g., parsed from Redis/JWT).

### When NOT to Use

- **Reactive UI** - Use framework adapters (`directive/react`, etc.) instead
- **Real-time updates** - Snapshots are point-in-time; use `subscribe()` for live data
- **Sensitive data** - Be mindful of what you include in JWTs (they're readable)

## Migration Guides

### From Zustand

```typescript
// Zustand
import { create } from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  fetchUser: async (id) => {
    const user = await api.getUser(id);
    set({ user });
  },
}));

// Directive equivalent
import { createModule, createSystem, t, type ModuleSchema } from 'directive';

const schema = {
  facts: { count: t.number(), userId: t.number(), user: t.any<User | null>() },
  derivations: {},
  events: { increment: {} },
  requirements: { FETCH_USER: {} },
} satisfies ModuleSchema;

const store = createModule("store", {
  schema,
  init: (facts) => { facts.count = 0; facts.userId = 0; facts.user = null; },
  derive: {},
  events: {
    increment: (facts) => { facts.count += 1; },
  },
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && facts.user === null,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});

// Key difference: Directive automatically fetches user when userId is set
system.facts.userId = 123; // Triggers FETCH_USER constraint
await system.settle(); // Wait for async resolution
```

### From Redux Toolkit

```typescript
// Redux Toolkit
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

const fetchUser = createAsyncThunk('user/fetch', async (userId) => {
  return await api.getUser(userId);
});

const userSlice = createSlice({
  name: 'user',
  initialState: { user: null, loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUser.pending, (state) => { state.loading = true; })
      .addCase(fetchUser.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
      })
      .addCase(fetchUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  },
});

// Directive equivalent - loading/error states are automatic
const schema = {
  facts: { userId: t.number(), user: t.any<User | null>() },
  derivations: {},
  events: {},
  requirements: { FETCH_USER: {} },
} satisfies ModuleSchema;

const userModule = createModule("user", {
  schema,
  init: (facts) => { facts.userId = 0; facts.user = null; },
  derive: {},
  events: {},
  constraints: {
    needsUser: {
      when: (facts) => facts.userId > 0 && facts.user === null,
      require: { type: "FETCH_USER" },
    },
  },
  resolvers: {
    fetchUser: {
      requirement: "FETCH_USER",
      retry: { attempts: 3, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.user = await api.getUser(context.facts.userId);
      },
    },
  },
});

// Use createRequirementStatusPlugin for loading/error tracking
import { createRequirementStatusPlugin } from 'directive';
const statusPlugin = createRequirementStatusPlugin();
const system = createSystem({ module: userModule, plugins: [statusPlugin.plugin] });

// Check loading state
const status = statusPlugin.getStatus("FETCH_USER");
console.log(status.isLoading, status.hasError, status.lastError);
```

### From XState

```typescript
// XState
import { createMachine, assign } from 'xstate';

const trafficLightMachine = createMachine({
  id: 'trafficLight',
  initial: 'red',
  context: { elapsed: 0 },
  states: {
    red: { after: { 30000: 'green' } },
    green: { after: { 25000: 'yellow' } },
    yellow: { after: { 5000: 'red' } },
  },
});

// Directive equivalent - constraints drive transitions
const schema = {
  facts: {
    phase: t.string<"red" | "green" | "yellow">(),
    elapsed: t.number(),
  },
  derivations: {},
  events: {},
  requirements: { TRANSITION: { to: t.string<"red" | "green" | "yellow">() } },
} satisfies ModuleSchema;

const trafficLight = createModule("traffic-light", {
  schema,
  init: (facts) => { facts.phase = "red"; facts.elapsed = 0; },
  derive: {},
  events: {},
  constraints: {
    redToGreen: {
      when: (facts) => facts.phase === "red" && facts.elapsed >= 30,
      require: { type: "TRANSITION", to: "green" },
    },
    greenToYellow: {
      when: (facts) => facts.phase === "green" && facts.elapsed >= 25,
      require: { type: "TRANSITION", to: "yellow" },
    },
    yellowToRed: {
      when: (facts) => facts.phase === "yellow" && facts.elapsed >= 5,
      require: { type: "TRANSITION", to: "red" },
    },
  },
  resolvers: {
    transition: {
      requirement: "TRANSITION",
      resolve: (req, context) => {
        context.facts.phase = req.to;
        context.facts.elapsed = 0;
      },
    },
  },
});

// Key difference: Constraints are declarative and composable
// Multiple constraints can be active simultaneously with priority ordering
```

## Documentation

- [Full Documentation](https://directive.run/docs)
- [API Reference](https://directive.run/api)
- [Examples](https://github.com/DirectiveRun/DirectiveJS/tree/main/examples)

## License

MIT
