---
title: Core API Reference
description: Complete API reference for Directive's core functions.
---

Core functions and types for Directive. {% .lead %}

---

## createModule

Create a module definition.

```typescript
// Define a module's schema, constraints, resolvers, and effects
function createModule<M extends ModuleSchema>(
  name: string,       // unique identifier for this module
  config: ModuleConfig<M>
): ModuleDef<M>
```

### createModule Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique module identifier |
| `config` | `ModuleConfig` | Module configuration |

### Config Options

| Property | Type | Description |
|----------|------|-------------|
| `schema` | `Schema` | Type definitions for facts, events, requirements |
| `init` | `(facts) => void` | Initialize facts with default values |
| `derive` | `Record<string, Derivation>` | Computed values |
| `effects` | `Record<string, Effect>` | Side effect handlers |
| `constraints` | `Record<string, Constraint>` | Declarative rules |
| `resolvers` | `Record<string, Resolver>` | Requirement handlers |

---

## createModuleFactory

Create a factory that produces named module instances from a single definition.

```typescript
function createModuleFactory<M extends ModuleSchema>(
  config: ModuleConfig<M>
): (name: string) => ModuleDef<M>
```

### createModuleFactory Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ModuleConfig` | Module configuration (same as `createModule`, without `name`) |

### Returns

A function `(name: string) => ModuleDef<M>` that creates named instances.

### Example

```typescript
const chatRoom = createModuleFactory({
  schema: { facts: { messages: t.array<string>() } },
  init: (facts) => { facts.messages = []; },
});

const system = createSystem({
  modules: {
    lobby: chatRoom("lobby"),
    support: chatRoom("support"),
  },
});
```

---

## createSystem

Create a runtime system.

```typescript
// Create a live runtime from a module definition
function createSystem<M extends ModuleSchema>(
  config: SystemConfig<M>
): SingleModuleSystem<M>
```

### createSystem Parameters

| Property | Type | Description |
|----------|------|-------------|
| `module` | `Module` | Module definition |
| `plugins` | `Plugin[]` | Optional plugins |
| `debug` | `DebugConfig` | Debug options |
| `errorBoundary` | `ErrorBoundaryConfig` | Error handling configuration |
| `initialFacts` | `Record<string, unknown>` | Initial fact values for hydration |

---

## System Properties

### facts

Proxy object for reading and writing facts.

```typescript
// Write a fact (triggers constraint evaluation and effects)
system.facts.count = 10;

// Read a fact (fully typed from your schema)
const count = system.facts.count;
```

### derive

Read-only proxy for derivations. Also exposes runtime registration methods.

```typescript
// Read derivations (recompute automatically when tracked facts change)
const total = system.derive.cartTotal;

// Runtime registration
system.derive.register("tripled", (facts) => facts.count * 3);
system.derive.assign("doubled", (facts) => facts.count * 20);
system.derive.unregister("tripled");
system.derive.call("doubled");            // recompute, ignoring cache
system.derive.isDynamic("tripled");       // true
system.derive.listDynamic();              // ["tripled"]
```

### events

Accessor for the system's event definitions.

### constraints

Runtime control for constraints.

| Method | Description |
|--------|-------------|
| `disable(id)` | Skip constraint during reconciliation |
| `enable(id)` | Re-enable a disabled constraint |
| `isDisabled(id)` | Check if disabled |
| `register(id, def)` | Add a new constraint at runtime |
| `assign(id, def)` | Override an existing constraint |
| `unregister(id)` | Remove a dynamically registered constraint |
| `call(id, props?)` | Evaluate and return requirements |
| `isDynamic(id)` | Check if dynamically registered |
| `listDynamic()` | List all dynamic constraint IDs |

```typescript
system.constraints.disable("myConstraint");
system.constraints.enable("myConstraint");
system.constraints.register("newRule", { when: ..., require: ... });
system.constraints.assign("newRule", { when: ..., require: ... });
system.constraints.unregister("newRule");
```

### effects

Runtime control for effects.

| Method | Description |
|--------|-------------|
| `disable(id)` | Skip effect during reconciliation |
| `enable(id)` | Re-enable a disabled effect |
| `isEnabled(id)` | Check if enabled |
| `register(id, def)` | Add a new effect at runtime |
| `assign(id, def)` | Override an existing effect |
| `unregister(id)` | Remove a dynamically registered effect |
| `call(id)` | Execute effect immediately |
| `isDynamic(id)` | Check if dynamically registered |
| `listDynamic()` | List all dynamic effect IDs |

