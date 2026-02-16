---
title: Snapshots
description: Capture and restore complete system state.
---

Save and restore system state with snapshots. {% .lead %}

---

## Creating Snapshots

```typescript
// Capture a complete copy of the current system state
const snapshot = system.getSnapshot();

// The snapshot contains all fact values as a plain object
console.log(snapshot);
// { facts: { count: 5, user: { name: "John" } }, ... }
```

---

## Restoring Snapshots

```typescript
// Overwrite the current system state with a saved snapshot
system.restore(snapshot);

// All facts now reflect the snapshot values
console.log(system.facts.count); // 5
```

---

## Signed Snapshots

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

Both functions use the secret string for HMAC-based signing and verification.

---

## Diff Snapshots

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

---

## Distributable Snapshots

Export computed derivations for use outside the Directive runtime (e.g., Redis, CDN edge caches):

```typescript
// Export selected derivations for use outside the Directive runtime
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600, // Snapshot expires after 1 hour
});
// { data: { effectivePlan: "pro", ... }, createdAt: ..., expiresAt: ... }

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

## Validating Snapshot Expiry

Before serving a cached snapshot, check that it hasn't expired:

```typescript
import { isSnapshotExpired, validateSnapshot } from '@directive-run/core';

// Simple check
if (isSnapshotExpired(cachedSnapshot)) {
  // Fetch a fresh snapshot
}

// Strict validation: throws if expired, missing data, or malformed
try {
  const data = validateSnapshot(cachedSnapshot);
} catch (error) {
  // Handle expired or invalid snapshot
}
```

When verifying signed snapshots, check both the signature and expiry:

```typescript
const isValid = await verifySnapshotSignature(signed, secret);
const isExpired = isSnapshotExpired(signed);

if (!isValid || isExpired) {
  // Reject: tampered or stale
}
```

`signSnapshot` and `verifySnapshotSignature` use `globalThis.crypto.subtle` (Web Crypto API) and work in Node 18+, all modern browsers, Deno, and Bun. No Node-specific imports required.

---

## Next Steps

- [Time-Travel](/docs/advanced/time-travel) – Navigation
- [Persistence](/docs/plugins/persistence) – Automatic saving
- [SSR](/docs/advanced/ssr) – Server-side usage
