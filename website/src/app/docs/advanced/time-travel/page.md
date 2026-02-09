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
const tt = system.debug; // TimeTravelAPI | null

if (tt) {
  // View snapshot history
  console.log(`${tt.snapshots.length} snapshots`);
  console.log(`Currently at index ${tt.currentIndex}`);

  // Go back one snapshot
  tt.goBack();

  // Go back multiple steps
  tt.goBack(3);

  // Go forward
  tt.goForward();

  // Jump to a specific snapshot by ID
  tt.goTo(5);
}
```

---

## Snapshot Structure

Each snapshot contains:

```typescript
interface Snapshot {
  id: number;
  timestamp: number;
  facts: Record<string, unknown>;
  trigger: string;
}
```

The `trigger` string describes what caused the snapshot (e.g., a fact change or resolver completion).

---

## Export / Import

Save and restore an entire debugging session:

```typescript
const tt = system.debug;

if (tt) {
  // Export returns a JSON string
  const exported = tt.export();
  localStorage.setItem('debug-session', exported);

  // Import from a JSON string
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
  // Jump back, then replay
  tt.goTo(5);
  tt.replay();
}
```

---

## Undo Groups (Changesets)

A single user action often produces multiple snapshots (e.g., moving a piece changes the board, clears selection, and switches turns). Without grouping, undo goes back one snapshot — not one logical action.

Use `beginChangeset` / `endChangeset` to group snapshots into a single undo/redo unit:

```typescript
const tt = system.debug;

if (tt) {
  tt.beginChangeset("Move piece from A to B");
  // ... multiple fact mutations happen here ...
  tt.endChangeset();

  // Now goBack() jumps past all snapshots in the changeset
  tt.goBack();  // Undoes the entire move, not just one fact change
}
```

---

## Reactive `useTimeTravel` Hook

Each framework adapter provides a reactive `useTimeTravel` that re-renders when snapshot state changes. Returns a `TimeTravelState` object:

```typescript
interface TimeTravelState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  currentIndex: number;
  totalSnapshots: number;
}
```

### React

```tsx
import { useTimeTravel } from 'directive/react';

function UndoControls() {
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

const tt = useTimeTravel();
</script>

<template>
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