```typescript
system.effects.disable("myEffect");
system.effects.enable("myEffect");
system.effects.register("logger", { run: (facts) => console.log(facts) });
```

### resolvers

Runtime control for resolvers.

| Method | Description |
|--------|-------------|
| `register(id, def)` | Add a new resolver at runtime |
| `assign(id, def)` | Override an existing resolver |
| `unregister(id)` | Remove a dynamically registered resolver |
| `call(id, requirement)` | Execute resolver with a requirement |
| `isDynamic(id)` | Check if dynamically registered |
| `listDynamic()` | List all dynamic resolver IDs |

```typescript
system.resolvers.register("loadData", { requirement: "LOAD", resolve: ... });
await system.resolvers.call("loadData", { type: "LOAD", id: "123" });
```

### debug

Access the time-travel API (or `null` if not enabled).

```typescript
// Time-travel is only available when debug.timeTravel is enabled
if (system.debug) {
  system.debug.goBack();               // undo last state change
  system.debug.goForward();            // redo
  console.log(system.debug.snapshots); // all captured snapshots
}
```

### isRunning / isSettled / isInitialized / isReady

Boolean status properties for the system lifecycle.

```typescript
system.isRunning;      // true after start() is called
system.isSettled;      // true when all constraints and resolvers finish
system.isInitialized;  // true after module init() completes
system.isReady;        // true after the first reconciliation pass
```

---

## System Methods

### start

Start the system (runs module init and first reconciliation).

```typescript
system.start();
```

### stop

Stop the system (pauses reconciliation).

```typescript
system.stop();
```

### destroy

Clean up system resources.

```typescript
system.destroy();
```

### registerModule

Register a module dynamically on a running namespaced system.

```typescript
system.registerModule(name: string, module: ModuleDef): void
```

The module is immediately wired into the constraint, resolver, effect, and derivation graphs. Throws if called during reconciliation or on a destroyed system.

### dispatch

Dispatch an event.

```typescript
// Send a typed event into the system for constraints and effects to react to
system.dispatch({ type: "EVENT_NAME", payload: data });
```

### batch

Batch multiple fact mutations into a single reconciliation cycle.

```typescript
// Group multiple writes so constraints evaluate once (not per write)
system.batch(() => {
  system.facts.a = 1;
  system.facts.b = 2;
});
```

### read

Read a derivation value by ID.

```typescript
// Read a specific derivation by its string ID
const total = system.read("cartTotal");
```

### subscribe

Subscribe to fact or derivation changes. Accepts any combination of fact and derivation keys (auto-detected). Returns an unsubscribe function.

```typescript
// Subscribe to fact changes
system.subscribe(["count"], () => console.log("count changed"));

// Subscribe to derivation changes
system.subscribe(["doubled"], () => console.log("doubled changed"));

// Subscribe to mix of facts and derivations
system.subscribe(["count", "doubled"], () => console.log("something changed"));
```

**Signature:**

```typescript
subscribe(ids: Array<ObservableKeys<M>>, listener: () => void): () => void
```

### watch

Watch a fact or derivation and receive old/new values. Accepts both fact and derivation keys (auto-detected). Returns an unsubscribe function.

Has three typed overloads: derivation-specific, fact-specific, and a generic fallback.

```typescript
// Watch a fact
system.watch("count", (newVal, oldVal) => {
  console.log(`count: ${oldVal} -> ${newVal}`);
});

// Watch a derivation
system.watch("doubled", (newVal, oldVal) => {
  console.log(`doubled: ${oldVal} -> ${newVal}`);
});

// With custom equality
system.watch("config", callback, {
  equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});
```

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `equalityFn` | `(a: T, b: T) => boolean` | Custom equality function to control when the callback fires. Defaults to `===`. |

### when

Wait for a predicate to become true. Returns a promise that resolves when the condition is met. Useful for awaiting state transitions.

```typescript
// Wait for a condition to become true
await system.when((facts) => facts.phase === "ready");

// With timeout
await system.when(
  (facts) => facts.count > 10,
  { timeout: 5000 }
);
```

**Signature:**

```typescript
when(predicate: (facts: Facts<M>) => boolean, options?: { timeout?: number }): Promise<void>
```

**Options:**

| Property | Type | Description |
|----------|------|-------------|
| `timeout` | `number` | Maximum time in ms to wait before rejecting. If omitted, waits indefinitely. |

### whenReady

