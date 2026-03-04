---
title: Module & System
description: Learn how to create modules and systems in Directive - the building blocks of your application.
---

Modules encapsulate state and logic. Systems run modules and provide the runtime. {% .lead %}

{% module-lifecycle-diagram /%}

---

## Creating a Module

A module is created with `createModule`:

```typescript
import { createModule, t } from '@directive-run/core';

// Define a module with its schema and initial values
const counterModule = createModule("counter", {
  schema: {
    facts: {
      count: t.number(),
    },
    derivations: {},
    events: {},
    requirements: {},
  },

  init: (facts) => {
    facts.count = 0;
  },
});
```

### Module Options

| Option | Description |
|--------|-------------|
| `schema` | Type definitions for facts, derivations, events, requirements |
| `init` | Initialize facts with default values |
| `derive` | Computed values |
| `constraints` | Rules that generate requirements |
| `resolvers` | Functions that fulfill requirements |
| `effects` | Side effects that run on changes |
| `snapshotEvents` | Which events create time-travel snapshots (omit to snapshot all) |

---

## Creating a System

A system runs one or more modules:

```typescript
import { createSystem } from '@directive-run/core';

// Single module – facts and derivations are accessed directly
// const system = createSystem({ module: counterModule });

// With plugins and debug options
const system = createSystem({
  module: counterModule,
  plugins: [loggingPlugin(), devtoolsPlugin()],
  debug: { timeTravel: true },
});
```

### System Options

| Option | Description |
|--------|-------------|
| `module` | Single module to run (direct access) |
| `modules` | Multiple modules as `{ name: module }` (namespaced access) |
| `plugins` | Array of plugins |
| `debug` | Debug options (`{ timeTravel, maxSnapshots }`) |
| `errorBoundary` | Error handling strategies per subsystem |
| `initialFacts` | Override initial fact values |
| `tickMs` | Interval in ms for automatic `tick` event dispatch |
| `zeroConfig` | Enable sensible defaults for dev mode |

---

## Initialization Order

Facts are applied in this order, each layer overriding the previous:

```
createModule()     →  init(facts)          →  Schema defaults
createSystem()     →  initialFacts         →  Override init() values
system.hydrate()   →  hydrate callback     →  Override everything (highest precedence)
system.start()     →  Constraints evaluate →  Reconciliation begins
```

`init()` runs during `system.start()` (or `system.initialize()`), not during `createSystem()`. `hydrate()` must be called before `start()` and its values take highest precedence – use it for SSR restoration or persisted state.

---

## System API

### Facts

Read and write facts directly:

```typescript
// Read a fact value
const count = system.facts.count;

// Write a fact (triggers reconciliation)
system.facts.count = 10;

// Batch multiple updates into a single reconciliation
system.batch(() => {
  system.facts.count = 10;
  system.facts.loading = true;
});
```

### Batching

`system.batch()` defers notifications until the callback completes. All fact mutations inside a batch trigger a single reconciliation instead of one per mutation:

```typescript
// Without batch: 3 reconciliation cycles
system.facts.a = 1;
system.facts.b = 2;
system.facts.c = 3;

// With batch: 1 reconciliation cycle
system.batch(() => {
  system.facts.a = 1;
  system.facts.b = 2;
  system.facts.c = 3;
});
```

Batches can nest – only the outermost batch triggers reconciliation. Resolver `resolve()` functions are automatically batched, so multiple fact mutations inside a resolver always coalesce.

### Derivations

Access computed values:

```typescript
// Read a computed derivation (auto-tracked, lazy, cached)
const doubled = system.derive.doubled;
```

### Settle

Wait for all resolvers to complete:

```typescript
// Trigger async work by setting a fact
system.facts.userId = 123;

// Wait for all resolvers to finish before continuing
await system.settle();
```

### Subscribe

React to changes in facts or derivations. Both `subscribe()` and `watch()` auto-detect whether each key is a fact or derivation – you can freely mix them:

```typescript
// Subscribe to specific keys (facts or derivations)
const unsubscribe = system.subscribe(["displayName", "isLoggedIn"], () => {
  console.log('Value changed:', system.derive.displayName);
});

// Mix facts and derivations in one call
const unsub2 = system.subscribe(["userId", "displayName"], () => {
  console.log("userId fact or displayName derivation changed");
});

// Watch a single key with old and new values
const unsub3 = system.watch("displayName", (newValue, prevValue) => {
  console.log(`Changed from "${prevValue}" to "${newValue}"`);
});

// Watch with a custom equality function
const unsub4 = system.watch("items", (newVal, oldVal) => {
  console.log(`Items updated: ${newVal.length} items`);
}, { equalityFn: (a, b) => a.length === b.length });

// Clean up subscriptions when no longer needed
unsubscribe();
unsub3();
```

### When

Wait for a condition to become true. `system.when()` returns a promise that resolves once the predicate passes:

```typescript
// Wait until the system reaches a specific state
await system.when(() => system.facts.status === "ready");

// With a timeout (rejects if condition isn't met in time)
await system.when(() => system.derive.isLoggedIn, { timeout: 5000 });
```

### Events

Dispatch events to update facts:

```typescript
// Dispatch via typed accessor (preferred – autocomplete + type checking)
system.events.increment();
system.events.setUser({ user: newUser });

// Dispatch via object syntax
system.dispatch({ type: "increment" });
system.dispatch({ type: "setUser", user: newUser });
```

