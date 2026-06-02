# AI guardrails and memory

> Covers `@directive-run/ai/guardrails` and `@directive-run/ai` — input/output/toolCall guardrails (PII, prompt-injection, length, schema, content filter), memory strategies, summarizers.

Guardrails validate and transform input, output, and tool calls. Memory strategies manage conversation history with configurable summarization. Both plug into `createAgentOrchestrator` and `createMultiAgentOrchestrator`.

Import guardrail factories from the subpath barrel — the main `@directive-run/ai` re-exports them with `@deprecated` notices for v2.

```typescript
import {
  createPIIGuardrail,
  createModerationGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
  createLengthGuardrail,
  createContentFilterGuardrail,
} from "@directive-run/ai/guardrails";
```

## Decision tree

```
What are you guarding against?
├── PII in input             → createPIIGuardrail()
├── Harmful content           → createModerationGuardrail()
├── Rate limits               → createRateLimitGuardrail()
├── Unauthorized tool calls   → createToolGuardrail()
├── Output schema mismatch   → createOutputSchemaGuardrail()
├── Output type / shape      → createOutputTypeGuardrail()
├── Response length          → createLengthGuardrail()
└── Banned words/patterns   → createContentFilterGuardrail()
```

## `GuardrailResult` shape

Every guardrail returns this shape:

```typescript
interface GuardrailResult {
  passed: boolean;
  reason?: string;       // populated when passed: false
  transformed?: unknown; // when set, replaces the original value downstream
}
```

When `transformed` is set, the modified value replaces the original for downstream processing — that's how redaction and sanitization work.

## Built-in guardrails

### PII detection + redaction

```typescript
const piiGuardrail = createPIIGuardrail({
  patterns: [/CUSTOM-\d{8}/g],  // extra regex patterns beyond defaults (SSN / credit card / email)
  redact: true,                  // redact in place instead of blocking (default: false)
  redactReplacement: "***",      // string to substitute (default: "[REDACTED]")
});
```

### Content moderation (user check function)

```typescript
const moderation = createModerationGuardrail({
  checkFn: async (text) => {
    const result = await moderationAPI.check(text);
    return result.flagged;       // return TRUE when content should be flagged/blocked
  },
  message: "Content flagged by moderation", // optional override
});
```

The check function may be sync or async. Returning `true` causes the guardrail to block.

### Rate limiting (sliding window)

```typescript
const rateLimit = createRateLimitGuardrail({
  maxTokensPerMinute: 50_000,    // default 100_000
  maxRequestsPerMinute: 30,      // default 60
});

// Test helper — included on the returned guardrail
rateLimit.reset();
```

### Tool allow/deny lists

```typescript
const tools = createToolGuardrail({
  allowlist: ["search", "calculator", "readFile"], // only these tools are allowed
  denylist:  ["dangerous-tool"],                    // any of these are blocked
  caseSensitive: false,                              // default false
});
```

Use `allowlist` OR `denylist` (or both). A tool not on the allowlist is blocked; a tool on the denylist is blocked.

### Output schema validation

The validator is a function — Directive does NOT take a raw JSON schema. Use any validation library that has a `safeParse`-style API; pass an adapter.

```typescript
import { z } from "zod";

const schemaGuardrail = createOutputSchemaGuardrail({
  validate: (value) => {
    const result = z.object({ title: z.string(), score: z.number() }).safeParse(value);

    return {
      valid: result.success,
      errors: result.success ? undefined : result.error.issues.map((i) => i.message),
    };
  },
  errorPrefix: "Output schema validation failed", // default — prepended to error.reason
});
```

For automatic schema-retry on the agent's behalf, configure `outputSchema` + `maxSchemaRetries` on the orchestrator instead (see `ai-orchestrator.md` → Structured output).

### Output type guard (no schema library needed)

```typescript
const typeGuard = createOutputTypeGuardrail({
  type: "object",                     // "string" | "number" | "boolean" | "object" | "array"
  requiredFields: ["id", "name"],     // object keys that must exist
  minLength: 1,                       // for arrays
  maxLength: 100,                     // for arrays
  minStringLength: 1,                 // for strings
  maxStringLength: 5000,              // for strings
});
```

### Length constraints

```typescript
const lengthGuardrail = createLengthGuardrail({
  maxCharacters: 5000,
  maxTokens: 1200,
  estimateTokens: (text) => Math.ceil(text.length / 4), // default: chars / 4
});
```

There is NO `minChars`, `maxChars`, or `minTokens` option — only `maxCharacters` (note the spelling) and `maxTokens`.

### Content filter (banned patterns)

```typescript
const contentFilter = createContentFilterGuardrail({
  blockedPatterns: [/\bpassword\b/i, /\bsecret\b/i, "internal-only"],
  caseSensitive: false,
});
```

Strings are escaped and compiled to RegExp; RegExp instances pass through. There is NO `action: "redact"` mode — this guardrail blocks only. For redaction, use `createPIIGuardrail({ redact: true, patterns: [...] })`.

## Applying guardrails

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input:    [piiGuardrail, rateLimit],
    output:   [lengthGuardrail, schemaGuardrail, contentFilter],
    toolCall: [tools],
  },
});
```

## Catching `GuardrailError`

```typescript
import { GuardrailError, isGuardrailError } from "@directive-run/ai";

