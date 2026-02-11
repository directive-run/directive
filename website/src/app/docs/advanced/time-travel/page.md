---
title: Time-Travel
description: Debug your application with time-travel state navigation.
---

Navigate through state history for debugging. {% .lead %}

---

## Enable Time-Travel

```typescript
const system = createSystem({
  module: myModule,

  // Enable time-travel and cap history at 100 snapshots
  debug: {
    timeTravel: true,
    maxSnapshots: 100,
  },
});
```

When enabled, `system.debug` exposes the time-travel API. When disabled, `system.debug` is `null`.

---

## Basic Navigation

```typescript
// system.debug is null when time-travel is disabled
const tt = system.debug; // TimeTravelAPI | null

if (tt) {
  // Inspect the current snapshot history
  console.log(`${tt.snapshots.length} snapshots`);
  console.log(`Currently at index ${tt.currentIndex}`);

  // Step backward through history (one step by default)
  tt.goBack();

  // Jump back multiple steps at once
  tt.goBack(3);

  // Step forward (redo)
  tt.goForward();

  // Jump directly to a specific snapshot by its index
  tt.goTo(5);
}
```

---

## Snapshot Structure

Each snapshot contains:

```typescript
interface Snapshot {
  id: number;                       // Auto-incrementing snapshot identifier
  timestamp: number;                // When the snapshot was captured (Date.now())
  facts: Record<string, unknown>;   // Complete copy of all fact values
  trigger: string;                  // What caused this snapshot (e.g., "fact:count")
}
```

The `trigger` string describes what caused the snapshot (e.g., a fact change or resolver completion).

---

## Export / Import

Save and restore an entire debugging session:

```typescript
const tt = system.debug;

if (tt) {
  // Serialize the entire snapshot history to a JSON string
  const exported = tt.export();
  localStorage.setItem('debug-session', exported);

  // Restore a previously saved session (e.g., after a page refresh)
  const saved = localStorage.getItem('debug-session');
  if (saved) {
    tt.import(saved);
  }
}
```

---

## Replay

Replay from the current snapshot forward:

```typescript
const tt = system.debug;

if (tt) {
  // Rewind to snapshot 5, then replay all subsequent snapshots forward
  tt.goTo(5);
  tt.replay();
}
```

---

## Undo Groups (Changesets)

A single user action often produces multiple snapshots (e.g., moving a piece changes the board, clears selection, and switches turns). Without grouping, undo goes back one snapshot – not one logical action.

Use `beginChangeset` / `endChangeset` to group snapshots into a single undo/redo unit:

```typescript
const tt = system.debug;

if (tt) {
  // Group multiple snapshots into one logical "undo" unit
  tt.beginChangeset("Move piece from A to B");
  // ... multiple fact mutations happen here ...
  tt.endChangeset();

  // Undo reverts the entire changeset, not individual snapshots
  tt.goBack();
}
```

---

## Reactive `useTimeTravel` Hook

Each framework adapter provides a reactive `useTimeTravel` that re-renders when snapshot state changes. Returns a `TimeTravelState` object:

```typescript
interface TimeTravelState {
  canUndo: boolean;          // True when there are earlier snapshots to go back to
  canRedo: boolean;          // True when there are later snapshots to go forward to
  undo: () => void;          // Navigate one step backward in history
  redo: () => void;          // Navigate one step forward in history
  currentIndex: number;      // Position in the snapshot array
  totalSnapshots: number;    // Total number of recorded snapshots
}
```

### React

```tsx
import { useTimeTravel } from 'directive/react';

function UndoControls() {
  // Returns null when time-travel is disabled, so the UI can hide itself
  const tt = useTimeTravel(system);
  if (!tt) return null;

  return (
    <div>
      <button onClick={tt.undo} disabled={!tt.canUndo}>Undo</button>
      <button onClick={tt.redo} disabled={!tt.canRedo}>Redo</button>
      <span>{tt.currentIndex + 1} / {tt.totalSnapshots}</span>
    </div>
  );
}
```

### Vue

```vue
<script setup>
import { useTimeTravel } from 'directive/vue';

// Reactive ref – re-renders when snapshot state changes
const tt = useTimeTravel();
</script>

<template>
  <!-- Only show controls when time-travel is enabled -->
  <div v-if="tt">
    <button @click="tt.undo" :disabled="!tt.canUndo">Undo</button>
    <button @click="tt.redo" :disabled="!tt.canRedo">Redo</button>
  </div>
</template>
```

### Svelte

```svelte
<script>
import { useTimeTravel } from 'directive/svelte';

// Svelte store – use $tt to auto-subscribe in the template
const tt = useTimeTravel();
</script>

{#if $tt}
  <button on:click={$tt.undo} disabled={!$tt.canUndo}>Undo</button>
  <button on:click={$tt.redo} disabled={!$tt.canRedo}>Redo</button>
{/if}
```

### Solid

```tsx
import { useTimeTravel } from 'directive/solid';

function UndoControls() {
  // Solid signal – call tt() to read the current value
  const tt = useTimeTravel();

  return (
    <Show when={tt()}>
      {(state) => (
        <>
          <button onClick={state().undo} disabled={!state().canUndo}>Undo</button>
          <button onClick={state().redo} disabled={!state().canRedo}>Redo</button>
        </>
      )}
    </Show>
  );
}
```

### Lit

```typescript
import { TimeTravelController } from 'directive/lit';

class UndoControls extends LitElement {
  // Lit reactive controller – triggers re-render on snapshot changes
  private _tt = new TimeTravelController(this, system);

  render() {
    const tt = this._tt.value;
    if (!tt) return html``;

    return html`
      <button @click=${tt.undo} ?disabled=${!tt.canUndo}>Undo</button>
      <button @click=${tt.redo} ?disabled=${!tt.canRedo}>Redo</button>
    `;
  }
}
```

---

## Keyboard Shortcuts

Common keyboard shortcuts for time-travel:

```typescript
// Wire up standard undo/redo keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();

    if (e.shiftKey) {
      system.debug?.goForward();  // Cmd+Shift+Z = Redo
    } else {
      system.debug?.goBack();     // Cmd+Z = Undo
    }
  }
});
```

---

## Next Steps

- See [Snapshots](/docs/advanced/snapshots) for state serialization
- See [DevTools](/docs/plugins/devtools) for browser integration
- See [Testing](/docs/testing/overview) for debugging tests
