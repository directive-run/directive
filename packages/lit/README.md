# @directive-run/lit

Lit web components adapter for Directive. Provides reactive controllers and factory functions for reading facts, derivations, and dispatching events.

## Install

```bash
npm install @directive-run/core @directive-run/lit
```

## Usage

```typescript
import { LitElement, html } from "lit";
import { FactController, DerivedController, useEvents } from "@directive-run/lit";

class MyCounter extends LitElement {
  private count = new FactController<number>(this, system, "count");
  private doubled = new DerivedController<number>(this, system, "doubled");
  private events = useEvents(system);

  render() {
    return html`
      <p>Count: ${this.count.value} (doubled: ${this.doubled.value})</p>
      <button @click=${() => this.events.increment()}>+</button>
    `;
  }
}
```

## Exports

**Controllers:** `FactController`, `DerivedController`, `InspectController`, `RequirementStatusController`, `DirectiveSelectorController`, `WatchController`, `ExplainController`, `ConstraintStatusController`, `OptimisticUpdateController`, `SystemController`, `ModuleController`, `TimeTravelController`

**Factories:** `createFact`, `createDerived`, `createInspect`, `createRequirementStatus`, `createWatch`, `createDirectiveSelector`, `createExplain`, `createConstraintStatus`, `createOptimisticUpdate`, `createModule`, `useDispatch`, `useEvents`, `useTimeTravel`, `getDerived`, `getFact`, `createTypedHooks`, `shallowEqual`

## Peer Dependencies

- `lit >= 3`
- `@directive-run/core`

## License

MIT

[Full documentation](https://directive.run/docs)
