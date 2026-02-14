---
title: Time-Travel & Snapshots
description: Debug your application with time-travel state navigation, and capture, restore, and diff system snapshots.
---

Navigate through state history for debugging, and save or restore complete system state with snapshots. {% .lead %}

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
const timeTravel = system.debug; // TimeTravelAPI | null

if (timeTravel) {
  // Inspect the current snapshot history
  console.log(`${timeTravel.snapshots.length} snapshots`);
  console.log(`Currently at index ${timeTravel.currentIndex}`);

  // Step backward through history (one step by default)
  timeTravel.goBack();

  // Jump back multiple steps at once
  timeTravel.goBack(3);

  // Step forward (redo)
  timeTravel.goForward();

  // Jump directly to a specific snapshot by its index
  timeTravel.goTo(5);
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
const timeTravel = system.debug;

if (timeTravel) {
  // Serialize the entire snapshot history to a JSON string
  const exported = timeTravel.export();
  localStorage.setItem('debug-session', exported);

  // Restore a previously saved session (e.g., after a page refresh)
  const saved = localStorage.getItem('debug-session');
  if (saved) {
    timeTravel.import(saved);
  }
}
```

---

## Replay

Replay from the current snapshot forward:

```typescript
const timeTravel = system.debug;

if (timeTravel) {
  // Rewind to snapshot 5, then replay all subsequent snapshots forward
  timeTravel.goTo(5);
  timeTravel.replay();
}
```

---

## Undo Groups (Changesets)

A single user action often produces multiple snapshots (e.g., moving a piece changes the board, clears selection, and switches turns). Without grouping, undo goes back one snapshot – not one logical action.

Use `beginChangeset` / `endChangeset` to group snapshots into a single undo/redo unit:

```typescript
const timeTravel = system.debug;

if (timeTravel) {
  // Group multiple snapshots into one logical "undo" unit
  timeTravel.beginChangeset("Move piece from A to B");
  // ... multiple fact mutations happen here ...
  timeTravel.endChangeset();

  // Undo reverts the entire changeset, not individual snapshots
  timeTravel.goBack();
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

  // Snapshot access (metadata only – keeps re-renders cheap)
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
  const timeTravel = useTimeTravel(system);

  if (!timeTravel) {
    return null;
  }

  // Destructure exactly what you need
  const {
    canUndo, canRedo, undo, redo, currentIndex, totalSnapshots,
    snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
    exportSession, importSession,
    beginChangeset, endChangeset,
    isPaused, pause, resume,
  } = timeTravel;

  return (
    <div>
      {/* Undo / Redo */}
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
      <span>{currentIndex + 1} / {totalSnapshots}</span>

      {/* Navigation */}
      <button onClick={() => goBack(5)}>Back 5</button>
      <button onClick={() => goForward(5)}>Forward 5</button>
      <button onClick={replay}>Replay All</button>

      {/* Snapshot timeline (metadata only – no facts, keeps re-renders cheap) */}
      <ul>
        {snapshots.map((snap) => (
          <li key={snap.id}>
            <button onClick={() => goTo(snap.id)}>
              {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
            </button>
            <button onClick={() => console.log(getSnapshotFacts(snap.id))}>
              Inspect
            </button>
          </li>
        ))}
      </ul>

      {/* Session persistence */}
      <button onClick={() => localStorage.setItem('debug', exportSession())}>
        Save Session
      </button>
      <button onClick={() => {
        const saved = localStorage.getItem('debug');
        if (saved) importSession(saved);
      }}>
        Restore Session
      </button>

      {/* Recording control */}
      <button onClick={isPaused ? resume : pause}>
        {isPaused ? 'Resume' : 'Pause'} Recording
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

const timeTravel = useTimeTravel(system);

function saveSession() {
  if (timeTravel.value) localStorage.setItem('debug', timeTravel.value.exportSession());
}

function restoreSession() {
  const saved = localStorage.getItem('debug');
  if (saved && timeTravel.value) timeTravel.value.importSession(saved);
}
</script>

<template>
  <div v-if="timeTravel">
    <!-- Undo / Redo -->
    <button @click="timeTravel.undo" :disabled="!timeTravel.canUndo">Undo</button>
    <button @click="timeTravel.redo" :disabled="!timeTravel.canRedo">Redo</button>
    <span>{{ timeTravel.currentIndex + 1 }} / {{ timeTravel.totalSnapshots }}</span>

    <!-- Navigation -->
    <button @click="timeTravel.goBack(5)">Back 5</button>
    <button @click="timeTravel.goForward(5)">Forward 5</button>
    <button @click="timeTravel.replay()">Replay All</button>

    <!-- Snapshot timeline (metadata only – no facts, keeps re-renders cheap) -->
    <ul>
      <li v-for="snap in timeTravel.snapshots" :key="snap.id">
        <button @click="timeTravel.goTo(snap.id)">
          {{ snap.trigger }} – {{ new Date(snap.timestamp).toLocaleTimeString() }}
        </button>
        <button @click="console.log(timeTravel.getSnapshotFacts(snap.id))">
          Inspect
        </button>
      </li>
    </ul>

    <!-- Session persistence -->
    <button @click="saveSession">Save Session</button>
    <button @click="restoreSession">Restore Session</button>

    <!-- Recording control -->
    <button @click="timeTravel.isPaused ? timeTravel.resume() : timeTravel.pause()">
      {{ timeTravel.isPaused ? 'Resume' : 'Pause' }} Recording
    </button>
  </div>
</template>
```

### Svelte

```html
<script>
import { useTimeTravel } from 'directive/svelte';
import { system } from '$lib/directive';

const timeTravel = useTimeTravel(system);

function saveSession() {
  if ($timeTravel) localStorage.setItem('debug', $timeTravel.exportSession());
}

function restoreSession() {
  const saved = localStorage.getItem('debug');
  if (saved && $timeTravel) $timeTravel.importSession(saved);
}
</script>

{#if $timeTravel}
  {@const {
    canUndo, canRedo, undo, redo, currentIndex, totalSnapshots,
    snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
    isPaused, pause, resume,
  } = $timeTravel}

  <!-- Undo / Redo -->
  <button on:click={undo} disabled={!canUndo}>Undo</button>
  <button on:click={redo} disabled={!canRedo}>Redo</button>
  <span>{currentIndex + 1} / {totalSnapshots}</span>

  <!-- Navigation -->
  <button on:click={() => goBack(5)}>Back 5</button>
  <button on:click={() => goForward(5)}>Forward 5</button>
  <button on:click={replay}>Replay All</button>

  <!-- Snapshot timeline (metadata only – no facts, keeps re-renders cheap) -->
  <ul>
    {#each snapshots as snap (snap.id)}
      <li>
        <button on:click={() => goTo(snap.id)}>
          {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
        </button>
        <button on:click={() => console.log(getSnapshotFacts(snap.id))}>
          Inspect
        </button>
      </li>
    {/each}
  </ul>

  <!-- Session persistence -->
  <button on:click={saveSession}>Save Session</button>
  <button on:click={restoreSession}>Restore Session</button>

  <!-- Recording control -->
  <button on:click={isPaused ? resume : pause}>
    {isPaused ? 'Resume' : 'Pause'} Recording
  </button>
{/if}
```

### Solid

```tsx
import { useTimeTravel } from 'directive/solid';
import { Show, For } from 'solid-js';

function TimeTravelToolbar() {
  const timeTravel = useTimeTravel(system);

  return (
    <Show when={timeTravel()}>
      {(state) => {
        const {
          canUndo, canRedo, undo, redo, currentIndex, totalSnapshots,
          snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
          exportSession, importSession,
          isPaused, pause, resume,
        } = state();

        return (
          <div>
            {/* Undo / Redo */}
            <button onClick={undo} disabled={!canUndo}>Undo</button>
            <button onClick={redo} disabled={!canRedo}>Redo</button>
            <span>{currentIndex + 1} / {totalSnapshots}</span>

            {/* Navigation */}
            <button onClick={() => goBack(5)}>Back 5</button>
            <button onClick={() => goForward(5)}>Forward 5</button>
            <button onClick={replay}>Replay All</button>

            {/* Snapshot timeline (metadata only – no facts, keeps re-renders cheap) */}
            <ul>
              <For each={snapshots}>
                {(snap) => (
                  <li>
                    <button onClick={() => goTo(snap.id)}>
                      {snap.trigger} – {new Date(snap.timestamp).toLocaleTimeString()}
                    </button>
                    <button onClick={() => console.log(getSnapshotFacts(snap.id))}>
                      Inspect
                    </button>
                  </li>
                )}
              </For>
            </ul>

            {/* Session persistence */}
            <button onClick={() => localStorage.setItem('debug', exportSession())}>
              Save Session
            </button>
            <button onClick={() => {
              const saved = localStorage.getItem('debug');
              if (saved) importSession(saved);
            }}>
              Restore Session
            </button>

            {/* Recording control */}
            <button onClick={isPaused ? resume : pause}>
              {isPaused ? 'Resume' : 'Pause'} Recording
            </button>
          </div>
        );
      }}
    </Show>
  );
}
```

### Lit

```typescript
import { TimeTravelController } from 'directive/lit';

class TimeTravelToolbar extends LitElement {
  private _timeTravel = new TimeTravelController(this, system);

  render() {
    const timeTravel = this._timeTravel.value;

    if (!timeTravel) {
      return html``;
    }

    const {
      canUndo, canRedo, undo, redo, currentIndex, totalSnapshots,
      snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
      exportSession, importSession,
      isPaused, pause, resume,
    } = timeTravel;

    return html`
      <!-- Undo / Redo -->
      <button @click=${undo} ?disabled=${!canUndo}>Undo</button>
      <button @click=${redo} ?disabled=${!canRedo}>Redo</button>
      <span>${currentIndex + 1} / ${totalSnapshots}</span>

      <!-- Navigation -->
      <button @click=${() => goBack(5)}>Back 5</button>
      <button @click=${() => goForward(5)}>Forward 5</button>
      <button @click=${replay}>Replay All</button>

      <!-- Snapshot timeline (metadata only – no facts, keeps re-renders cheap) -->
      <ul>
        ${snapshots.map((snap) => html`
          <li>
            <button @click=${() => goTo(snap.id)}>
              ${snap.trigger} – ${new Date(snap.timestamp).toLocaleTimeString()}
            </button>
            <button @click=${() => console.log(getSnapshotFacts(snap.id))}>
              Inspect
            </button>
          </li>
        `)}
      </ul>

      <!-- Session persistence -->
      <button @click=${() => localStorage.setItem('debug', exportSession())}>
        Save Session
      </button>
      <button @click=${() => {
        const saved = localStorage.getItem('debug');
        if (saved) importSession(saved);
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

## Snapshots

### Creating Snapshots

```typescript
// Capture a complete copy of the current system state
const snapshot = system.getSnapshot();

// The snapshot contains all fact values as a plain object
console.log(snapshot);
// { facts: { count: 5, user: { name: "John" } }, ... }
```

### Restoring Snapshots

```typescript
// Overwrite the current system state with a saved snapshot
system.restore(snapshot);

// All facts now reflect the snapshot values
console.log(system.facts.count); // 5
```

### Signed Snapshots

Create tamper-proof snapshots for secure transmission:

```typescript
import { signSnapshot, verifySnapshotSignature } from 'directive';

// Attach an HMAC signature to detect tampering
const signed = signSnapshot(snapshot, process.env.SIGNING_SECRET);

// Always verify the signature before restoring untrusted snapshots
const isValid = verifySnapshotSignature(signed, process.env.SIGNING_SECRET);

if (isValid) {
  system.restore(signed);
}
```

### Diff Snapshots

Compare two snapshots to see what changed:

```typescript
import { diffSnapshots } from 'directive';

// Take a "before" snapshot, let state change, then take an "after"
const before = system.getSnapshot();
// ... changes happen ...
const after = system.getSnapshot();

// Compare the two to see which facts were added, removed, or changed
const diff = diffSnapshots(before, after);
// { changed: ['count'], added: [], removed: [] }
```

### Distributable Snapshots

Export computed derivations for use outside the Directive runtime (e.g., Redis, CDN edge caches):

```typescript
// Export selected derivations for use outside the Directive runtime
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600, // Snapshot expires after 1 hour
});

// Cache the snapshot in Redis for fast edge reads
await redis.setex(`state:${userId}`, 3600, JSON.stringify(snapshot));
```

Watch for changes and push updates:

```typescript
// Automatically push updated snapshots to Redis whenever derivations change
const unsubscribe = system.watchDistributableSnapshot(
  { includeDerivations: ['effectivePlan', 'canUseFeature'] },
  (snapshot) => {
    redis.setex(`state:${userId}`, 3600, JSON.stringify(snapshot));
  },
);
```

---

## Next Steps

- [DevTools](/docs/plugins/devtools) – Browser integration
- [Persistence](/docs/plugins/persistence) – Automatic saving
- [Testing](/docs/testing/overview) – Debugging tests
