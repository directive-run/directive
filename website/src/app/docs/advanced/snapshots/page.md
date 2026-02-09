---
title: Snapshots
description: Capture and restore complete system state.
---

Save and restore system state with snapshots. {% .lead %}

---

## Creating Snapshots

```typescript
// Capture current state
const snapshot = system.getSnapshot();

// Snapshot is a SystemSnapshot object
console.log(snapshot);
// { facts: { count: 5, user: { name: "John" } }, ... }
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

## Signed Snapshots

Create tamper-proof snapshots for secure transmission:

```typescript
import { signSnapshot, verifySnapshotSignature } from 'directive';

// Sign a snapshot with a secret
const signed = signSnapshot(snapshot, process.env.SIGNING_SECRET);

// Verify before restoring
const isValid = verifySnapshotSignature(signed, process.env.SIGNING_SECRET);

if (isValid) {
  system.restore(signed);
}
```

Both functions use the secret string for HMAC-based signing and verification.

---

## Diff Snapshots

Compare two snapshots to see what changed:

```typescript
import { diffSnapshots } from 'directive';

const before = system.getSnapshot();
// ... changes happen ...
const after = system.getSnapshot();

const diff = diffSnapshots(before, after);
// { changed: ['count'], added: [], removed: [] }
```

---

## Distributable Snapshots

Export computed derivations for use outside the Directive runtime (e.g., Redis, CDN edge caches):

```typescript
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600,
});

// { data: { effectivePlan: "pro", ... }, createdAt: ..., expiresAt: ... }

// Store in Redis
await redis.setex(`state:${userId}`, 3600, JSON.stringify(snapshot));
```

Watch for changes and push updates:

```typescript
const unsubscribe = system.watchDistributableSnapshot(
  { includeDerivations: ['effectivePlan', 'canUseFeature'] },
  (snapshot) => {
    redis.setex(`state:${userId}`, 3600, JSON.stringify(snapshot));
  },
);
```

---

## Next Steps

- See [Time-Travel](/docs/advanced/time-travel) for navigation
- See [Persistence](/docs/plugins/persistence) for automatic saving
- See [SSR](/docs/advanced/ssr) for server-side usage
