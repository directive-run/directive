---
title: Guardrails
description: Validate AI agent inputs, outputs, and tool calls with built-in and custom guardrails.
---

Protect AI agents with input validation, output checks, and tool access control. {% .lead %}

---

## Built-in Guardrails

Directive ships with guardrails you can drop into any orchestrator. No external dependencies needed.

### PII Detection

Detect and optionally redact personal information before it reaches the agent:

```typescript
import {
  createAgentOrchestrator,
  createPIIGuardrail,
} from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    input: [
      // Block any input that contains personal information
      createPIIGuardrail({}),

      // Or scrub PII in-place and allow the request to continue
      createPIIGuardrail({
        redact: true,
        redactReplacement: '[REDACTED]',
        patterns: [
          /\b\d{3}-\d{2}-\d{4}\b/,                       // SSN
          /\b\d{16}\b/,                                    // Credit card
          /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,  // Email
        ],
      }),
    ],
  },
});
```

### Content Moderation

Block harmful content using your moderation API:

```typescript
import { createModerationGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    // Check user input before it reaches the agent
    input: [
      createModerationGuardrail({
        checkFn: async (text) => {
          const result = await openai.moderations.create({ input: text });
          return result.results[0].flagged;
        },
        message: 'Content flagged by moderation',
      }),
    ],

    // Check agent output before it reaches the user
    output: [
      createModerationGuardrail({
        checkFn: async (text) => {
          const result = await openai.moderations.create({ input: text });
          return result.results[0].flagged;
        },
      }),
    ],
  },
});
```

### Tool Access Control

Allow or deny specific tools:

```typescript
import { createToolGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    toolCall: [
      // Allowlist – only these tools are permitted
      createToolGuardrail({
        allowlist: ['search', 'calculator', 'weather'],
      }),

      // Denylist – block dangerous tools by name
      createToolGuardrail({
        denylist: ['shell', 'filesystem', 'eval'],
        caseSensitive: false,  // Match regardless of casing
      }),
    ],
  },
});
```

### Output Type Validation

Ensure agent output matches an expected type:

```typescript
import { createOutputTypeGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      // Require a non-empty string response
      createOutputTypeGuardrail({ type: 'string', minStringLength: 1 }),

      // Require an object with specific keys present
      createOutputTypeGuardrail({
        type: 'object',
        requiredFields: ['answer', 'sources'],
      }),

      // Require an array within a size range
      createOutputTypeGuardrail({
        type: 'array',
        minLength: 1,
        maxLength: 100,
      }),
    ],
  },
});
```

### Output Schema Validation

For complex output validation, use `createOutputSchemaGuardrail` with a custom validator – or plug in Zod:

```typescript
import { createOutputSchemaGuardrail } from 'directive/ai';

// Validate output with a custom function
const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      createOutputSchemaGuardrail({
        validate: (output) => {
          if (typeof output !== 'object' || output === null) {
            return { valid: false, errors: ['Output must be an object'] };
          }
          if (!('answer' in output)) {
            return { valid: false, errors: ['Missing required field: answer'] };
          }
          return { valid: true };
        },
      }),
    ],
  },
});

// Or plug in Zod for schema-level validation
import { z } from 'zod';

const OutputSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()),
});

const zodOrchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      createOutputSchemaGuardrail({
        // Delegate validation to Zod's safeParse
        validate: (output) => {
          const result = OutputSchema.safeParse(output);
          if (result.success) return { valid: true };
          return {
            valid: false,
            errors: result.error.errors.map((e) => e.message),
          };
        },
      }),
    ],
  },
});
```

### Output Length Limit

Limit output by character count or estimated token count:

```typescript
import { createLengthGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      // Cap output by raw character count
      createLengthGuardrail({ maxCharacters: 5000 }),

      // Cap output by estimated token count (default: chars / 4)
      createLengthGuardrail({ maxTokens: 1000 }),

      // Provide your own token estimator
      createLengthGuardrail({
        maxTokens: 1000,
        estimateTokens: (text) => text.split(' ').length,
      }),
    ],
  },
});
```

### Content Filter

Block output matching specific keywords or patterns:

```typescript
import { createContentFilterGuardrail } from 'directive/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    output: [
      // Block output containing sensitive keywords or patterns
      createContentFilterGuardrail({
        blockedPatterns: [
          'internal-only',              // Plain string (auto-escaped for regex safety)
          /\bpassword\b/i,              // RegExp for exact word match
          /api[_-]key/i,                // RegExp with alternation
        ],
        caseSensitive: false,           // String patterns match case-insensitively
      }),
    ],
  },
});
```

String patterns are automatically regex-escaped, so special characters like `.` match literally.

### Rate Limiting

Limit request frequency based on token usage and request count:

