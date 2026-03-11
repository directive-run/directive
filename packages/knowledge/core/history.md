# History & Snapshots

Directive records fact changes as snapshots, enabling undo/redo, replay, export/import, and changeset grouping.

## Decision Tree: "Should I enable history?"

```
What's the use case?
├── Debugging during development → Yes, enable with maxSnapshots cap
├── Production app → No, disable for performance
├── Bug reproduction → Enable, use export() to share
├── Testing → Usually no – use assertFact/assertDerivation instead
└── Demo / presentation → Yes, great for showing state changes
```

## Enabling History

```typescript
import { createSystem } from "@directive-run/core";

const system = createSystem({
  module: myModule,
  history: {
    maxSnapshots: 100, // Cap memory usage (default: 100)
  },
});
```

History is disabled by default. When disabled, `system.history` is `null`. When enabled, snapshots are recorded automatically after every fact mutation.

## Filtering Snapshot Events

By default every event that changes facts creates a snapshot. Use `history.snapshotEvents` on your module to limit which events create snapshots — keeps undo/redo clean by excluding UI-only events like selection or timer ticks.

```typescript
const game = createModule("game", {
  schema: gameSchema,

  // Only these events appear in undo/redo history.
  // Omit to snapshot ALL events (the default).
  history: {
    snapshotEvents: [
      "inputNumber",
      "requestHint",
      "newGame",
    ],
  },

  events: {
    tick: (facts) => { /* no snapshot */ },
    selectCell: (facts, { index }) => { /* no snapshot */ },
    inputNumber: (facts, { value }) => { /* creates snapshot */ },
    requestHint: (facts) => { /* creates snapshot */ },
    newGame: (facts, { difficulty }) => { /* creates snapshot */ },
  },
});
```

### Filtering by Module

In a multi-module system, control which modules create snapshots at the system level:

```typescript
const system = createSystem({
  modules: { ui: uiModule, game: gameModule },
  history: {
    maxSnapshots: 100,
    snapshotModules: ["game"], // Only game events create snapshots
  },
});
```

**Rules:**
- `snapshotEvents` omitted → all events snapshot (per module)
- `snapshotModules` omitted → all modules snapshot (per system)
- Both provided → they intersect (module must be in `snapshotModules` AND event in `snapshotEvents`)
- Direct fact mutations (`system.facts.x = 5`) always snapshot regardless of filtering
- `snapshotEvents` entries are type-checked against schema events

## Core API: `system.history` (`HistoryAPI`)

```typescript
const history = system.history; // HistoryAPI | null

if (history) {
  // Read-only state
  history.snapshots;      // Snapshot[] — all recorded snapshots
  history.currentIndex;   // number — position in the snapshot array
  history.isPaused;       // boolean — whether recording is paused

  // Navigation
  history.goBack();       // Step backward one snapshot (changeset-aware)
  history.goBack(3);      // Step backward 3 snapshots
  history.goForward();    // Step forward one snapshot (changeset-aware)
  history.goForward(3);   // Step forward 3 snapshots
  history.goTo(snapshotId); // Jump to a specific snapshot by its ID
  history.replay();       // Jump to the first snapshot

  // Export / Import (JSON strings)
  history.export();       // Serialize entire history to JSON string
  history.import(json);   // Restore history from JSON string

  // Changesets — group multiple snapshots into one undo/redo unit
  history.beginChangeset("Move piece");
  // ... mutations happen ...
  history.endChangeset();

  // Recording control
  history.pause();        // Temporarily stop recording snapshots
  history.resume();       // Resume recording
}
```

### Snapshot Structure

```typescript
interface Snapshot {
  id: number;                     // Auto-incrementing identifier
  timestamp: number;              // When captured (Date.now())
  facts: Record<string, unknown>; // Complete copy of all fact values
  trigger: string;                // What caused this snapshot (e.g., "fact:count")
}
```

## Framework Hook: `useHistory` (`HistoryState`)

Each framework adapter provides a reactive `useHistory` hook that re-renders on snapshot changes. Returns `null` when history is disabled, otherwise a `HistoryState` object that wraps the core API with convenience properties.

