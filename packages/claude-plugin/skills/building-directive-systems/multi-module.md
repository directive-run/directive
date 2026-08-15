# Multi-Module Systems

> Covers `@directive-run/core` — namespaced multi-module systems, cross-module deps, `facts.self.*`.

How to compose multiple modules into a namespaced system with cross-module type safety.

## Decision Tree: "Single or Multi-Module?"

```
How many state domains?
├── One → createSystem({ module: myModule })
│         Direct access: system.facts.count
│
└── Two or more → createSystem({ modules: { auth, cart, ui } })
                   Namespaced: system.facts.auth.token

Does module A need to read module B's state?
├── No → No crossModuleDeps needed
│
└── Yes → Declare crossModuleDeps on the consuming module
          Own facts at facts.self.*, other at facts.otherModule.*
```

## Creating a Multi-Module System

```typescript
import { createModule, createSystem, t } from "@directive-run/core";

const authModule = createModule("auth", {
  schema: {
    facts: {
      token: t.string<string | null>(),
      isAuthenticated: t.boolean(),
    },
    events: {
      login: { token: t.string() },
      logout: {},
    },
  },
  init: (facts) => {
    facts.token = null;
    facts.isAuthenticated = false;
  },
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
});

const cartModule = createModule("cart", {
  schema: {
    facts: {
      items: t.array(t.object<{ id: string; qty: number }>()),
    },
    derivations: {
      itemCount: t.number(),
    },
  },
  init: (facts) => {
    facts.items = [];
  },
  derive: {
    itemCount: (facts) => facts.items.length,
  },
});

// Multi-module system – namespaced access
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});

system.start();
```

## Accessing Namespaced State

```typescript
// Facts – namespaced under module name
system.facts.auth.token;
system.facts.auth.isAuthenticated;
system.facts.cart.items;

// Derivations – namespaced under module name
system.derive.cart.itemCount;

// Events – namespaced under module name
system.events.auth.login({ token: "abc123" });
system.events.auth.logout();

// Subscribe – use "namespace.key" format
system.subscribe(["auth.token", "cart.items"], () => {
  console.log("auth or cart changed");
});

// Watch – use "namespace.key" format
system.watch("auth.isAuthenticated", (newVal, oldVal) => {
  console.log(`Auth: ${oldVal} -> ${newVal}`);
});

// Subscribe to all keys in a module
system.subscribeModule("cart", () => {
  console.log("anything in cart changed");
});

// Wait for condition – facts are namespaced
await system.when((facts) => facts.auth.isAuthenticated);
```

## Cross-Module Dependencies

When a module needs to read another module's facts in its constraints, effects, or derivations, declare `crossModuleDeps`.

### Extracting the Schema

Export the schema separately from the module so other modules can reference it:

```typescript
// modules/auth.ts
export const authSchema = {
  facts: {
    token: t.string<string | null>(),
    isAuthenticated: t.boolean(),
  },
  events: {
    login: { token: t.string() },
    logout: {},
  },
} as const;

export const authModule = createModule("auth", {
  schema: authSchema,
  init: (facts) => {
    facts.token = null;
    facts.isAuthenticated = false;
  },
  // ...
});
```

### Declaring crossModuleDeps

```typescript
// modules/data.ts
import { authSchema } from "./auth";

const dataModule = createModule("data", {
  schema: {
    facts: {
      items: t.array(t.string()),
      loaded: t.boolean(),
    },
    requirements: {
      FETCH_ITEMS: {},
    },
  },

  // Declare cross-module dependency
  crossModuleDeps: { auth: authSchema },

  init: (facts) => {
    facts.items = [];
    facts.loaded = false;
  },

  // CORRECT – facts.self for own module, facts.auth for cross-module
  constraints: {
    fetchWhenAuth: {
      when: (facts) => facts.auth.isAuthenticated && !facts.self.loaded,
      require: { type: "FETCH_ITEMS" },
    },
  },

  resolvers: {
    fetchItems: {
      requirement: "FETCH_ITEMS",
      resolve: async (req, context) => {
        const res = await fetch("/api/items");
        context.facts.items = await res.json();
        context.facts.loaded = true;
      },
    },
  },

  // Effects also get cross-module facts
  effects: {
    onAuthChange: {
      run: (facts, prevFacts) => {
        if (prev && prev.auth.isAuthenticated && !facts.auth.isAuthenticated) {
          console.log("User logged out, clearing data");
        }
      },
    },
  },
});
```

### `derived` is scoped to the own module

