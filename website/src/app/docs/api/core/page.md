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

### Parameters

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

## createSystem

Create a runtime system.

```typescript
// Create a live runtime from a module definition
function createSystem<M extends ModuleSchema>(
  config: SystemConfig<M>
): SingleModuleSystem<M>
```

### Parameters

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

Read-only proxy for derivations.

```typescript
// Derivations recompute automatically when their tracked facts change
const total = system.derive.cartTotal;
```

### events

Accessor for the system's event definitions.

### constraints

Runtime control for constraints.

```typescript
// Temporarily suppress a constraint (e.g., during maintenance)
system.constraints.disable("myConstraint");

// Re-enable it to resume normal evaluation
system.constraints.enable("myConstraint");
```

### effects

Runtime control for effects.

```typescript
system.effects.disable("myEffect");     // pause a side effect
system.effects.enable("myEffect");      // resume it
system.effects.isEnabled("myEffect");   // check current state
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

Subscribe to derivation changes. Returns an unsubscribe function.

```typescript
// Re-render or react whenever any of these derivations change
const unsubscribe = system.subscribe(["cartTotal", "itemCount"], () => {
  console.log("Derivation changed");
});
```

### watch

Watch a derivation and receive old/new values. Returns an unsubscribe function.

```typescript
// Like subscribe, but also provides the old and new values
const unsubscribe = system.watch("cartTotal", (newValue, previousValue) => {
  console.log(`Changed from ${previousValue} to ${newValue}`);
});
```

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

## Next Steps

- See [Types](/docs/api/types) for type definitions
- See [React Hooks](/docs/api/react) for React API
- See [Module and System](/docs/module-system) for usage
