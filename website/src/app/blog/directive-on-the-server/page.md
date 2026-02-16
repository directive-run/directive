---
title: Directive on the Server
description: Distributable snapshots, signed verification, audit trails, and GDPR compliance – Directive runs on Node.js without React.
layout: blog
date: 2026-02-18
dateModified: 2026-02-18
slug: directive-on-the-server
author: directive-labs
categories: [Architecture, Tutorial]
---

Directive is framework-agnostic. There are no browser APIs in the core. No DOM, no `window`, no React import. The same runtime that powers reactive UIs also runs on a plain Node.js server.

This matters because server-side state management is often ad-hoc. User sessions live in Redis blobs without structure. Feature flags get passed around as loose objects. Cache invalidation is manual. Audit logging is bolted on after the fact. There's no unifying model &ndash; just scattered Maps, middleware, and hope.

Directive gives server-side state the same declarative treatment that frontend state gets. Facts, derivations, constraints, resolvers &ndash; they work the same way regardless of where the code runs. But the server also unlocks features that don't make sense in a browser: distributable snapshots with TTL, HMAC-signed verification, cryptographic audit trails, and GDPR/CCPA compliance tooling.

This article walks through all four, using a real Express API as the running example.

---

## Per-request systems

The first thing to get right on the server is isolation. In a browser, you typically create one system for the lifetime of the page. On the server, you create one system per request.

```typescript
import { createSystem } from '@directive-run/core';
import { userProfile } from './module.js';

function createUserSystem(userId: string) {
  const system = createSystem({
    module: userProfile,
    plugins: [audit.createPlugin()],
  });

  system.start();
  system.events.loadUser({ userId });

  return system;
}
```

Never use a module-level singleton. Two concurrent requests would mutate the same facts, and you'd get race conditions that are nearly impossible to debug.

The factory function creates a fresh system, starts it, and seeds it with request-specific data. Constraints fire, resolvers execute, and the system converges on a settled state &ndash; all scoped to a single request lifecycle.

The server-side equivalent of "wait for loading" is `system.settle()`:

```typescript
const system = createUserSystem(req.params.userId);
await system.settle(5000);

// All constraints evaluated, all resolvers complete
const snapshot = system.getDistributableSnapshot({ ttlSeconds: 3600 });
res.json(snapshot);

system.destroy();
```

`settle()` returns a promise that resolves when all active constraints have been evaluated and all in-flight resolvers have completed (or the timeout is reached). After settling, the system is fully resolved and ready to export.

---

## Distributable snapshots

`getSnapshot()` returns the raw internal state. It's useful for debugging and hydration, but it's not what you want to hand to an API consumer. It exposes internal structure, includes no metadata, and has no expiry.

`getDistributableSnapshot()` is designed for exactly this. It exports selected derivations as a clean data object with timestamps and TTL:

```typescript
const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature', 'isReady'],
  ttlSeconds: 3600, // 1 hour
});
// {
//   data: { effectivePlan: "pro", canUseFeature: { analytics: true, ... }, isReady: true },
//   createdAt: 1708300000000,
//   expiresAt: 1708303600000,
// }
```

Cache the result in Redis, a CDN edge cache, or an in-memory Map. Before serving a cached snapshot, check expiry:

```typescript
import { isSnapshotExpired } from '@directive-run/core';

const cached = snapshotCache.get(userId);
if (cached && !isSnapshotExpired(cached)) {
  return res.json({ source: "cache", snapshot: cached });
}
```

For push-based updates, `watchDistributableSnapshot()` fires a callback whenever the underlying derivations change:

```typescript
const unsubscribe = system.watchDistributableSnapshot(
  { includeDerivations: ['effectivePlan', 'canUseFeature'] },
  (snapshot) => {
    redis.setex(`state:${userId}`, 3600, JSON.stringify(snapshot));
  },
);
```

This replaces manual cache invalidation with reactive push. When facts change, derivations recompute, and the snapshot updates automatically.

---

## Signed snapshots

Snapshots are plain JSON. If you pass them between services, through a CDN, or to a client for later submission, you need a way to detect tampering. `signSnapshot()` attaches an HMAC-SHA256 signature:

```typescript
import { signSnapshot, verifySnapshotSignature } from '@directive-run/core';

const signed = await signSnapshot(snapshot, process.env.SIGNING_SECRET);
// Adds: { signature: "a1b2c3...", algorithm: "hmac-sha256" }
```

On the receiving end, verify before trusting:

```typescript
const isValid = await verifySnapshotSignature(signedSnapshot, process.env.SIGNING_SECRET);
if (!isValid) {
  return res.status(403).json({ error: "Snapshot signature invalid" });
}
```

The verification uses a timing-safe comparison (XOR byte-by-byte) to prevent timing attacks. Both functions use `globalThis.crypto.subtle` &ndash; no Node-specific crypto imports. They work in Node 18+, browsers, Deno, and Bun.

Use cases: passing user entitlements between microservices, edge-caching signed state at a CDN, verifying client-submitted snapshots before restoring them.

