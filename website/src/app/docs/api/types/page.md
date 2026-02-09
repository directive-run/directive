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
interface System<M extends ModuleSchema> {
  readonly facts: Facts<M["facts"]>;
  readonly debug: TimeTravelAPI | null;
  readonly derive: InferDerivations<M>;
  readonly events: EventsAccessor<M>;
  readonly constraints: ConstraintsControl;
  readonly effects: EffectsControl;

  start(): void;
  stop(): void;
  destroy(): void;

  readonly isRunning: boolean;
  readonly isSettled: boolean;
  readonly isInitialized: boolean;
  readonly isReady: boolean;
  whenReady(): Promise<void>;

  dispatch(event: SystemEvent): void;
  batch(fn: () => void): void;

  read(derivationId: string): unknown;
  subscribe(derivationIds: string[], listener: () => void): () => void;
  watch(derivationId: string, callback: (newValue, previousValue) => void): () => void;

  inspect(): SystemInspection;
  settle(maxWait?: number): Promise<void>;
  explain(requirementId: string): string | null;
  getSnapshot(): SystemSnapshot;
  restore(snapshot: SystemSnapshot): void;
  getDistributableSnapshot(options?: DistributableSnapshotOptions): DistributableSnapshot;
  watchDistributableSnapshot(options: DistributableSnapshotOptions, callback: (snapshot) => void): () => void;
}
```

### ConstraintsControl

```typescript
interface ConstraintsControl {
  disable(id: string): void;
  enable(id: string): void;
}
```

### EffectsControl

```typescript
interface EffectsControl {
  disable(id: string): void;
  enable(id: string): void;
  isEnabled(id: string): boolean;
}
```

### TimeTravelAPI

```typescript
interface TimeTravelAPI {
  readonly snapshots: Snapshot[];
  readonly currentIndex: number;
  goBack(steps?: number): void;
  goForward(steps?: number): void;
  goTo(snapshotId: number): void;
  replay(): void;
  export(): string;
  import(json: string): void;
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

### ConstraintDef

```typescript
interface ConstraintDef<S, R extends Requirement> {
  priority?: number;
  async?: boolean;
  when: (facts: Facts<S>) => boolean | Promise<boolean>;
  require: RequirementOutput<R> | ((facts: Facts<S>) => RequirementOutput<R>);
  timeout?: number;
  after?: string[];
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

### ResolverDef

```typescript
interface ResolverDef<S, R extends Requirement> {
  requirement: string | ((req: Requirement) => req is R);
  key?: (req: R) => string;
  retry?: RetryPolicy;
  timeout?: number;
  batch?: BatchConfig;
  resolve?: (req: R, ctx: ResolverContext<S>) => Promise<void>;
  resolveBatch?: (reqs: R[], ctx: ResolverContext<S>) => Promise<void>;
  resolveBatchWithResults?: (reqs: R[], ctx: ResolverContext<S>) => Promise<BatchItemResult[]>;
}
```

### ResolverContext

```typescript
interface ResolverContext<S> {
  readonly facts: Facts<S>;
  readonly signal: AbortSignal;
  readonly snapshot: () => FactsSnapshot<S>;
}
```

### RetryPolicy

```typescript
interface RetryPolicy {
  attempts: number;
  backoff: "none" | "linear" | "exponential";
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

## Error Types

### ErrorBoundaryConfig

```typescript
interface ErrorBoundaryConfig {
  onConstraintError?: RecoveryStrategy | ((error: Error, constraint: string) => void);
  onResolverError?: RecoveryStrategy | ((error: Error, resolver: string) => void);
  onEffectError?: RecoveryStrategy | ((error: Error, effect: string) => void);
  onDerivationError?: RecoveryStrategy | ((error: Error, derivation: string) => void);
  onError?: (error: DirectiveError) => void;
  retryLater?: RetryLaterConfig;
  circuitBreaker?: CircuitBreakerConfig;
}
```

---

## Snapshot Types

### SystemSnapshot

```typescript
interface SystemSnapshot {
  facts: Record<string, unknown>;
  version?: number;
}
```

### SystemInspection

```typescript
interface SystemInspection {
  unmet: RequirementWithId[];
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
  constraints: Array<{ id: string; active: boolean; priority: number }>;
  resolvers: Record<string, ResolverStatus>;
}
```

---

## Next Steps

- See [Core API](/docs/api/core) for function reference
- See [React Hooks](/docs/api/react) for React API
- See [Type Builders](/docs/type-builders) for schema types
