---
title: Integrations
description: How Directive connects to other libraries, plus migration guides for switching from Redux, Zustand, or XState.
---

Directive exposes standard reactive primitives that connect naturally to any state management library. Run side-by-side, or migrate fully with step-by-step guides. {% .lead %}

---

## Philosophy: Better Together

Directive doesn't replace your existing tools. It adds a **constraint layer** on top of them.

Your existing library handles **what** your state looks like and **how** it changes. Directive adds **when** – constraints that evaluate across state and automatically trigger the right behavior.

- **Redux** dispatches actions → Directive decides when actions need dispatching
- **Zustand** holds UI state → Directive evaluates rules across that state
- **XState** transitions machines → Directive coordinates multiple machines
- **React Query** fetches data → Directive decides when to fetch, prefetch, or invalidate

The result: your existing library keeps doing what it's good at, while Directive handles orchestration that would otherwise be scattered across useEffects and event handlers.

---

## Interop Primitives

Directive ships six primitives that make external integration trivial:

| Primitive | Signature | Use case |
|-----------|-----------|----------|
| `system.subscribe` | `(keys: string[], fn: () => void) => () => void` | React to fact/derivation changes, push into external stores |
| `system.watch` | `(key: string, fn: (value, prev) => void, opts?) => () => void` | Fine-grained sync with previous value comparison |
| `system.batch` | `(fn: () => void) => void` | Bulk-import external state without notification storms |
| `system.dispatch` | `(event: { type: string; ... }) => void` | Forward external actions as Directive events |
| `system.getDistributableSnapshot` | `(options?) => { data, createdAt, ... }` | Serialize full state for any consumer |
| Plugin `onFactSet` | `(key: string, value: unknown, prev: unknown) => void` | Intercept every fact write for devtools/logging |

---

## General Pattern: External → Directive

Subscribe to the external store and batch-write into Directive facts. Always use `batch()` to coalesce multiple fact writes into a single notification cycle:

```typescript
const unsubscribe = externalStore.subscribe((state) => {
  system.batch(() => {
    system.facts.count = state.count;
    system.facts.status = state.status;
  });
});

// Clean up when done
// unsubscribe();
```

{% callout type="warning" title="Always batch multi-key writes" %}
Without `batch()`, each fact assignment fires its own notification cycle. This can cause derivations and constraints to evaluate with partially-updated state.
{% /callout %}

### Error Handling

External subscriptions can fire during teardown or with unexpected values. Wrap the sync body:

```typescript
const unsubscribe = externalStore.subscribe((state) => {
  try {
    system.batch(() => {
      system.facts.count = state.count;
    });
  } catch (err) {
    console.error('Sync from external store failed:', err);
  }
});
```

---

## General Pattern: Directive → External

Watch Directive facts and push changes to the external store. The `watch` callback receives both the new and previous value:

```typescript
const unwatch = system.watch('count', (value, prev) => {
  externalStore.setState({ count: value });
});

// Clean up when done
// unwatch();
```

Use the `equalityFn` option to control when the callback fires:

```typescript
const unwatch = system.watch('derivedResult', (value) => {
  externalStore.setState({ result: value });
}, {
  equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});
```

---

## Choosing the Right Primitive

| Scenario | Primitive | Why |
|----------|-----------|-----|
| Import multiple keys from external store | `system.batch()` inside external subscribe | Coalesces writes, single notification |
| React to a single Directive key changing | `system.watch(key, fn)` | Gives you new + previous value |
| React to any of several keys changing | `system.subscribe([keys], fn)` | Single listener for multiple keys |
| Mirror every fact change to devtools | Plugin `onFactSet` | Fires for every write, zero overhead to register |
| Forward external actions into Directive | `system.dispatch(event)` | Events flow into event handlers and constraints |
| Export full state for serialization | `system.getDistributableSnapshot()` | Full state capture with metadata |

---

## Lifecycle and Cleanup

Every interop subscription must be cleaned up. In React, use `useEffect`:

```typescript
useEffect(() => {
  // External → Directive
  const unsub = externalStore.subscribe((state) => {
    system.batch(() => {
      system.facts.value = state.value;
    });
  });

  // Directive → External
  const unwatch = system.watch('result', (value) => {
    externalStore.setState({ result: value });
  });

  return () => {
    unsub();
    unwatch();
  };
}, [system, externalStore]);
```

For framework-agnostic code, call the cleanup functions when your component or service tears down.

---

## Avoiding Infinite Loops

When syncing bidirectionally, a change in Store A updates Store B, which triggers a change back in Store A. Prevent this with a guard flag:

```typescript
let syncing = false;

// External → Directive
externalStore.subscribe((state) => {
  if (syncing) {
    return;
  }

  syncing = true;
  system.batch(() => {
    system.facts.count = state.count;
  });
  syncing = false;
});

// Directive → External
system.watch('count', (value) => {
  if (syncing) {
    return;
  }

  syncing = true;
  externalStore.setState({ count: value });
  syncing = false;
});
```

{% callout type="note" title="Any subscribe API works" %}
Using a library not listed below? The general pattern above works with any store that exposes a subscribe API.
{% /callout %}

---

## Library Guides

| Library | What it adds | Key pattern |
|---------|-------------|-------------|
| [Redux](/docs/works-with/redux) | Predictable state + DevTools | `store.subscribe(() => { const s = store.getState(); ... })` – listener gets no args |
| [Zustand](/docs/works-with/zustand) | Minimal UI state | `store.subscribe((state, prev) => ...)` – listener gets both current and previous state |
| [XState](/docs/works-with/xstate) | State machines + actors | `actor.subscribe(fn)` returns `{ unsubscribe }`, not a bare function |
| [React Query](/docs/works-with/react-query) | Server cache + fetching | `queryCache.subscribe(event => ...)` – event-driven with typed event objects |

### First-Party Adapters

These are built into Directive and don't use the subscribe patterns above:

| Adapter | What it does |
|---------|-------------|
| [Web Worker](/docs/works-with/worker) | Run the Directive engine off the main thread with a type-safe client |

---

## Concept Mapping

Key concept mapping when adopting Directive alongside existing libraries:

| From | Key Mapping |
|------|------------|
| [Redux](/docs/works-with/redux) | Slices → Modules, actions → events, selectors → derivations, thunks → resolvers |
| [Zustand](/docs/works-with/zustand) | Stores → Modules, set → events, get → derivations, middleware → plugins |
| [XState](/docs/works-with/xstate) | Machines → Modules, states → facts, transitions → events, services → resolvers |

---

## Next Steps

- Pick the library you're using and follow its guide above
- **[Installation](/docs/installation)** – Get Directive installed in your project
- **[Core API](/docs/core-api)** – Full reference for subscribe, watch, batch, and dispatch
- **[Plugins](/docs/plugins/overview)** – Use plugin hooks for cross-cutting interop logic
