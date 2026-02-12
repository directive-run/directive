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
  // In-memory storage for development (use a database adapter in production)
  storage: createInMemoryComplianceStorage(),

  // Define how long each category of data is kept
  retention: {
    name: 'default',
    defaultRetentionMs: 365 * 24 * 60 * 60 * 1000, // 1 year
    categoryRetention: {
      audit: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years for audit logs (regulatory)
      sessions: 30 * 24 * 60 * 60 * 1000,    // 30 days for sessions
    },
  },
});
```

---

## Data Export (GDPR Article 20)

Export all data for a subject:

```typescript
// Export all data associated with a user (GDPR data portability)
const result = await compliance.exportData({
  subjectId: 'user-123',
  format: 'json',          // or 'csv'
  includeAudit: true,      // include audit trail entries
  includeDerived: false,   // exclude computed data
  categories: ['profile', 'orders'], // limit to specific categories
});

console.log(result.success);      // true
console.log(result.recordCount);  // 47
console.log(result.checksum);     // SHA-256 for integrity verification
console.log(result.data);         // JSON string of all records
```

---

## Data Deletion (GDPR Article 17)

Delete or anonymize data for a subject:

```typescript
// Erase a user's data (GDPR right to erasure)
const result = await compliance.deleteData({
  subjectId: 'user-123',
  scope: 'all',          // 'all' | 'facts' | 'audit' | 'specific'
  anonymize: false,       // set true to anonymize instead of hard delete
  reason: 'User requested account deletion',
});

console.log(result.success);          // true
console.log(result.recordsAffected);  // 47
console.log(result.certificate);      // DeletionCertificate (proof of deletion)
```

Every deletion produces a `DeletionCertificate` with a SHA-256 hash for compliance records:

```typescript
// The certificate serves as auditable proof that deletion occurred
const cert = result.certificate;

console.log(cert.id);          // unique certificate ID
console.log(cert.type);        // 'hard' | 'soft' | 'anonymization'
console.log(cert.scope);       // what was deleted
console.log(cert.recordCount); // how many records were affected
console.log(cert.hash);        // SHA-256 hash for tamper detection
```

---

## Consent Tracking

Track and enforce user consent:

```typescript
// Record that a user opted in to marketing emails
await compliance.consent.grant('user-123', 'marketing', {
  source: 'signup_form',
  version: 'v2.1',
  expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
});

// Verify consent before processing (returns boolean)
const hasConsent = await compliance.consent.check('user-123', 'marketing');

// Honor a user's withdrawal of consent
await compliance.consent.revoke('user-123', 'marketing');

// Audit: see everything a user has consented to
const consents = await compliance.consent.getForSubject('user-123');

// Audit: find all users who opted in to a specific purpose
const marketingUsers = await compliance.consent.getForPurpose('marketing');
```

---

## Consent Guardrail

Block AI processing when consent is missing:

```typescript
import { createAgentOrchestrator, createOpenAIRunner } from 'directive/ai';

// Block AI processing unless the user has granted the 'ai_processing' consent
const consentGuardrail = compliance.createConsentGuardrail('ai_processing');

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

// Consent is checked before every agent invocation
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

    // Override retention for specific data categories
    categoryRetention: {
      sessions: 30 * 24 * 60 * 60 * 1000,
      logs: 90 * 24 * 60 * 60 * 1000,
    },

    // Hooks for logging or backup before data is purged
    onBeforeDelete: async ({ category, count }) => {
      console.log(`About to delete ${count} records from ${category}`);
    },
    onAfterDelete: ({ category, count }) => {
      console.log(`Deleted ${count} records from ${category}`);
    },
  },
});

// Delete all records that have exceeded their retention period
const deletedCount = await compliance.enforceRetention();
```

---

## Custom Storage

Implement the `ComplianceStorage` interface to back compliance with any database:

```typescript
// Implement this interface to connect compliance to your database
const storage: ComplianceStorage = {
  // Data export: fetch all records for a subject
  getSubjectData: async (subjectId, categories) => {
    return db.query('SELECT * FROM data WHERE subject_id = ?', [subjectId]);
  },

  // Hard deletion: permanently remove a subject's data
  deleteSubjectData: async (subjectId, categories) => {
    return db.delete('data', { subject_id: subjectId });
  },

  // Soft deletion: strip PII while keeping anonymized records
  anonymizeSubjectData: async (subjectId, categories) => {
    return db.update('data', { pii: null }, { subject_id: subjectId });
  },

  // Retention: find records older than the cutoff date
  getExpiredData: async (category, olderThan) => {
    return db.query('SELECT id, created_at FROM data WHERE category = ? AND created_at < ?', [category, olderThan]);
  },
  deleteByIds: async (ids) => {
    return db.delete('data', { id: ids });
  },

  // Consent management
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

  // Store proof of deletion for regulatory audits
  storeDeletionCertificate: async (cert) => {
    await db.insert('deletion_certificates', cert);
  },
};
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | `ComplianceStorage` | – (required) | Storage adapter for compliance data |
| `retention` | `RetentionPolicy` | – | Retention policy configuration |
| `consentPurposes` | `string[]` | – | Consent purposes to track |
| `exportExpirationMs` | `number` | `24 hours` | Expiration for export download links |
| `auditOperations` | `boolean` | – | Audit all compliance operations |
| `events` | `object` | – | Callbacks for export, delete, consent, and retention events |

---

## Next Steps

- [Audit Trail](/docs/security/audit) – tamper-evident audit logging
- [PII Detection](/docs/security/pii) – detect and redact sensitive data
- [Guardrails](/docs/ai/guardrails) – AI safety guardrails
