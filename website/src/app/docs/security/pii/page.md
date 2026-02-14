---
title: PII Detection
description: Detect and redact personally identifiable information in AI agent inputs and outputs.
---

Detect SSNs, credit cards, emails, phone numbers, and more – then block, redact, or mask them before they reach your AI agents. {% .lead %}

---

## Quick Start

```typescript
import { createEnhancedPIIGuardrail } from 'directive';

// Define which PII types to scan for and how to handle matches
const piiGuardrail = createEnhancedPIIGuardrail({
  types: ['ssn', 'credit_card', 'email'],
  redact: true,
  redactionStyle: 'typed', // replaces with [SSN], [CREDIT_CARD], etc.
});
```

Use with an orchestrator:

```typescript
import { createAgentOrchestrator, createOpenAIRunner } from 'directive/ai';

// Connect to OpenAI (or any compatible provider)
const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

// Attach the PII guardrail to the orchestrator's input pipeline
const orchestrator = createAgentOrchestrator({
  runner,
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
  // What to look for
  types: ['ssn', 'credit_card', 'email', 'phone'],
  detector: 'regex',         // 'regex' or a custom PIIDetector

  // How to handle matches
  redact: true,              // redact instead of blocking
  redactionStyle: 'typed',   // 'typed' | 'masked' | 'hash'

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
| `typed` | `My SSN is [SSN]` |
| `masked` | `My SSN is ***-**-1234` |
| `hash` | `My SSN is a1b2c3d4...` |

---

## Output PII Guardrail

Scan agent outputs for PII leakage:

```typescript
import { createOutputPIIGuardrail } from 'directive';
import { createAgentOrchestrator, createOpenAIRunner } from 'directive/ai';

// Scan agent responses for accidentally leaked PII
const outputGuardrail = createOutputPIIGuardrail({
  types: ['ssn', 'credit_card'],
  redact: true,
});

const runner = createOpenAIRunner({ apiKey: process.env.OPENAI_API_KEY! });

// Output guardrails run after the agent responds, before the user sees it
const orchestrator = createAgentOrchestrator({
  runner,
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

For basic use with the orchestrator, a simpler guardrail is available:

```typescript
import { createPIIGuardrail } from 'directive/ai';

// Lightweight alternative using raw regex patterns (no detection pipeline)
const guardrail = createPIIGuardrail({
  patterns: [/\b\d{3}-\d{2}-\d{4}\b/, /\b\d{16}\b/], // SSN and 16-digit card formats
  redact: true,
  redactReplacement: '[REDACTED]',
});
```

This version uses regex patterns directly without the full detection pipeline.

---

## Next Steps

- [Prompt Injection](/docs/security/prompt-injection) – block injection attacks
- [Audit Trail](/docs/security/audit) – audit logging with PII masking
- [Compliance](/docs/security/compliance) – GDPR/CCPA data subject rights
