# History Debugging

Directive can record every fact change as a snapshot, enabling undo/redo, replay, and state export for bug reports.

## Decision Tree: "Should I enable history?"

```
What's the use case?
├── Debugging during development → Yes, enable with maxSnapshots cap
├── Production app → No, disable for performance
├── Bug reproduction → Enable, use exportHistory() to share
├── Testing → Usually no – use assertFact/assertDerivation instead
└── Demo / presentation → Yes, great for showing state changes
```

## Enabling History

```typescript
import { createSystem } from "@directive-run/core";

const system = createSystem({
  module: myModule,
  history: {
    maxSnapshots: 100,      // Cap memory usage (default: 50)
  },
});
```

History is disabled by default. Snapshots are recorded automatically on every fact mutation.

## The History API

Access via `system.history`:

```typescript
const history = system.history;

// Navigation
history.canUndo();           // boolean – is there a previous snapshot?
history.canRedo();           // boolean – is there a next snapshot?
history.undo();              // Restore previous snapshot
history.redo();              // Restore next snapshot

// Direct access
history.getSnapshots();      // Array of all snapshots
history.goToSnapshot(index); // Jump to a specific snapshot by index

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
  history: { maxSnapshots: 200 },
});

system.start();

// User makes changes
system.facts.text = "Hello";
system.facts.text = "Hello, world";
system.facts.text = "Hello, world!";

// Undo last change
const history = system.history;
history.undo();
console.log(system.facts.text); // "Hello, world"

history.undo();
console.log(system.facts.text); // "Hello"

// Redo
history.redo();
console.log(system.facts.text); // "Hello, world"

// Check navigation state
history.canUndo(); // true
history.canRedo(); // true
```

## Changesets: Grouping Related Changes

Multiple fact mutations can be grouped into a single undoable unit.

```typescript
const history = system.history;

// Without changeset – each mutation is a separate snapshot
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
// Two snapshots, two undos needed

// With changeset – grouped into one snapshot
history.beginChangeset("Update user name");
system.facts.firstName = "Alice";
system.facts.lastName = "Smith";
history.endChangeset();
// One snapshot, one undo restores both

// Undo reverts the entire changeset
history.undo();
// Both firstName and lastName are restored
```

Use changesets for logically related mutations: form submissions, multi-field updates, resolver results.

## Exporting and Importing History

Serialize the full snapshot history for bug reports or debugging.

```typescript
const history = system.history;

// Export – returns a serializable object
const historyData = history.exportHistory();
// Send to server, save to file, attach to bug report
console.log(JSON.stringify(historyData));

// Import – restore history from exported data
history.importHistory(historyData);

// Now you can step through the user's exact state sequence
history.goToSnapshot(0); // Start
history.goToSnapshot(5); // When the bug occurred
```

## Snapshot Inspection

```typescript
const history = system.history;
const snapshots = history.getSnapshots();

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
history.goToSnapshot(3);
console.log(system.facts); // State as of snapshot 3
```

## Performance: maxSnapshots

Every fact mutation creates a snapshot. Cap the number to control memory:

```typescript
// Low memory – keeps last 20 snapshots, discards oldest
history: { maxSnapshots: 20 },

// Development – generous cap for deep debugging
history: { maxSnapshots: 500 },

// Default if not specified
history: true, // maxSnapshots defaults to 50
```

When the cap is reached, the oldest snapshot is discarded (FIFO). Redo history beyond the cap is lost.

## Common Mistakes

### Enabling history in production

```typescript
// WRONG – snapshots consume memory on every mutation
const system = createSystem({
  module: myModule,
  history: true,
});

// CORRECT – gate on environment
const system = createSystem({
  module: myModule,
  history: process.env.NODE_ENV === "development"
    ? { maxSnapshots: 100 }
    : false,
});
```

### Forgetting to end a changeset

```typescript
// WRONG – changeset never closed, all subsequent mutations are grouped
history.beginChangeset("update");
system.facts.name = "Alice";
// ... forgot endChangeset()
system.facts.unrelated = true; // Still part of the changeset!

// CORRECT – always close changesets
history.beginChangeset("update");
system.facts.name = "Alice";
history.endChangeset();
```

### Accessing history when disabled

```typescript
// WRONG – history not enabled, system.history is null
const system = createSystem({ module: myModule });
system.history.undo(); // TypeError!

// CORRECT – check before using
const history = system.history;
if (history) {
  history.undo();
}

// Or enable it
const system = createSystem({
  module: myModule,
  history: true,
});
```

### No maxSnapshots cap with frequent mutations

```typescript
// WRONG – unbounded snapshots in a high-frequency update loop
history: true, // Default cap is 50, which is fine

// Be explicit when mutation rate is high
history: { maxSnapshots: 30 },
```
