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

// Unmet requirements
inspection.unmet;
// [{ id: "req-1", requirement: { type: "FETCH_USER" }, fromConstraint: "needsUser" }]

// Inflight resolvers
inspection.inflight;
// [{ id: "req-2", resolverId: "fetchData", startedAt: 1709000000 }]

// Facts with meta
inspection.facts;
// [{ key: "userId", meta: { label: "User ID" } }, { key: "count" }]

// Constraints with state + meta
inspection.constraints;
// [{ id: "needsUser", active: true, disabled: false, priority: 0, hitCount: 3, meta: { label: "..." } }]

// Resolver definitions + meta
inspection.resolverDefs;
// [{ id: "fetchUser", requirement: "FETCH_USER", meta: { label: "..." } }]

// Resolver statuses (inflight only)
inspection.resolvers;
// { "req-1": { state: "running" } }

// Effects, derivations, modules — all with optional meta
inspection.effects;     // [{ id: "log", meta: { ... } }]
inspection.derivations; // [{ id: "doubled", meta: { ... } }]
inspection.modules;     // [{ id: "auth", meta: { ... } }]
inspection.events;      // [{ name: "increment", meta: { ... } }]

// Unmet requirements (no matching resolver)
inspection.unmet;

// Explain why a requirement exists (uses meta.label + meta.description)
const explanation = system.explain("req-123");
```

## Definition Meta

Attach optional metadata to any definition for debugging, devtools, and AI context:

```typescript
// On constraints, resolvers, effects — meta field
constraints: {
  needsAuth: {
    when: (f) => !f.user,
    require: { type: "LOGIN" },
    meta: { label: "Requires Auth", category: "auth", tags: ["critical"] },
  },
},

// On derivations — { compute, meta } object form
derive: {
  displayName: {
    compute: (f) => `${f.first} ${f.last}`,
    meta: { label: "Display Name" },
  },
},

// On facts — chainable .meta()
schema: { facts: { email: t.string().meta({ label: "Email", tags: ["pii"] }) } },

// On modules
meta: { label: "Auth Module", category: "auth" },

// O(1) accessor
system.meta.constraint("needsAuth")?.label;  // "Requires Auth"
system.meta.fact("email")?.tags;             // ["pii"]
system.meta.module("auth")?.label;           // "Auth Module"

// Bulk queries
system.meta.byCategory("auth");  // MetaMatch[] — all auth definitions
system.meta.byTag("pii");        // MetaMatch[] — all PII-tagged fields
```

Meta is frozen at registration (Object.create(null) + Object.freeze). Zero hot-path cost. See [Definition Meta docs](https://directive.run/docs/advanced/meta).

## Observation Protocol

Typed event stream for all lifecycle events — enables browser extensions, third-party tools, and test assertions:

```typescript
import type { ObservationEvent } from "@directive-run/core";

const unsub = system.observe((event: ObservationEvent) => {
  if (event.type === "constraint.evaluate") console.log(event.id, event.active);
  if (event.type === "resolver.complete") console.log(event.resolver, event.duration);
  if (event.type === "fact.change") console.log(event.key, event.prev, "→", event.next);
});

// 18 event types: fact.change, constraint.evaluate/error, requirement.created/met/canceled,
// resolver.start/complete/error, effect.run/error, derivation.compute,
// reconcile.start/end, system.init/start/stop/destroy

unsub(); // Stop observing
```

Zero overhead when no observers. Implemented as an internal plugin.

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

## SSR and Hydration

Four mechanisms for populating a system with external state:

```typescript
// 1. initialFacts – simplest, at construction time
const system = createSystem({
  module: myModule,
  initialFacts: { userId: "user-1", name: "Alice" },
});
system.start();

// 2. system.hydrate() – async, before start()
const system = createSystem({ module: myModule });
await system.hydrate(async () => {
  const res = await fetch('/api/state');

  return res.json();
});
system.start();

// 3. system.restore() – sync, applies facts from a snapshot
const system = createSystem({ module: myModule });
system.restore(serverSnapshot);
system.start();

// 4. DirectiveHydrator + useHydratedSystem (React only)
// Server: getDistributableSnapshot() → serialize
// Client: <DirectiveHydrator snapshot={s}><App /></DirectiveHydrator>
//         useHydratedSystem(module) inside App
```

### SSR Lifecycle

```typescript
// Server: create → start → settle → snapshot → destroy
const system = createSystem({
  module: pageModule,
  initialFacts: { userId: req.user.id },
});
system.start();
await system.settle(5000); // Throws on timeout
const snapshot = system.getSnapshot();
system.stop();
system.destroy();
```

### Snapshot Types

- `SystemSnapshot` – facts only, used with `getSnapshot()` / `restore()`
- `DistributableSnapshot` – facts + derivations + metadata + TTL, used with `getDistributableSnapshot()` and `DirectiveHydrator`

### Avoiding Singletons

Never use module-level systems in SSR – they share state across concurrent requests. Always create a fresh system per request and destroy it when done.

## Runtime Dynamics

All four subsystems (constraints, resolvers, derivations, effects) share a uniform dynamic definition interface:

### Enable / Disable (Constraints & Effects only)

```typescript
system.constraints.disable("id");
system.constraints.enable("id");
system.constraints.isDisabled("id");

system.effects.disable("id");
system.effects.enable("id");
system.effects.isEnabled("id");
```

### Register / Assign / Unregister (All 4 subsystems)

```typescript
// Register a new definition at runtime
system.constraints.register("id", { when: ..., require: ... });
system.resolvers.register("id", { requirement: "TYPE", resolve: ... });
system.derive.register("id", (facts) => facts.count * 3);
system.effects.register("id", { run: (facts) => { ... } });

// Override an existing definition
system.constraints.assign("id", { when: ..., require: ... });

// Remove a dynamically registered definition (static = no-op + dev warning)
system.constraints.unregister("id");
```

Semantics: `register` throws if ID exists. `assign` throws if ID doesn't exist. `unregister` on static ID = dev warning, no-op. All three are deferred if called during reconciliation.

### Introspection

```typescript
system.constraints.isDynamic("id");  // true if registered at runtime
system.constraints.listDynamic();    // all dynamic constraint IDs
```

### getOriginal / restoreOriginal

When `assign()` overrides a static definition, the original is saved:

```typescript
system.getOriginal("constraint", "id");    // returns original definition
system.restoreOriginal("constraint", "id"); // restores it, returns true/false
```

### Dynamic Module Registration

```typescript
system.registerModule("chat", chatModule); // adds module to running system
```

See docs: https://directive.run/docs/advanced/runtime

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
