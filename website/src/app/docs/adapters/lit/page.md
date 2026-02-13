---
title: Lit Adapter
description: Use Directive with Lit web components using reactive controllers. DerivedController, FactController, InspectController, ExplainController, ModuleController, and more.
---

Directive provides native Lit integration using the Reactive Controller pattern. Controllers automatically subscribe on connect and clean up on disconnect. {% .lead %}

---

## Installation

The Lit adapter is included in the main package:

```typescript
import { DerivedController, FactController, createDerived } from 'directive/lit';
```

---

## Setup

Create your system and start it in `connectedCallback`:

```typescript
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { createSystem } from 'directive';
import { DerivedController, FactController } from 'directive/lit';
import { counterModule } from './modules/counter';

// Create and start the system
const system = createSystem({ module: counterModule });
system.start();

@customElement('my-counter')
class MyCounter extends LitElement {
  // Subscribe to the count derivation – re-renders when it changes
  private count = new DerivedController<number>(this, system, 'count');

  render() {
    return html`
      <div>
        <p>Count: ${this.count.value}</p>
        <button @click=${() => system.facts.count--}>-</button>
        <button @click=${() => system.facts.count++}>+</button>
      </div>
    `;
  }
}
```

Each controller calls `host.addController(this)` in its constructor, subscribes in `hostConnected`, and unsubscribes in `hostDisconnected`. You never manage subscriptions manually.

---

## Core Controllers

### DerivedController

Subscribe to one or more derivations. The host re-renders when any value changes.

Single key:

```typescript
import { DerivedController } from 'directive/lit';

class StatusDisplay extends LitElement {
  // Subscribe to the isRed derivation – re-renders when it changes
  private isRed = new DerivedController<boolean>(this, system, 'isRed');

  render() {
    return html`<div>${this.isRed.value ? 'Red' : 'Not Red'}</div>`;
  }
}
```

Array of keys:

```typescript
import { DerivedController } from 'directive/lit';

class StatusBar extends LitElement {
  // Subscribe to multiple derivations at once
  private state = new DerivedController<{ isRed: boolean; elapsed: number }>(
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
  // Subscribe to the current phase – re-renders when it changes
  private phase = new FactController<string>(this, system, 'phase');

  render() {
    return html`<div>Current phase: ${this.phase.value}</div>`;
  }
}
```

### WatchController

Watch a fact or derivation and fire a callback on change (no re-render). The key is auto-detected as either a fact or derivation, so no discriminator is needed:

```typescript
import { WatchController } from 'directive/lit';

class PhaseWatcher extends LitElement {
  // Watch the phase derivation for logging -- auto-detected
  private watcher = new WatchController<string>(
    this, system, 'phase',
    (newPhase, oldPhase) => {
      console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
    }
  );

  // Watch the count fact for logging -- auto-detected, no discriminator needed
  private countWatcher = new WatchController<number>(
    this, system, 'count',
    (newCount, oldCount) => {
      console.log(`Count changed from ${oldCount} to ${newCount}`);
    }
  );
}
```

{% callout type="warning" title="Deprecated: fact discriminator object" %}
The old `{ kind: "fact", factKey: "key" }` options pattern still works but is deprecated. Use the string key directly instead -- the runtime auto-detects whether the key is a fact or derivation.

```typescript
// Deprecated -- still works but not recommended
private watcher = new WatchController<number>(
  this, system,
  { kind: "fact", factKey: "count" },
  (newCount, oldCount) => { /* ... */ }
);

// Preferred -- auto-detects fact vs derivation
private watcher = new WatchController<number>(
  this, system, 'count',
  (newCount, oldCount) => { /* ... */ }
);
```
{% /callout %}

---

## Inspection Controllers

### InspectController

Get system inspection data with optional throttling. Returns `InspectState` with `isSettled`, `unmet`, `inflight`, `isWorking`, `hasUnmet`, and `hasInflight`:

```typescript
import { InspectController } from 'directive/lit';

class Inspector extends LitElement {
  // Get reactive system inspection data
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
  // Throttle inspection updates to limit render frequency
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
  // Get a detailed explanation of why the FETCH_USER requirement exists
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
  // Get all constraints for the debug panel
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
  // Check a specific constraint by ID
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
  // Set up optimistic mutations with automatic rollback
  private optimistic = new OptimisticUpdateController(
    this, system, statusPlugin, 'SAVE_DATA'
  );

  handleSave() {
    this.optimistic.mutate(() => {
      // Optimistically update the UI before the server responds
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

Manual rollback is also available via `rollback()`. The `statusPlugin` and `requirementType` parameters are optional – without them, you get manual-only rollback.

### ModuleController

Zero-config all-in-one controller. Creates a system scoped to the component lifecycle, starts it, and subscribes to all facts and derivations:

```typescript
import { ModuleController } from 'directive/lit';
import { counterModule } from './modules/counter';

