---
title: Lit Controllers
description: Complete API reference for all Lit reactive controllers exported from @directive-run/lit. Controller pattern – each controller subscribes on connect and cleans up on disconnect.
---

Lit controllers API reference. All controllers follow the Reactive Controller pattern – pass the host element and system to the constructor. {% .lead %}

---

## Quick Reference

### Controllers

| Export | Type | Description |
|---|---|---|
| `DerivedController` | Controller | Subscribe to one or more derivations |
| `FactController` | Controller | Subscribe to a single fact |
| `WatchController` | Controller | Side-effect watcher for derivations or facts |
| `InspectController` | Controller | System inspection with optional throttle |
| `ExplainController` | Controller | Reactive requirement explanation |
| `ConstraintStatusController` | Controller | Reactive constraint inspection |
| `RequirementStatusController` | Controller | Requirement status tracking |
| `OptimisticUpdateController` | Controller | Optimistic mutations with rollback |
| `ModuleController` | Controller | Scoped system tied to element lifecycle |
| `SystemController` | Controller | Create system scoped to element lifecycle |
| `HistoryController` | Controller | Reactive time-travel state |

### Selector Controller

| Export | Type | Description |
|---|---|---|
| `DirectiveSelectorController` | Controller | Select across all facts |

### Factory Functions (Quick Reference)

| Export | Type | Description |
|---|---|---|
| `createDerived` | Factory | Shorthand for `new DerivedController` |
| `createFact` | Factory | Shorthand for `new FactController` |
| `createWatch` | Factory | Shorthand for `new WatchController` |
| `createInspect` | Factory | Shorthand for `new InspectController` |
| `createExplain` | Factory | Shorthand for `new ExplainController` |
| `createConstraintStatus` | Factory | Shorthand for `new ConstraintStatusController` |
| `createRequirementStatus` | Factory | Shorthand for `new RequirementStatusController` |
| `createOptimisticUpdate` | Factory | Shorthand for `new OptimisticUpdateController` |
| `createModule` | Factory | Shorthand for `new ModuleController` |
| `createDirectiveSelector` | Factory | Shorthand for `new DirectiveSelectorController` |

### Non-Reactive Utilities (Quick Reference)

| Export | Type | Description |
|---|---|---|
| `useDispatch` | Function | Typed dispatch function |
| `useEvents` | Function | Typed event dispatchers |
| `useHistory` | Function | Non-reactive time-travel access |
| `getDerived` | Function | Non-reactive derivation getter |
| `getFact` | Function | Non-reactive fact getter |
| `createTypedHooks` | Factory | Create typed controllers for a schema |
| `shallowEqual` | Utility | Shallow equality for selectors |
| `directiveContext` | Context | Lit context key for sharing systems |

---

## DerivedController

Subscribe to one or more derivations. The host element re-renders when any subscribed derivation value changes.

```typescript
import { DerivedController } from '@directive-run/lit';

// Single derivation
new DerivedController<T>(host: ReactiveControllerHost, system: System, key: string)

// Multiple derivations
new DerivedController<T>(host: ReactiveControllerHost, system: System, keys: string[])
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `key` | `string \| string[]` | Derivation key(s) to subscribe to |

| Property | Type | Description |
|---|---|---|
| `.value` | `T` | Single key: the derivation value. Array of keys: `Record<string, unknown>` mapping keys to values. |

```typescript
// Single derivation
class MyElement extends LitElement {
  // Subscribe to the cart total – re-renders when it changes
  private total = new DerivedController<number>(this, system, "total");

  render() {
    return html`<span>Total: ${this.total.value}</span>`;
  }
}

// Multiple derivations
class DashboardElement extends LitElement {
  // Subscribe to multiple derivations at once
  private stats = new DerivedController<Record<string, unknown>>(
    this, system, ["total", "average", "count"]
  );

  render() {
    const { total, average, count } = this.stats.value;

    return html`<div>${total} / ${average} / ${count}</div>`;
  }
}
```

---

## FactController

Subscribe to a single fact. The host element re-renders when the fact value changes.

```typescript
import { FactController } from '@directive-run/lit';

