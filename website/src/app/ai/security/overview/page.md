---
title: Security & Compliance Overview
description: PII detection, prompt injection prevention, audit trails, and GDPR/CCPA compliance for AI systems.
---

Directive provides security guardrails and compliance tooling for AI agent systems. Detect threats at the input layer, audit every operation, and handle data subject requests. {% .lead %}

---

## Security Features

| Feature | Page | Threat Addressed |
|---------|------|-----------------|
| [PII Detection](/ai/security/pii) | Input/output scanning | Personally identifiable information leaking to/from agents |
| [Prompt Injection](/ai/security/prompt-injection) | Input validation | Jailbreaks, instruction overrides, encoding evasion |
| [Audit Trail](/ai/security/audit) | Observability | Tamper-evident logging of every system operation |
| [GDPR/CCPA](/ai/security/compliance) | Data governance | Right to erasure, data export, consent tracking, retention |

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
import { createAgentOrchestrator } from '@directive-run/ai';
import { createEnhancedPIIGuardrail, createPromptInjectionGuardrail } from '@directive-run/ai';

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

## Server vs. Browser

All security features use `globalThis.crypto.subtle` (Web Crypto API) and work in both environments:

| Feature | Server (Node 18+) | Browser | Primary Use |
|---------|-------------------|---------|-------------|
| PII Detection | Yes | Yes | Both &ndash; input/output scanning |
| Prompt Injection | Yes | Yes | Both &ndash; input validation |
| Audit Trail | Yes | Yes | Primarily server &ndash; tamper-evident logs, SIEM export |
| GDPR/CCPA Compliance | Yes | Yes | Primarily server &ndash; data export, deletion certificates |

Node 18+ is required for `crypto.subtle`. No Node-specific imports are used &ndash; the same code runs in Deno and Bun as well.

Audit trails and compliance tooling are most useful on the server where you control the data layer. PII detection and prompt injection prevention are equally valuable in both environments.

---

## Threat Model

A unified view of the threats Directive's security features address:

| Threat | Attack Vector | Mitigation | Feature |
|--------|--------------|------------|---------|
| **Data exfiltration** | Agent leaks PII in output | Output scanning with redaction | [PII Detection](/ai/security/pii) |
| **PII in prompts** | User submits personal data | Input scanning with redaction | [PII Detection](/ai/security/pii) |
| **Prompt injection** | Attacker embeds instructions in input | Pattern detection, encoding analysis | [Prompt Injection](/ai/security/prompt-injection) |
| **Jailbreak** | User overrides system prompt | Strict mode, known-attack patterns | [Prompt Injection](/ai/security/prompt-injection) |
| **Encoding evasion** | Base64, Unicode smuggling | Multi-encoding detection | [Prompt Injection](/ai/security/prompt-injection) |
| **Unaudited operations** | No record of what agents did | Tamper-evident logging, HMAC chain | [Audit Trail](/ai/security/audit) |
| **Data subject requests** | GDPR right to erasure / export | Automated data deletion + export | [GDPR/CCPA](/ai/security/compliance) |
| **Runaway costs** | Agent enters infinite loop | Token budgets, circuit breakers | [Self-Healing](/ai/self-healing) |
| **Unsafe tool calls** | Agent invokes dangerous tools | Tool-call guardrails, deny lists | [Guardrails](/ai/guardrails) |

### Layered Defense Strategy

```
Layer 1: Input Validation
  └─ Prompt injection detection (block attacks before they reach agents)
  └─ PII detection with redaction (scrub sensitive data from input)

Layer 2: Execution Controls
  └─ Tool-call guardrails (restrict which tools agents can invoke)
  └─ Token budgets + circuit breakers (prevent runaway costs)
  └─ Approval workflows (human-in-the-loop for high-risk actions)

Layer 3: Output Validation
  └─ Output guardrails (catch data leaks, enforce format)
  └─ Streaming guardrails (halt streams mid-generation)

Layer 4: Observability & Compliance
  └─ Audit trail with HMAC integrity chain
  └─ GDPR/CCPA data export and deletion
  └─ OpenTelemetry spans for every operation
```

---

## Next Steps

- **Start with safety** &ndash; [PII Detection](/ai/security/pii) is the most common first step
- **Add attack prevention** &ndash; [Prompt Injection](/ai/security/prompt-injection) for user-facing apps
- **Compliance requirements?** &ndash; [GDPR/CCPA](/ai/security/compliance) for regulated industries
- **Troubleshooting** &ndash; [Troubleshooting](/ai/troubleshooting) for common issues and solutions
