---
name: building-directive-systems
description: "Compose Directive modules into systems: single-module and multi-module createSystem() calls, namespaced fact/derive/event access, cross-module dependencies, initialFacts and hydration, plugins (logging, devtools, persistence, circuit breaker), React adapter hooks (useSelector, useEvent, useSystem, DirectiveProvider), and system lifecycle. Use when creating a system, connecting modules together, adding plugins, or integrating Directive with React."
---

# Building Directive Systems

## Prerequisites

This skill applies when the project uses `@directive-run/core`. If not found in `package.json`, suggest installing it: `npm install @directive-run/core`.

## When Claude Should Use This Skill

**Auto-invoke when the user:**
- Says "create a system", "compose modules", "add plugins", or "connect to React"
- Shows `createSystem()` and asks to extend it with more modules or plugins
- Asks about `useSelector`, `useEvent`, `useSystem`, or `DirectiveProvider`
- Asks how modules share state or read each other's facts
- Asks about system lifecycle, hydration, or dynamic module registration

**Do NOT invoke when:**
- Writing a module for the first time (start with `writing-directive-modules.md`)
- Writing constraints/resolvers only (see `writing-directive-constraints.md`)
- Writing tests (see `testing-directive-code.md`)

---

## Decision Tree: Single or Multi-Module?

```
How many state domains?
├── One → createSystem({ module: myModule })
│          Direct access: system.facts.count
│
└── Two or more → createSystem({ modules: { auth, cart, ui } })
                   Namespaced: system.facts.auth.token

Does module A need to read module B's state in constraints/effects/derivations?
├── No → No crossModuleDeps needed
└── Yes → Declare crossModuleDeps on the consuming module
          Own facts at facts.self.*, other module at facts.otherModule.*
```

---

## System Creation

### Single module

```typescript
import { createSystem } from "@directive-run/core";
import { loggingPlugin, devtoolsPlugin } from "@directive-run/core/plugins";

const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin(), devtoolsPlugin()],
  history: { maxSnapshots: 100 },
});

system.start();
await system.settle();   // Wait for all resolvers to complete
```

### Multi-module

```typescript
const system = createSystem({
  modules: { auth: authModule, cart: cartModule, data: dataModule },
  plugins: [loggingPlugin(), devtoolsPlugin()],
  initialFacts: {
    auth: { token: "restored-token" },
    cart: { items: [] },
  },
  initOrder: "auto",   // "auto" | "declaration" | ["auth", "data", "cart"]
});

system.start();
await system.settle();
```

### Hydration from async source (before start)

```typescript
await system.hydrate(async () => {
  const stored = localStorage.getItem("app-state");

  return stored ? JSON.parse(stored) : {};
});

system.start();
```

### Dynamic module registration at runtime

```typescript
const chatModule = await import("./modules/chat");
system.registerModule("chat", chatModule.default);
// Now: system.facts.chat.*, system.events.chat.*, etc.
```

---

## Accessing System State

### Single module – direct access

```typescript
system.facts.count = 5;
const val = system.facts.count;
const loading = system.derive.isLoading;
system.events.increment();
system.events.setUser({ user: { id: "1", name: "Alice" } });
```

### Multi-module – namespaced access (dot notation always)

```typescript
system.facts.auth.token;
system.facts.cart.items;
system.derive.auth.isAdmin;
system.derive.cart.itemCount;
system.events.auth.login({ token: "abc" });
system.events.cart.addItem({ productId: "p1", qty: 1 });
```

```typescript
// WRONG – internal separator never used in public API
system.facts["auth::token"];
system.facts["auth_token"];

// CORRECT – dot notation through namespace proxy
system.facts.auth.token;
```

### Subscribing and watching

```typescript
// Subscribe to multiple keys
const unsub = system.subscribe(["count", "isLoading"], () => {
  console.log(system.facts.count, system.derive.isLoading);
});

// Multi-module keys use "module.key" format
system.subscribe(["auth.token", "cart.items"], () => { ... });

// Watch a single value with old/new
system.watch("count", (newVal, oldVal) => {
  console.log(`Count: ${oldVal} -> ${newVal}`);
});

// Subscribe to all keys in a module
system.subscribeModule("cart", () => { ... });

// Wait for condition
await system.when((facts) => facts.phase === "done");
await system.when((facts) => facts.auth.isAuthenticated, { timeout: 5000 });
```