new FactController<T>(host: ReactiveControllerHost, system: System, key: string)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `key` | `string` | Fact key to subscribe to |

| Property | Type | Description |
|---|---|---|
| `.value` | `T` | Current fact value |

```typescript
class StatusElement extends LitElement {
  // Subscribe to the current phase – re-renders when it changes
  private phase = new FactController(this, system, "phase");

  render() {
    return html`<span>Phase: ${this.phase.value}</span>`;
  }
}
```

---

## DirectiveSelectorController

Select across all facts with an auto-tracking selector. The host element re-renders only when the selected value changes.

```typescript
import { DirectiveSelectorController } from '@directive-run/lit';

new DirectiveSelectorController<R>(
  host: ReactiveControllerHost,
  system: System,
  selector: (state: FactsProxy) => R,
  equalityFn?: (a: R, b: R) => boolean,
)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `selector` | `(state: FactsProxy) => R` | Selector over facts and derivations |
| `equalityFn` | `(a: R, b: R) => boolean` | Optional custom equality check (defaults to `===`) |

| Property | Type | Description |
|---|---|---|
| `.value` | `R` | Current selected value |

```typescript
class SummaryElement extends LitElement {
  // Select across all facts to build a summary string
  private summary = new DirectiveSelectorController(
    this, system, (facts) => `${facts.user?.name}: ${facts.count}`
  );

  render() {
    return html`<p>${this.summary.value}</p>`;
  }
}
```

---

## WatchController

Side-effect watcher for facts or derivations. The key is auto-detected, so no discriminator is needed. Fires a callback when the watched value changes. Does not expose a `.value` property.

```typescript
import { WatchController } from '@directive-run/lit';

// Unified API – auto-detects fact vs derivation
new WatchController(
  host: ReactiveControllerHost,
  system: System,
  key: string,
  callback: (value: unknown, prev: unknown) => void,
)

// Deprecated: "fact" discriminator overload (still works)
new WatchController(
  host: ReactiveControllerHost,
  system: System,
  { kind: "fact", factKey: string },
  callback: (value: unknown, prev: unknown) => void,
)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `key` | `string` | Key to watch (auto-detected as fact or derivation) |
| `callback` | `(value, prev) => void` | Called when the value changes |

```typescript
class LoggerElement extends LitElement {
  // Watch the phase derivation – auto-detected
  private _watcher = new WatchController(
    this, system, "phase", (value, prev) => {
      console.log(`Phase changed: ${prev} -> ${value}`);
    }
  );

  // Watch the count fact – auto-detected, no discriminator needed
  private _factWatcher = new WatchController(
    this, system, "count", (value, prev) => {
      console.log(`Count changed: ${prev} -> ${value}`);
    }
  );
}
```

{% callout type="warning" title="Deprecated" %}
The `{ kind: "fact", factKey: "key" }` options object is deprecated. Pass the key as a plain string instead – the runtime auto-detects whether it is a fact or derivation.
{% /callout %}

---

## InspectController

System inspection controller. Provides reactive access to unmet requirements, inflight resolvers, constraint statuses, and settlement state. Supports optional throttling.

```typescript
import { InspectController } from '@directive-run/lit';

new InspectController(host: ReactiveControllerHost, system: System, opts?: { throttleMs?: number })
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `opts.throttleMs` | `number` | Optional throttle interval in milliseconds |

| Property | Type | Description |
|---|---|---|
| `.value` | `InspectState` | Current inspection state |
| `.value.unmet` | `Requirement[]` | Currently unmet requirements |
| `.value.inflight` | `Requirement[]` | Requirements being resolved |
| `.value.constraints` | `ConstraintStatus[]` | Constraint statuses |
| `.value.isSettled` | `boolean` | Whether the system is settled |

```typescript
class DebugElement extends LitElement {
  // Get reactive system inspection data with throttled updates
  private inspect = new InspectController(this, system, { throttleMs: 200 });

