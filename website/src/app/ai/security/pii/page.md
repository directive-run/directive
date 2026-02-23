---
title: PII Detection
description: Detect and redact personally identifiable information in text, API inputs, and AI agent pipelines.
---

Detect SSNs, credit cards, emails, phone numbers, and more &ndash; then block, redact, or mask them before they leave your system. {% .lead %}

---

## Quick Start

Scan any string for PII and redact matches &ndash; no orchestrator required:

```typescript
import { detectPII, redactPII } from '@directive-run/ai';

// Step 1: Scan text for PII matches
const result = await detectPII('My SSN is 123-45-6789', {
  types: ['ssn', 'email'],
  minConfidence: 0.7,
});

console.log(result.detected);  // true
console.log(result.items);     // [{ type: 'ssn', value: '123-45-6789', confidence: 0.95, ... }]

// Step 2: Replace detected items with type-safe placeholders
const redacted = redactPII(
  'My SSN is 123-45-6789',
  result.items,
  'typed'
);
console.log(redacted); // 'My SSN is [SSN]'
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
import { createEnhancedPIIGuardrail } from '@directive-run/ai';

const guardrail = createEnhancedPIIGuardrail({
  // What to look for
  types: ['ssn', 'credit_card', 'email', 'phone'],
  detector: 'regex',         // 'regex' or a custom PIIDetector

  // How to handle matches
  redact: true,              // redact instead of blocking
  redactionStyle: 'typed',   // 'placeholder' | 'typed' | 'masked' | 'hashed'

  // Tuning and thresholds
  minConfidence: 0.7,        // confidence threshold (0-1)
  allowlist: ['test@example.com'],  // values to skip
  minItemsToBlock: 1,        // minimum PII items to trigger
  detectorTimeout: 5000,     // timeout for custom detectors (ms)

  // Called whenever PII is found, useful for metrics
  onDetected: (items) => {
    console.log(`Found ${items.length} PII items`);
  },
});
```

### Redaction Styles

| Style | Example |
|-------|---------|
| `placeholder` | `My SSN is [REDACTED]` |
| `typed` | `My SSN is [SSN]` |
| `masked` | `My SSN is ***-**-1234` |
| `hashed` | `My SSN is a1b2c3d4...` |

---

## Custom Detector

Plug in an external detection service (like Microsoft Presidio):

```typescript
// Wrap an external PII detection service as a Directive detector
const customDetector = {
  name: 'presidio',
  detect: async (text, types) => {
    // Send text to your Presidio (or similar) endpoint
    const response = await fetch('https://presidio.internal/analyze', {
      method: 'POST',
      body: JSON.stringify({ text, entities: types }),
    });

    // Map the external format to Directive's expected shape
    const results = await response.json();

    return results.map(r => ({
      type: r.entity_type,
      value: r.text,
      position: { start: r.start, end: r.end },
      confidence: r.score,
    }));
  },
};

// Plug the custom detector into the guardrail
const guardrail = createEnhancedPIIGuardrail({
  detector: customDetector,
  detectorTimeout: 5000, // timeout prevents DoS from slow services
});
```

---

## Simple PII Guardrail

For basic use, a simpler regex-only guardrail is available:

```typescript
import { createPIIGuardrail } from '@directive-run/ai';

// Lightweight alternative using raw regex patterns (no detection pipeline)
const guardrail = createPIIGuardrail({
  patterns: [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{16}\b/], // SSN and 16-digit card formats
  redact: true,
  redactReplacement: '[REDACTED]',
});
```

This version uses regex patterns directly without the full detection pipeline.

---

## AI Integration

Wire PII detection into an orchestrator as input and output guardrails:

```typescript
import {
  createAgentOrchestrator,
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
} from '@directive-run/ai';
import { createOpenAIRunner } from '@directive-run/ai/openai';

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    // Redact PII from user messages before the agent sees them
    input: [{ name: 'pii', fn: createEnhancedPIIGuardrail({
      types: ['ssn', 'credit_card', 'email'],
      redact: true,
      redactionStyle: 'typed',
    }) }],

    // Catch any PII the agent leaks in its response
    output: [{ name: 'output-pii', fn: createOutputPIIGuardrail({
      types: ['ssn', 'credit_card'],
      redact: true,
    }) }],
  },
});
```

See [Guardrails](/ai/guardrails) for error handling, streaming guardrails, and the builder pattern.

---

## Next Steps

- [Prompt Injection](/ai/security/prompt-injection) &ndash; block injection attacks
- [Audit Trail](/ai/security/audit) &ndash; audit logging with PII masking
- [GDPR/CCPA](/ai/security/compliance) &ndash; data subject rights
