---
title: PII Detection
description: Detect and protect personally identifiable information in Directive systems.
---

Automatically detect and handle PII in your data flows. {% .lead %}

---

## Basic Setup

Enable PII detection:

```typescript
import { piiPlugin } from 'directive/security';

const system = createSystem({
  module: myModule,
  plugins: [
    piiPlugin({
      types: ['email', 'phone', 'ssn', 'creditCard'],
      action: 'redact',
    }),
  ],
});
```

---

## Detection Types

| Type | Pattern |
|------|---------|
| `email` | Email addresses |
| `phone` | Phone numbers |
| `ssn` | Social Security numbers |
| `creditCard` | Credit card numbers |
| `ip` | IP addresses |
| `name` | Personal names |
| `address` | Physical addresses |

---

## Actions

Configure how PII is handled:

```typescript
piiPlugin({
  types: ['email', 'ssn'],

  // 'redact' - Replace with [REDACTED]
  // 'mask' - Partial masking (j***@email.com)
  // 'hash' - One-way hash
  // 'warn' - Log warning only
  // 'block' - Prevent the operation
  action: 'redact',
})
```

---

## Custom Patterns

Add custom PII patterns:

```typescript
piiPlugin({
  custom: [
    {
      name: 'employeeId',
      pattern: /EMP-\d{6}/g,
      action: 'redact',
    },
    {
      name: 'internalCode',
      pattern: /INTERNAL-[A-Z]{4}/g,
      action: 'mask',
    },
  ],
})
```

---

## Field-Level Control

Configure per-field behavior:

```typescript
piiPlugin({
  fields: {
    'user.email': { action: 'mask' },
    'user.ssn': { action: 'redact' },
    'logs.*': { action: 'hash' },
  },
})
```

---

## Audit Logging

Log PII detections:

```typescript
piiPlugin({
  onDetection: (field, type, value) => {
    auditLog.write({
      event: 'pii_detected',
      field,
      type,
      timestamp: Date.now(),
    });
  },
})
```

---

## Next Steps

- See Prompt Injection for input safety
- See Audit Trail for compliance logging
- See GDPR/CCPA for regulations
