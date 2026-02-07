---
title: GDPR/CCPA Compliance
description: Build compliant applications with Directive's privacy features.
---

Implement privacy regulations with built-in tools. {% .lead %}

---

## Data Subject Rights

Implement right to access and erasure:

```typescript
import { compliancePlugin } from 'directive/security';

const system = createSystem({
  module: myModule,
  plugins: [
    compliancePlugin({
      regulations: ['gdpr', 'ccpa'],
    }),
  ],
});

// Export user data
const userData = await system.compliance.exportUserData(userId);

// Delete user data
await system.compliance.deleteUserData(userId);
```

---

## Consent Management

Track consent:

```typescript
const userModule = createModule("user", {
  schema: {
    facts: {
      consents: t.object<{
        marketing: boolean;
        analytics: boolean;
        thirdParty: boolean;
        timestamp: number;
      }>(),
    },
  },

  constraints: {
    needsConsent: {
      when: (facts) => !facts.consents,
      require: { type: "SHOW_CONSENT_DIALOG" },
    },
  },
});
```

---

## Data Minimization

Only collect necessary data:

```typescript
compliancePlugin({
  minimization: {
    // Auto-expire sensitive data
    expiry: {
      'session.*': '24h',
      'logs.*': '30d',
      'analytics.*': '90d',
    },

    // Anonymize after period
    anonymize: {
      'user.ip': '7d',
      'user.location': '30d',
    },
  },
})
```

---

## Purpose Limitation

Restrict data usage:

```typescript
compliancePlugin({
  purposes: {
    'user.email': ['authentication', 'notifications'],
    'user.preferences': ['personalization'],
    'analytics.*': ['analytics'],
  },

  onViolation: (field, purpose) => {
    throw new Error(`${field} cannot be used for ${purpose}`);
  },
})
```

---

## Breach Notification

Handle data breaches:

```typescript
compliancePlugin({
  breach: {
    onDetected: async (details) => {
      // Notify authorities
      await notifyDPA(details);

      // Notify affected users
      await notifyUsers(details.affectedUsers);

      // Log incident
      await logIncident(details);
    },
    notificationWindow: 72 * 60 * 60 * 1000, // 72 hours
  },
})
```

---

## Next Steps

- See PII Detection for data identification
- See Audit Trail for logging
- See Prompt Injection for security
