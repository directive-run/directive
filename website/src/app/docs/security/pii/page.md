---
title: PII Detection
description: Detect and redact personally identifiable information in AI agent inputs and outputs.
---

Detect SSNs, credit cards, emails, phone numbers, and more -- then block, redact, or mask them before they reach your AI agents. {% .lead %}

---

## Quick Start

```typescript
import { createEnhancedPIIGuardrail } from 'directive';

const piiGuardrail = createEnhancedPIIGuardrail({
  types: ['ssn', 'credit_card', 'email'],
  redact: true,
  redactionStyle: 'typed', // replaces with [SSN], [CREDIT_CARD], etc.
});
```

Use with an orchestrator:

```typescript
import { createAgentOrchestrator } from 'directive/openai-agents';

const orchestrator = createAgentOrchestrator({
  runAgent: run,
  guardrails: {
    input: [{ name: 'pii', fn: piiGuardrail }],
  },
});
```

---

## Supported PII Types

| Type | Description |
|------|-------------|
| `ssn` | US Social Security Numbers |
| `credit_card` | Credit/debit card numbers |
| `email` | Email addresses |
| `phone` | Phone numbers (various formats) |
| `address` | Physical addresses |
| `name` | Personal names (context-aware) |
| `date_of_birth` | Birth dates |
| `passport` | Passport numbers |
| `driver_license` | Driver's license numbers |
| `ip_address` | IP addresses |
| `bank_account` | Bank account numbers |
| `medical_id` | Medical record numbers |
| `national_id` | Non-US national IDs |

---

## Configuration

```typescript
const guardrail = createEnhancedPIIGuardrail({
  types: ['ssn', 'credit_card', 'email', 'phone'],
  detector: 'regex',         // 'regex' or a custom PIIDetector
  redact: true,              // redact instead of blocking
  redactionStyle: 'typed',   // 'typed' | 'masked' | 'hash'
  minConfidence: 0.7,        // confidence threshold (0-1)
  allowlist: ['test@example.com'],  // values to skip
  minItemsToBlock: 1,        // minimum PII items to trigger
  detectorTimeout: 5000,     // timeout for custom detectors (ms)
  onDetected: (items) => {
    console.log(`Found ${items.length} PII items`);
  },
});
```

### Redaction Styles

| Style | Example |
|-------|---------|
| `typed` | `My SSN is [SSN]` |
| `masked` | `My SSN is ***-**-1234` |
| `hash` | `My SSN is a1b2c3d4...` |

---

## Output PII Guardrail

Scan agent outputs for PII leakage:

```typescript
import { createOutputPIIGuardrail } from 'directive';

const outputGuardrail = createOutputPIIGuardrail({
  types: ['ssn', 'credit_card'],
  redact: true,
});

const orchestrator = createAgentOrchestrator({
  runAgent: run,
  guardrails: {
    output: [{ name: 'output-pii', fn: outputGuardrail }],
  },
});
```

---

## Standalone Detection

Use PII detection outside of guardrails:

```typescript
import { detectPII, redactPII } from 'directive';

// Detect PII in text
const result = await detectPII('My SSN is 123-45-6789', {
  types: ['ssn', 'email'],
  minConfidence: 0.7,
});

console.log(result.detected);  // true
console.log(result.items);     // [{ type: 'ssn', value: '123-45-6789', confidence: 0.95, ... }]

// Redact PII from text
const redacted = redactPII(
  'My SSN is 123-45-6789',
  result.items,
  'typed'
);
console.log(redacted); // 'My SSN is [SSN]'
```

---

## Custom Detector

Plug in an external detection service (like Microsoft Presidio):

```typescript
const customDetector = {
  name: 'presidio',
  detect: async (text, types) => {
    const response = await fetch('https://presidio.internal/analyze', {
      method: 'POST',
      body: JSON.stringify({ text, entities: types }),
    });
    const results = await response.json();
    return results.map(r => ({
      type: r.entity_type,
      value: r.text,
      position: { start: r.start, end: r.end },
      confidence: r.score,
    }));
  },
};

const guardrail = createEnhancedPIIGuardrail({
  detector: customDetector,
  detectorTimeout: 5000, // timeout prevents DoS from slow services
});
```

---

## Simple PII Guardrail

For basic use with the orchestrator, a simpler guardrail is available:

```typescript
import { createPIIGuardrail } from 'directive/openai-agents';

const guardrail = createPIIGuardrail({
  patterns: [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{16}\b/],
  redact: true,
  redactReplacement: '[REDACTED]',
});
```

This version uses regex patterns directly without the full detection pipeline.

---

## Next Steps

- [Prompt Injection](/docs/security/prompt-injection) -- block injection attacks
- [Audit Trail](/docs/security/audit) -- audit logging with PII masking
- [Compliance](/docs/security/compliance) -- GDPR/CCPA data subject rights
