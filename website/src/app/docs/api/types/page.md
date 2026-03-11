---
title: Types Reference
description: TypeScript type definitions for Directive.
---

Complete type definitions for Directive. {% .lead %}

---

## Core Types

### ModuleDef

```typescript
interface ModuleDef<M extends ModuleSchema> {
  name: string;                        // unique module identifier
  schema: M;                           // type definitions for facts, events, requirements

  init?: (facts: Facts<M>) => void;    // set default fact values
  derive?: Derivations<M>;             // computed values (auto-tracked)
  effects?: Effects<M>;                // fire-and-forget side effects
  constraints?: Constraints<M>;        // declarative rules that emit requirements
  resolvers?: Resolvers<M>;            // handlers that fulfill requirements
}
```

### System

```typescript
interface System<M extends ModuleSchema> {
  // State access
  readonly facts: Facts<M["facts"]>;           // read/write proxy for facts
  readonly derive: InferDerivations<M>;        // read-only computed values
  readonly events: EventsAccessor<M>;          // typed event definitions
  readonly constraints: ConstraintsControl;    // enable/disable constraints
  readonly effects: EffectsControl;            // enable/disable effects
  readonly history: HistoryAPI | null;          // time-travel (null if disabled)

  // Lifecycle
  start(): void;
  stop(): void;
  destroy(): void;

  // Status flags
  readonly isRunning: boolean;
  readonly isSettled: boolean;
  readonly isInitialized: boolean;
  readonly isReady: boolean;
  whenReady(): Promise<void>;

  // Mutations and events
  dispatch(event: SystemEvent): void;
  batch(fn: () => void): void;

  // Subscriptions
  read(derivationId: string): unknown;
  subscribe(ids: Array<ObservableKeys<M>>, listener: () => void): () => void;
  watch(id: ObservableKeys<M>, callback: (newValue, previousValue) => void, options?: { equalityFn?: (a, b) => boolean }): () => void;
  when(predicate: (facts: Facts<M>) => boolean, options?: { timeout?: number }): Promise<void>;

  // Debugging and persistence
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

### HistoryAPI

```typescript
interface HistoryAPI {
  readonly snapshots: Snapshot[];    // all captured state snapshots
  readonly currentIndex: number;     // position in the snapshot timeline

  goBack(steps?: number): void;     // undo state changes
  goForward(steps?: number): void;  // redo state changes
  goTo(snapshotId: number): void;   // jump to a specific snapshot

  replay(): void;                   // replay all snapshots from the beginning
  export(): string;                 // serialize timeline to JSON
  import(json: string): void;       // restore a previously exported timeline
}
```

---

## Schema Types

### ModuleSchema

```typescript
interface ModuleSchema {
  facts: Record<string, SchemaType>;                    // mutable state
  derivations?: Record<string, SchemaType>;             // computed values
  events?: Record<string, Record<string, SchemaType>>;  // event payloads
  requirements?: Record<string, Record<string, SchemaType>>; // requirement payloads
}
```

### TypeBuilder

```typescript
// Fluent API for defining schema types with modifiers
interface TypeBuilder<T> {
  nullable(): TypeBuilder<T | null>;       // allow null values
  optional(): TypeBuilder<T | undefined>;  // allow undefined values
  default(value: T): TypeBuilder<T>;       // set a default when omitted
}
```

---

## Utility Types

Type helpers for extracting keys and return types from a module schema.

### FactKeys

```typescript
// Extract fact key names from a module schema
type FactKeys<M extends ModuleSchema> = keyof M["facts"] & string;
```

### FactReturnType

```typescript
// Get the return type of a specific fact from a module schema
type FactReturnType<M extends ModuleSchema, K extends FactKeys<M>> = InferFacts<M>[K];
```

### DerivationKeys

```typescript
// Extract derivation key names from a module schema
type DerivationKeys<M extends ModuleSchema> = keyof M["derivations"] & string;
```

### DerivationReturnType

```typescript
// Get the return type of a specific derivation from a module schema
type DerivationReturnType<M extends ModuleSchema, K extends DerivationKeys<M>> = InferDerivations<M>[K];
```

### ObservableKeys

```typescript
// Union of all fact and derivation keys – used in subscribe() and watch()
type ObservableKeys<M extends ModuleSchema> = FactKeys<M> | DerivationKeys<M>;
```

---

## Constraint Types

### ConstraintDef

```typescript
interface ConstraintDef<S, R extends Requirement> {
  priority?: number;    // higher = evaluated first (for conflict resolution)
  async?: boolean;      // enable async precondition evaluation
  timeout?: number;     // max time for async constraints (ms)
  after?: string[];     // constraint IDs that must evaluate before this one
  deps?: string[];      // explicit fact dependencies (recommended for async constraints)

