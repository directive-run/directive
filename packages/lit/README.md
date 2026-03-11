# @directive-run/lit

[![npm](https://img.shields.io/npm/v/@directive-run/lit?color=%236366f1)](https://www.npmjs.com/package/@directive-run/lit)
[![downloads](https://img.shields.io/npm/dm/@directive-run/lit)](https://www.npmjs.com/package/@directive-run/lit)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@directive-run/lit)](https://bundlephobia.com/package/@directive-run/lit)

Lit reactive controllers for [Directive](https://www.npmjs.com/package/@directive-run/core). Controllers subscribe on `hostConnected` and unsubscribe on `hostDisconnected`, following the Lit `ReactiveController` lifecycle.

## Install

```bash
npm install @directive-run/core @directive-run/lit
```

## Quick Start

Define a module in a shared file, then use controllers in any element:

```typescript
// system.ts
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
    events: { increment: {}, decrement: {} },
    requirements: {},
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
  },
});

export const system = createSystem({ module: counter });
system.start();
```

```typescript
// my-counter.ts
import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { FactController, DerivedController, useEvents } from "@directive-run/lit";
import { system } from "./system";

@customElement("my-counter")
export class MyCounter extends LitElement {
  private count = new FactController<number>(this, system, "count");
  private doubled = new DerivedController<number>(this, system, "doubled");
  private events = useEvents(system);

  render() {
    return html`
      <p>Count: ${this.count.value} (doubled: ${this.doubled.value})</p>
      <button @click=${() => this.events.increment()}>+</button>
      <button @click=${() => this.events.decrement()}>&minus;</button>
    `;
  }
}
```

## DirectiveSelectorController

Auto-tracking selector controller. Subscribes only to the keys your selector reads:

```typescript
import { LitElement, html } from "lit";
import { DirectiveSelectorController } from "@directive-run/lit";
import { system } from "./system";

class MySummary extends LitElement {
  private label = new DirectiveSelectorController(
    this, system, (state) => state.count > 10 ? "High" : "Low"
  );

  render() {
    return html`<span>${this.label.value}</span>`;
  }
}
```

## API Reference

### Controllers

| Controller | `.value` Type | Description |
|------------|--------------|-------------|
| `FactController<T>(host, system, key)` | `T \| undefined` | Subscribe to a single fact |
| `DerivedController<T>(host, system, key)` | `T` | Subscribe to a single derivation |
| `DerivedController<T>(host, system, [keys])` | `Record<string, unknown>` | Subscribe to multiple derivations |
| `DirectiveSelectorController<R>(host, system, fn)` | `R` | Auto-tracking selector |
| `WatchController<T>(host, system, key, cb)` | &ndash; | Side-effect on change |
| `InspectController(host, system)` | `InspectState` | Consolidated system state |
| `RequirementStatusController(host, plugin, type)` | `RequirementTypeStatus` | Requirement loading/error |
| `ExplainController(host, system, reqId)` | `string \| null` | Requirement explanation |
| `ConstraintStatusController(host, system)` | `ConstraintInfo[]` | All constraint states |
| `OptimisticUpdateController(host, system)` | `{ isPending, error }` | Optimistic mutation with `.mutate()` and `.rollback()` |
| `HistoryController(host, system)` | `HistoryState \| null` | Undo/redo navigation |
| `SystemController(host, module)` | &ndash; | Manages system lifecycle (`.system` accessor) |
| `ModuleController(host, module)` | &ndash; | All-in-one: creates system, subscribes to all facts/derivations |

### Factory Functions

Shorthand for creating controllers:

| Factory | Creates |
|---------|---------|
| `createFact(host, system, key)` | `FactController` |
| `createDerived(host, system, key)` | `DerivedController` |
| `createDirectiveSelector(host, system, fn)` | `DirectiveSelectorController` |
| `createWatch(host, system, key, cb)` | `WatchController` |
| `createInspect(host, system)` | `InspectController` |
| `createRequirementStatus(host, plugin, type)` | `RequirementStatusController` |
| `createExplain(host, system, reqId)` | `ExplainController` |
| `createConstraintStatus(host, system)` | `ConstraintStatusController` |
| `createOptimisticUpdate(host, system)` | `OptimisticUpdateController` |
| `createModule(host, module)` | `ModuleController` |

### Functional Helpers

| Helper | Return Type | Description |
|--------|------------|-------------|
| `useDispatch(system)` | `(event) => void` | Dispatch function (non-reactive) |
| `useEvents(system)` | `Events` | Events dispatcher (non-reactive) |
| `useHistory(system)` | `HistoryState \| null` | Snapshot time-travel state (non-reactive) |
| `getDerived(system, key)` | `() => T` | Getter function for a derivation |
| `getFact(system, key)` | `() => T` | Getter function for a fact |
| `createTypedHooks()` | `{ createDerived, createFact, ... }` | Factory for pre-typed controllers |
| `shallowEqual` | `(a, b) => boolean` | Shallow equality helper |

## Peer Dependencies

- `lit >= 3`
- `@directive-run/core`

## Documentation

- [Lit Adapter Guide](https://directive.run/docs/adapters/lit)
- [API Reference](https://directive.run/docs/api)

## License

MIT