```typescript
import { createRateLimitGuardrail } from 'directive/ai';

// Enforce both token-based and request-based rate limits
const rateLimiter = createRateLimitGuardrail({
  maxTokensPerMinute: 10000,
  maxRequestsPerMinute: 60,
});

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    input: [rateLimiter],   // Checked before every agent run
  },
});

// Clear the rate limiter's sliding window (useful in tests)
rateLimiter.reset();
```

---

## Custom Guardrails

Write your own guardrail as a function that returns `{ passed, reason?, transformed? }`. The function receives `(data, context)` – you can omit `context` if you don't need it:

```typescript
import { createAgentOrchestrator } from 'directive/ai';
import type { GuardrailFn, InputGuardrailData, OutputGuardrailData } from 'directive/ai';

// Block inputs that are too long
const maxLengthGuardrail: GuardrailFn<InputGuardrailData> = (data) => {
  if (data.input.length > 10000) {
    return { passed: false, reason: 'Input exceeds 10,000 characters' };
  }
  return { passed: true };
};

// Clean up whitespace and pass the transformed input downstream
const normalizeWhitespace: GuardrailFn<InputGuardrailData> = (data) => {
  const cleaned = data.input.replace(/\s+/g, ' ').trim();
  return { passed: true, transformed: cleaned };
};

// Reject empty agent responses
const noEmptyResponse: GuardrailFn<OutputGuardrailData> = (data) => {
  const output = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
  if (!output || output.trim().length === 0) {
    return { passed: false, reason: 'Agent returned empty response' };
  }
  return { passed: true };
};

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    input: [maxLengthGuardrail, normalizeWhitespace],   // Run in order
    output: [noEmptyResponse],
  },
});
```

---

## Named Guardrails

Give guardrails a name for better error messages, and optionally add retry support:

```typescript
import type { NamedGuardrail, InputGuardrailData } from 'directive/ai';

const piiCheck: NamedGuardrail<InputGuardrailData> = {
  name: 'pii-detector',                // Shows up in error messages and hooks

  fn: async (data, context) => {
    const hasPII = await externalPIIService.check(data.input);
    return { passed: !hasPII, reason: hasPII ? 'Contains PII' : undefined };
  },

  critical: true,   // Block the run on failure (default: true)

  // Retry transient failures with exponential backoff
  retry: {
    attempts: 3,
    backoff: 'exponential',
    baseDelayMs: 100,
    maxDelayMs: 5000,
  },
};

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: true,
  guardrails: {
    input: [piiCheck],  // Named guardrails mix freely with plain functions
  },
});
```

---

## Error Handling

When a guardrail fails, a structured `GuardrailError` is thrown:

```typescript
import { isGuardrailError } from 'directive/ai';

try {
  await orchestrator.run(agent, userInput);
} catch (error) {
  // Type-narrow to a structured GuardrailError
  if (isGuardrailError(error)) {
    console.log(error.code);           // 'INPUT_GUARDRAIL_FAILED' | 'OUTPUT_GUARDRAIL_FAILED' | 'TOOL_CALL_GUARDRAIL_FAILED'
    console.log(error.guardrailName);  // Which guardrail fired
    console.log(error.guardrailType);  // 'input' | 'output' | 'toolCall'
    console.log(error.userMessage);    // Safe to display in your UI
    console.log(error.agentName);      // Which agent was running

    // Sensitive fields are non-enumerable (hidden from JSON.stringify / console.log)
    console.log(error.input);  // The raw input that triggered the error
    console.log(error.data);   // Additional guardrail context
  }
}
```

---

## Streaming Guardrails

Evaluate guardrails on partial output as tokens stream in:

```typescript
import {
  createStreamingRunner,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
  createToxicityStreamingGuardrail,
  combineStreamingGuardrails,
} from 'directive/ai';

// Halt the stream if the output grows too long
const lengthGuard = createLengthStreamingGuardrail({
  maxTokens: 2000,
  warnAt: 1500,  // Emit a warning chunk at 75% capacity
});

// Halt the stream when sensitive data patterns appear
const patternGuard = createPatternStreamingGuardrail({
  patterns: [
    { regex: /\b(SSN|social security)\b/i, name: 'PII' },
    { regex: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
  ],
});

// Merge both guardrails into a single checker
const combined = combineStreamingGuardrails([lengthGuard, patternGuard]);

// Attach to a standalone streaming runner
const streamRunner = createStreamingRunner(baseRunner, {
  streamingGuardrails: [combined],
});
```

---

## Builder Pattern

Use the fluent builder to compose guardrails:

