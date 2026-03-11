# System API

The system is created with `createSystem()` and is the runtime that orchestrates modules, constraints, resolvers, and plugins.

## Decision Tree: "How do I interact with the system?"

```
What do you want to do?
├── Read/write state → system.facts.fieldName
├── Read computed values → system.derive.derivationName
├── Dispatch user actions → system.events.eventName(payload)
├── React to changes → system.subscribe() or system.watch()
├── Wait for a condition → system.when()
├── Wait for all async to finish → system.settle()
├── Debug/inspect current state → system.inspect()
├── Control lifecycle → system.start() / system.stop() / system.destroy()
└── Multi-module access → system.facts.moduleName.fieldName
```

## Creating a System

```typescript
import { createSystem } from "@directive-run/core";
import { loggingPlugin, devtoolsPlugin } from "@directive-run/core/plugins";

// Single module – direct access to facts/derive/events
const system = createSystem({
  module: myModule,
  plugins: [loggingPlugin(), devtoolsPlugin()],
  history: { maxSnapshots: 100 },
});

// Multi-module – namespaced access
const system = createSystem({
  modules: {
    auth: authModule,
    cart: cartModule,
    ui: uiModule,
  },
  plugins: [devtoolsPlugin()],
});
```

## Facts: Reading and Writing State

```typescript
// Single module
system.facts.count = 5;
const val = system.facts.count;

// Multi-module – access through module namespace
system.facts.auth.token = "abc123";
system.facts.cart.items = [];
const token = system.facts.auth.token;
```

Facts are proxy-based. Mutations are tracked automatically and trigger derivation recomputation, constraint evaluation, and effect execution.

## Derivations: Reading Computed Values

```typescript
// Single module
const loading = system.derive.isLoading;
const display = system.derive.displayName;

// Multi-module
const isAdmin = system.derive.auth.isAdmin;
const total = system.derive.cart.totalPrice;
```

Derivations are read-only. They recompute lazily when their tracked facts change.

## Events: Dispatching Actions

```typescript
// Single module
system.events.increment();
system.events.setUser({ user: { id: "1", name: "Alice" } });

// Multi-module
system.events.auth.login({ email: "alice@example.com" });
system.events.cart.addItem({ productId: "p1", quantity: 2 });
```

Events are synchronous. They mutate facts in the event handler, which triggers the reactive pipeline.

## Subscribing to Changes

```typescript
// Subscribe to specific keys (facts or derivations)
const unsub = system.subscribe(["count", "isLoading"], () => {
  console.log(system.facts.count, system.derive.isLoading);
});

// Watch a single value with old/new
system.watch("count", (newVal, oldVal) => {
  console.log(`Count: ${oldVal} -> ${newVal}`);
});

// Unsubscribe
unsub();
```

## Waiting for Conditions

```typescript
// Wait until a condition is true
await system.when((facts) => facts.phase === "done");

// With timeout – throws if condition not met in time
await system.when((facts) => facts.phase === "done", { timeout: 5000 });
```

## Settling: Waiting for Async Completion

```typescript
system.start();

// Wait for all resolvers and async constraints to complete
await system.settle();

// With timeout
await system.settle(5000); // Throws if not settled in 5s

// Check settlement state synchronously
if (system.isSettled) {
  console.log("All resolvers complete");
}

// Subscribe to settlement changes
const unsub = system.onSettledChange(() => {
  console.log("Settlement:", system.isSettled);
});
```

## Reading by Key

```typescript
// Read fact or derivation by string key
const count = system.read("count");
const isLoading = system.read("isLoading");

// Multi-module – use dot notation
const token = system.read("auth.token");
const total = system.read("cart.totalPrice");
```

## Inspecting System State

```typescript
const inspection = system.inspect();

// Full fact snapshot
inspection.facts;
// { count: 5, phase: "done", user: { id: "1", name: "Alice" } }

// Derivation values
inspection.derivations;
// { isLoading: false, displayName: "Alice" }

// Active requirements
inspection.requirements;
// [{ id: "req-1", type: "FETCH_USER", userId: "1" }]

// Constraint definitions and state
inspection.constraintDefs;
// [{ id: "fetchWhenAuth", priority: 0, disabled: false }]

// Resolver statuses
inspection.resolvers;
// { fetchUser: { state: "success", duration: 150 } }

// Currently inflight resolvers
inspection.inflight;
// [{ id: "req-2", resolverId: "fetchData", startedAt: 1709000000 }]

// Unmet requirements (no matching resolver)
inspection.unmet;

// Explain why a requirement exists
const explanation = system.explain("req-123");
```

## Lifecycle

```typescript
// Start – begins constraint evaluation and reconciliation
system.start();

// Stop – pauses evaluation, cancels inflight resolvers
system.stop();

// Destroy – cleans up all resources, subscriptions, plugins
system.destroy();

// Lifecycle order:
// createSystem() → system.start() → ... → system.stop() → system.destroy()
```

`system.start()` is auto-called in most cases. Call it explicitly when you need to set up subscriptions before the first evaluation cycle.

## Constraint Control at Runtime

```typescript
// Disable a constraint – it won't be evaluated
system.constraints.disable("fetchWhenReady");

// Check if disabled
system.constraints.isDisabled("fetchWhenReady"); // true

// Re-enable – triggers re-evaluation on next cycle
system.constraints.enable("fetchWhenReady");
```

## Common Mistakes

### Reading facts before settling

```typescript
// WRONG – resolver hasn't completed, facts are stale
system.start();
console.log(system.facts.user); // null

// CORRECT – wait for async resolution
system.start();
await system.settle();
console.log(system.facts.user); // { id: "1", name: "Alice" }
```

### Casting facts/derivations unnecessarily

```typescript
// WRONG – the schema already provides types
const profile = system.facts.profile as ResourceState<Profile>;

// CORRECT – types are inferred from the schema
const profile = system.facts.profile;
```

### Using single-line returns without braces

```typescript
// WRONG
system.watch("phase", (val) => { if (val === "done") return; });

// CORRECT
system.watch("phase", (val) => {
  if (val === "done") {
    return;
  }
});
```

### Forgetting to destroy

```typescript
// WRONG – resources leak
function setupSystem() {
  const system = createSystem({ module: myModule });
  system.start();

  return system;
}

// CORRECT – clean up when done
const system = createSystem({ module: myModule });
system.start();
// ... when finished:
system.stop();
system.destroy();
```
