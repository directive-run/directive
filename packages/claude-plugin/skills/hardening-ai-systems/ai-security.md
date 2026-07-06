# AI security

> Covers `@directive-run/ai` and `@directive-run/ai/guardrails` — `createPIIGuardrail`, `createPromptInjectionGuardrail`, `createAuditTrail`, `createCompliance` (GDPR/CCPA).

PII detection and redaction, prompt-injection defense, audit trails with non-repudiation, and GDPR/CCPA compliance — all wired in via Directive's guardrail and instance APIs. Import the audit + compliance instances from `@directive-run/ai` (NOT `@directive-run/core/plugins`); import the security guardrails from `@directive-run/ai/guardrails`.

## Decision tree

```
What are you protecting against?
├── PII in input        → createPIIGuardrail() or createEnhancedPIIGuardrail()
├── PII in output       → createOutputPIIGuardrail()
├── Prompt injection    → createPromptInjectionGuardrail()
├── Audit / forensics   → createAuditTrail(config)
├── GDPR / CCPA         → createCompliance(config)
├── Tool restriction    → createToolGuardrail({ allowlist | denylist })
└── Sensitive content   → createContentFilterGuardrail({ blockedPatterns })

Where do these go?
├── Guardrails → orchestrator.guardrails.input / output / toolCall
├── Audit      → record into auditInstance from your call sites (NOT a plugins:[…] entry)
└── Compliance → instance you call directly (exportData, deleteData, consent.*)
```

## PII detection + redaction

### Basic PII guardrail (input only)

`createPIIGuardrail` returns a `GuardrailFn<InputGuardrailData>` — input only. For output PII protection, use `createOutputPIIGuardrail`.

```typescript
import { createPIIGuardrail } from "@directive-run/ai/guardrails";

const piiInput = createPIIGuardrail({
  patterns: [
    /\b\d{3}-\d{2}-\d{4}\b/,         // SSN — already a default, here as a custom example
    /\b[A-Z]{2}\d{6,8}\b/,           // Passport
    /ACCT-\d{10}/,                   // Internal account IDs
  ],
  redact: true,                       // default: false (block instead of redact)
  redactReplacement: "[REDACTED]",
});
```

Built-in default patterns: SSN, credit card numbers, email addresses. Custom `patterns` are added on top.

### Enhanced PII guardrails (input + output)

For production scenarios — context-aware detection, multi-region defaults, output coverage — use the enhanced factories:

```typescript
import { createEnhancedPIIGuardrail, createOutputPIIGuardrail } from "@directive-run/ai/guardrails";

const piiInput  = createEnhancedPIIGuardrail({ /* …config… */ });
const piiOutput = createOutputPIIGuardrail({  /* …config… */ });

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input:  [piiInput],
    output: [piiOutput],
  },
});
```

### Wiring it in

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input:  [piiInput],
    output: [piiOutput],
  },
});
```

## Prompt-injection defense

`createPromptInjectionGuardrail` ships with default + strict pattern sets and a 0–100 risk score. The real options are `strictMode`, `blockThreshold`, `additionalPatterns`, `replacePatterns`, `sanitize`, `onBlocked`, `ignoreCategories`. There is no `sensitivity` field and no `allowlist`.

```typescript
import { createPromptInjectionGuardrail } from "@directive-run/ai/guardrails";

// Basic — uses default patterns + 50 block threshold
const injection = createPromptInjectionGuardrail();

// Strict — for high-security applications
const strictInjection = createPromptInjectionGuardrail({
  strictMode: true,        // use STRICT_INJECTION_PATTERNS instead of DEFAULT
  blockThreshold: 25,      // lower threshold — more aggressive blocking
  additionalPatterns: [    // your own patterns layered on top
    { name: "custom_role_override", regex: /you are now a /i, score: 70, category: "role_manipulation" },
  ],
  sanitize: false,         // when true, attempts to neutralize the input instead of blocking
  onBlocked: (input, result) => {
    metrics.increment("prompt_injection_blocked", { risk: result.riskScore });
  },
});

// Roleplay app — allow role-manipulation patterns, keep everything else
const roleplayInjection = createPromptInjectionGuardrail({
  ignoreCategories: ["role_manipulation"],
});

// Replace all defaults
const customOnly = createPromptInjectionGuardrail({
  replacePatterns: myPatternList,
});
```

### Catching the block

```typescript
import { isGuardrailError } from "@directive-run/ai";