  render() {
    const { unmet, isSettled } = this.inspect.value;

    return html`
      <div>Settled: ${isSettled}</div>
      <div>Unmet: ${unmet.length}</div>
    `;
  }
}
```

---

## ExplainController

Reactive requirement explanation. Provides a detailed breakdown of why a requirement exists and what constraint produced it.

```typescript
import { ExplainController } from '@directive-run/lit';

new ExplainController(host: ReactiveControllerHost, system: System, requirementType: string)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `requirementType` | `string` | The requirement type to explain |

| Property | Type | Description |
|---|---|---|
| `.value` | `Explanation \| null` | Current explanation or null |

```typescript
class ExplainElement extends LitElement {
  // Get a detailed explanation of why the TRANSITION requirement exists
  private explanation = new ExplainController(this, system, "TRANSITION");

  render() {
    const exp = this.explanation.value;
    if (!exp) {
      return html`<p>No active requirement</p>`;
    }

    return html`<pre>${JSON.stringify(exp, null, 2)}</pre>`;
  }
}
```

---

## ConstraintStatusController

Reactive constraint inspection. Subscribe to the status of a single constraint or all constraints.

```typescript
import { ConstraintStatusController } from '@directive-run/lit';

new ConstraintStatusController(host: ReactiveControllerHost, system: System, constraintId?: string)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `constraintId` | `string` | Optional constraint ID. Omit to get all constraints. |

| Property | Type | Description |
|---|---|---|
| `.value` | `ConstraintStatus \| ConstraintStatus[]` | Single status or array of all statuses |

```typescript
class ConstraintElement extends LitElement {
  // Check if the transition constraint is currently active
  private status = new ConstraintStatusController(this, system, "transition");

  render() {
    return html`<span>Active: ${this.status.value?.active}</span>`;
  }
}
```

---

## RequirementStatusController

Track the status of a specific requirement type, including inflight count and last error.

```typescript
import { RequirementStatusController } from '@directive-run/lit';

new RequirementStatusController(
  host: ReactiveControllerHost,
  statusPlugin: StatusPlugin,
  type: string,
)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `statusPlugin` | `StatusPlugin` | The status plugin instance |
| `type` | `string` | Requirement type to track |

| Property | Type | Description |
|---|---|---|
| `.value` | `RequirementStatus` | Current status |
| `.value.inflight` | `number` | Number of inflight resolutions |
| `.value.lastError` | `Error \| null` | Most recent error |

```typescript
class LoadingElement extends LitElement {
  // Track the loading state of the FETCH_USER requirement
  private status = new RequirementStatusController(this, statusPlugin, "FETCH_USER");

  render() {
    if (this.status.value.inflight > 0) {
      return html`<spinner-el></spinner-el>`;
    }

    if (this.status.value.lastError) {
      return html`<p>Error!</p>`;
    }

    return html`<p>Ready</p>`;
  }
}
```

---

## OptimisticUpdateController

Optimistic mutations with automatic rollback on failure.

```typescript
import { OptimisticUpdateController } from '@directive-run/lit';

new OptimisticUpdateController(
  host: ReactiveControllerHost,
  system: System,
  statusPlugin: StatusPlugin,
  requirementType: string,
)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system |
| `statusPlugin` | `StatusPlugin` | The status plugin instance |
| `requirementType` | `string` | Requirement type for optimistic updates |

| Property | Type | Description |
|---|---|---|
| `.value` | `OptimisticState` | Current optimistic state |
| `.mutate()` | Method | Apply an optimistic mutation |

```typescript
class LikeButton extends LitElement {
  // Set up optimistic mutations with automatic rollback
  private optimistic = new OptimisticUpdateController(
    this, system, statusPlugin, "TOGGLE_LIKE"
  );

  private handleClick() {
    // Optimistically update the UI before the server responds
    this.optimistic.mutate({ liked: true, count: currentCount + 1 });
  }
}
```

---

## ModuleController

Creates a scoped system tied to the element lifecycle. The system starts on `connectedCallback` and stops on `disconnectedCallback`.

```typescript
import { ModuleController } from '@directive-run/lit';

