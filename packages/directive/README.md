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
      resolve: async (req, ctx) => {
        const response = await fetch(`/api/users/${ctx.facts.userId}`);
        ctx.facts.user = await response.json();
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
import { DirectiveProvider, useDerivation, useDispatch } from 'directive/react';

function App() {
  return (
    <DirectiveProvider system={system}>
      <UserGreeting />
    </DirectiveProvider>
  );
}

function UserGreeting() {
  const greeting = useDerivation<string>("greeting");
  const isLoggedIn = useDerivation<boolean>("isLoggedIn");

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

### Resolvers

Async handlers that fulfill requirements with retry, timeout, and cancellation.

```typescript
resolvers: {
  fetchData: {
    requirement: "FETCH_DATA",
    retry: { attempts: 3, backoff: "exponential" },
    timeout: 5000,
    resolve: async (req, ctx) => {
      ctx.facts.data = await fetchData(req.id);
    },
  },
},
```

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
      resolve: async (req, ctx) => {
        ctx.facts.user = await api.getUser(ctx.facts.userId);
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
      resolve: async (req, ctx) => {
        ctx.facts.user = await api.getUser(ctx.facts.userId);
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
      resolve: (req, ctx) => {
        ctx.facts.phase = req.to;
        ctx.facts.elapsed = 0;
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