### System lifecycle

```typescript
system.start();     // Begins constraint evaluation and reconciliation
system.stop();      // Pauses evaluation, cancels inflight resolvers
system.destroy();   // Full cleanup – subscriptions, plugins, resources
```

Always call `destroy()` when a system is no longer needed (teardown, React unmount, test cleanup).

---

## Cross-Module Dependencies

Export the schema separately so other modules can reference it for type safety.

```typescript
// modules/auth.ts
export const authSchema = {
  facts: {
    token: t.string<string | null>(),
    isAuthenticated: t.boolean(),
  },
} as const;

export const authModule = createModule("auth", {
  schema: authSchema,
  init: (facts) => {
    facts.token = null;
    facts.isAuthenticated = false;
  },
  events: {
    login: (facts, payload) => { facts.token = payload.token; facts.isAuthenticated = true; },
    logout: (facts) => { facts.token = null; facts.isAuthenticated = false; },
  },
});
```

```typescript
// modules/data.ts
import { authSchema } from "./auth";

const dataModule = createModule("data", {
  schema: { facts: { items: t.array(t.string()), loaded: t.boolean() } },
  crossModuleDeps: { auth: authSchema },
  init: (facts) => { facts.items = []; facts.loaded = false; },

  constraints: {
    fetchWhenAuth: {
      when: (facts) => facts.auth.isAuthenticated && !facts.self.loaded,
      require: { type: "FETCH_ITEMS" },
    },
  },

  effects: {
    onAuthChange: {
      run: (facts, prev) => {
        if (prev && prev.auth.isAuthenticated && !facts.auth.isAuthenticated) {
          console.log("User logged out");
        }
      },
    },
  },
});
```

---

## Plugins

### Built-in plugins

```typescript
import {
  loggingPlugin,
  devtoolsPlugin,
  persistencePlugin,
} from "@directive-run/core/plugins";

const plugins = [];

if (process.env.NODE_ENV === "development") {
  plugins.push(loggingPlugin({ verbose: true }));   // Logging first
  plugins.push(devtoolsPlugin({ name: "My App" }));
}

plugins.push(persistencePlugin({
  key: "app-state",
  storage: localStorage,
  exclude: ["authToken", "isLoading"],  // Skip sensitive/transient
  version: 1,
  migrate: (old, version) => old,       // Always version when persisting
}));
```

Plugin order matters – logging first captures all events including those from other plugins.

### Custom plugin

```typescript
import type { DirectivePlugin } from "@directive-run/core";

const myPlugin: DirectivePlugin = {
  name: "my-plugin",
  onInit: (system) => { ... },
  onStart: (system) => { ... },
  onStop: (system) => { ... },
  onSnapshot: (snapshot) => {
    // snapshot.facts, snapshot.changedKeys
  },
  onRequirementEmitted: (requirement) => { ... },
  onResolutionStart: (resolution) => { ... },
  onResolutionComplete: (resolution) => { ... },
  onError: (error, context) => { ... },
};
```

---

## React Adapter

Import from `@directive-run/react`.

### Setup: create system outside React

```typescript
// system.ts – created once, imported anywhere
export const system = createSystem({ module: counterModule });
```

### useSelector – subscribe to state

Re-renders only when the selected value changes (shallow comparison).

```typescript
import { useSelector, useEvent } from "@directive-run/react";

function Counter() {
  const count = useSelector(system, (s) => s.facts.count);
  const doubled = useSelector(system, (s) => s.derive.doubled);

  // Multi-module
  const token = useSelector(system, (s) => s.facts.auth.token);
  const itemCount = useSelector(system, (s) => s.derive.cart.itemCount);

  const events = useEvent(system);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => events.increment()}>+1</button>
    </div>
  );
}
```

### useEvent – dispatch events (stable reference)

```typescript
const events = useEvent(system);
events.increment();
events.auth.login({ token: "abc" });   // Multi-module
```

### useSystem – lifecycle scoped to component

