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

Each framework adapter provides a reactive `useTimeTravel` that re-renders when snapshot state changes. Returns `null` when time-travel is disabled, otherwise a `TimeTravelState` object:

```typescript
interface SnapshotMeta {
  id: number;                // Snapshot identifier
  timestamp: number;         // When captured (Date.now())
  trigger: string;           // What caused this snapshot (e.g., "fact:count")
}

interface TimeTravelState {
  // Undo / Redo
  canUndo: boolean;          // True when there are earlier snapshots
  canRedo: boolean;          // True when there are later snapshots
  undo: () => void;          // One step backward (changeset-aware)
  redo: () => void;          // One step forward (changeset-aware)
  currentIndex: number;      // Position in the snapshot array
  totalSnapshots: number;    // Total number of recorded snapshots

  // Snapshot access (metadata only — keeps re-renders cheap)
  snapshots: SnapshotMeta[];
  getSnapshotFacts: (id: number) => Record<string, unknown> | null;

  // Navigation
  goTo: (snapshotId: number) => void;   // Jump to a specific snapshot
  goBack: (steps: number) => void;      // Go back N steps
  goForward: (steps: number) => void;   // Go forward N steps
  replay: () => void;                   // Rewind to first snapshot

  // Session persistence
  exportSession: () => string;          // Serialize history to JSON
  importSession: (json: string) => void; // Restore from JSON

  // Changesets (group multiple snapshots into one undo unit)
  beginChangeset: (label: string) => void;
  endChangeset: () => void;

  // Recording control
  isPaused: boolean;         // Whether snapshot recording is paused
  pause: () => void;         // Pause recording
  resume: () => void;        // Resume recording
}
```

### React

```tsx
import { useTimeTravel } from 'directive/react';

function TimeTravelToolbar() {
  const tt = useTimeTravel(system);
  if (!tt) return null;

  return (
    <div>
      {/* Basic undo / redo */}
      <button onClick={tt.undo} disabled={!tt.canUndo}>Undo</button>
      <button onClick={tt.redo} disabled={!tt.canRedo}>Redo</button>
      <span>{tt.currentIndex + 1} / {tt.totalSnapshots}</span>

      {/* Snapshot timeline */}
      <ul>
        {tt.snapshots.map((snap) => (
          <li key={snap.id}>
            <button onClick={() => tt.goTo(snap.id)}>
              {snap.trigger} — {new Date(snap.timestamp).toLocaleTimeString()}
            </button>
          </li>
        ))}
      </ul>

      {/* Session persistence */}
      <button onClick={() => navigator.clipboard.writeText(tt.exportSession())}>
        Copy Session
      </button>

      {/* Recording control */}
      <button onClick={tt.isPaused ? tt.resume : tt.pause}>
        {tt.isPaused ? 'Resume' : 'Pause'} Recording
      </button>
    </div>
  );
}
```

### Vue

```html
<script setup>
import { useTimeTravel } from 'directive/vue';
import { system } from './system';

const tt = useTimeTravel(system);
</script>

<template>
  <div v-if="tt">
    <!-- Basic undo / redo -->
    <button @click="tt.undo" :disabled="!tt.canUndo">Undo</button>
    <button @click="tt.redo" :disabled="!tt.canRedo">Redo</button>
    <span>{{ tt.currentIndex + 1 }} / {{ tt.totalSnapshots }}</span>

    <!-- Snapshot timeline -->
    <ul>
      <li v-for="snap in tt.snapshots" :key="snap.id">
        <button @click="tt.goTo(snap.id)">
          {{ snap.trigger }} — {{ new Date(snap.timestamp).toLocaleTimeString() }}
        </button>
      </li>
    </ul>

    <!-- Session persistence -->
    <button @click="navigator.clipboard.writeText(tt.exportSession())">
      Copy Session
    </button>

    <!-- Recording control -->
    <button @click="tt.isPaused ? tt.resume() : tt.pause()">
      {{ tt.isPaused ? 'Resume' : 'Pause' }} Recording
    </button>
  </div>
</template>
```

