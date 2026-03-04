# AI Guardrails and Memory

Built-in guardrails validate/transform input and output. Memory strategies manage conversation history with configurable summarization.

## Decision Tree: "Which guardrail do I need?"

```
What are you guarding against?
├── PII in input/output      → createPIIGuardrail()
├── Harmful content           → createModerationGuardrail()
├── Rate limits               → createRateLimitGuardrail()
├── Unauthorized tool use     → createToolGuardrail()
├── Output format validation  → createOutputSchemaGuardrail()
├── Output type checking      → createOutputTypeGuardrail()
├── Response length           → createLengthGuardrail()
└── Banned words/patterns     → createContentFilterGuardrail()
```

## GuardrailResult Shape

Every guardrail returns this shape:

```typescript
interface GuardrailResult {
  // Did the input/output pass?
  passed: boolean;

  // Why it failed (when passed: false)
  reason?: string;

  // Modified data — guardrail can transform the input/output
  transformed?: unknown;
}
```

When `transformed` is set, the modified value replaces the original for downstream processing.

## Built-In Guardrails

### PII Detection and Redaction

```typescript
import { createPIIGuardrail } from "@directive-run/ai";

const piiGuardrail = createPIIGuardrail({
  // Additional regex patterns beyond defaults
  patterns: [/CUSTOM-\d{8}/g],

  // Redact instead of blocking (default: false)
  redact: true,

  // Replacement string (default: "[REDACTED]")
  redactReplacement: "***",
});
```

### Content Moderation

```typescript
import { createModerationGuardrail } from "@directive-run/ai";

const moderationGuardrail = createModerationGuardrail({
  // Custom check function — return true if content is safe
  checkFn: async (content) => {
    const result = await moderationAPI.check(content);

    return result.safe;
  },

  // Custom rejection message
  message: "Content flagged by moderation",
});
```

### Rate Limiting

```typescript
import { createRateLimitGuardrail } from "@directive-run/ai";

const rateLimitGuardrail = createRateLimitGuardrail({
  maxTokensPerMinute: 50000,
  maxRequestsPerMinute: 10,
});
```

### Tool Allowlist

```typescript
import { createToolGuardrail } from "@directive-run/ai";

const toolGuardrail = createToolGuardrail({
  allowedTools: ["search", "calculator", "readFile"],
  // Any tool not in this list is blocked
});
```

### Output Schema Validation

```typescript
import { createOutputSchemaGuardrail } from "@directive-run/ai";

const schemaGuardrail = createOutputSchemaGuardrail({
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      score: { type: "number", minimum: 0, maximum: 100 },
    },
    required: ["title", "score"],
  },

  // Retry with schema feedback if validation fails (default: 0)
  retries: 2,
});
```

### Output Type Guard

```typescript
import { createOutputTypeGuardrail } from "@directive-run/ai";

const typeGuardrail = createOutputTypeGuardrail({
  type: "object", // "string" | "number" | "boolean" | "object" | "array"
});
```

### Length Constraints

```typescript
import { createLengthGuardrail } from "@directive-run/ai";

const lengthGuardrail = createLengthGuardrail({
  minChars: 100,
  maxChars: 5000,
  minTokens: 50,
  maxTokens: 1000,
});
```

### Content Filter

```typescript
import { createContentFilterGuardrail } from "@directive-run/ai";

const contentFilter = createContentFilterGuardrail({
  patterns: [/badword/i, /sensitive-term/gi],

  // "block" (default) or "redact"
  action: "redact",

  // Replacement for redact mode
  replacement: "[FILTERED]",
});
```

## Applying Guardrails

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    // Run before the agent receives the prompt
    input: [piiGuardrail, rateLimitGuardrail],

    // Run after the agent produces output
    output: [lengthGuardrail, schemaGuardrail, contentFilter],
  },
});
```

## Anti-Pattern #25: Catching Error Instead of GuardrailError

```typescript
// WRONG — loses guardrail-specific metadata
try {
  const result = await orchestrator.run(agent, prompt);
} catch (error) {
  if (error instanceof Error) {
    console.log(error.message); // No guardrail context
  }
}

// CORRECT — catch GuardrailError for full context
import { GuardrailError } from "@directive-run/ai";

try {
  const result = await orchestrator.run(agent, prompt);
} catch (error) {
  if (error instanceof GuardrailError) {
    console.log(error.guardrailName);  // "pii-detection"
    console.log(error.errorCode);      // "GUARDRAIL_INPUT_BLOCKED"
    console.log(error.reason);         // "PII detected in input"
  }
}
```

---

## Memory Strategies

Memory strategies control how conversation history is managed when it grows too large.

## Decision Tree: "Which memory strategy?"

```
How should history be trimmed?
├── Keep N most recent messages → createSlidingWindowStrategy()
├── Keep within token budget   → createTokenBasedStrategy()
└── Both constraints           → createHybridStrategy()
```

### Sliding Window

```typescript
import { createAgentMemory, createSlidingWindowStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({
    maxMessages: 50,

    // Always keep the N most recent (default: 5)
    preserveRecentCount: 10,
  }),
});
```

### Token-Based

```typescript
import { createAgentMemory, createTokenBasedStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createTokenBasedStrategy({
    maxTokens: 8000,
    preserveRecentCount: 5,
  }),
});
```

### Hybrid (Both Constraints)

```typescript
import { createAgentMemory, createHybridStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createHybridStrategy({
    maxMessages: 100,
    maxTokens: 16000,
  }),
});
```

## Summarizers

When messages are evicted, a summarizer condenses them:

### Truncation (Default)

```typescript
import { createTruncationSummarizer } from "@directive-run/ai";

// Simply drops old messages — no summary generated
const summarizer = createTruncationSummarizer();
```

### Key Points Extraction

```typescript
import { createKeyPointsSummarizer } from "@directive-run/ai";

// Extracts bullet points from evicted messages (rule-based, no LLM)
const summarizer = createKeyPointsSummarizer();
```

### LLM-Based Summarization

```typescript
import { createLLMSummarizer } from "@directive-run/ai";

// Uses the runner to summarize evicted messages via LLM
const summarizer = createLLMSummarizer(runner);
```

### Applying to Memory

```typescript
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
  summarizer: createKeyPointsSummarizer(),
  autoManage: true, // Automatically trim + summarize (default: true)
});

const orchestrator = createAgentOrchestrator({
  runner,
  memory,
});
```

## Anti-Pattern #31: Async Summarizer Without autoManage: false

```typescript
// WRONG — LLM summarizer is async but autoManage runs synchronously
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 20 }),
  summarizer: createLLMSummarizer(runner),
  autoManage: true, // Will not await the summarizer properly
});

// CORRECT — disable autoManage, call memory.manage() manually
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 20 }),
  summarizer: createLLMSummarizer(runner),
  autoManage: false,
});

// After each run, manually manage memory
const result = await orchestrator.run(agent, prompt);
await memory.manage(); // Awaits the async summarizer
```

## Quick Reference

| Guardrail | Input/Output | Key Option |
|---|---|---|
| `createPIIGuardrail` | Both | `redact`, `patterns` |
| `createModerationGuardrail` | Both | `checkFn` |
| `createRateLimitGuardrail` | Input | `maxTokensPerMinute` |
| `createToolGuardrail` | Input | `allowedTools` |
| `createOutputSchemaGuardrail` | Output | `schema`, `retries` |
| `createOutputTypeGuardrail` | Output | `type` |
| `createLengthGuardrail` | Output | `minChars`, `maxChars` |
| `createContentFilterGuardrail` | Both | `patterns`, `action` |