```typescript
import {
  createOrchestratorBuilder,
  createPIIGuardrail,
  createToolGuardrail,
  createOutputTypeGuardrail,
} from 'directive/ai';

const orchestrator = createOrchestratorBuilder()
  // Input guardrails run in the order they are added
  .withInputGuardrail('pii', createPIIGuardrail({ redact: true }))
  .withInputGuardrail('length', (data) => ({
    passed: data.input.length <= 10000,
    reason: data.input.length > 10000 ? 'Input too long' : undefined,
  }))

  // Tool call and output guardrails
  .withToolCallGuardrail('tools', createToolGuardrail({ denylist: ['shell'] }))
  .withOutputGuardrail('type', createOutputTypeGuardrail({ type: 'string' }))

  // Finalize with the runner
  .build({
    runner,
    autoApproveToolCalls: true,
  });
```

---

## Framework Integration

Handle guardrail errors in your UI by catching `GuardrailError` from `orchestrator.run()` and displaying the `userMessage`.

### React

```tsx
import { useState, useCallback } from 'react';
import { useAgentOrchestrator, useFact } from 'directive/react';
import { isGuardrailError } from 'directive/ai';

function GuardedChat() {
  const orchestrator = useAgentOrchestrator({ runner, autoApproveToolCalls: true });
  const agent = useFact(orchestrator.system, '__agent');
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (input: string) => {
    setError(null);  // Clear any previous guardrail error

    try {
      await orchestrator.run(myAgent, input);
    } catch (err) {
      // Show the user-safe message if a guardrail blocked the request
      if (isGuardrailError(err)) {
        setError(err.userMessage);
      }
    }
  }, [orchestrator]);

  return (
    <div>
      <p>Status: {agent?.status}</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

### Vue

```html
<script setup>
import { ref, onUnmounted } from 'vue';
import { createAgentOrchestrator, isGuardrailError } from 'directive/ai';
import { useFact } from 'directive/vue';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onUnmounted(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
const error = ref<string | null>(null);

async function send(input: string) {
  error.value = null;  // Clear previous error

  try {
    await orchestrator.run(myAgent, input);
  } catch (err) {
    // Surface guardrail errors to the user
    if (isGuardrailError(err)) error.value = err.userMessage;
  }
}
</script>

<template>
  <p>Status: {{ agent?.status }}</p>
  <p v-if="error" class="error">{{ error }}</p>
</template>
```

### Svelte

```html
<script>
import { createAgentOrchestrator, isGuardrailError } from 'directive/ai';
import { useFact } from 'directive/svelte';
import { onDestroy } from 'svelte';

const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
onDestroy(() => orchestrator.dispose());

const agent = useFact(orchestrator.system, '__agent');
let error = null;

async function send(input) {
  error = null;  // Reset before each attempt

  try {
    await orchestrator.run(myAgent, input);
  } catch (err) {
    if (isGuardrailError(err)) error = err.userMessage;
  }
}
</script>

<p>Status: {$agent?.status}</p>
{#if error}<p class="error">{error}</p>{/if}
```

### Solid

```tsx
import { createSignal } from 'solid-js';
import { createAgentOrchestrator, isGuardrailError } from 'directive/ai';
import { useFact } from 'directive/solid';
import { onCleanup } from 'solid-js';

function GuardedChat() {
  const orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  onCleanup(() => orchestrator.dispose());

  const agent = useFact(orchestrator.system, '__agent');
  const [error, setError] = createSignal<string | null>(null);

  async function send(input: string) {
    setError(null);  // Clear previous error signal

    try {
      await orchestrator.run(myAgent, input);
    } catch (err) {
      if (isGuardrailError(err)) setError(err.userMessage);
    }
  }

  return (
    <div>
      <p>Status: {agent()?.status}</p>
      {error() && <p class="error">{error()}</p>}
    </div>
  );
}
```

### Lit

```typescript
import { LitElement, html } from 'lit';
import { createAgentOrchestrator, isGuardrailError } from 'directive/ai';
import { FactController } from 'directive/lit';

class GuardedChat extends LitElement {
  private orchestrator = createAgentOrchestrator({ runner, autoApproveToolCalls: true });
  private agent = new FactController(this, this.orchestrator.system, '__agent');
  private error: string | null = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    this.orchestrator.dispose();
  }

  async send(input: string) {
    this.error = null;

    try {
      await this.orchestrator.run(myAgent, input);
    } catch (err) {
      // Show the user-safe message and trigger a re-render
      if (isGuardrailError(err)) {
        this.error = err.userMessage;
        this.requestUpdate();
      }
    }
  }

  render() {
    return html`
      <p>Status: ${this.agent.value?.status}</p>
      ${this.error ? html`<p class="error">${this.error}</p>` : ''}
    `;
  }
}
```

---

## Next Steps

- See [Agent Orchestrator](/docs/ai/orchestrator) for the full orchestrator API
- See [Streaming](/docs/ai/streaming) for real-time response processing
- See [PII Detection](/docs/security/pii) for privacy compliance