try {
  await orchestrator.run(agent, userInput);
} catch (error) {
  if (isGuardrailError(error)) {
    console.log(error.guardrailName); // "prompt-injection"
    console.log(error.code);          // "INPUT_GUARDRAIL_FAILED"
    console.log(error.userMessage);   // safe-to-display rejection reason
    // error.input and error.data are NON-enumerable (won't leak via JSON.stringify)
  }
}
```

`GuardrailError` does not expose `errorCode` (it's `code`) or `reason` (the rejection reason becomes the error `message` / `userMessage`). See `ai-guardrails-memory.md` for the full error shape.

## Audit trail

`createAuditTrail(config)` returns an `AuditInstance` you record into from your call sites — it is NOT a plugin you put in `plugins: […]`. The factory is named `createAuditTrail`, NOT `createAuditTrailPlugin`, and it lives in `@directive-run/ai`, NOT `@directive-run/core/plugins`.

```typescript
import { createAuditTrail } from "@directive-run/ai";

const audit = createAuditTrail({
  maxEntries: 10_000,                    // default 10000
  retentionMs: 7 * 24 * 60 * 60 * 1000,  // default: 7 days
  exportInterval: 60_000,                // default 60s — async exporter cadence
  exporter: async (entries) => {
    await sendToSIEM(entries);
  },
  piiMasking: {
    enabled: true,
    fields: ["input", "output"],
  },
  signing: {                              // optional non-repudiation chain
    signFn:   (hash) => signWithHSM(hash),
    verifyFn: (hash, sig) => verifyWithHSM(hash, sig),
  },
  sessionId: currentSessionId,
  actorId:   currentUserId,
  events: {
    onEntryAdded:   (entry) => log("audit:entry", entry.eventType),
    onChainBroken:  (result) => alertOnTamper(result),
    onExportError:  (err, entries) => log("audit:export:fail", err, entries.length),
  },
});

// Query
const failed = audit.getEntries({ eventType: "guardrail_check" });
const verified = await audit.verifyChain();
const exported = await audit.export(Date.now() - 24 * 60 * 60 * 1000);
```

Each `AuditEntry` carries a hash-chained sequence number so `verifyChain()` can prove no entries were dropped or rewritten in flight.

### Recording entries

For most workflows the orchestrator records relevant events automatically when an audit instance is attached via your own integration code. The bare minimum from a call site:

```typescript
// In your resolver / event handler / orchestrator hook
audit.record({
  eventType: "agent_run",
  agentName: agent.name,
  input,
  output: result.output,
  tokenUsage: result.tokenUsage,
});
```

See the API skeleton for the full `AuditEntry` shape.

## GDPR / CCPA compliance

`createCompliance(config)` returns a `ComplianceInstance` you call directly. The factory is named `createCompliance`, NOT `createCompliancePlugin`, and lives in `@directive-run/ai`. **`storage` is required.**

```typescript
import { createCompliance } from "@directive-run/ai";

const compliance = createCompliance({
  storage: myComplianceStorage,           // REQUIRED — your ComplianceStorage adapter
  retention: {
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,    // 30 days
    autoEnforce: true,
  },
  consentPurposes: ["analytics", "personalization", "training"],
  exportExpirationMs: 24 * 60 * 60 * 1000, // signed export links expire in 24h (default)
  auditOperations: true,                    // mirror every compliance op into the audit trail
  events: {
    onExport:           (result) => log("gdpr:export", result.subjectId),
    onDelete:           (result) => log("gdpr:delete", result.certificate),
    onConsentChange:    (record) => log("consent:change", record),
    onRetentionEnforced: (category, count) => log("retention:enforced", category, count),
  },
});

// GDPR Article 20 — right to data portability
const exportResult = await compliance.exportData({ subjectId: "user-42", format: "json" });

// GDPR Article 17 — right to erasure (returns a signed deletion certificate)
const deletion = await compliance.deleteData({ subjectId: "user-42", scope: "all" });
console.log(deletion.certificate.signature);

