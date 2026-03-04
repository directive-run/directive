# Time-Travel Debugging

Directive can record every fact change as a snapshot, enabling undo/redo, replay, and state export for bug reports.

## Decision Tree: "Should I enable time-travel?"

```
What's the use case?
├── Debugging during development → Yes, enable with maxSnapshots cap
├── Production app → No, disable for performance
├── Bug reproduction → Enable, use exportHistory() to share
├── Testing → Usually no – use assertFact/assertDerivation instead
└── Demo / presentation → Yes, great for showing state changes
```

## Enabling Time-Travel

```typescript
import { createSystem } from "@directive-run/core";

const system = createSystem({
  module: myModule,
  debug: {
    timeTravel: true,       // Enable snapshot recording
    maxSnapshots: 100,      // Cap memory usage (default: 50)
  },
});
```

Time-travel is disabled by default. Snapshots are recorded automatically on every fact mutation.

## The TimeTravelAPI

Access via `system.debug.timeTravel`:

```typescript
const tt = system.debug.timeTravel;

// Navigation
tt.canUndo();           // boolean – is there a previous snapshot?
tt.canRedo();           // boolean – is there a next snapshot?
tt.undo();              // Restore previous snapshot
tt.redo();              // Restore next snapshot

// Direct access
tt.getSnapshots();      // Array of all snapshots
tt.goToSnapshot(index); // Jump to a specific snapshot by index

// Each snapshot contains:
// {
//   facts: { ... },        – full fact state at that point
//   timestamp: number,     – when the snapshot was taken
//   label?: string,        – optional label from changeset
//   changedKeys: string[], – which facts changed
// }
```

## Undo/Redo Pattern

```typescript
const system = createSystem({
  module: editorModule,
  debug: { timeTravel: true, maxSnapshots: 200 },
});

system.start();

// User makes changes
system.facts.text = "Hello";
system.facts.text = "Hello, world";
system.facts.text = "Hello, world!";

// Undo last change
const tt = system.debug.timeTravel;
tt.undo();
console.log(system.facts.text); // "Hello, world"

tt.undo();
console.log(system.facts.text); // "Hello"

// Redo
tt.redo();
console.log(system.facts.text); // "Hello, world"

// Check navigation state
tt.canUndo(); // true
tt.canRedo(); // true
```

## Changesets: Grouping Related Changes

Multiple fact mutations can be grouped into a single undoable unit.

```typescript
const tt = system.debug.timeTravel;

// Without changeset – each mutation is a separate snapshot
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
// Two snapshots, two undos needed

// With changeset – grouped into one snapshot
tt.beginChangeset("Update user name");
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
tt.endChangeset();
// One snapshot, one undo restores both

// Undo reverts the entire changeset
tt.undo();
// Both firstName and lastName are restored
```

Use changesets for logically related mutations: form submissions, multi-field updates, resolver results.

## Exporting and Importing History

Serialize the full snapshot history for bug reports or debugging.

```typescript
const tt = system.debug.timeTravel;

// Export – returns a serializable object
const historyData = tt.exportHistory();
// Send to server, save to file, attach to bug report
console.log(JSON.stringify(historyData));

// Import – restore history from exported data
tt.importHistory(historyData);

// Now you can step through the user's exact state sequence
tt.goToSnapshot(0); // Start
tt.goToSnapshot(5); // When the bug occurred
```

## Snapshot Inspection

```typescript
const tt = system.debug.timeTravel;
const snapshots = tt.getSnapshots();

// Walk through all snapshots
for (const snap of snapshots) {
  console.log(`[${new Date(snap.timestamp).toISOString()}]`);
  console.log(`  Changed: ${snap.changedKeys.join(", ")}`);
  if (snap.label) {
    console.log(`  Label: ${snap.label}`);
  }
  console.log(`  Facts:`, snap.facts);
}

// Jump to a specific point
tt.goToSnapshot(3);
console.log(system.facts); // State as of snapshot 3
```

## Performance: maxSnapshots

Every fact mutation creates a snapshot. Cap the number to control memory:

```typescript
// Low memory – keeps last 20 snapshots, discards oldest
debug: { timeTravel: true, maxSnapshots: 20 },

// Development – generous cap for deep debugging
debug: { timeTravel: true, maxSnapshots: 500 },

// Default if not specified
debug: { timeTravel: true }, // maxSnapshots defaults to 50
```

When the cap is reached, the oldest snapshot is discarded (FIFO). Redo history beyond the cap is lost.

## Common Mistakes

### Enabling time-travel in production

```typescript
// WRONG – snapshots consume memory on every mutation
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true },
});

// CORRECT – gate on environment
const system = createSystem({
  module: myModule,
  debug: {
    timeTravel: process.env.NODE_ENV === "development",
    maxSnapshots: 100,
  },
});
```

### Forgetting to end a changeset

```typescript
// WRONG – changeset never closed, all subsequent mutations are grouped
tt.beginChangeset("update");
system.facts.name = "Alice";
// ... forgot endChangeset()
system.facts.unrelated = true; // Still part of the changeset!

// CORRECT – always close changesets
tt.beginChangeset("update");
system.facts.name = "Alice";
tt.endChangeset();
```

### Accessing time-travel when disabled

```typescript
// WRONG – timeTravel not enabled, system.debug.timeTravel is null
const system = createSystem({ module: myModule });
system.debug.timeTravel.undo(); // TypeError!

// CORRECT – check before using
const tt = system.debug.timeTravel;
if (tt) {
  tt.undo();
}

// Or enable it
const system = createSystem({
  module: myModule,
  debug: { timeTravel: true },
});
```

### No maxSnapshots cap with frequent mutations

```typescript
// WRONG – unbounded snapshots in a high-frequency update loop
debug: { timeTravel: true }, // Default cap is 50, which is fine

// Be explicit when mutation rate is high
debug: { timeTravel: true, maxSnapshots: 30 },
```
