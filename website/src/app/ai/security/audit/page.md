---
title: Audit Trail
description: Cryptographic audit logging with hash chains, PII masking, and tamper detection.
---

Maintain an immutable, tamper-evident audit trail of every operation. Part of the `@directive-run/ai` package. {% .lead %}

---

## Quick Start

Create an audit trail and start recording entries:

```typescript
import { createAuditTrail } from '@directive-run/ai';

// Create a hash-chained audit trail with size and time limits
const audit = createAuditTrail({
  maxEntries: 10000,
  retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// Record custom events
await audit.addEntry('agent.run.start', {
  agentName: 'researcher',
  input: 'Find recent papers on AI safety',
});
```

---

## What Gets Logged

22 event types across eight categories:

| Category | Events |
|----------|--------|
| Agent lifecycle | `agent.run.start`, `agent.run.complete`, `agent.run.error` |
| Tool operations | `tool.call.start`, `tool.call.complete`, `tool.call.error` |
| Human-in-the-loop | `approval.requested`, `approval.granted`, `approval.denied` |
| Requirements | `requirement.created`, `requirement.met` |
| Resolvers | `resolver.start`, `resolver.complete`, `resolver.error` |
| Fact mutations | `fact.set`, `fact.batch` |
| Error handling | `error.occurred`, `error.recovery` |
| Checkpoint operations | `checkpoint.save`, `checkpoint.restore`, `checkpoint.fork`, `checkpoint.replay` |

---

## Configuration

```typescript
const audit = createAuditTrail({
  // Storage limits
  maxEntries: 10000,          // Max entries before FIFO eviction
  retentionMs: 7 * 24 * 60 * 60 * 1000, // Retention period

  // External shipping (e.g., to a SIEM like Splunk or Datadog)
  exportInterval: 60000,      // Export flush interval (ms)
  exporter: async (entries) => {
    await sendToSIEM(entries);
  },

  // Identity context attached to every entry
  sessionId: 'session-abc',   // Correlate entries to a session
  actorId: 'user-123',        // Identify the actor

  // Lifecycle callbacks for monitoring the audit system itself
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
| `exporter` | `(entries) => Promise<void>` | &ndash; | Async function to ship entries externally |
| `piiMasking` | `PIIMaskingConfig` | &ndash; | PII detection and redaction config |
| `signing` | `SigningConfig` | &ndash; | Cryptographic signing for non-repudiation |
| `sessionId` | `string` | &ndash; | Session ID attached to all entries |
| `actorId` | `string` | &ndash; | Actor ID attached to all entries |
| `events` | `object` | &ndash; | Callbacks for entry, chain, and export events |

---

## PII Masking

Automatically detect and redact PII in audit payloads:

```typescript
const audit = createAuditTrail({
  // Scan audit payloads for PII before storing them
  piiMasking: {
    enabled: true,
    types: ['ssn', 'credit_card', 'email', 'phone'],
    redactionStyle: 'typed', // '[SSN]', '[CREDIT_CARD]', etc.
    minConfidence: 0.7,      // only redact high-confidence matches
  },
});
```

When enabled, each entry includes both the original `payload` and a `maskedPayload` with PII redacted. Supported redaction styles: `'placeholder'` (replaces with `[REDACTED]`), `'typed'` (replaces with type label like `[SSN]`), `'masked'` (partial masking like `***-**-1234`), or `'hashed'` (SHA-256 hash of original).

---

## Entry Signing

Sign entries for non-repudiation:

```typescript
const audit = createAuditTrail({
  // Cryptographic signing for non-repudiation (proves who wrote each entry)
  signing: {
    signFn: async (hash) => {
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
// Verify that no entries have been tampered with since creation
const result = await audit.verifyChain();

console.log(result.valid);            // true if chain is intact
console.log(result.entriesVerified);  // number of entries checked

// If tampered, pinpoints exactly where the chain broke
if (!result.valid) {
  console.log(result.brokenAt);
  // { index: 42, entryId: 'abc', expectedHash: '...', actualHash: '...' }
}
```

---

## Querying Entries

```typescript
// Retrieve the full audit log
const all = audit.getEntries();

// Find errors from the last hour (useful for incident investigation)
const recent = audit.getEntries({
  eventTypes: ['resolver.error', 'error.occurred'],
  since: Date.now() - 3600000, // last hour
  limit: 50,
});

// Trace all actions by a specific user in a specific session
const userActions = audit.getEntries({
  actorId: 'user-123',
  sessionId: 'session-abc',
});
```

---

## Statistics

```typescript
// Get a summary of audit trail health and usage
const stats = audit.getStats();

console.log(stats.totalEntries);    // 1523
console.log(stats.byEventType);    // { 'fact.set': 890, 'resolver.complete': 312, ... }
console.log(stats.chainIntegrity); // true (no tampering detected)
console.log(stats.entriesPruned);  // 0
console.log(stats.entriesExported); // 1200
```

---

## Cleanup

```typescript
// Remove entries that have exceeded their retention period
const pruned = audit.prune();
console.log(`Pruned ${pruned} entries`);

// Shut down gracefully (flushes pending exports, clears timers)
await audit.dispose();
```

---

## AI Integration

Attach the audit trail as a plugin to an orchestrator &ndash; it automatically records agent runs, tool calls, approval decisions, and errors:

```typescript
import { createAuditTrail, createAgentOrchestrator } from '@directive-run/ai';

const audit = createAuditTrail({
  maxEntries: 10000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  plugins: [audit.createPlugin()],
});
```

See [Guardrails](/ai/guardrails) for error handling, streaming guardrails, and the builder pattern.

---

## Next Steps

- [PII Detection](/ai/security/pii) &ndash; detect and redact sensitive data
- [GDPR/CCPA](/ai/security/compliance) &ndash; data subject rights
- [Security Overview](/ai/security/overview) &ndash; defense-in-depth architecture
