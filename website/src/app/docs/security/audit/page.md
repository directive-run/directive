---
title: Audit Trail
description: Maintain comprehensive audit logs for compliance and debugging.
---

Track all state changes and actions for compliance. {% .lead %}

---

## Basic Setup

Enable audit logging:

```typescript
import { auditPlugin } from 'directive/security';

const system = createSystem({
  module: myModule,
  plugins: [
    auditPlugin({
      storage: auditStorage,
    }),
  ],
});
```

---

## What Gets Logged

| Event | Data |
|-------|------|
| Fact changes | key, oldValue, newValue, timestamp |
| Events dispatched | name, payload, timestamp |
| Requirements raised | type, data, timestamp |
| Resolver execution | name, duration, result, timestamp |
| Errors | type, message, stack, timestamp |

---

## Storage Options

Configure where logs are stored:

```typescript
// Database storage
auditPlugin({
  storage: {
    write: (entry) => db.auditLog.insert(entry),
    query: (filter) => db.auditLog.find(filter),
  },
})

// File storage
auditPlugin({
  storage: fileAuditStorage({
    path: '/var/log/audit',
    rotate: 'daily',
  }),
})

// Cloud storage
auditPlugin({
  storage: cloudAuditStorage({
    bucket: 'my-audit-logs',
    region: 'us-east-1',
  }),
})
```

---

## Filtering

Control what gets logged:

```typescript
auditPlugin({
  include: ['facts', 'events'], // Only these
  exclude: ['password', 'token'], // Never these
  filter: (entry) => {
    // Custom logic
    return entry.type !== 'heartbeat';
  },
})
```

---

## Entry Signing

Sign entries for tamper detection:

```typescript
auditPlugin({
  signing: {
    algorithm: 'sha256',
    key: process.env.AUDIT_SIGNING_KEY,
  },
})
```

---

## Verification

Verify audit log integrity:

```typescript
import { verifyAuditLog } from 'directive/security';

const result = await verifyAuditLog({
  storage: auditStorage,
  from: startDate,
  to: endDate,
});

console.log(result.valid); // true/false
console.log(result.tamperedEntries); // []
```

---

## Next Steps

- See PII Detection for data privacy
- See GDPR/CCPA for compliance
- See Logging for debugging