class CounterApp extends LitElement {
  // Create a zero-config scoped system tied to this element's lifecycle
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
  // Create a scoped system with plugins, time-travel, and status tracking
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

## Selector Controller

Use `DirectiveSelectorController` for all transforms and derived values from facts. It auto-tracks which fact keys your selector reads and subscribes only to those.

### DirectiveSelectorController

Select across all facts:

```typescript
import { DirectiveSelectorController } from 'directive/lit';

class Summary extends LitElement {
  // Select across all facts with custom equality
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

Transform a single fact:

```typescript
class UserName extends LitElement {
  // Derive the user's display name – only re-renders when the name changes
  private userName = new DirectiveSelectorController<string>(
    this, system,
    (facts) => facts.user?.name ?? 'Guest',
  );

  render() {
    return html`<span>${this.userName.value}</span>`;
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

// Create the status plugin for tracking requirement resolution
const statusPlugin = createRequirementStatusPlugin();

// Pass the plugin when creating the system
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
  // Track the loading state of the FETCH_USER requirement
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
  createDerived,
  createFact,
  createInspect,
  createRequirementStatus,
  createWatch,
  createDirectiveSelector,
  createExplain,
  createConstraintStatus,
  createOptimisticUpdate,
  createModule,
} from 'directive/lit';

class MyElement extends LitElement {
  // These two are equivalent:
  private isRed = new DerivedController<boolean>(this, system, 'isRed');
  private isRed2 = createDerived<boolean>(this, system, 'isRed');

  // Subscribe to a single fact
  private phase = createFact<string>(this, system, 'phase');

  // Subscribe to multiple derivations as a single object
  private state = createDerived<{ isRed: boolean }>(this, system, ['isRed']);

  // Get system inspection with throttling
  private inspection = createInspect(this, system, { throttleMs: 100 });

  // Get a requirement explanation
  private explanation = createExplain(this, system, 'FETCH_USER');

  // Get all constraint statuses
  private constraints = createConstraintStatus(this, system);

  // Get a single constraint by ID
  private authConstraint = createConstraintStatus(this, system, 'requireAuth');

  // Set up optimistic mutations with rollback
  private optimistic = createOptimisticUpdate(this, system, statusPlugin, 'SAVE_DATA');
}
```

The `createModule` factory creates a `ModuleController`:

```typescript
class CounterApp extends LitElement {
  // Create a scoped system with the module factory
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

### useDispatch

Get a typed dispatch function:

```typescript
import { useDispatch } from 'directive/lit';

class Controls extends LitElement {
  // Get a typed dispatch function for sending events
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
  // Get typed event dispatchers for the system
  private events = useEvents(system);

  handleClick() {
    this.events.increment();
  }
}
```

### shallowEqual

Re-exported utility for custom equality in selectors:

```typescript
import { shallowEqual, DirectiveSelectorController } from 'directive/lit';

class UserIds extends LitElement {
  // Use shallowEqual to prevent re-renders when IDs haven't changed
  private ids = new DirectiveSelectorController<number[]>(
    this, system,
    (facts) => facts.users?.map(u => u.id) ?? [],
    shallowEqual,
  );
}
```

### TimeTravelController

Reactive controller — returns `null` when disabled, otherwise the full `TimeTravelState`. Destructure in `render()` to pull out what you need:

#### Undo / Redo Controls

```typescript
import { TimeTravelController } from 'directive/lit';

class UndoRedo extends LitElement {
  private _timeTravel = new TimeTravelController(this, system);

  render() {
    const timeTravel = this._timeTravel.value;

    if (!timeTravel) {
      return html``;
    }

    const { canUndo, canRedo, undo, redo, currentIndex, totalSnapshots } = timeTravel;

    return html`
      <button @click=${undo} ?disabled=${!canUndo}>Undo</button>
      <button @click=${redo} ?disabled=${!canRedo}>Redo</button>
      <span>${currentIndex + 1} / ${totalSnapshots}</span>
    `;
  }
}
```

#### Snapshot Timeline

`snapshots` is lightweight metadata only (no facts data). Use `getSnapshotFacts(id)` to lazily load a snapshot's state on demand:

```typescript
class SnapshotTimeline extends LitElement {
  private _timeTravel = new TimeTravelController(this, system);

  render() {
    const timeTravel = this._timeTravel.value;

    if (!timeTravel) {
      return html``;
    }

    const { snapshots, goTo, getSnapshotFacts } = timeTravel;

    return html`
      <ul>
        ${snapshots.map((snap) => html`
          <li>
            <button @click=${() => goTo(snap.id)}>
              ${snap.trigger} — ${new Date(snap.timestamp).toLocaleTimeString()}
            </button>
            <button @click=${() => console.log(getSnapshotFacts(snap.id))}>
              Inspect
            </button>
          </li>
        `)}
      </ul>
    `;
  }
}
```

#### Navigation, Session Persistence & Recording

```typescript
class TimeTravelControls extends LitElement {
  private _timeTravel = new TimeTravelController(this, system);

  render() {
    const timeTravel = this._timeTravel.value;

    if (!timeTravel) {
      return html``;
    }

    const {
      goBack, goForward, goTo, replay,
      exportSession, importSession,
      isPaused, pause, resume,
    } = timeTravel;

    return html`
      <!-- Navigation -->
      <button @click=${() => goBack(5)}>Back 5</button>
      <button @click=${() => goForward(5)}>Forward 5</button>
      <button @click=${() => goTo(0)}>Jump to Start</button>
      <button @click=${replay}>Replay All</button>