---

## Audit trail

`createAuditTrail()` is a Directive plugin that logs every system operation with a cryptographic hash chain. Every fact mutation, every resolver execution, every error &ndash; logged, timestamped, and hash-chained so that deleting or modifying a single entry breaks the chain.

```typescript
import { createAuditTrail } from '@directive-run/ai';

const audit = createAuditTrail({
  maxEntries: 10_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  piiMasking: {
    enabled: true,
    types: ['email', 'name'],
    redactionStyle: 'mask',
  },
});
```

Wire it into any Directive system as a plugin:

```typescript
const system = createSystem({
  module: userProfile,
  plugins: [audit.createPlugin()],
});
```

From this point, every operation flows through the audit trail. Query entries with filters:

```typescript
const entries = audit.getEntries({
  eventTypes: ['fact.set', 'resolver.complete'],
  since: Date.now() - 3600_000,
  actorId: 'user-1',
  limit: 50,
});
```

Verify the hash chain has not been tampered with:

```typescript
const result = await audit.verifyChain();
// { valid: true, entriesVerified: 42, verifiedAt: 1708300000000 }
```

If any entry has been modified or deleted, `valid` is `false` and `brokenAt` tells you exactly where the chain broke. This makes the audit trail suitable for SOC 2 and regulated-industry compliance where tamper-evident logging is required.

PII masking runs automatically. When `piiMasking` is enabled, the audit trail detects and masks email addresses, names, and other PII in payloads before they are stored. The original payload is never persisted &ndash; only the masked version.

For SIEM integration, use the `exporter` callback to push entries to Splunk, Datadog, or your log aggregation platform:

```typescript
const audit = createAuditTrail({
  exporter: async (entries) => {
    await fetch('https://siem.example.com/ingest', {
      method: 'POST',
      body: JSON.stringify(entries),
    });
  },
  exportInterval: 60_000, // Flush every 60 seconds
});
```

---

## GDPR/CCPA compliance

`createCompliance()` handles data subject requests: export all data (GDPR Article 20), delete all data (Article 17), and track consent.

```typescript
import { createCompliance, createInMemoryComplianceStorage } from '@directive-run/ai';

const compliance = createCompliance({
  storage: createInMemoryComplianceStorage(), // Dev/test only
  consentPurposes: ['analytics', 'marketing', 'personalization'],
});
```

Data export returns a JSON (or CSV) package with a SHA-256 checksum:

```typescript
app.post('/compliance/:subjectId/export', async (req, res) => {
  const result = await compliance.exportData({
    subjectId: req.params.subjectId,
    format: 'json',
    includeAudit: true,
  });

  res.json({
    data: JSON.parse(result.data),
    checksum: result.checksum,
    recordCount: result.recordCount,
  });
});
```

Data deletion returns a deletion certificate &ndash; cryptographic proof that you deleted what you said you deleted:

```typescript
app.post('/compliance/:subjectId/delete', async (req, res) => {
  const result = await compliance.deleteData({
    subjectId: req.params.subjectId,
    scope: 'all',
    reason: 'GDPR Article 17 request',
  });

  res.json({
    recordsDeleted: result.recordsDeleted,
    certificate: result.certificate,
  });
});
```

The deletion certificate includes a SHA-256 hash of the deletion parameters, a timestamp, and the subject ID. It serves as an audit record that the deletion was performed.

Consent tracking is built in:

```typescript
// Grant consent
await compliance.consent.grant('user-1', 'analytics', {
  source: 'cookie-banner',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
});

// Check consent before processing
const hasConsent = await compliance.consent.check('user-1', 'analytics');

// Revoke consent
await compliance.consent.revoke('user-1', 'marketing');
```

In production, swap `createInMemoryComplianceStorage()` for a database-backed adapter. The interface is the same.

---

## Not a frontend library

Directive isn't a frontend library that happens to work on the server. It's a runtime that happens to have React hooks. The constraint-driven model &ndash; declare what must be true, let resolvers fulfill it, inspect everything &ndash; is equally powerful for server-side state.

Distributable snapshots replace ad-hoc caching. Signed verification replaces trust assumptions. Audit trails replace bolted-on logging. Compliance tooling replaces manual data subject request handling.

The [server example](https://github.com/directive-run/directive/tree/main/examples/server) ties all four together in a runnable Express API. The [SSR & Hydration docs](/docs/advanced/ssr) cover the patterns for server-rendered frontends. And the [security docs](/docs/security/overview) cover each feature in depth.

---

## Go deeper

- [Server (Node.js) Example](/docs/examples/server) &ndash; full Express API walkthrough
- [SSR & Hydration](/docs/advanced/ssr) &ndash; server rendering and client hydration
- [Snapshots](/docs/advanced/snapshots) &ndash; distributable snapshots, signing, TTL
- [Audit Trail](/docs/security/audit) &ndash; hash-chained logging and SIEM export
- [GDPR/CCPA Compliance](/docs/security/compliance) &ndash; data export, deletion, consent
