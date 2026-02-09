---
title: Audit Trail
description: Cryptographic audit logging with hash chains, PII masking, and tamper detection.
---

Maintain an immutable, tamper-evident audit trail of every operation in your system. {% .lead %}

---

## Basic Setup

```typescript
import { createAuditTrail } from 'directive/openai-agents';

const audit = createAuditTrail({
  maxEntries: 10000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const system = createSystem({
  module: myModule,
  plugins: [audit.createPlugin()],
});
```

The plugin automatically records fact changes, requirement lifecycle, resolver operations, and errors as hash-chained entries.

---

## What Gets Logged

17 event types across six categories:

| Category | Events |
|----------|--------|
| Agent lifecycle | `agent.run.start`, `agent.run.complete`, `agent.run.error` |
| Tool operations | `tool.call.start`, `tool.call.complete`, `tool.call.error` |
| Human-in-the-loop | `approval.requested`, `approval.granted`, `approval.denied` |
| Requirements | `requirement.created`, `requirement.met` |
| Resolvers | `resolver.start`, `resolver.complete`, `resolver.error` |
| Facts & errors | `fact.set`, `fact.batch`, `error.occurred`, `error.recovery` |

---

## Configuration

```typescript
const audit = createAuditTrail({
  maxEntries: 10000,          // Max entries before FIFO eviction
  retentionMs: 7 * 24 * 60 * 60 * 1000, // Retention period
  exportInterval: 60000,      // Export flush interval (ms)
  sessionId: 'session-abc',   // Correlate entries to a session
  actorId: 'user-123',        // Identify the actor

  exporter: async (entries) => {
    await sendToSIEM(entries);
  },

  events: {
    onEntryAdded: (entry) => console.log('Audit:', entry.eventType),
    onChainBroken: (result) => alertOps('Chain integrity broken!'),
    onExportError: (error) => console.error('Export failed:', error),
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxEntries` | `number` | `10000` | Max entries before oldest are evicted |
| `retentionMs` | `number` | `7 days` | Retention period for entries |
| `exportInterval` | `number` | `60000` | How often to flush to exporter (ms) |
| `exporter` | `(entries) => Promise<void>` | — | Async function to ship entries externally |
| `piiMasking` | `PIIMaskingConfig` | — | PII detection and redaction config |
| `signing` | `SigningConfig` | — | Cryptographic signing for non-repudiation |
| `sessionId` | `string` | — | Session ID attached to all entries |
| `actorId` | `string` | — | Actor ID attached to all entries |
| `events` | `object` | — | Callbacks for entry, chain, and export events |

---

## PII Masking

Automatically detect and redact PII in audit payloads:

```typescript
const audit = createAuditTrail({
  piiMasking: {
    enabled: true,
    types: ['ssn', 'credit_card', 'email', 'phone'],
    redactionStyle: 'typed', // '[SSN]', '[CREDIT_CARD]', etc.
    minConfidence: 0.7,
  },
});
```

When enabled, each entry includes both the original `payload` and a `maskedPayload` with PII redacted. Supported redaction styles: `'typed'` (replaces with type label), `'masked'` (partial masking like `***-**-1234`), or `'hash'` (SHA-256 hash of original).

---

## Entry Signing

Sign entries for non-repudiation:

```typescript
const audit = createAuditTrail({
  signing: {
    signFn: async (hash) => {
      // Sign the hash with your private key
      return await crypto.sign(hash, privateKey);
    },
    verifyFn: async (hash, signature) => {
      return await crypto.verify(hash, signature, publicKey);
    },
  },
});
```

When signing is configured, each entry includes a `signature` field containing the cryptographic signature of the entry's hash.

---

## Hash Chain Verification

Every entry links to the previous via SHA-256 hashes, forming a tamper-evident chain:

```typescript
const result = await audit.verifyChain();

console.log(result.valid);            // true if chain is intact
console.log(result.entriesVerified);  // number of entries checked

if (!result.valid) {
  console.log(result.brokenAt);
  // { index: 42, entryId: 'abc', expectedHash: '...', actualHash: '...' }
}
```

---

## Querying Entries

```typescript
// Get all entries
const all = audit.getEntries();

// Filter by event type and time range
const recent = audit.getEntries({
  eventTypes: ['resolver.error', 'error.occurred'],
  since: Date.now() - 3600000, // last hour
  limit: 50,
});

// Filter by actor
const userActions = audit.getEntries({
  actorId: 'user-123',
  sessionId: 'session-abc',
});
```

---

## Manual Entries

Add custom audit entries:

```typescript
await audit.addEntry('agent.run.start', {
  agentName: 'researcher',
  input: 'Find recent papers on AI safety',
});
```

---

## Statistics

```typescript
const stats = audit.getStats();

console.log(stats.totalEntries);    // 1523
console.log(stats.byEventType);    // { 'fact.set': 890, 'resolver.complete': 312, ... }
console.log(stats.chainIntegrity); // true
console.log(stats.entriesPruned);  // 0
console.log(stats.entriesExported); // 1200
```

---

## Cleanup

```typescript
// Prune entries older than retentionMs
const pruned = audit.prune();
console.log(`Pruned ${pruned} entries`);

// Dispose (clears timers, flushes pending exports)
await audit.dispose();
```

---

## Next Steps

- [PII Detection](/docs/security/pii) -- detect and redact sensitive data
- [Compliance](/docs/security/compliance) -- GDPR/CCPA data subject rights
- [Guardrails](/docs/ai/guardrails) -- AI safety guardrails
