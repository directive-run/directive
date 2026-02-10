---
title: GDPR/CCPA Compliance
description: Data subject rights, consent tracking, retention policies, and deletion certificates.
---

Handle data export requests, right-to-erasure, consent management, and retention enforcement with a single API. {% .lead %}

---

## Basic Setup

```typescript
import { createCompliance, createInMemoryComplianceStorage } from 'directive/ai';

const compliance = createCompliance({
  storage: createInMemoryComplianceStorage(),
  retention: {
    name: 'default',
    defaultRetentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year
    categoryRetention: {
      audit: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years for audit logs
      sessions: 30 * 24 * 60 * 60 * 1000,    // 30 days for sessions
    },
  },
});
```

---

## Data Export (GDPR Article 20)

Export all data for a subject:

```typescript
const result = await compliance.exportData({
  subjectId: 'user-123',
  format: 'json',          // or 'csv'
  includeAudit: true,      // include audit trail entries
  includeDerived: false,   // include derived data
  categories: ['profile', 'orders'], // specific categories (optional)
});

console.log(result.success);      // true
console.log(result.recordCount);  // 47
console.log(result.checksum);     // SHA-256 of exported data
console.log(result.data);         // JSON string of all records
```

---

## Data Deletion (GDPR Article 17)

Delete or anonymize data for a subject:

```typescript
const result = await compliance.deleteData({
  subjectId: 'user-123',
  scope: 'all',          // 'all' | 'facts' | 'audit' | 'specific'
  anonymize: false,       // anonymize instead of hard delete
  reason: 'User requested account deletion',
});

console.log(result.success);          // true
console.log(result.recordsAffected);  // 47
console.log(result.certificate);      // DeletionCertificate
```

Every deletion produces a `DeletionCertificate` with a SHA-256 hash for compliance records:

```typescript
const cert = result.certificate;
console.log(cert.id);          // unique certificate ID
console.log(cert.type);        // 'hard' | 'soft' | 'anonymization'
console.log(cert.scope);       // deletion scope
console.log(cert.recordCount); // records affected
console.log(cert.hash);        // SHA-256 hash of certificate content
```

---

## Consent Tracking

Track and enforce user consent:

```typescript
// Grant consent
await compliance.consent.grant('user-123', 'marketing', {
  source: 'signup_form',
  version: 'v2.1',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
});

// Check consent
const hasConsent = await compliance.consent.check('user-123', 'marketing');

// Revoke consent
await compliance.consent.revoke('user-123', 'marketing');

// Get all consents for a user
const consents = await compliance.consent.getForSubject('user-123');

// Get all users who consented to a purpose
const marketingUsers = await compliance.consent.getForPurpose('marketing');
```

---

## Consent Guardrail

Block AI processing when consent is missing:

```typescript
import { createAgentOrchestrator, createOpenAIRunner } from 'directive/ai';

const consentGuardrail = compliance.createConsentGuardrail('ai_processing');

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [{ name: 'consent', fn: consentGuardrail }],
  },
});
```

The guardrail checks the subject's consent status before allowing the input through. If consent is not granted, the guardrail blocks the request.

---

## Retention Enforcement

Automatically delete data that exceeds retention periods:

```typescript
const compliance = createCompliance({
  storage: myStorage,
  retention: {
    name: 'production',
    defaultRetentionMs: 365 * 24 * 60 * 60 * 1000,
    categoryRetention: {
      sessions: 30 * 24 * 60 * 60 * 1000,
      logs: 90 * 24 * 60 * 60 * 1000,
    },
    onBeforeDelete: async ({ category, count }) => {
      console.log(`About to delete ${count} records from ${category}`);
    },
    onAfterDelete: ({ category, count }) => {
      console.log(`Deleted ${count} records from ${category}`);
    },
  },
});

// Run retention enforcement
const deletedCount = await compliance.enforceRetention();
```

---

## Custom Storage

Implement the `ComplianceStorage` interface to back compliance with any database:

```typescript
const storage: ComplianceStorage = {
  getSubjectData: async (subjectId, categories) => {
    return db.query('SELECT * FROM data WHERE subject_id = ?', [subjectId]);
  },
  deleteSubjectData: async (subjectId, categories) => {
    return db.delete('data', { subject_id: subjectId });
  },
  anonymizeSubjectData: async (subjectId, categories) => {
    return db.update('data', { pii: null }, { subject_id: subjectId });
  },
  getExpiredData: async (category, olderThan) => {
    return db.query('SELECT id, created_at FROM data WHERE category = ? AND created_at < ?', [category, olderThan]);
  },
  deleteByIds: async (ids) => {
    return db.delete('data', { id: ids });
  },
  storeConsent: async (record) => {
    await db.insert('consents', record);
  },
  getConsent: async (subjectId, purpose) => {
    return db.findOne('consents', { subject_id: subjectId, purpose });
  },
  getConsentsBySubject: async (subjectId) => {
    return db.find('consents', { subject_id: subjectId });
  },
  getConsentsByPurpose: async (purpose) => {
    return db.find('consents', { purpose });
  },
  storeDeletionCertificate: async (cert) => {
    await db.insert('deletion_certificates', cert);
  },
};
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | `ComplianceStorage` | — (required) | Storage adapter for compliance data |
| `retention` | `RetentionPolicy` | — | Retention policy configuration |
| `consentPurposes` | `string[]` | — | Consent purposes to track |
| `exportExpirationMs` | `number` | `24 hours` | Expiration for export download links |
| `auditOperations` | `boolean` | — | Audit all compliance operations |
| `events` | `object` | — | Callbacks for export, delete, consent, and retention events |

---

## Next Steps

- [Audit Trail](/docs/security/audit) -- tamper-evident audit logging
- [PII Detection](/docs/security/pii) -- detect and redact sensitive data
- [Guardrails](/docs/ai/guardrails) -- AI safety guardrails
