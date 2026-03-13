---
title: History & Snapshots
description: Debug your application with history state navigation, and capture, restore, and diff system snapshots.
---

Navigate through state history for debugging, and save or restore complete system state with snapshots. {% .lead %}

```
    t=0          t=1          t=2          t=3          t=4
    ─────────────────────────────────────────────────────────
    Snapshot 1   Snapshot 2   Current ▼    Snapshot 4   Snapshot 5
                              ◄─ back │ forward ─►
```

---

## Enable History

```typescript
const system = createSystem({
  module: myModule,

  // Enable history and cap at 100 snapshots
  history: {
    maxSnapshots: 100,
  },
});
```

When enabled, `system.history` exposes the history API. When disabled, `system.history` is `null`.

---

## Filtering Snapshot Events

By default, **every** event that changes facts creates a history snapshot. In interactive apps this means UI-only events (cell selection, timer ticks) pollute the undo history, making Ctrl+Z useless.

Add a `history` option to your module to declare which events create snapshots:

```typescript
const game = createModule("game", {
  schema: gameSchema,

  // Only these events appear in undo/redo history.
  // Omit this field to snapshot ALL events (the default).
  history: {
    snapshotEvents: [
      "inputNumber",
      "toggleNote",
      "requestHint",
      "newGame",
    ],
  },

  events: {
    tick: (facts) => { /* timer – no snapshot */ },
    selectCell: (facts, { index }) => { /* selection – no snapshot */ },
    inputNumber: (facts, { value }) => { /* creates snapshot */ },
    toggleNote: (facts, { value }) => { /* creates snapshot */ },
    requestHint: (facts) => { /* creates snapshot */ },
    newGame: (facts, { difficulty }) => { /* creates snapshot */ },
  },
});
```

### Rules

- **Omitted** &ndash; all events create snapshots (backward compatible).
- **Provided** &ndash; only listed events create snapshots; unlisted events silently skip.
- **Direct fact mutations** (`system.facts.x = 5`) always create snapshots regardless of filtering.
- **Resolver and effect** fact changes always create snapshots.
- **Multi-module** &ndash; each module controls its own events. A module without `history.snapshotEvents` still snapshots all of its events, even if another module in the system uses filtering. Use `history.snapshotModules` to filter at the system level instead.

### Module-Level Filtering

In a multi-module system, you can control which **modules** create snapshots without touching module definitions. This is useful when composing modules you didn't author:

```typescript
const system = createSystem({
  modules: {
    ui: uiModule,       // UI-only state (selection, hover, etc.)
    game: gameModule,    // Core game logic (moves, scores)
  },
  history: {
    maxSnapshots: 100,
    snapshotModules: ["game"],  // Only game events create snapshots
  },
});
```

**Rules:**

- **Omitted** &ndash; all modules create snapshots (backward compatible).
- **Provided** &ndash; only events from listed modules create snapshots; events from excluded modules silently skip.
- **Intersects with `history.snapshotEvents`** &ndash; if a module has `history: { snapshotEvents: ["move"] }` AND is in `snapshotModules`, only `move` events create snapshots.
- **Direct fact mutations** and resolver/effect changes always create snapshots regardless of filtering.

**When to use which:**

| Scenario | Use |
|----------|-----|
| Filter specific events within a module | `history.snapshotEvents` on `createModule()` |
| Exclude entire modules from snapshots | `history.snapshotModules` on `createSystem()` |
| Both | They intersect &ndash; the module must be in `snapshotModules` AND the event must be in `history.snapshotEvents` |

### Type Safety

`history.snapshotEvents` entries are type-checked against your schema events. Typos or removed event names produce compile-time errors:

```typescript
history: {
  snapshotEvents: [
    "inputNumber",
    "typoEvent",
//   ^^^^^^^^^ Type error: not in schema.events
  ],
},
```

---

## Basic Navigation

```typescript
// system.history is null when history is disabled
const history = system.history; // HistoryAPI | null

if (history) {
  // Inspect the current snapshot history
  console.log(`${history.snapshots.length} snapshots`);
  console.log(`Currently at index ${history.currentIndex}`);

  // Step backward through history (one step by default)
  history.goBack();

  // Jump back multiple steps at once
  history.goBack(3);

  // Step forward (redo)
  history.goForward();

  // Jump directly to a specific snapshot by its index
  history.goTo(5);
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
const history = system.history;

if (history) {
  // Serialize the entire snapshot history to a JSON string
  const exported = history.export();
  localStorage.setItem('debug-session', exported);

  // Restore a previously saved session (e.g., after a page refresh)
  const saved = localStorage.getItem('debug-session');
  if (saved) {
    history.import(saved);
  }
}
```