try {
  await orchestrator.run(agent, prompt);
} catch (error) {
  if (isGuardrailError(error)) {
    console.log(error.code);          // "INPUT_GUARDRAIL_FAILED" | "OUTPUT_GUARDRAIL_FAILED" | "TOOL_CALL_GUARDRAIL_FAILED" | …
    console.log(error.guardrailName); // "pii-detection"
    console.log(error.guardrailType); // "input" | "output" | "toolCall"
    console.log(error.userMessage);   // safe-to-show user-facing message
    console.log(error.agentName);     // which agent triggered it
    // error.input and error.data are non-enumerable to prevent accidental log leakage
  }
}
```

There is no `errorCode` field — it's `code`. There is no `reason` field on `GuardrailError` — the rejection reason from the guardrail's result becomes the error's `message` (or `userMessage` for safe display).

`GuardrailErrorCode` union:
- `INPUT_GUARDRAIL_FAILED` / `OUTPUT_GUARDRAIL_FAILED` / `TOOL_CALL_GUARDRAIL_FAILED`
- `APPROVAL_REJECTED`
- `BUDGET_EXCEEDED`
- `RATE_LIMIT_EXCEEDED`
- `AGENT_ERROR`

---

## Memory strategies

Memory strategies control how conversation history is trimmed as it grows.

```
How should history be trimmed?
├── Keep N most recent messages → createSlidingWindowStrategy()
├── Keep within token budget   → createTokenBasedStrategy()
└── Both at once               → createHybridStrategy()
```

### Sliding window (message count)

```typescript
import { createAgentMemory, createSlidingWindowStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({
    maxMessages: 50,
    preserveRecentCount: 10, // always keep the N most recent (default 5)
  }),
});
```

### Token-based

```typescript
import { createTokenBasedStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createTokenBasedStrategy({
    maxTokens: 8000,
    preserveRecentCount: 5,
  }),
});
```

### Hybrid (both constraints)

```typescript
import { createHybridStrategy } from "@directive-run/ai";

const memory = createAgentMemory({
  strategy: createHybridStrategy({
    maxMessages: 100,
    maxTokens: 16_000,
  }),
});
```

## Summarizers

When messages are evicted, a summarizer condenses them.

### Truncation (drop, no summary)

```typescript
import { createTruncationSummarizer } from "@directive-run/ai";

const summarizer = createTruncationSummarizer();
```

### Key-points (rule-based, no LLM call)

```typescript
import { createKeyPointsSummarizer } from "@directive-run/ai";

const summarizer = createKeyPointsSummarizer();
```

### LLM-based (async)

```typescript
import { createLLMSummarizer } from "@directive-run/ai";

const summarizer = createLLMSummarizer(runner);
```

### Wiring memory to an orchestrator

```typescript
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 50 }),
  summarizer: createKeyPointsSummarizer(),
  autoManage: true, // automatically trim + summarize after each run (default: true)
});

const orchestrator = createAgentOrchestrator({
  runner,
  memory,
});
```

## Anti-patterns

### Calling guardrails by old field names

```typescript
// WRONG — these option names don't exist
createOutputSchemaGuardrail({ schema: jsonSchema, retries: 2 })   // → use validate + outputSchema on the orchestrator for retry
createToolGuardrail({ allowedTools: [...] })                       // → use allowlist
createLengthGuardrail({ minChars, maxChars, minTokens, maxTokens })// → only maxCharacters + maxTokens
createContentFilterGuardrail({ patterns, action: "redact" })       // → blockedPatterns; this guardrail BLOCKS only
```

### Catching `Error` instead of `GuardrailError`

```typescript
// WRONG — loses code, guardrailName, guardrailType, userMessage
try { await orch.run(agent, prompt); } catch (e) {
  if (e instanceof Error) console.log(e.message);
}

// CORRECT — narrow to GuardrailError
try { await orch.run(agent, prompt); } catch (e) {
  if (e instanceof GuardrailError) {
    console.log(e.code, e.guardrailName, e.userMessage);
  } else {
    throw e;
  }
}
```

### Reading the wrong error fields

```typescript
// WRONG — these don't exist on GuardrailError
error.errorCode   // → use error.code
error.reason      // → use error.message (or userMessage for user-facing)
```

### LLM summarizer with `autoManage: true`

```typescript
// WRONG — autoManage runs synchronously; the async summarizer is never awaited
createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 20 }),
  summarizer: createLLMSummarizer(runner),
  autoManage: true,
})

// CORRECT — disable autoManage, call memory.manage() after each run
const memory = createAgentMemory({
  strategy: createSlidingWindowStrategy({ maxMessages: 20 }),
  summarizer: createLLMSummarizer(runner),
  autoManage: false,
});

await orchestrator.run(agent, prompt);
await memory.manage(); // awaits the async summarizer
```

## Quick reference

| Guardrail | Phase | Required options |
|---|---|---|
| `createPIIGuardrail` | input | (none — sensible defaults) |
| `createModerationGuardrail` | input + output | `checkFn` |
| `createRateLimitGuardrail` | input | (none — defaults 100K tokens/60 requests per minute) |
| `createToolGuardrail` | toolCall | `allowlist` or `denylist` |
| `createOutputSchemaGuardrail` | output | `validate` (`SchemaValidator<T>`) |
| `createOutputTypeGuardrail` | output | `type` |
| `createLengthGuardrail` | output | one of `maxCharacters` or `maxTokens` |
| `createContentFilterGuardrail` | output | `blockedPatterns` |

## See also

- [`ai-orchestrator.md`](./ai-orchestrator.md) — `guardrails: { input, output, toolCall }` and `memory:` options on `createAgentOrchestrator`
- [`ai-security.md`](./ai-security.md) — `createPIIGuardrail`, `createPromptInjectionGuardrail`, `createAuditTrail`, `createCompliance` — the security-flavored guardrails
- [`ai-budget-resilience.md`](./ai-budget-resilience.md) — `createSemanticCache` pairs with `createSemanticCacheGuardrail` for caching-as-guardrail