      <!-- Session persistence -->
      <button @click=${() => localStorage.setItem('debug', exportSession())}>
        Save Session
      </button>
      <button @click=${() => {
        const saved = localStorage.getItem('debug');
        if (saved) {
          importSession(saved);
        }
      }}>
        Restore Session
      </button>

      <!-- Recording control -->
      <button @click=${isPaused ? resume : pause}>
        ${isPaused ? 'Resume' : 'Pause'} Recording
      </button>
    `;
  }
}
```

#### Changesets

Group multiple fact mutations into a single undo/redo unit:

```typescript
class BatchedAction extends LitElement {
  private _timeTravel = new TimeTravelController(this, system);

  private _handleComplexAction() {
    this._timeTravel.value?.beginChangeset('Move piece A→B');
    // ... multiple fact mutations ...
    this._timeTravel.value?.endChangeset();
    // Now undo/redo treats all mutations as one step
  }

  render() {
    return html`<button @click=${this._handleComplexAction}>Move Piece</button>`;
  }
}
```

### useTimeTravel

Non-reactive shorthand (useful outside Lit elements for imperative code):

```typescript
import { useTimeTravel } from 'directive/lit';

const timeTravel = useTimeTravel(system);

if (timeTravel) {
  const { undo, redo, goTo, goBack, goForward, replay } = timeTravel;
  const { exportSession, importSession } = timeTravel;
  const { beginChangeset, endChangeset } = timeTravel;
  const { isPaused, pause, resume } = timeTravel;

  // Navigate
  undo();
  goBack(3);
  goTo(0);

  // Persist
  localStorage.setItem('debug', exportSession());

  // Changesets
  beginChangeset('batch edit');
  // ... mutations ...
  endChangeset();

  // Recording
  isPaused ? resume() : pause();
}
```

See [Time-Travel](/docs/advanced/time-travel) for the full `TimeTravelState` interface and keyboard shortcuts.

### getDerived / getFact

Non-reactive getter functions (return a function you call to read the current value):

```typescript
import { getDerived, getFact } from 'directive/lit';

// Create non-reactive getters for reading values on demand
const getIsRed = getDerived<boolean>(system, 'isRed');
const getPhase = getFact<string>(system, 'phase');

console.log(getIsRed()); // Current value, non-reactive
console.log(getPhase()); // Current value, non-reactive
```

---

## Scoped Systems

### SystemController

Create a system scoped to a component's lifecycle. The system starts on connect and is destroyed on disconnect:

```typescript
import { SystemController, DerivedController } from 'directive/lit';
import { counterModule } from './modules/counter';

class CounterElement extends LitElement {
  // Create a system scoped to this element's lifecycle
  private directive = new SystemController(this, counterModule);

  // Access the scoped system for other controllers
  private count?: DerivedController<number>;

  connectedCallback() {
    super.connectedCallback();
    this.count = new DerivedController<number>(
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
  // Create a system with plugins and time-travel debugging
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

// Create typed controller factories pre-bound to your schema
const {
  createDerived,
  createFact,
  useDispatch,
  useEvents,
} = createTypedHooks<typeof myModule.schema>();

class Counter extends LitElement {
  // Fully typed – key autocompletes, return type inferred
  private count = createFact(this, system, 'count');       // Type: FactController<number>
  private doubled = createDerived(this, system, 'doubled'); // Type: DerivedController<number>
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

// Share the system with all descendant elements via Lit context
@customElement('app-root')
class AppRoot extends LitElement {
  @provide({ context: directiveContext })
  system = createSystem({ module: myModule });

  connectedCallback() {
    super.connectedCallback();
    this.system.start();
  }
}

// Consume the system from an ancestor provider
@customElement('child-widget')
class ChildWidget extends LitElement {
  @consume({ context: directiveContext })
  system!: System<typeof myModule.schema>;

  private count = new DerivedController<number>(this, this.system, 'count');

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
  // Subscribe to loading and user state
  private loading = new FactController<boolean>(this, system, 'loading');
  private user = new FactController<User | null>(this, system, 'user');

  // Track the loading state of the fetch requirement
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
  // Subscribe to derivations from different systems
  private userName = new DerivedController<string>(this, authSystem, 'displayName');
  private cartCount = new DerivedController<number>(this, cartSystem, 'itemCount');

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
  // Create a test system with mock data
  const system = createTestSystem({ module: counterModule });
  system.facts.count = 5;

  const el = await fixture(html`<my-counter></my-counter>`);
  expect(el.shadowRoot?.textContent).to.contain('5');
});
```

---

## Next Steps

- **[Quick Start](/docs/quick-start)** – Build your first module
- **[Facts](/docs/facts)** – State management deep dive
- **[Testing](/docs/testing/overview)** – Testing components with Directive