`crossModuleDeps` widens `facts` — it does **not** widen `derived`. A constraint's `when` / `require` receive `derived` as their second argument, an effect's `run` as its third, and in every case it holds only the derivations declared by the module reading it. There is no `derived.auth.*`; the read returns `undefined`.

```typescript
const dataModule = createModule("data", {
  schema: {
    facts: { items: t.array(t.string()) },
    derivations: { isEmpty: t.boolean() },
  },
  crossModuleDeps: { auth: authSchema },

  derive: {
    isEmpty: (facts) => facts.self.items.length === 0,
  },

  constraints: {
    fetchWhenAuth: {
      // facts crosses the boundary; derived does not
      when: (facts, derived) => facts.auth.isAuthenticated && derived.isEmpty,
      require: { type: "FETCH_ITEMS" },
    },
  },
});
```

This is intentional and permanent. A derivation is a module's private computation over its own facts, and two modules are free to declare derivations of the same name from different facts — `derived.total` always means *this* module's `total`, whatever else the system holds. To act on another module's computed value, either declare your own derivation over the cross-module facts you already depend on (`facts.auth.*`), or have the owning module publish the value as a fact.

## Common Mistakes

### Using bare `facts.*` instead of `facts.self.*`

```typescript
// WRONG – in cross-module context, bare facts has no self-module properties
constraints: {
  check: {
    when: (facts) => facts.loaded, // TypeScript error
    require: { type: "FETCH" },
  },
},

// CORRECT – use facts.self for own module
constraints: {
  check: {
    when: (facts) => facts.self.loaded,
    require: { type: "FETCH" },
  },
},
```

### Bracket notation for internal keys

```typescript
// WRONG – the :: separator is internal, never use it directly
system.facts["auth::token"];
system.read("auth::status");

// CORRECT – dot notation through namespace proxy
system.facts.auth.token;
system.read("auth.status");
```

### Forgetting crossModuleDeps

```typescript
// WRONG – facts.auth is untyped without crossModuleDeps
const dataModule = createModule("data", {
  schema: { facts: { items: t.array(t.string()) } },
  constraints: {
    check: {
      when: (facts) => facts.auth.isAuthenticated, // No type info
      require: { type: "FETCH" },
    },
  },
});

// CORRECT – declare the dependency
const dataModule = createModule("data", {
  schema: { facts: { items: t.array(t.string()) } },
  crossModuleDeps: { auth: authSchema },
  constraints: {
    check: {
      when: (facts) => facts.auth.isAuthenticated, // Fully typed
      require: { type: "FETCH" },
    },
  },
});
```

## System Configuration Options

```typescript
const system = createSystem({
  modules: { auth: authModule, cart: cartModule, data: dataModule },

  // Initial facts – applied after init(), before first reconciliation
  initialFacts: {
    auth: { token: "restored-token" },
    cart: { items: cachedItems },
  },

  // Init order – control module initialization sequence
  initOrder: "auto",            // Sort by crossModuleDeps topology (default)
  // initOrder: "declaration",   // Use object key order
  // initOrder: ["auth", "data", "cart"], // Explicit order

  plugins: [loggingPlugin()],
  history: true,
});

// Hydrate from async source (call before start)
await system.hydrate(async () => {
  const stored = localStorage.getItem("app-state");

  return stored ? JSON.parse(stored) : {};
});

system.start();
await system.settle();
```

## Dynamic Module Registration

```typescript
// Lazy-load and register a module at runtime
const chatModule = await import("./modules/chat");
system.registerModule("chat", chatModule.default);

// Now accessible at system.facts.chat.*, system.events.chat.*, etc.
```

## Cross-Module Events

Events are namespaced at the system level. **Prefer the typed events accessor** — it carries autocomplete and per-event payload typing.

```typescript
// Multi-module events — canonical form
system.events.auth.login({ token: "abc" });
system.events.cart.addItem({ id: "item-1", qty: 1 });

// dispatch() is supported when you need to forward a programmatically-built
// event (e.g., replaying a serialized event). The string form
// (system.dispatch("login", payload)) does NOT exist — only the single-arg
// object form is valid.
system.dispatch({ type: "login", token: "abc" });
```

## See also

- [`core-patterns.md`](./core-patterns.md) — start here for the single-module shape before going namespaced
- [`system-api.md`](./system-api.md) — `createSystem({ modules: { ... } })` and the namespaced facts proxy
- [`constraints.md`](./constraints.md) — `crossModuleDeps` for constraints that fire on facts owned by another module
- [`naming.md`](./naming.md) — `facts.self.*` convention; dot-notation vs bracket-notation rules