---

## Replay

Replay from the current snapshot forward:

```typescript
const history = system.history;

if (history) {
  // Rewind to snapshot 5, then replay all subsequent snapshots forward
  history.goTo(5);
  history.replay();
}
```

---

## How Snapshots Work

Snapshots are taken **once per reconciliation cycle**, not per individual fact change. All synchronous fact mutations within the same event handler batch into a single snapshot:

```typescript
events: {
  movePiece: (facts, { from, to }) => {
    facts.cells[to] = facts.cells[from];  // ─┐
    facts.cells[from] = "";                //  ├─ One reconcile cycle = one snapshot
    facts.selected = -1;                   //  │
    facts.turn = facts.turn === "white"    //  │
      ? "black" : "white";                 // ─┘
  },
},
```

One `goBack()` reverts all four changes — no changeset needed for a single event.

---

## Undo Groups (Changesets)

Changesets group snapshots from **multiple separate events** into one undo/redo unit. This is useful when a single user action triggers a sequence of events.

For example, a drag-and-drop move might require two separate events — one to pick up, one to place:

```typescript
const board = createModule("board", {
  schema: {
    cells: t.array<string>(),
    selected: t.number(),
    turn: t.string<"white" | "black">(),
  },

  events: {
    pickUp: (facts, { index }: { index: number }) => {
      facts.selected = index;
      // → snapshot 1
    },
    place: (facts, { from, to }: { from: number; to: number }) => {
      facts.cells[to] = facts.cells[from];
      facts.cells[from] = "";
      facts.selected = -1;
      facts.turn = facts.turn === "white" ? "black" : "white";
      // → snapshot 2
    },
  },
});
```

### Without a changeset

```typescript
system.events.pickUp({ index: 0 });   // Snapshot 1
system.events.place({ from: 0, to: 1 }); // Snapshot 2

system.history!.goBack(); // Only reverts the place — piece is selected but not moved
system.history!.goBack(); // Now reverts the pickup
```

Two `goBack()` calls for what the user sees as one action.

### With a changeset

```typescript
const history = system.history!;

history.beginChangeset("Move piece 0 → 1");
system.events.pickUp({ index: 0 });
system.events.place({ from: 0, to: 1 });
history.endChangeset();
// Two snapshots, but grouped as one changeset

history.goBack(); // Reverts both — one undo for one user action
```

### In a React component

```tsx
function Board() {
  const { facts, events } = useDirective(boardModule);
  const history = useHistory(system);

  function handleDrop(from: number, to: number) {
    history?.beginChangeset(`Move ${from} → ${to}`);
    events.pickUp({ index: from });
    events.place({ from, to });
    history?.endChangeset();
  }

  return <BoardGrid cells={facts.cells} onDrop={handleDrop} />;
}
```

{{ note }}
Always close your changesets. If you forget `endChangeset()`, all subsequent mutations get grouped into the same changeset — causing undo to revert far more than intended.
{{ /note }}

---

## Reactive `useHistory` Hook

Each framework adapter provides a reactive `useHistory` that re-renders when snapshot state changes. Returns `null` when history is disabled, otherwise a `HistoryState` object:

