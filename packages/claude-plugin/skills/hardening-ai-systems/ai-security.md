# AI Security

PII detection/redaction, prompt injection defense, audit trails, GDPR/CCPA compliance, and security best practices for Directive AI applications.

## Decision Tree: "What security do I need?"

```
What are you protecting against?
├── PII leakage in prompts/outputs → createPIIGuardrail()
├── Prompt injection attacks → createPromptInjectionGuardrail()
├── Audit/compliance requirements → createAuditTrailPlugin()
├── GDPR/CCPA data handling → createCompliancePlugin()
│
Where do guardrails go?
├── Before agent receives prompt → guardrails.input
├── After agent produces output → guardrails.output
└── Both directions → guardrails.input + guardrails.output
│
Where do plugins go?
└── Always → plugins: [createAuditTrailPlugin(), ...]
    (Plugins are Directive core plugins, not AI-specific)
```

## PII Detection and Redaction

Enhanced PII guardrail with built-in patterns and custom regex support:

```typescript
import { createPIIGuardrail } from "@directive-run/ai";

const piiGuardrail = createPIIGuardrail({
  // Redact PII instead of blocking (default: false = block)
  redact: true,

  // Replacement string (default: "[REDACTED]")
  redactReplacement: "[REDACTED]",

  // Additional custom patterns beyond built-ins
  patterns: [
    /\b\d{3}-\d{2}-\d{4}\b/,         // SSN
    /\b[A-Z]{2}\d{6,8}\b/,           // Passport
    /ACCT-\d{10}/,                     // Internal account IDs
  ],
});
```

Built-in patterns detect:
- Email addresses
- Phone numbers (US, international)
- Credit card numbers (Visa, MC, Amex, Discover)
- IP addresses (v4, v6)
- Dates of birth (common formats)

### Using PII Guardrail

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    // Redact PII before the agent sees it
    input: [piiGuardrail],

    // Catch any PII the agent generates
    output: [piiGuardrail],
  },
});
```

## Prompt Injection Detection

Detect and block common prompt injection patterns:

```typescript
import { createPromptInjectionGuardrail } from "@directive-run/ai";

const injectionGuardrail = createPromptInjectionGuardrail({
  // Sensitivity: "low" | "medium" | "high" (default: "medium")
  sensitivity: "high",

  // Custom patterns to detect
  additionalPatterns: [
    /ignore previous instructions/i,
    /you are now/i,
    /system prompt/i,
  ],

  // Allow-list specific phrases that look like injections but are safe
  allowlist: [
    "you are now ready to proceed",
  ],
});
```

### Sensitivity Levels

| Level | Detects | False Positives |
|---|---|---|
| `"low"` | Obvious injections (role overrides, ignore instructions) | Rare |
| `"medium"` | Common patterns + encoded attacks | Occasional |
| `"high"` | Aggressive detection + heuristic analysis | More frequent |

### Applying Injection Defense

```typescript
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    // Check user input for injection attempts
    input: [injectionGuardrail],
  },
});

// Handle blocked input
import { GuardrailError } from "@directive-run/ai";

try {
  const result = await orchestrator.run(agent, userInput);
} catch (error) {
  if (error instanceof GuardrailError) {
    console.log(error.guardrailName);  // "prompt-injection"
    console.log(error.errorCode);      // "GUARDRAIL_INPUT_BLOCKED"
    console.log(error.reason);         // "Prompt injection detected: role override"
  }
}
```

## Audit Trail Plugin

Log all AI interactions for compliance and forensics:

```typescript
import { createAuditTrailPlugin } from "@directive-run/core/plugins";

const auditPlugin = createAuditTrailPlugin({
  // Where to store audit logs
  storage: "file",           // "file" | "console" | custom handler
  filePath: "./audit.jsonl", // For file storage

  // What to log
  logInputs: true,
  logOutputs: true,
  logToolCalls: true,
  logTokenUsage: true,

  // Redact sensitive data in logs (recommended)
  redactPII: true,

  // Custom log handler (alternative to file/console)
  onLog: async (entry) => {
    await sendToSIEM(entry);
  },
});
```

### Audit Log Entry Shape

```typescript
interface AuditLogEntry {
  timestamp: string;
  eventType: "agent_run" | "tool_call" | "guardrail_check" | "error";
  agentName: string;
  input?: string;         // Redacted if redactPII: true
  output?: string;        // Redacted if redactPII: true
  toolCalls?: ToolCall[];
  tokenUsage?: { inputTokens: number; outputTokens: number };
  duration: number;
  guardrails?: { name: string; passed: boolean; reason?: string }[];
  error?: { message: string; code: string };
}
```

## GDPR/CCPA Compliance Plugin

Enforce data handling policies at the system level:

```typescript
import { createCompliancePlugin } from "@directive-run/core/plugins";

const compliancePlugin = createCompliancePlugin({
  // Data retention policy
  retention: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
    autoDelete: true,
  },

  // Right to deletion
  onDeletionRequest: async (userId) => {
    await deleteUserData(userId);
    await deleteConversationHistory(userId);
  },

  // Data export (right to portability)
  onExportRequest: async (userId) => {
    const data = await getUserData(userId);

    return JSON.stringify(data);
  },

  // Consent tracking
  requireConsent: true,
  consentCategories: ["analytics", "personalization", "training"],
});
```

## Applying Security Plugins

Plugins go on the orchestrator (they are Directive core plugins):

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [piiGuardrail, injectionGuardrail],
    output: [piiGuardrail],
  },
  plugins: [auditPlugin, compliancePlugin],
});
```

## Security Best Practices

### Input Validation

```typescript
// WRONG — passing raw user input to the agent
const result = await orchestrator.run(agent, userInput);

// CORRECT — validate and sanitize input first
const sanitized = sanitizeInput(userInput);
const result = await orchestrator.run(agent, sanitized);
```

### Token Budget Limits

```typescript
// Always set a token budget to prevent runaway costs
const orchestrator = createAgentOrchestrator({
  runner,
  maxTokenBudget: 100000,
  budgetWarningThreshold: 0.8,
});
```

### Tool Approval Workflows

```typescript
import { createToolGuardrail } from "@directive-run/ai";

// Restrict which tools the agent can call
const toolGuardrail = createToolGuardrail({
  allowedTools: ["search", "calculator", "readFile"],
  // Tools not in this list are blocked
});

// For MCP tools, use toolConstraints
const mcp = createMCPAdapter({
  servers: [...],
  toolConstraints: {
    "tools/write-file": { requireApproval: true },
    "tools/delete": { requireApproval: true, maxAttempts: 1 },
  },
});
```

### Output Sanitization

```typescript
// Always validate agent output before using it
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    output: [
      createOutputSchemaGuardrail({ schema: expectedSchema, retries: 2 }),
      createContentFilterGuardrail({ patterns: [/eval\(/, /<script/i], action: "block" }),
      createPIIGuardrail({ redact: true }),
    ],
  },
});
```

## Quick Reference

| API | Import Path | Purpose |
|---|---|---|
| `createPIIGuardrail` | `@directive-run/ai` | Detect/redact PII |
| `createPromptInjectionGuardrail` | `@directive-run/ai` | Block injection attacks |
| `createAuditTrailPlugin` | `@directive-run/core/plugins` | Log all AI interactions |
| `createCompliancePlugin` | `@directive-run/core/plugins` | GDPR/CCPA data policies |
| `createToolGuardrail` | `@directive-run/ai` | Restrict tool access |
| `createContentFilterGuardrail` | `@directive-run/ai` | Block unsafe content patterns |
| `GuardrailError` | `@directive-run/ai` | Catch guardrail failures |