```typescript
interface SnapshotMeta {
  id: number;          // Snapshot identifier
  timestamp: number;   // When captured
  trigger: string;     // What caused this snapshot
}

interface HistoryState {
  // Convenience booleans (not on core API)
  canGoBack: boolean;    // True when currentIndex > 0
  canGoForward: boolean; // True when currentIndex < totalSnapshots - 1
  currentIndex: number;
  totalSnapshots: number;

  // Snapshot access (metadata only — keeps re-renders cheap)
  snapshots: SnapshotMeta[];
  getSnapshotFacts: (id: number) => Record<string, unknown> | null;

  // Navigation
  goTo: (snapshotId: number) => void;
  goBack: (steps: number) => void;
  goForward: (steps: number) => void;
  replay: () => void;

  // Session persistence
  exportSession: () => string;     // Wraps history.export()
  importSession: (json: string) => void; // Wraps history.import()

  // Changesets
  beginChangeset: (label: string) => void;
  endChangeset: () => void;

  // Recording control
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
}
```

### React Example

```tsx
import { useHistory } from "@directive-run/react";

function HistoryToolbar() {
  const history = useHistory(system);
  if (!history) return null;

  return (
    <div>
      <button onClick={() => history.goBack()} disabled={!history.canGoBack}>Undo</button>
      <button onClick={() => history.goForward()} disabled={!history.canGoForward}>Redo</button>
      <span>{history.currentIndex + 1} / {history.totalSnapshots}</span>
    </div>
  );
}
```

## Undo/Redo Pattern

```typescript
const system = createSystem({
  module: editorModule,
  history: { maxSnapshots: 200 },
});

system.start();

// User makes changes
system.facts.text = "Hello";
system.facts.text = "Hello, world";
system.facts.text = "Hello, world!";

const history = system.history!;

// Undo (one step back)
history.goBack();
console.log(system.facts.text); // "Hello, world"

history.goBack();
console.log(system.facts.text); // "Hello"

// Redo (one step forward)
history.goForward();
console.log(system.facts.text); // "Hello, world"
```

## Changesets: Grouping Related Changes

Multiple fact mutations can be grouped into a single undoable unit.

```typescript
const history = system.history!;

// Without changeset — each mutation is a separate snapshot
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
// Two snapshots, two goBack() calls needed

// With changeset — grouped into one undo unit
history.beginChangeset("Update user name");
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
history.endChangeset();
// One goBack() restores both

history.goBack();
// Both firstName and lastName are restored
```

## Exporting and Importing History

Serialize the full snapshot history for bug reports or debugging.

```typescript
const history = system.history!;

// Export — returns a JSON string
const exported = history.export();
localStorage.setItem("debug-session", exported);

// Import — restore from a JSON string
const saved = localStorage.getItem("debug-session");
if (saved) {
  history.import(saved);

  // Step through the user's exact state sequence
  history.goTo(0); // First snapshot
  history.goTo(5); // When the bug occurred
}
```

## Performance: maxSnapshots

Every fact mutation creates a snapshot. Cap the number to control memory:

```typescript
// Low memory — keeps last 20 snapshots, discards oldest
history: { maxSnapshots: 20 },

// Development — generous cap for deep debugging
history: { maxSnapshots: 500 },

// Default if not specified
history: true, // maxSnapshots defaults to 100
```

When the cap is reached, the oldest snapshot is discarded (ring buffer / FIFO).

## Common Mistakes

### Enabling history in production

```typescript
// WRONG — snapshots consume memory on every mutation
const system = createSystem({
  module: myModule,
  history: true,
});

// CORRECT — gate on environment
const system = createSystem({
  module: myModule,
  history: process.env.NODE_ENV === "development"
    ? { maxSnapshots: 100 }
    : false,
});
```

### Forgetting to end a changeset

```typescript
// WRONG — changeset never closed, all subsequent mutations are grouped
history.beginChangeset("update");
system.facts.name = "Alice";
// ... forgot endChangeset()
system.facts.unrelated = true; // Still part of the changeset!

// CORRECT — always close changesets
history.beginChangeset("update");
system.facts.name = "Alice";
history.endChangeset();
```

### Accessing history when disabled

```typescript
// WRONG — history not enabled, system.history is null
const system = createSystem({ module: myModule });
system.history.goBack(); // TypeError!

// CORRECT — check before using
if (system.history) {
  system.history.goBack();
}

// Or enable it
const system = createSystem({
  module: myModule,
  history: true,
});
```