Wait for the system to be fully ready (after first reconciliation).

```typescript
// Block until init + first reconciliation completes (useful in tests/SSR)
await system.whenReady();
```

### settle

Wait for all constraints and resolvers to complete.

```typescript
// Wait for all in-flight constraints and resolvers to finish
await system.settle();
```

### inspect

Get current system state for debugging.

```typescript
// See what's pending, running, and resolved at this moment
const inspection = system.inspect();
// { unmet, inflight, constraints, resolvers }
```

### explain

Get an explanation of why a requirement exists.

```typescript
// Trace which constraint generated a requirement and why
const explanation = system.explain("requirement-id");
```

### getSnapshot

Capture current state as a serializable snapshot.

```typescript
// Serialize current state for persistence or transfer
const snapshot = system.getSnapshot();
```

### restore

Restore from a snapshot.

```typescript
// Rehydrate state from a previously captured snapshot
system.restore(snapshot);
```

### getDistributableSnapshot

Get a distributable snapshot of computed derivations for use outside the runtime.

```typescript
// Export selected derivations for use outside the runtime (e.g., edge cache)
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ["effectivePlan", "canUseFeature"],
  ttlSeconds: 3600, // snapshot expires after 1 hour
});
```

### watchDistributableSnapshot

Watch for changes to distributable snapshot derivations.

```typescript
// Automatically push updated snapshots whenever derivations change
const unsubscribe = system.watchDistributableSnapshot(
  { includeDerivations: ["effectivePlan"] },
  (snapshot) => {
    // Push to Redis/edge cache
  }
);
```

---

## Builders & Helpers

Type-safe utilities for defining constraints and resolvers outside of `createModule()`. Useful for shared libraries, reusable definitions, and composable module configurations.

### constraintFactory

Create a factory that produces typed constraints for a specific schema.

```typescript
function constraintFactory<S extends Schema>(): {
  create<R extends Requirement>(constraint: TypedConstraint<S, R>): TypedConstraint<S, R>
}
```

```typescript
import { constraintFactory, t } from '@directive-run/core';

const schema = { facts: { count: t.number(), threshold: t.number() } };
const factory = constraintFactory<typeof schema>();

const maxCount = factory.create({
  when: (facts) => facts.count > facts.threshold,
  require: { type: "RESET" },
});

// Use in any module with the same schema
const module = createModule("counter", {
  schema,
  constraints: { maxCount },
});
```

### resolverFactory

Create a factory that produces typed resolvers for a specific schema.

```typescript
function resolverFactory<S extends Schema>(): {
  create<R extends Requirement>(resolver: TypedResolver<S, R>): TypedResolver<S, R>
}
```

```typescript
import { resolverFactory } from '@directive-run/core';

const factory = resolverFactory<typeof schema>();

const fetchUser = factory.create<{ type: "FETCH_USER"; userId: string }>({
  requirement: "FETCH_USER",
  resolve: async (req, context) => {
    context.facts.user = await api.getUser(req.userId);
  },
});
```

### typedConstraint

One-off typed constraint creator. Simpler than `constraintFactory` when you only need a single definition.

```typescript
function typedConstraint<S extends Schema, R extends Requirement>(
  constraint: TypedConstraint<S, R>
): TypedConstraint<S, R>
```

```typescript
import { typedConstraint } from '@directive-run/core';

const lowStock = typedConstraint<typeof schema, { type: "REORDER" }>({
  when: (facts) => facts.stock < 10,
  require: { type: "REORDER" },
  priority: 50,
});
```

### typedResolver

One-off typed resolver creator. Simpler than `resolverFactory` when you only need a single definition.

```typescript
function typedResolver<S extends Schema, R extends Requirement>(
  resolver: TypedResolver<S, R>
): TypedResolver<S, R>
```

```typescript
import { typedResolver } from '@directive-run/core';

const resetResolver = typedResolver<typeof schema, { type: "RESET" }>({
  requirement: "RESET",
  resolve: async (_req, context) => {
    context.facts.count = 0;
  },
});
```

{% callout title="AI Orchestrator" %}
For AI agent orchestrators, see `createAgentOrchestrator()` in `@directive-run/ai`. See [Orchestrator](/ai/orchestrator).
{% /callout %}

---

## Next Steps

- [Types](/docs/api/types) – Type definitions
- [React Hooks](/docs/api/react) – React API
- [Module and System](/docs/module-system) – Usage guide
- [Builders](/docs/builders) – Fluent builder patterns