// Consent
compliance.consent.grant({ subjectId: "user-42", purpose: "analytics" });
compliance.consent.revoke({ subjectId: "user-42", purpose: "personalization" });
const consents = compliance.consent.list("user-42");
```

The `storage` adapter is your responsibility — Directive provides the policy + signed-receipt machinery; you provide the database. The `ComplianceStorage` interface lives in `@directive-run/ai`.

## Combining the surface

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createAuditTrail, createCompliance } from "@directive-run/ai";
import {
  createPIIGuardrail,
  createOutputPIIGuardrail,
  createPromptInjectionGuardrail,
  createToolGuardrail,
} from "@directive-run/ai/guardrails";

const audit      = createAuditTrail({ /* ... */ });
const compliance = createCompliance({ storage: myStorage });

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input:    [createPIIGuardrail({ redact: true }), createPromptInjectionGuardrail({ strictMode: true })],
    output:   [createOutputPIIGuardrail()],
    toolCall: [createToolGuardrail({ allowlist: ["search", "calculator"] })],
  },
  maxTokenBudget: 100_000,
  budgetWarningThreshold: 0.8,
});

// Wire audit + compliance into your orchestrator hooks
orchestrator.run = (orig => async (agent, input, opts) => {
  audit.record({ eventType: "agent_run", agentName: agent.name, input });
  return orig(agent, input, opts);
})(orchestrator.run);
```

## Security best practices

### Validate input before dispatch

```typescript
// WRONG — raw user input goes straight to the agent
await orchestrator.run(agent, userInput);

// CORRECT — sanitize / shape-check first, even with guardrails
const sanitized = sanitizeInput(userInput);
await orchestrator.run(agent, sanitized);
```

### Always set a token budget

```typescript
createAgentOrchestrator({
  runner,
  maxTokenBudget: 100_000,
  budgetWarningThreshold: 0.8,
  onBudgetWarning: (e) => alertOps(e),
})
```

### Restrict tool access

```typescript
import { createToolGuardrail } from "@directive-run/ai/guardrails";

const tools = createToolGuardrail({
  allowlist: ["search", "calculator", "readFile"],
});

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: { toolCall: [tools] },
});
```

For MCP-mediated tools, see `ai-mcp-rag.md` for per-tool approval + risk-scoring.

### Always validate output

```typescript
import {
  createOutputSchemaGuardrail,
  createContentFilterGuardrail,
  createOutputPIIGuardrail,
} from "@directive-run/ai/guardrails";

createAgentOrchestrator({
  runner,
  guardrails: {
    output: [
      createOutputSchemaGuardrail({ validate: zodAdapter(expectedSchema) }),
      createContentFilterGuardrail({ blockedPatterns: [/eval\(/, /<script/i] }),
      createOutputPIIGuardrail(),
    ],
  },
});
```

(`createOutputSchemaGuardrail` takes `validate` — not `schema` + `retries`. For automatic retry on schema failure, set `outputSchema` + `maxSchemaRetries` directly on the orchestrator.)

## Anti-patterns

### Importing audit/compliance from `@directive-run/core/plugins`

```typescript
// WRONG — these names + path don't exist
import { createAuditTrailPlugin, createCompliancePlugin } from "@directive-run/core/plugins";

// CORRECT — createAuditTrail / createCompliance from @directive-run/ai
import { createAuditTrail, createCompliance } from "@directive-run/ai";
```

### Putting `createAuditTrail()` into `plugins: [...]`

```typescript
// WRONG — createAuditTrail returns an AuditInstance, not a Directive Plugin
plugins: [createAuditTrail({ /* … */ })],

// CORRECT — keep the instance, record into it
const audit = createAuditTrail({ /* … */ });
audit.record({ /* … */ });
```

### `createPromptInjectionGuardrail({ sensitivity, allowlist })`

```typescript
// WRONG — sensitivity + allowlist are hallucinated
createPromptInjectionGuardrail({ sensitivity: "high", allowlist: ["safe phrase"] })

// CORRECT — strictMode + blockThreshold + ignoreCategories + replacePatterns
createPromptInjectionGuardrail({
  strictMode: true,
  blockThreshold: 25,
  ignoreCategories: ["role_manipulation"],
})
```

### Using `createPIIGuardrail` for output

```typescript
// WRONG — createPIIGuardrail is input-only (GuardrailFn<InputGuardrailData>)
guardrails: { output: [createPIIGuardrail({ redact: true })] }

// CORRECT — createOutputPIIGuardrail for output
guardrails: { output: [createOutputPIIGuardrail()] }
```

### `createCompliance` without `storage`