```typescript
interface SnapshotMeta {
  id: number;                // Snapshot identifier
  timestamp: number;         // When captured (Date.now())
  trigger: string;           // What caused this snapshot (e.g., "fact:count")
}

interface HistoryState {
  // Back / Forward
  canGoBack: boolean;        // True when there are earlier snapshots
  canGoForward: boolean;     // True when there are later snapshots
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
import { useHistory } from '@directive-run/react';

function HistoryToolbar() {
  const history = useHistory(system);

  if (!history) {
    return null;
  }

  // Destructure exactly what you need
  const {
    canGoBack, canGoForward, currentIndex, totalSnapshots,
    snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
    exportSession, importSession,
    beginChangeset, endChangeset,
    isPaused, pause, resume,
  } = history;

  return (
    <div>
      {/* Back / Forward */}
      <button onClick={() => goBack()} disabled={!canGoBack}>Undo</button>
      <button onClick={() => goForward()} disabled={!canGoForward}>Redo</button>
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
        if (saved) {
          importSession(saved);
        }
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
import { useHistory } from '@directive-run/vue';
import { system } from './system';

const history = useHistory(system);

function saveSession() {
  if (history.value) {
    localStorage.setItem('debug', history.value.exportSession());
  }
}

function restoreSession() {
  const saved = localStorage.getItem('debug');
  if (saved && history.value) {
    history.value.importSession(saved);
  }
}
</script>

<template>
  <div v-if="history">
    <!-- Back / Forward -->
    <button @click="history.goBack()" :disabled="!history.canGoBack">Undo</button>
    <button @click="history.goForward()" :disabled="!history.canGoForward">Redo</button>
    <span>{{ history.currentIndex + 1 }} / {{ history.totalSnapshots }}</span>

    <!-- Navigation -->
    <button @click="history.goBack(5)">Back 5</button>
    <button @click="history.goForward(5)">Forward 5</button>
    <button @click="history.replay()">Replay All</button>

    <!-- Snapshot timeline (metadata only – no facts, keeps re-renders cheap) -->
    <ul>
      <li v-for="snap in history.snapshots" :key="snap.id">
        <button @click="history.goTo(snap.id)">
          {{ snap.trigger }} – {{ new Date(snap.timestamp).toLocaleTimeString() }}
        </button>
        <button @click="console.log(history.getSnapshotFacts(snap.id))">
          Inspect
        </button>
      </li>
    </ul>

    <!-- Session persistence -->
    <button @click="saveSession">Save Session</button>
    <button @click="restoreSession">Restore Session</button>

    <!-- Recording control -->
    <button @click="history.isPaused ? history.resume() : history.pause()">
      {{ history.isPaused ? 'Resume' : 'Pause' }} Recording
    </button>
  </div>
</template>
```

### Svelte

```html
<script>
import { useHistory } from '@directive-run/svelte';
import { system } from '$lib/directive';

const history = useHistory(system);

function saveSession() {
  if ($history) {
    localStorage.setItem('debug', $history.exportSession());
  }
}

function restoreSession() {
  const saved = localStorage.getItem('debug');
  if (saved && $history) {
    $history.importSession(saved);
  }
}
</script>

{#if $history}
  {@const {
    canGoBack, canGoForward, currentIndex, totalSnapshots,
    snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
    isPaused, pause, resume,
  } = $history}

  <!-- Back / Forward -->
  <button on:click={() => goBack()} disabled={!canGoBack}>Undo</button>
  <button on:click={() => goForward()} disabled={!canGoForward}>Redo</button>
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
import { useHistory } from '@directive-run/solid';
import { Show, For } from 'solid-js';

function HistoryToolbar() {
  const history = useHistory(system);

  return (
    <Show when={history()}>
      {(state) => {
        const {
          canGoBack, canGoForward, currentIndex, totalSnapshots,
          snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
          exportSession, importSession,
          isPaused, pause, resume,
        } = state();

        return (
          <div>
            {/* Back / Forward */}
            <button onClick={() => goBack()} disabled={!canGoBack}>Undo</button>
            <button onClick={() => goForward()} disabled={!canGoForward}>Redo</button>
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
              if (saved) {
                importSession(saved);
              }
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
import { HistoryController } from '@directive-run/lit';

class HistoryToolbar extends LitElement {
  private _history = new HistoryController(this, system);

  render() {
    const history = this._history.value;

    if (!history) {
      return html``;
    }

    const {
      canGoBack, canGoForward, currentIndex, totalSnapshots,
      snapshots, getSnapshotFacts, goTo, goBack, goForward, replay,
      exportSession, importSession,
      isPaused, pause, resume,
    } = history;

    return html`
      <!-- Back / Forward -->
      <button @click=${() => goBack()} ?disabled=${!canGoBack}>Undo</button>
      <button @click=${() => goForward()} ?disabled=${!canGoForward}>Redo</button>
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

---

## Keyboard Shortcuts

Common keyboard shortcuts for history:

```typescript
// Wire up standard undo/redo keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();

    if (e.shiftKey) {
      system.history?.goForward();  // Cmd+Shift+Z = Redo
    } else {
      system.history?.goBack();     // Cmd+Z = Undo
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
import { signSnapshot, verifySnapshotSignature } from '@directive-run/core';

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
import { diffSnapshots } from '@directive-run/core';

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
