---
title: Lit Adapter
description: Use Directive with Lit web components using reactive controllers. DerivationController, FactController, InspectController, ExplainController, ModuleController, and more.
---

Directive provides native Lit integration using the Reactive Controller pattern. Controllers automatically subscribe on connect and clean up on disconnect. {% .lead %}

---

## Installation

The Lit adapter is included in the main package:

```typescript
import { DerivationController, FactController, createDerivation } from 'directive/lit';
```

---

## Setup

Create your system and start it in `connectedCallback`:

```typescript
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createSystem } from 'directive';
import { DerivationController, FactController, useFacts } from 'directive/lit';
import { counterModule } from './modules/counter';

const system = createSystem({ module: counterModule });
system.start();

@customElement('my-counter')
class MyCounter extends LitElement {
  private count = new DerivationController<number>(this, system, 'count');
  private facts = useFacts(system);

  render() {
    return html`
      <div>
        <p>Count: ${this.count.value}</p>
        <button @click=${() => this.facts.count--}>-</button>
        <button @click=${() => this.facts.count++}>+</button>
      </div>
    `;
  }
}
```

Each controller calls `host.addController(this)` in its constructor, subscribes in `hostConnected`, and unsubscribes in `hostDisconnected`. You never manage subscriptions manually.

---

## Core Controllers

### DerivationController

Subscribe to a single derivation. The host re-renders when the value changes:

```typescript
import { DerivationController } from 'directive/lit';

class StatusDisplay extends LitElement {
  private isRed = new DerivationController<boolean>(this, system, 'isRed');

  render() {
    return html`<div>${this.isRed.value ? 'Red' : 'Not Red'}</div>`;
  }
}
```

### DerivationsController

Subscribe to multiple derivations at once:

```typescript
import { DerivationsController } from 'directive/lit';

class StatusBar extends LitElement {
  private state = new DerivationsController<{ isRed: boolean; elapsed: number }>(
    this, system, ['isRed', 'elapsed']
  );

  render() {
    const { isRed, elapsed } = this.state.value;
    return html`<div>${isRed ? `Red for ${elapsed}s` : 'Not Red'}</div>`;
  }
}
```

### FactController

Subscribe to a single fact:

```typescript
import { FactController } from 'directive/lit';

class PhaseDisplay extends LitElement {
  private phase = new FactController<string>(this, system, 'phase');

  render() {
    return html`<div>Current phase: ${this.phase.value}</div>`;
  }
}
```

### WatchController

Watch a derivation or fact and fire a callback on change (no re-render).

Watch a derivation:

```typescript
import { WatchController } from 'directive/lit';

class PhaseWatcher extends LitElement {
  private watcher = new WatchController<string>(
    this, system, 'phase',
    (newPhase, oldPhase) => {
      console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
    }
  );
}
```

Watch a fact (use the `{ kind: "fact", factKey }` overload):

```typescript
class FactWatcher extends LitElement {
  private watcher = new WatchController<number>(
    this, system,
    { kind: "fact", factKey: "count" },
    (newCount, oldCount) => {
      console.log(`Count changed from ${oldCount} to ${newCount}`);
    }
  );
}
```

---

## Inspection Controllers

### InspectController

Get system inspection data with optional throttling. Returns `InspectState` with `isSettled`, `unmet`, `inflight`, `isWorking`, `hasUnmet`, and `hasInflight`:

```typescript
import { InspectController } from 'directive/lit';

class Inspector extends LitElement {
  private inspection = new InspectController(this, system);

  render() {
    return html`
      <div>Settled: ${this.inspection.value.isSettled}</div>
      <div>Unmet: ${this.inspection.value.unmet.length}</div>
      <div>Inflight: ${this.inspection.value.inflight.length}</div>
      <div>Working: ${this.inspection.value.isWorking}</div>
    `;
  }
}
```

For high-frequency updates, pass `{ throttleMs }`:

