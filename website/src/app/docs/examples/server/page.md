---
title: Server (Node.js) Example
description: An Express API demonstrating distributable snapshots, signed verification, audit trails, and GDPR compliance with Directive.
---

Directive running on a plain Node.js server &ndash; no React, no framework. {% .lead %}

---

## Overview

This example is a standalone Express API that demonstrates four server-side features working together:

- **Distributable Snapshots** &ndash; export system state with TTL and in-memory caching
- **Signed Snapshots** &ndash; HMAC-SHA256 signing and tamper-proof verification
- **Audit Trail** &ndash; hash-chained, tamper-evident logging with PII masking
- **GDPR/CCPA Compliance** &ndash; data export, right to erasure, consent tracking

---

## Run It

```bash
cd examples/server
pnpm install
pnpm dev
```

The server starts on `http://localhost:3000`. Try `curl http://localhost:3000/snapshot/user-1`.

---

## The Module

A user profile module with facts (`userId`, `profile`, `status`, `error`), a constraint that fires when a user needs loading, and a resolver that simulates a database lookup:

```typescript
import { createModule, t, type ModuleSchema } from "@directive-run/core";

export const userProfile = createModule("user-profile", {
  schema: {
    facts: {
      userId: t.string(),
      profile: t.object<UserProfile | null>(),
      status: t.string<"idle" | "loading" | "ready" | "error">(),
      error: t.string(),
    },
    derivations: {
      effectivePlan: t.string(),
      canUseFeature: t.object<Record<string, boolean>>(),
      isReady: t.boolean(),
    },
    events: {
      loadUser: { userId: t.string() },
    },
    requirements: {
      FETCH_PROFILE: { userId: t.string() },
    },
  },

  // Constraint: when status is "loading" and userId is set, require FETCH_PROFILE
  constraints: {
    fetchProfile: {
      when: (facts) => facts.status === "loading" && facts.userId !== "",
      require: (facts) => ({ type: "FETCH_PROFILE", userId: facts.userId }),
    },
  },

  // Resolver: simulate async database lookup
  resolvers: {
    fetchProfile: {
      requirement: "FETCH_PROFILE",
      resolve: async (req, context) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const user = USERS[req.userId];
        if (user) {
          context.facts.profile = user;
          context.facts.status = "ready";
        } else {
          context.facts.status = "error";
          context.facts.error = `User ${req.userId} not found`;
        }
      },
    },
  },
});
```

---

## Per-Request Systems

Every request creates a fresh Directive system. No singletons, no shared mutable state between requests:

```typescript
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

Use `system.settle()` with a timeout to wait for all constraints and resolvers to complete before responding:

```typescript
await system.settle(5000);
```

---

## Distributable Snapshots

Export computed derivations with a TTL. Cache the result in-memory (or Redis, or a CDN edge cache):

```typescript
app.get("/snapshot/:userId", async (req, res) => {
  const system = createUserSystem(req.params.userId);

  await system.settle(5000);

  const snapshot = system.getDistributableSnapshot({
    includeDerivations: ["effectivePlan", "canUseFeature", "isReady"],
    ttlSeconds: 3600,
  });

  // Cache it
  snapshotCache.set(userId, { snapshot, cachedAt: Date.now() });

  res.json({ snapshot });
  system.destroy();
});
```

The returned snapshot includes `createdAt` and `expiresAt` timestamps. Use `isSnapshotExpired()` to check validity before serving a cached snapshot.

---

## Signed Verification

Sign snapshots with HMAC-SHA256 for tamper-proof transmission between services:

```typescript
import { signSnapshot, verifySnapshotSignature } from "@directive-run/core";

// Sign a snapshot
const signed = await signSnapshot(snapshot, SIGNING_SECRET);
// { data: {...}, signature: "a1b2c3...", algorithm: "hmac-sha256" }

// Verify before trusting
const isValid = await verifySnapshotSignature(signed, SIGNING_SECRET);
```

Both functions use `globalThis.crypto.subtle` &ndash; no Node-specific imports. Works in Node 18+, browsers, Deno, and Bun.

---

## Audit Trail

The audit trail plugs directly into the Directive lifecycle. Every fact mutation, resolver execution, and error is automatically logged with a cryptographic hash chain:

```typescript
import { createAuditTrail } from "@directive-run/ai";

const audit = createAuditTrail({
  maxEntries: 10_000,
  piiMasking: {
    enabled: true,
    types: ["email", "name"],
    redactionStyle: "mask",
  },
});

// Wire it into any Directive system as a plugin
const system = createSystem({
  module: userProfile,
  plugins: [audit.createPlugin()],
});
```

Query entries and verify chain integrity:

```typescript
// Filter entries
const entries = audit.getEntries({
  eventTypes: ["fact.set"],
  since: Date.now() - 3600_000,
  limit: 50,
});

// Verify the hash chain has not been tampered with
const result = await audit.verifyChain();
// { valid: true, entriesVerified: 42 }
```

---

## GDPR/CCPA Compliance

Data export (Article 20), right to erasure (Article 17), and consent tracking:

```typescript
import { createCompliance, createInMemoryComplianceStorage } from "@directive-run/ai";

const compliance = createCompliance({
  storage: createInMemoryComplianceStorage(), // Use a DB adapter in production
  consentPurposes: ["analytics", "marketing", "personalization"],
});

// Export all data for a subject
const exportResult = await compliance.exportData({
  subjectId: "user-1",
  format: "json",
  includeAudit: true,
});
// { success: true, data: "...", checksum: "sha256-...", recordCount: 5 }

// Delete all data with a deletion certificate
const deleteResult = await compliance.deleteData({
  subjectId: "user-1",
  scope: "all",
  reason: "GDPR Article 17 request",
});
// { success: true, certificate: { hash: "sha256-...", ... } }
```

---

## Endpoints

| Method | Path | Feature |
|--------|------|---------|
| `GET` | `/snapshot/:userId` | Distributable snapshot with TTL |
| `POST` | `/snapshot/:userId/verify` | Sign and verify HMAC signatures |
| `GET` | `/audit` | Query audit entries |
| `GET` | `/audit/verify` | Verify hash chain integrity |
| `POST` | `/compliance/:subjectId/export` | GDPR data export |
| `POST` | `/compliance/:subjectId/delete` | GDPR right to erasure |
| `GET` | `/health` | System status and audit stats |

---

## Related

- [SSR & Hydration](/docs/advanced/ssr) &ndash; Server rendering patterns
- [Snapshots](/docs/advanced/snapshots) &ndash; Snapshot API reference
- [Audit Trail](/ai/security/audit) &ndash; Full audit trail docs
- [GDPR/CCPA](/ai/security/compliance) &ndash; Full compliance docs
- [Directive on the Server](/blog/directive-on-the-server) &ndash; Blog post walkthrough