```typescript
import { useSystem } from "@directive-run/react";

function GameBoard() {
  const gameSystem = useSystem({   // Created on mount, destroyed on unmount
    module: gameModule,
    history: true,
  });
  const score = useSelector(gameSystem, (s) => s.facts.score);

  return <div>Score: {score}</div>;
}
```

Use `useSystem` when the system's lifecycle matches a component's lifecycle (wizard, game board, modal form). For app-wide state, create outside React.

### DirectiveProvider – share system via context

```typescript
import { DirectiveProvider, useDirectiveContext } from "@directive-run/react";

function App() {
  return (
    <DirectiveProvider system={system}>
      <Dashboard />
    </DirectiveProvider>
  );
}

function Dashboard() {
  const system = useDirectiveContext();
  const stats = useSelector(system, (s) => s.derive.dashboardStats);

  return <div>{stats.totalUsers} users</div>;
}
```

---

## Critical Anti-Patterns

### 1. Reading facts before settling

```typescript
// WRONG – resolver hasn't completed
system.start();
console.log(system.facts.user);   // null

// CORRECT
system.start();
await system.settle();
console.log(system.facts.user);   // resolved
```

### 2. Forgetting to start the system

```typescript
// WRONG – constraints never evaluate
const system = createSystem({ module: myModule });
console.log(system.facts.phase);  // "idle" – resolvers never ran

// CORRECT
system.start();
await system.settle();
```

### 3. Missing crossModuleDeps

```typescript
// WRONG – facts.auth untyped, no reactive tracking
when: (facts) => facts.auth.isAuthenticated,   // TypeScript error

// CORRECT
crossModuleDeps: { auth: authSchema },
when: (facts) => facts.auth.isAuthenticated,   // Fully typed + tracked
```

### 4. Bare facts.* in cross-module context

```typescript
// WRONG – in cross-module constraints, bare facts has no self properties
when: (facts) => facts.loaded,

// CORRECT
when: (facts) => facts.self.loaded,
```

### 5. Bracket notation for namespaced access

```typescript
// WRONG
system.facts["auth::token"];

// CORRECT
system.facts.auth.token;
```

### 6. Creating system inside a React component without useSystem

```typescript
// WRONG – new system on every render
function Counter() {
  const system = createSystem({ module: counterModule });   // Bug!
}

// CORRECT – module-level or useSystem()
const system = createSystem({ module: counterModule });
```

### 7. The nonexistent useDirective hook

```typescript
// WRONG – this does not exist
const { facts, derive, events } = useDirective(system);

// CORRECT
const count = useSelector(system, (s) => s.facts.count);
const events = useEvent(system);
```

### 8. Selecting too much state in useSelector

```typescript
// WRONG – re-renders on any fact change
const allFacts = useSelector(system, (s) => s.facts);

// CORRECT – select only what you need
const name = useSelector(system, (s) => s.facts.userName);
```

### 9. devtoolsPlugin in production

```typescript
// CORRECT – gate on environment
const plugins = process.env.NODE_ENV === "development"
  ? [loggingPlugin(), devtoolsPlugin()]
  : [];
```

### 10. persistencePlugin without version

```typescript
// WRONG – schema changes break existing users
persistencePlugin({ key: "app", storage: localStorage })

// CORRECT
persistencePlugin({ key: "app", storage: localStorage, version: 1, migrate: (old) => old })
```

---

## Inspecting System State

```typescript
const inspection = system.inspect();
inspection.facts;           // Current fact snapshot
inspection.derivations;     // Derivation values
inspection.requirements;    // Active requirements
inspection.constraintDefs;  // Constraint definitions and state
inspection.resolvers;       // Resolver statuses
inspection.inflight;        // Currently running resolvers
inspection.unmet;           // Requirements with no matching resolver

system.explain("req-123");  // Why this requirement exists
system.isSettled;           // boolean
```

---

## Reference Files

- `multi-module.md` – crossModuleDeps, module schema export pattern, subscribe/watch in multi-module
- `system-api.md` – full system API reference, read(), watch(), when(), lifecycle order
- `plugins.md` – all built-in plugins with full config, custom plugin lifecycle hooks
- `react-adapter.md` – all React hooks with examples, common mistakes, multi-module patterns
