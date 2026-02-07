---
title: Types Reference
description: TypeScript type definitions for Directive.
---

Complete type definitions for Directive. {% .lead %}

---

## Core Types

### Module

```typescript
interface Module<T extends ModuleSchema> {
  name: string;
  schema: T;
  init?: (facts: Facts<T>) => void;
  derive?: Derivations<T>;
  effects?: Effects<T>;
  constraints?: Constraints<T>;
  resolvers?: Resolvers<T>;
}
```

### System

```typescript
interface System<T extends ModuleSchema> {
  facts: Facts<T>;
  derive: DeriveProxy<T>;
  on: <K extends keyof T["events"]>(
    event: K,
    handler: (payload: T["events"][K]) => void
  ) => () => void;
  dispatch: <K extends keyof T["events"]>(
    event: K,
    payload: T["events"][K]
  ) => void;
  snapshot: (keys?: string[]) => Partial<Facts<T>>;
  restore: (state: Partial<Facts<T>>) => void;
  settle: () => Promise<void>;
  dispose: () => void;
}
```

---

## Schema Types

### ModuleSchema

```typescript
interface ModuleSchema {
  facts?: Record<string, TypeBuilder>;
  derivations?: Record<string, TypeBuilder>;
  events?: Record<string, TypeBuilder>;
  requirements?: Record<string, TypeBuilder>;
}
```

### TypeBuilder

```typescript
interface TypeBuilder<T> {
  nullable(): TypeBuilder<T | null>;
  optional(): TypeBuilder<T | undefined>;
  default(value: T): TypeBuilder<T>;
}
```

---

## Constraint Types

### Constraint

```typescript
interface Constraint<T> {
  priority?: number;
  after?: string[];
  when: (facts: Facts<T>, derive: DeriveProxy<T>) => boolean | Promise<boolean>;
  require: Requirement | ((facts: Facts<T>) => Requirement);
  timeout?: number;
  onTimeout?: (ctx: Context<T>) => void;
}
```

### Requirement

```typescript
interface Requirement {
  type: string;
  [key: string]: unknown;
}
```

---

## Resolver Types

### Resolver

```typescript
interface Resolver<T> {
  requirement: string;
  key?: (req: Requirement) => string;
  retry?: RetryConfig;
  timeout?: number;
  onTimeout?: (req: Requirement, ctx: Context<T>) => void;
  onError?: (error: Error, req: Requirement, ctx: Context<T>) => void;
  resolve: (req: Requirement, ctx: Context<T>) => void | Promise<void>;
}
```

### RetryConfig

```typescript
interface RetryConfig {
  attempts: number;
  backoff?: "linear" | "exponential";
  initialDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}
```

---

## Effect Types

### Effect

```typescript
interface Effect<T> {
  watch?: (facts: Facts<T>) => unknown;
  debounce?: number;
  run: (
    value: unknown,
    prev: unknown,
    ctx: { facts: Facts<T> }
  ) => void | (() => void);
}
```

---

## Context Types

### Context

```typescript
interface Context<T> {
  facts: Facts<T>;
  derive: DeriveProxy<T>;
  dispatch: <K extends keyof T["events"]>(
    event: K,
    payload: T["events"][K]
  ) => void;
  system: System<T>;
}
```

---

## Next Steps

- See Core API for function reference
- See React Hooks for React API
- See Type Builders for schema types