### Svelte

```html
<script>
import { useTimeTravel } from 'directive/svelte';
import { system } from '$lib/directive';

const tt = useTimeTravel(system);
</script>

{#if $tt}
  <!-- Basic undo / redo -->
  <button on:click={$tt.undo} disabled={!$tt.canUndo}>Undo</button>
  <button on:click={$tt.redo} disabled={!$tt.canRedo}>Redo</button>
  <span>{$tt.currentIndex + 1} / {$tt.totalSnapshots}</span>

  <!-- Snapshot timeline -->
  <ul>
    {#each $tt.snapshots as snap (snap.id)}
      <li>
        <button on:click={() => $tt.goTo(snap.id)}>
          {snap.trigger} — {new Date(snap.timestamp).toLocaleTimeString()}
        </button>
      </li>
    {/each}
  </ul>

  <!-- Session persistence -->
  <button on:click={() => navigator.clipboard.writeText($tt.exportSession())}>
    Copy Session
  </button>

  <!-- Recording control -->
  <button on:click={$tt.isPaused ? $tt.resume : $tt.pause}>
    {$tt.isPaused ? 'Resume' : 'Pause'} Recording
  </button>
{/if}
```

### Solid

```tsx
import { useTimeTravel } from 'directive/solid';
import { Show, For } from 'solid-js';

function TimeTravelToolbar() {
  const tt = useTimeTravel(system);

  return (
    <Show when={tt()}>
      {(state) => (
        <div>
          {/* Basic undo / redo */}
          <button onClick={state().undo} disabled={!state().canUndo}>Undo</button>
          <button onClick={state().redo} disabled={!state().canRedo}>Redo</button>
          <span>{state().currentIndex + 1} / {state().totalSnapshots}</span>

          {/* Snapshot timeline */}
          <ul>
            <For each={state().snapshots}>
              {(snap) => (
                <li>
                  <button onClick={() => state().goTo(snap.id)}>
                    {snap.trigger} — {new Date(snap.timestamp).toLocaleTimeString()}
                  </button>
                </li>
              )}
            </For>
          </ul>

          {/* Session persistence */}
          <button onClick={() => navigator.clipboard.writeText(state().exportSession())}>
            Copy Session
          </button>

          {/* Recording control */}
          <button onClick={state().isPaused ? state().resume : state().pause}>
            {state().isPaused ? 'Resume' : 'Pause'} Recording
          </button>
        </div>
      )}
    </Show>
  );
}
```

### Lit

```typescript
import { TimeTravelController } from 'directive/lit';

class TimeTravelToolbar extends LitElement {
  private _tt = new TimeTravelController(this, system);

  render() {
    const tt = this._tt.value;
    if (!tt) return html``;

    return html`
      <!-- Basic undo / redo -->
      <button @click=${tt.undo} ?disabled=${!tt.canUndo}>Undo</button>
      <button @click=${tt.redo} ?disabled=${!tt.canRedo}>Redo</button>
      <span>${tt.currentIndex + 1} / ${tt.totalSnapshots}</span>

      <!-- Snapshot timeline -->
      <ul>
        ${tt.snapshots.map((snap) => html`
          <li>
            <button @click=${() => tt.goTo(snap.id)}>
              ${snap.trigger} — ${new Date(snap.timestamp).toLocaleTimeString()}
            </button>
          </li>
        `)}
      </ul>

      <!-- Session persistence -->
      <button @click=${() => navigator.clipboard.writeText(tt.exportSession())}>
        Copy Session
      </button>

      <!-- Recording control -->
      <button @click=${tt.isPaused ? tt.resume : tt.pause}>
        ${tt.isPaused ? 'Resume' : 'Pause'} Recording
      </button>
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
