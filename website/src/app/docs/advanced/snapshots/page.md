---
title: Snapshots
description: Capture and restore complete system state.
---

Save and restore system state with snapshots. {% .lead %}

---

## Creating Snapshots

```typescript
// Capture current state
const snapshot = system.snapshot();

// Snapshot is a plain object
console.log(snapshot);
// { count: 5, user: { name: "John" }, items: [...] }
```

---

## Restoring Snapshots

```typescript
// Restore from snapshot
system.restore(snapshot);

// Facts are updated to match snapshot
console.log(system.facts.count); // 5
```

---

## Partial Snapshots

Snapshot specific facts:

```typescript
// Only snapshot certain facts
const partial = system.snapshot(['user', 'preferences']);
// { user: {...}, preferences: {...} }

// Restore partial (other facts unchanged)
system.restore(partial);
```

---

## Signed Snapshots

Create tamper-proof snapshots:

```typescript
import { signSnapshot, verifySnapshot } from 'directive';

// Sign a snapshot
const signed = await signSnapshot(snapshot, {
  key: process.env.SIGNING_KEY,
  algorithm: 'sha256',
});

// Verify before restoring
const isValid = await verifySnapshot(signed, {
  key: process.env.SIGNING_KEY,
});

if (isValid) {
  system.restore(signed.data);
}
```

---

## Compression

Compress large snapshots:

```typescript
import { compressSnapshot, decompressSnapshot } from 'directive';

const compressed = await compressSnapshot(snapshot);
localStorage.setItem('state', compressed);

const decompressed = await decompressSnapshot(
  localStorage.getItem('state')
);
system.restore(decompressed);
```

---

## Diff Snapshots

Compare two snapshots:

```typescript
import { diffSnapshots } from 'directive';

const before = system.snapshot();
// ... changes happen ...
const after = system.snapshot();

const diff = diffSnapshots(before, after);
// { changed: ['count'], added: [], removed: [] }
```

---

## Next Steps

- See Time-Travel for navigation
- See Persistence for automatic saving
- See SSR for server-side usage