```typescript
class ThrottledInspector extends LitElement {
  // Updates at most every 200ms
  private inspection = new InspectController(this, system, { throttleMs: 200 });

  render() {
    if (!this.inspection.value.isSettled) return html`<spinner-el></spinner-el>`;
    return html`<content-el></content-el>`;
  }
}
```

### ExplainController

Get a reactive explanation of why a requirement exists:

```typescript
import { ExplainController } from 'directive/lit';

class RequirementDebug extends LitElement {
  private explanation = new ExplainController(this, system, 'FETCH_USER');

  render() {
    if (!this.explanation.value) return html`<p>No active requirement</p>`;
    return html`<pre>${this.explanation.value}</pre>`;
  }
}
```

### ConstraintStatusController

Read constraint status reactively. Without a constraint ID, returns all constraints. With an ID, returns a single constraint or `null`:

```typescript
import { ConstraintStatusController } from 'directive/lit';

// All constraints
class ConstraintDashboard extends LitElement {
  private constraints = new ConstraintStatusController(this, system);

  render() {
    const all = this.constraints.value as ConstraintInfo[];
    return html`
      <ul>
        ${all.map(c => html`
          <li>${c.id}: ${c.active ? 'Active' : 'Inactive'} (priority: ${c.priority})</li>
        `)}
      </ul>
    `;
  }
}

// Single constraint
class AuthConstraint extends LitElement {
  private auth = new ConstraintStatusController(this, system, 'requireAuth');

  render() {
    const info = this.auth.value as ConstraintInfo | null;
    if (!info) return html`<p>Constraint not found</p>`;
    return html`<p>Auth: ${info.active ? 'Active' : 'Inactive'}</p>`;
  }
}
```

### OptimisticUpdateController

Apply optimistic mutations with automatic rollback on resolver failure:

```typescript
import { OptimisticUpdateController } from 'directive/lit';

class SaveButton extends LitElement {
  private optimistic = new OptimisticUpdateController(
    this, system, statusPlugin, 'SAVE_DATA'
  );

  handleSave() {
    this.optimistic.mutate(() => {
      // Optimistic update — applied immediately via system.batch()
      system.facts.savedAt = Date.now();
      system.facts.status = 'saved';
    });
    // If "SAVE_DATA" resolver fails, facts are rolled back automatically
  }

  render() {
    return html`
      <button @click=${() => this.handleSave()} ?disabled=${this.optimistic.isPending}>
        ${this.optimistic.isPending ? 'Saving...' : 'Save'}
      </button>
      ${this.optimistic.error
        ? html`<div class="error">${this.optimistic.error.message}</div>`
        : ''}
    `;
  }
}
```

Manual rollback is also available via `rollback()`. The `statusPlugin` and `requirementType` parameters are optional -- without them, you get manual-only rollback.

### ModuleController

Zero-config all-in-one controller. Creates a system scoped to the component lifecycle, starts it, and subscribes to all facts and derivations:

```typescript
import { ModuleController } from 'directive/lit';
import { counterModule } from './modules/counter';

class CounterApp extends LitElement {
  private mod = new ModuleController(this, counterModule);

  render() {
    return html`
      <p>Count: ${this.mod.facts.count}</p>
      <p>Doubled: ${this.mod.derived.doubled}</p>
      <button @click=${() => this.mod.events.increment()}>+</button>
      <button @click=${() => this.mod.dispatch({ type: 'reset' })}>Reset</button>
    `;
  }
}
```

With plugins and status tracking:

```typescript
class AppElement extends LitElement {
  private mod = new ModuleController(this, myModule, {
    plugins: [loggingPlugin()],
    debug: { timeTravel: true },
    status: true,
    initialFacts: { count: 10 },
  });

  render() {
    const status = this.mod.statusPlugin?.getStatus('FETCH_DATA');
    return html`
      <div>${status?.isLoading ? 'Loading...' : 'Ready'}</div>
    `;
  }
}
```

---

## Selector Controllers

Selectors provide fine-grained re-rendering. The host only updates when the selected value changes according to the equality function.

### FactSelectorController

Select part of a fact:

```typescript
import { FactSelectorController } from 'directive/lit';

class UserName extends LitElement {
  private userName = new FactSelectorController<User, string>(
    this, system, 'user', (u) => u?.name ?? 'Guest'
  );

  render() {
    return html`<span>${this.userName.value}</span>`;
  }
}
```

### DerivedSelectorController

Select part of a derivation:

```typescript
import { DerivedSelectorController } from 'directive/lit';

class StatusLabel extends LitElement {
  private statusText = new DerivedSelectorController<Status, string>(
    this, system, 'status', (s) => s?.label ?? 'Unknown'
  );

  render() {
    return html`<span>${this.statusText.value}</span>`;
  }
}
```

### DirectiveSelectorController

Select across all facts:

```typescript
import { DirectiveSelectorController } from 'directive/lit';

class Summary extends LitElement {
  private summary = new DirectiveSelectorController(
    this, system,
    (facts) => ({ count: facts.items?.length ?? 0, loading: facts.loading ?? false }),
    (a, b) => a.count === b.count && a.loading === b.loading
  );

  render() {
    return html`<div>${this.summary.value.count} items</div>`;
  }
}
```

---

## Status Controllers

These controllers require a `statusPlugin` created with `createRequirementStatusPlugin`:

```typescript
import { createSystem } from 'directive';
import { createRequirementStatusPlugin } from 'directive';
import { RequirementStatusController } from 'directive/lit';

const statusPlugin = createRequirementStatusPlugin();
const system = createSystem({
  module: myModule,
  plugins: [statusPlugin.plugin],
});
system.start();
```

### RequirementStatusController

Full status for a requirement type:

```typescript
class UserLoader extends LitElement {
  private status = new RequirementStatusController(this, statusPlugin, 'FETCH_USER');

  render() {
    if (this.status.value.isLoading) return html`<spinner-el></spinner-el>`;
    if (this.status.value.hasError)
      return html`<error-el .message=${this.status.value.lastError?.message}></error-el>`;
    return html`<user-content></user-content>`;
  }
}
```

---

## Factory Functions

Every controller has a factory function shorthand. These are functionally identical to using `new` directly:

```typescript
import {
  createDerivation,
  createDerivations,
  createFact,
  createInspect,
  createRequirementStatus,
  createWatch,
  createFactSelector,
  createDerivedSelector,
  createDirectiveSelector,
  createExplain,
  createConstraintStatus,
  createOptimisticUpdate,
  createModule,
} from 'directive/lit';

class MyElement extends LitElement {
  // These two are equivalent:
  private isRed = new DerivationController<boolean>(this, system, 'isRed');
  private isRed2 = createDerivation<boolean>(this, system, 'isRed');

  // Factory functions for other controllers
  private phase = createFact<string>(this, system, 'phase');
  private state = createDerivations<{ isRed: boolean }>(this, system, ['isRed']);
  private inspection = createInspect(this, system, { throttleMs: 100 });
  private explanation = createExplain(this, system, 'FETCH_USER');
  private constraints = createConstraintStatus(this, system);
  private authConstraint = createConstraintStatus(this, system, 'requireAuth');
  private optimistic = createOptimisticUpdate(this, system, statusPlugin, 'SAVE_DATA');
}
```

The `createModule` factory creates a `ModuleController`:

```typescript
class CounterApp extends LitElement {
  private mod = createModule(this, counterModule, {
    status: true,
    debug: { timeTravel: true },
  });

  render() {
    return html`<p>Count: ${this.mod.facts.count}</p>`;
  }
}
```

---

## Non-Reactive Utilities

For event handlers and imperative code where you do not need reactivity:

### useFacts

Direct access to the facts proxy for mutations:

```typescript
import { useFacts } from 'directive/lit';

class Controls extends LitElement {
  private facts = useFacts(system);

  handleClick() {
    this.facts.count = (this.facts.count ?? 0) + 1;
  }
}
```

### useDispatch

Get a typed dispatch function:

```typescript
import { useDispatch } from 'directive/lit';

class Controls extends LitElement {
  private dispatch = useDispatch(system);

  handleClick() {
    this.dispatch({ type: 'tick' });
  }
}
```

### useEvents

Get a typed reference to the system's event dispatchers:

```typescript
import { useEvents } from 'directive/lit';

class Controls extends LitElement {
  private events = useEvents(system);

  handleClick() {
    this.events.increment();
  }
}
```

### shallowEqual

Re-exported utility for custom equality in selectors:

```typescript
import { shallowEqual } from 'directive/lit';

class UserIds extends LitElement {
  private ids = new FactSelectorController<User[], number[]>(
    this, system, 'users',
    (users) => users?.map(u => u.id) ?? [],
    shallowEqual
  );
}
```

### TimeTravelController

Reactive controller for time-travel state. Updates the host element when snapshot state changes:

```typescript
import { TimeTravelController } from 'directive/lit';

class UndoControls extends LitElement {
  private _tt = new TimeTravelController(this, system);

  render() {
    const tt = this._tt.value;
    if (!tt) return html``;

    return html`
      <button @click=${tt.undo} ?disabled=${!tt.canUndo}>Undo</button>
      <button @click=${tt.redo} ?disabled=${!tt.canRedo}>Redo</button>
      <span>${tt.currentIndex + 1} / ${tt.totalSnapshots}</span>
    `;
  }
}
```

### useTimeTravel

Non-reactive shorthand to read time-travel state (useful outside Lit elements):

```typescript
import { useTimeTravel } from 'directive/lit';

const tt = useTimeTravel(system);
tt?.undo();
tt?.redo();
```

Returns `null` when time-travel is disabled. See [Time-Travel](/docs/advanced/time-travel) for changesets and keyboard shortcuts.

### getDerivation / getFact

Non-reactive getter functions (return a function you call to read the current value):

```typescript
import { getDerivation, getFact } from 'directive/lit';

const getIsRed = getDerivation<boolean>(system, 'isRed');
const getPhase = getFact<string>(system, 'phase');

console.log(getIsRed()); // Current value, non-reactive
console.log(getPhase()); // Current value, non-reactive
```

---

## Scoped Systems

### SystemController

Create a system scoped to a component's lifecycle. The system starts on connect and is destroyed on disconnect:

```typescript
import { SystemController, DerivationController } from 'directive/lit';
import { counterModule } from './modules/counter';

class CounterElement extends LitElement {
  private directive = new SystemController(this, counterModule);

  // Access the system for other controllers in connectedCallback
  private count?: DerivationController<number>;

  connectedCallback() {
    super.connectedCallback();
    this.count = new DerivationController<number>(
      this, this.directive.system, 'count'
    );
  }

  render() {
    return html`
      <button @click=${() => this.directive.system.facts.count++}>
        Count: ${this.count?.value ?? 0}
      </button>
    `;
  }
}
```

You can also pass full system options:

```typescript
class AppElement extends LitElement {
  private directive = new SystemController(this, {
    module: myModule,
    plugins: [loggingPlugin()],
    debug: { timeTravel: true },
  });
}
```

---

## Typed Hooks

Create typed controllers for your module schema. The factory also returns `useEvents`:

```typescript
import { createTypedHooks } from 'directive/lit';
import type { ModuleSchema } from 'directive';

const {
  createDerivation,
  createFact,
  useDispatch,
  useFacts,
  useEvents,
} = createTypedHooks<typeof myModule.schema>();

class Counter extends LitElement {
  private count = createFact(this, system, 'count');       // Type: FactController<number>
  private doubled = createDerivation(this, system, 'doubled'); // Type: DerivationController<number>
  private dispatch = useDispatch(system);
  private events = useEvents(system);                       // Typed event dispatchers

  handleClick() {
    this.events.increment(); // Typed!
  }
}
```

---

## Context Protocol

Use `@lit/context` to share a system across shadow DOM boundaries:

```typescript
import { provide, consume } from '@lit/context';
import { directiveContext } from 'directive/lit';

@customElement('app-root')
class AppRoot extends LitElement {
  @provide({ context: directiveContext })
  system = createSystem({ module: myModule });

  connectedCallback() {
    super.connectedCallback();
    this.system.start();
  }
}

@customElement('child-widget')
class ChildWidget extends LitElement {
  @consume({ context: directiveContext })
  system!: System<typeof myModule.schema>;

  private count = new DerivationController<number>(this, this.system, 'count');

  render() {
    return html`<span>Count: ${this.count.value}</span>`;
  }
}
```

---

## Patterns

### Loading States

```typescript
class UserCard extends LitElement {
  private loading = new FactController<boolean>(this, system, 'loading');
  private user = new FactController<User | null>(this, system, 'user');
  private status = new RequirementStatusController(this, statusPlugin, 'FETCH_USER');

  render() {
    if (this.loading.value) return html`<spinner-el></spinner-el>`;
    if (this.status.value.hasError)
      return html`<error-el .message=${this.status.value.lastError?.message}></error-el>`;
    if (!this.user.value) return html`<empty-state></empty-state>`;
    return html`<user-details .user=${this.user.value}></user-details>`;
  }
}
```

### Multiple Systems

Use separate controllers for different systems:

```typescript
class Dashboard extends LitElement {
  private userName = new DerivationController<string>(this, authSystem, 'displayName');
  private cartCount = new DerivationController<number>(this, cartSystem, 'itemCount');

  render() {
    return html`
      <header>${this.userName.value}</header>
      <cart-badge .count=${this.cartCount.value}></cart-badge>
    `;
  }
}
```

---

## Testing

```typescript
import { fixture, html, expect } from '@open-wc/testing';
import { createTestSystem } from 'directive/testing';
import { counterModule } from './modules/counter';
import './my-counter';

it('displays the count', async () => {
  const system = createTestSystem({ module: counterModule });
  system.facts.count = 5;

  const el = await fixture(html`<my-counter></my-counter>`);
  expect(el.shadowRoot?.textContent).to.contain('5');
});
```

---

## Deprecated

The following controllers and factories still work but will be removed in a future release. They delegate to the consolidated API internally.

### Deprecated Controllers

| Deprecated | Use Instead |
|---|---|
| `InspectThrottledController(host, system, ms)` | `InspectController(host, system, { throttleMs: ms })` |
| `RequirementsController(host, system)` | `InspectController(host, system)` |
| `RequirementsThrottledController(host, system, ms)` | `InspectController(host, system, { throttleMs: ms })` |
| `IsSettledController(host, system)` | `InspectController(host, system)` then `.value.isSettled` |
| `IsResolvingController(host, plugin, type)` | `RequirementStatusController(host, plugin, type)` then `.value.inflight > 0` |
| `LatestErrorController(host, plugin, type)` | `RequirementStatusController(host, plugin, type)` then `.value.lastError` |
| `RequirementStatusesController(host, plugin)` | Individual `RequirementStatusController` instances |

### Deprecated Factories

| Deprecated | Use Instead |
|---|---|
| `createInspectThrottled(host, system, ms)` | `createInspect(host, system, { throttleMs: ms })` |
| `createRequirements(host, system)` | `createInspect(host, system)` |
| `createRequirementsThrottled(host, system, ms)` | `createInspect(host, system, { throttleMs: ms })` |
| `createIsSettled(host, system)` | `createInspect(host, system)` then `.value.isSettled` |
| `createIsResolving(host, plugin, type)` | `createRequirementStatus(host, plugin, type)` then `.value.inflight > 0` |
| `createLatestError(host, plugin, type)` | `createRequirementStatus(host, plugin, type)` then `.value.lastError` |
| `createRequirementStatuses(host, plugin)` | Individual `createRequirementStatus` calls |

---

## Next Steps

- **[Quick Start](/docs/quick-start)** -- Build your first module
- **[Facts](/docs/facts)** -- State management deep dive
- **[Testing](/docs/testing/overview)** -- Testing components with Directive