new ModuleController(host: ReactiveControllerHost, module: Module, opts?: ModuleOpts)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `module` | `Module` | The Directive module definition |
| `opts.status` | `boolean` | Enable the status plugin |
| `opts.trace` | `TraceOption` | Per-run reconciliation trace |
| `opts.plugins` | `Plugin[]` | Additional plugins |

| Property | Type | Description |
|---|---|---|
| `.system` | `System` | The scoped system instance |

```typescript
class CounterElement extends LitElement {
  // Create a scoped system tied to this element's lifecycle
  private mod = new ModuleController(this, counterModule, { status: true });

  render() {
    const count = this.mod.system.read("count");

    return html`<button @click=${() => this.mod.system.dispatch({ type: "INCREMENT" })}>
      ${count}
    </button>`;
  }
}
```

---

## SystemController

Create a full system scoped to the element lifecycle. Accepts either a module directly or a configuration object.

```typescript
import { SystemController } from '@directive-run/lit';

// Simple
new SystemController(host: ReactiveControllerHost, module: Module)

// With options
new SystemController(host: ReactiveControllerHost, config: {
  module: Module,
  plugins?: Plugin[],
  trace?: TraceOption,
})
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `module` | `Module` | The Directive module definition |
| `config.plugins` | `Plugin[]` | Optional plugins |
| `config.trace` | `TraceOption` | Per-run reconciliation trace |

| Property | Type | Description |
|---|---|---|
| `.system` | `System` | The scoped system instance |

```typescript
class AppElement extends LitElement {
  // Create a full system scoped to this element's lifecycle
  private ctrl = new SystemController(this, {
    module: appModule,
    plugins: [loggingPlugin()],
    history: true,
  });

  render() {
    // Pass the system down to child elements
    return html`<child-el .system=${this.ctrl.system}></child-el>`;
  }
}
```

---

## HistoryController

Reactive time-travel state. Provides undo/redo capabilities and snapshot navigation.

```typescript
import { HistoryController } from '@directive-run/lit';

new HistoryController(host: ReactiveControllerHost, system: System)
```

| Parameter | Type | Description |
|---|---|---|
| `host` | `ReactiveControllerHost` | The Lit element (`this`) |
| `system` | `System` | The Directive system (must have time-travel enabled) |

| Property | Type | Description |
|---|---|---|
| `.value` | `HistoryState \| null` | Current time-travel state or null if not enabled |

```typescript
class HistoryElement extends LitElement {
  // Get reactive time-travel controls (null when not enabled)
  private tt = new HistoryController(this, system);

  render() {
    const state = this.tt.value;
    if (!state) {
      return html`<p>Time-travel not enabled</p>`;
    }

    return html`
      <button ?disabled=${!state.canUndo} @click=${state.undo}>Undo</button>
      <button ?disabled=${!state.canRedo} @click=${state.redo}>Redo</button>
    `;
  }
}
```

---

## Factory Functions

Every controller has a corresponding factory function that serves as a shorthand. The factory functions accept the same arguments as their controller constructors.

```typescript
import {
  createDerived,
  createFact,
  createWatch,
  createInspect,
  createExplain,
  createConstraintStatus,
  createRequirementStatus,
  createOptimisticUpdate,
  createModule,
  createDirectiveSelector,
} from '@directive-run/lit';

class MyElement extends LitElement {
  // These are equivalent:
  private total = new DerivedController(this, system, "total");
  private total = createDerived(this, system, "total");

  // Subscribe to a single fact
  private phase = createFact(this, system, "phase");

  // Subscribe to multiple derivations at once
  private stats = createDerived(this, system, ["total", "average"]);

  // Get system inspection data with throttled updates
  private inspect = createInspect(this, system, { throttleMs: 200 });

  // Get a requirement explanation
  private explanation = createExplain(this, system, "TRANSITION");

  // Check a specific constraint
  private constraint = createConstraintStatus(this, system, "transition");

  // Track requirement loading state
  private reqStatus = createRequirementStatus(this, statusPlugin, "FETCH_USER");

