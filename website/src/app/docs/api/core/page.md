---
title: Core API Reference
description: Complete API reference for Directive's core functions.
---

Core functions and types for Directive. {% .lead %}

---

## createModule

Create a module definition.

```typescript
function createModule<T>(
  name: string,
  config: ModuleConfig<T>
): Module<T>
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
function createSystem<T>(
  config: SystemConfig<T>
): System<T>
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
system.facts.count = 10;
const count = system.facts.count;
```

### derive

Read-only proxy for derivations.

```typescript
const total = system.derive.cartTotal;
```

### events

Accessor for the system's event definitions.

### constraints

Runtime control for constraints.

```typescript
system.constraints.disable("myConstraint");
system.constraints.enable("myConstraint");
```

### effects

Runtime control for effects.

```typescript
system.effects.disable("myEffect");
system.effects.enable("myEffect");
system.effects.isEnabled("myEffect"); // boolean
```

### debug

Access the time-travel API (or `null` if not enabled).

```typescript
if (system.debug) {
  system.debug.goBack();
  system.debug.goForward();
  console.log(system.debug.snapshots);
}
```

### isRunning / isSettled / isInitialized / isReady

Boolean status properties for the system lifecycle.

```typescript
system.isRunning;      // true after start()
system.isSettled;      // true when no pending operations
system.isInitialized;  // true after module init completes
system.isReady;        // true after first reconciliation
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
system.dispatch({ type: "EVENT_NAME", payload: data });
```

### batch

Batch multiple fact mutations into a single reconciliation cycle.

```typescript
system.batch(() => {
  system.facts.a = 1;
  system.facts.b = 2;
});
```

### read

Read a derivation value by ID.

```typescript
const total = system.read("cartTotal");
```

### subscribe

Subscribe to derivation changes. Returns an unsubscribe function.

```typescript
const unsubscribe = system.subscribe(["cartTotal", "itemCount"], () => {
  console.log("Derivation changed");
});
```

### watch

Watch a derivation and receive old/new values. Returns an unsubscribe function.

```typescript
const unsubscribe = system.watch("cartTotal", (newValue, previousValue) => {
  console.log(`Changed from ${previousValue} to ${newValue}`);
});
```

### whenReady

Wait for the system to be fully ready (after first reconciliation).

```typescript
await system.whenReady();
```

### settle

Wait for all constraints and resolvers to complete.

```typescript
await system.settle();
```

### inspect

Get current system state for debugging.

```typescript
const inspection = system.inspect();
// { unmet, inflight, constraints, resolvers }
```

### explain

Get an explanation of why a requirement exists.

```typescript
const explanation = system.explain("requirement-id");
```

### getSnapshot

Capture current state as a serializable snapshot.

```typescript
const snapshot = system.getSnapshot();
```

### restore

Restore from a snapshot.

```typescript
system.restore(snapshot);
```

### getDistributableSnapshot

Get a distributable snapshot of computed derivations for use outside the runtime.

```typescript
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ["effectivePlan", "canUseFeature"],
  ttlSeconds: 3600,
});
```

### watchDistributableSnapshot

Watch for changes to distributable snapshot derivations.

```typescript
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
