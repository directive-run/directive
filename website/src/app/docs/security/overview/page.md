---
title: Security & Compliance Overview
description: PII detection, prompt injection prevention, audit trails, and GDPR/CCPA compliance for AI systems.
---

Directive provides security guardrails and compliance tooling for AI agent systems. Detect threats at the input layer, audit every operation, and handle data subject requests. {% .lead %}

---

## Security Features

| Feature | Page | Threat Addressed |
|---------|------|-----------------|
| [PII Detection](/docs/security/pii) | Input/output scanning | Personally identifiable information leaking to/from agents |
| [Prompt Injection](/docs/security/prompt-injection) | Input validation | Jailbreaks, instruction overrides, encoding evasion |
| [Audit Trail](/docs/security/audit) | Observability | Tamper-evident logging of every system operation |
| [GDPR/CCPA](/docs/security/compliance) | Data governance | Right to erasure, data export, consent tracking, retention |

---

## Defense in Depth

Apply multiple layers of protection:

```
User Input
  → Prompt Injection Detection  (block attacks before they reach agents)
  → PII Detection               (redact sensitive data from input)
  → Agent Execution              (safe to process after filtering)
  → Output PII Scan             (catch any data leaks in responses)
  → Audit Trail                 (log every operation for compliance)
```

---

## Quick Setup

```typescript
import { createAgentOrchestrator } from 'directive/ai';
import { createEnhancedPIIGuardrail, createPromptInjectionGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner: myRunner,

  // Input guardrails run in order before each agent invocation
  guardrails: {
    input: [
      // First line of defense: block injection attacks
      createPromptInjectionGuardrail({ strictMode: true }),

      // Second pass: redact any PII that slipped through
      createEnhancedPIIGuardrail({ redact: true }),
    ],
  },
});
```

---

## When to Use What

| Scenario | Feature |
|----------|---------|
| User-facing chatbot | PII detection + prompt injection + audit trail |
| Internal tool | Audit trail + GDPR compliance |
| Healthcare/finance | All four features |
| Development/testing | Audit trail only |

---

## Next Steps

- **Start with safety** – [PII Detection](/docs/security/pii) is the most common first step
- **Add attack prevention** – [Prompt Injection](/docs/security/prompt-injection) for user-facing apps
- **Compliance requirements?** – [GDPR/CCPA](/docs/security/compliance) for regulated industries