```typescript
// WRONG — storage is required
createCompliance({ retention: { maxAgeMs: 30 * 24 * 60 * 60 * 1000 } })

// CORRECT — pass your ComplianceStorage adapter
createCompliance({
  storage: myStorage,
  retention: { maxAgeMs: 30 * 24 * 60 * 60 * 1000, autoEnforce: true },
})
```

## Sources × PII — closing the fact-injection bypass

`createPIIGuardrail` and `createEnhancedPIIGuardrail` only inspect the
`data.input` argument passed to `runStream(agent, input, ...)`. When a
source publishes PII into a fact and the agent's prompt template embeds
that fact (`"Hello ${facts.email}..."`), the PII reaches the LLM call
without hitting the input guardrail chain.

This is a documented gap in the input-only guardrail chain — the fix
is a fact-store-boundary guardrail that runs on every fact write:

```ts
import { createSystem, createModule, t } from "@directive-run/core";
import { createFactPIIGuardrail } from "@directive-run/ai/guardrails";

const customer = createModule("customer", {
  schema: {
    facts: {
      email: t.string().meta({ tags: ["pii"] }),  // ← tag pii-bearing facts
      ssn: t.string().meta({ tags: ["pii"] }),
    },
  },
  sources: { /* Supabase realtime, webhook, ... */ },
});

const system = createSystem({
  module: customer,
  plugins: [
    createFactPIIGuardrail({
      mode: "redact",            // 'redact' (safe default) | 'alert'
      onBlocked: (key, detected) =>
        Sentry.captureMessage(`pii redacted: ${key}`, {
          extra: { count: detected.length },
        }),
    }),
  ],
});
```

The plugin scans every write to a `pii`-tagged fact (auto-discovered via
`meta.byTag("pii")` at `onInit`) and either redacts the value (default —
rewrites via a follow-up store write so the next read sees the redacted
form) or alerts (fires `onBlocked` without mutating). Together with the
input-guardrail chain on `runStream`, this closes the source → fact →
prompt PII path.

**Limitation:** hard rejection at the write boundary requires a
pre-commit transform hook on the source primitive itself (Directive
plugin hooks are wrapped by `safeCall` and a thrown error is
swallowed). Tracked as a future RFC; today's `"redact"` mode is the
safe-shipping posture.

See [`ai-sources.md`](./ai-sources.md) for the full source primitive
integration recipes, including the live-context pattern that
`createFactPIIGuardrail` gates.

## Quick reference

| API | Import path | Returns | Purpose |
|---|---|---|---|
| `createPIIGuardrail` | `@directive-run/ai/guardrails` | `GuardrailFn<InputGuardrailData>` | Basic input PII detection (block or redact) |
| `createEnhancedPIIGuardrail` | `@directive-run/ai/guardrails` | guardrail | Context-aware input PII |
| `createOutputPIIGuardrail` | `@directive-run/ai/guardrails` | guardrail | Output PII coverage |
| `createFactPIIGuardrail` | `@directive-run/ai/guardrails` | `Plugin` | **Fact-boundary PII guardrail — closes the source → fact → prompt bypass. Wire at `createSystem({ plugins })`.** |
| `createPromptInjectionGuardrail` | `@directive-run/ai/guardrails` | guardrail | Risk-scored injection defense (`strictMode`, `blockThreshold`) |
| `createAuditTrail` | `@directive-run/ai` | `AuditInstance` | Hash-chained audit log w/ signing + PII masking + async export |
| `createCompliance` | `@directive-run/ai` | `ComplianceInstance` | GDPR exportData / deleteData / consent + retention enforcement |
| `createToolGuardrail` | `@directive-run/ai/guardrails` | guardrail | Tool allow/deny lists |
| `createContentFilterGuardrail` | `@directive-run/ai/guardrails` | guardrail | Block sensitive patterns (block-only — no redact) |
| `GuardrailError` / `isGuardrailError` | `@directive-run/ai` | error class + guard | Carries `code`, `guardrailName`, `userMessage` |

## See also

- [`ai-guardrails-memory.md`](./ai-guardrails-memory.md) — the broader guardrail surface (length, schema, content filter, tool allowlist) this file's security-flavored guardrails compose with
- [`ai-mcp-rag.md`](./ai-mcp-rag.md) — `toolConstraints[…].requireApproval` is where MCP tool calls thread into the approval workflow surfaced here
