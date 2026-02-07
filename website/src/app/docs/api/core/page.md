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

---

## System Methods

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

### on

Subscribe to events.

```typescript
const unsubscribe = system.on("EVENT_NAME", (payload) => {});
```

### dispatch

Dispatch an event.

```typescript
system.dispatch("EVENT_NAME", payload);
```

### snapshot

Capture current state.

```typescript
const state = system.snapshot();
```

### restore

Restore from snapshot.

```typescript
system.restore(state);
```

### settle

Wait for all constraints and resolvers to complete.

```typescript
await system.settle();
```

### dispose

Clean up system resources.

```typescript
system.dispose();
```

---

## Next Steps

- See Types for type definitions
- See React Hooks for React API
- See Module and System for usage