  // Precondition: when should this constraint fire?
  when: (facts: Facts<S>) => boolean | Promise<boolean>;

  // What requirement does it emit when the condition is met?
  require: RequirementOutput<R> | ((facts: Facts<S>) => RequirementOutput<R>);
}
```

### Requirement

```typescript
// The unit of work passed from constraints to resolvers
interface Requirement {
  type: string;              // matches a resolver's requirement field
  [key: string]: unknown;    // arbitrary payload for the resolver
}
```

---

## Resolver Types

### ResolverDef

```typescript
interface ResolverDef<S, R extends Requirement> {
  // Which requirement type this resolver handles
  requirement: string | ((req: Requirement) => req is R);

  // Dedupe key: identical keys share a single in-flight resolution
  key?: (req: R) => string;

  // Resilience
  retry?: RetryPolicy;
  timeout?: number;

  // Batching: group multiple requirements into one call
  batch?: BatchConfig;

  // Resolution strategies (provide one)
  resolve?: (req: R, context: ResolverContext<S>) => Promise<void>;
  resolveBatch?: (reqs: R[], context: ResolverContext<S>) => Promise<void>;
  resolveBatchWithResults?: (reqs: R[], context: ResolverContext<S>) => Promise<BatchItemResult[]>;
}
```

### ResolverContext

```typescript
// Provided to every resolver during execution
interface ResolverContext<S> {
  readonly facts: Facts<S>;              // read/write access to module state
  readonly signal: AbortSignal;          // cancelled when resolver times out or system stops
  readonly snapshot: () => FactsSnapshot<S>; // capture a point-in-time copy of facts
}
```

### RetryPolicy

```typescript
interface RetryPolicy {
  attempts: number;                    // max number of retries
  backoff: "none" | "linear" | "exponential"; // delay strategy between attempts

  initialDelay?: number;               // base delay in ms
  maxDelay?: number;                   // cap on backoff growth

  // Return false to stop retrying early (e.g., for non-transient errors)
  shouldRetry?: (error: Error, attempt: number) => boolean;
}
```

---

## Effect Types

### Effect

```typescript
interface EffectDef<S extends ModuleSchema> {
  // Optional: only run when these specific facts change
  deps?: Array<keyof InferFacts<S> & string>;

  // Side effect function (receives current and previous fact values)
  run: (facts: InferFacts<S>, prev: InferFacts<S> | null) => void;
}
```

---

## Error Types

### ErrorBoundaryConfig

```typescript
interface ErrorBoundaryConfig {
  // Per-component error handlers (use a string strategy or custom function)
  onConstraintError?: RecoveryStrategy | ((error: Error, constraint: string) => void);
  onResolverError?: RecoveryStrategy | ((error: Error, resolver: string) => void);
  onEffectError?: RecoveryStrategy | ((error: Error, effect: string) => void);
  onDerivationError?: RecoveryStrategy | ((error: Error, derivation: string) => void);

  // Catch-all for any error in the system
  onError?: (error: DirectiveError) => void;

  // Automatic retry and circuit breaker for transient failures
  retryLater?: RetryLaterConfig;
  circuitBreaker?: CircuitBreakerConfig;
}
```

---

## Snapshot Types

### SystemSnapshot

```typescript
// Serializable state for persistence, hydration, or time-travel
interface SystemSnapshot {
  facts: Record<string, unknown>;  // all current fact values
  version?: number;                // schema version for migration support
}
```

### SystemInspection

```typescript
// Returned by system.inspect() for debugging the current runtime state
interface SystemInspection {
  unmet: RequirementWithId[];        // requirements waiting for a resolver
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>; // actively resolving
  constraints: Array<{ id: string; active: boolean; priority: number }>;  // all constraints
  resolvers: Record<string, ResolverStatus>;  // resolver health and stats
}
```

---

## Next Steps

- [Core API](/docs/api/core) – Function reference
- [React Hooks](/docs/api/react) – React API
- [Schema & Types](/docs/schema-overview) – Schema types