Events are defined in the module and handler functions update facts:

```typescript
events: {
  // Simple mutation – increment the count
  increment: (facts) => { facts.count += 1; },

  // Mutation with payload
  setUser: (facts, { user }) => { facts.user = user; },
},
```

### Hydrate

Apply persisted or server-rendered state before starting. Values from `hydrate()` take highest precedence – they override both `init()` and `initialFacts`:

```typescript
// Must be called before system.start()
system.hydrate((facts) => {
  facts.userId = savedState.userId;
  facts.token = savedState.token;
});

system.start();
```

### Snapshot / Restore

Capture and restore system state:

```typescript
// Capture the current state
const snapshot = system.getSnapshot();
// { facts: { userId: 123, user: {...} }, version: 1 }

// Restore to a previous snapshot
system.restore(snapshot);
```

### Lifecycle

```typescript
// Initialize facts/derivations without starting reconciliation (SSR-safe)
system.initialize();

// Start the reconciliation loop
system.start();

// Wait for the first reconciliation to complete
await system.whenReady();

// Stop the reconciliation loop (can be restarted)
system.stop();

// Clean up all resources (irreversible)
system.destroy();
```

### State Flags

```typescript
system.isRunning;      // Whether reconciliation is currently active
system.isSettled;       // Whether all resolvers have completed
system.isInitialized;  // Whether all modules completed initialization
system.isReady;        // Whether system completed first reconciliation

// Subscribe to settled state changes
const unsub = system.onSettledChange(() => {
  console.log('Settled:', system.isSettled);
});
```

### Runtime Control

Disable or enable individual constraints and effects at runtime:

```typescript
// Constraints
system.constraints.disable("expensiveCheck");
system.constraints.enable("expensiveCheck");
system.constraints.isDisabled("expensiveCheck"); // boolean

// Effects
system.effects.disable("analytics");
system.effects.enable("analytics");
system.effects.isEnabled("analytics"); // boolean
```

See [Constraints](/docs/constraints) and [Effects](/docs/effects) for details.

### Inspection

```typescript
// Read a derivation programmatically
const value = system.read("displayName");

// Get detailed system state
const info = system.inspect();
// { unmet, inflight, constraints, resolvers, runHistory? }

// Explain why a requirement exists
const reason = system.explain(requirementId);
```

### Distributable Snapshots

Export derivation data for caching (Redis, JWT, edge KV):

```typescript
const snap = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan'],
  ttlSeconds: 3600,
});

// Watch for changes
const unsub = system.watchDistributableSnapshot(
  { includeDerivations: ['effectivePlan'] },
  (snapshot) => cache.set('plan', snapshot),
);
```

See [Time-Travel & Snapshots](/docs/advanced/time-travel) for full options.

### Run History

When `debug.runHistory` is enabled, the system tracks per-run changelogs:

```typescript
const system = createSystem({
  module: myModule,
  debug: { runHistory: true },
});

// Access the run changelog
system.runHistory; // RunChangelogEntry[] | null
```

### Time-Travel

When `debug.timeTravel` is enabled, `system.debug` exposes the full time-travel API:

```typescript
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true },
});

system.debug?.goBack();
system.debug?.goForward();

// Subscribe to time-travel changes
const unsub = system.onTimeTravelChange(() => {
  console.log('Snapshot index:', system.debug?.currentIndex);
});
```

See [Time-Travel](/docs/advanced/time-travel) for the full API.

---

## Multi-Module Systems

For larger apps, compose multiple modules:

```typescript
// Compose multiple modules into one system
const system = createSystem({
  modules: {
    user: userModule,
    cart: cartModule,
    checkout: checkoutModule,
  },
});

// Facts are namespaced by module name
system.facts.user.userId = 123;
system.facts.cart.items = [...system.facts.cart.items, item];
```

See **[Multi-Module](/docs/advanced/multi-module)** for more details.

---

## Module Factory

Use `createModuleFactory()` when you need multiple instances of the same module definition:

```typescript
import { createModuleFactory, t } from '@directive-run/core';

const chatRoom = createModuleFactory({
  schema: {
    facts: { messages: t.array<string>(), users: t.array<string>() },
    derivations: { count: t.number() },
  },
  init: (facts) => { facts.messages = []; facts.users = []; },
  derive: { count: (facts) => facts.messages.length },
});

const system = createSystem({
  modules: {
    lobby: chatRoom("lobby"),
    support: chatRoom("support"),
  },
});
```

See **[Multi-Module](/docs/advanced/multi-module)** for dynamic registration and factory patterns.

---

## Module Lifecycle

1. `createModule()` creates the module definition
2. `createSystem()` creates the runtime with the module (plugins initialized)
3. `system.start()` applies `initialFacts`/`hydrate` overrides, then triggers the first reconciliation
4. Constraints evaluate, requirements are generated, resolvers execute
5. System settles when all requirements are fulfilled

When facts change, the reconciliation loop runs until all constraints are satisfied.

---

## Next Steps

- **[Facts](/docs/facts)** - State management
- **[Constraints](/docs/constraints)** - Declarative rules
- **[Resolvers](/docs/resolvers)** - Async handling
- **[Derivations](/docs/derivations)** - Computed values
- **[Effects](/docs/effects)** - Side effects
- **[Events](/docs/events)** - Typed event dispatching