  // Set up optimistic mutations
  private optimistic = createOptimisticUpdate(this, system, statusPlugin, "TOGGLE_LIKE");

  // Create a scoped system tied to this element
  private mod = createModule(this, counterModule, { status: true });

  // Selector factory – derive values from facts
  private summary = createDirectiveSelector(this, system, (facts) => `${facts.count}`);
}
```

---

## Non-Reactive Utilities

These functions return values or proxies directly without subscribing to changes. They do not trigger host re-renders.

```typescript
import {
  useDispatch,
  useEvents,
  useHistory,
  getDerived,
  getFact,
  createTypedHooks,
  shallowEqual,
  directiveContext,
} from '@directive-run/lit';
```

### useDispatch

Returns a typed dispatch function for sending events to the system.

```typescript
useDispatch(system: System): (event: SystemEvent) => void
```

```typescript
// Get a typed dispatch function for sending events
const dispatch = useDispatch(system);

// Dispatch an event directly
dispatch({ type: "INCREMENT", payload: 1 });
```

### useEvents

Returns typed event dispatchers. Each event type becomes a callable function.

```typescript
useEvents(system: System): TypedEventDispatchers
```

```typescript
// Get typed event dispatchers – each event type becomes a callable function
const events = useEvents(system);

// Dispatch events with full type safety
events.increment(1);
events.reset();
```

### useHistory

Returns the current time-travel state without subscribing to changes. For reactive subscriptions, use `HistoryController` instead.

```typescript
useHistory(system: System): HistoryState | null
```

```typescript
// Get the current time-travel state (non-reactive)
const tt = useHistory(system);

// Undo the last action if possible
if (tt?.canUndo) tt.undo();
```

### getDerived

Returns a non-reactive getter function for a derivation value.

```typescript
getDerived<T>(system: System, key: string): () => T
```

```typescript
// Create a non-reactive getter for a derivation
const getTotal = getDerived(system, "total");

// Read the current value on demand
console.log(getTotal());
```

### getFact

Returns a non-reactive getter function for a fact value.

```typescript
getFact<T>(system: System, key: string): () => T
```

```typescript
// Create a non-reactive getter for a fact
const getCount = getFact(system, "count");

// Read the current value on demand
console.log(getCount());
```

### createTypedHooks

Creates a set of typed controller factories and utilities pre-bound to a specific schema. This eliminates the need for manual type annotations on every controller.

```typescript
createTypedHooks<M extends ModuleSchema>(): {
  createDerived: <K>(host, system, derivationId: K) => DerivedController<InferDerivations<M>[K]>;
  createFact: <K>(host, system, factKey: K) => FactController<InferFacts<M>[K]>;
  useDispatch: (system) => (event: InferEvents<M>) => void;
  useEvents: (system) => System<M>["events"];
}
```

```typescript
// Create typed controller factories for your schema
const hooks = createTypedHooks<typeof appModule>();

class MyElement extends LitElement {
  // Fully typed – fact key autocompletes, return type inferred
  private count = hooks.createFact(this, system, "count");

  // Derivation types are also fully inferred
  private total = hooks.createDerived(this, system, "total");
}
```

### shallowEqual

Shallow equality comparison for use as an `equalityFn` in selector controllers.

```typescript
shallowEqual(a: unknown, b: unknown): boolean
```

```typescript
// Use shallowEqual to prevent re-renders when name/age haven't changed
const selected = new DirectiveSelectorController(
  this, system, (facts) => ({ name: facts.user?.name, age: facts.user?.age }), shallowEqual
);
```

### directiveContext

A Lit context key for sharing systems through the component tree via `@lit/context`.

```typescript
import { directiveContext } from '@directive-run/lit';
import { provide, consume } from '@lit/context';

// Provider – share the system with descendant elements
@provide({ context: directiveContext })
system = mySystem;

// Consumer – receive the system from an ancestor
@consume({ context: directiveContext })
system!: System;
```

---

## Next Steps

- [Core API](/docs/api/core) – System functions
- [Types](/docs/api/types) – Type definitions
- [Lit Adapter](/docs/adapters/lit) – Setup and patterns
