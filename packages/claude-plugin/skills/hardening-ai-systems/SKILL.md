---
name: hardening-ai-systems
description: "Add guardrails (input/output validation), memory strategies, token budgets, PII detection, prompt injection prevention, and circuit breakers to AI orchestrators. Use when enforcing content policies, managing costs, preventing security vulnerabilities, adding resilience, or implementing agent memory across turns."
---

# Hardening AI Systems

# When Claude Should Use This Skill

## Auto-Invoke Triggers
- User asks about input/output validation for LLM calls
- User wants to prevent harmful content or prompt injection
- User needs to control token spending or set cost limits
- User asks about agent memory, conversation history, or context management
- User mentions `createGuardrail`, `GuardrailError`, `createAgentMemory`
- User wants retry logic, circuit breakers, or failure resilience

## Exclusions
- Do NOT invoke for basic orchestrator/agent setup — use `building-ai-orchestrators`
- Do NOT invoke for streaming or provider setup — use `building-ai-agents`
- Do NOT invoke for test mocking — use `testing-ai-systems`

---

# Quick Reference

## Decision Tree: Which Hardening Feature?

```
What do you need?
├── Block bad inputs before LLM call → Input guardrail
├── Validate/filter LLM output → Output guardrail
├── Remember context across turns → createAgentMemory
├── Limit cost / token spend → maxTokenBudget
├── Detect PII in prompts → PII guardrail
├── Prevent prompt injection → Injection guardrail
└── Handle provider failures gracefully → Circuit breaker + retry
```

---

## Guardrails

Guardrails are pure validators. They check content and throw `GuardrailError` on violation. They must NOT modify the content they check.

### Input + Output Guardrails

```typescript
import { createGuardrail, GuardrailError } from "@directive-run/ai";

// Input guardrail — runs before each LLM call
const lengthGuardrail = createGuardrail({
  name: "input-length",
  type: "input",
  check: async (input) => {
    if (input.prompt.length > 10_000) {
      throw new GuardrailError({
        code: "INPUT_TOO_LONG",
        message: `Input exceeds 10,000 characters (got ${input.prompt.length})`,
        guardrail: "input-length",
      });
    }
    // No return value needed — guardrails only validate
  },
});

// Output guardrail — runs after each LLM response
const toxicityGuardrail = createGuardrail({
  name: "toxicity-check",
  type: "output",
  check: async (output) => {
    const score = await getToxicityScore(output.text);

    if (score > 0.8) {
      throw new GuardrailError({
        code: "TOXIC_OUTPUT",
        message: `Toxicity score ${score} exceeds threshold`,
        guardrail: "toxicity-check",
      });
    }
  },
});

// Attach to orchestrator
const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ model: "claude-opus-4-6", apiKey: process.env.ANTHROPIC_API_KEY }),
  guardrails: [lengthGuardrail, toxicityGuardrail],
  factsSchema: {
    input: t.string(),
    output: t.string().optional(),
    status: t.string<"idle" | "done" | "blocked">(),
    violationCode: t.string().optional(),
  },
  init: (facts) => {
    facts.status = "idle";
  },
  resolvers: {
    process: {
      requirement: "PROCESS",
      resolve: async (req, context) => {
        try {
          const result = await context.runner.run({ prompt: context.facts.input });
          context.facts.output = result.text;
          context.facts.status = "done";
        } catch (error) {
          if (error instanceof GuardrailError) {
            context.facts.status = "blocked";
            context.facts.violationCode = error.code;
          } else {
            throw error;
          }
        }
      },
    },
  },
});
```

---

## Security Guardrails

### PII Detection

```typescript
const piiGuardrail = createGuardrail({
  name: "pii-check",
  type: "input",
  check: async (input) => {
    const patterns: Record<string, RegExp> = {
      ssn: /\b\d{3}-\d{2}-\d{4}\b/,
      creditCard: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/,
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    };

    const detected = Object.entries(patterns)
      .filter(([, re]) => re.test(input.prompt))
      .map(([type]) => type);

    if (detected.length > 0) {
      throw new GuardrailError({
        code: "PII_DETECTED",
        message: `Input contains PII: ${detected.join(", ")}`,
        guardrail: "pii-check",
        metadata: { piiTypes: detected },
      });
    }
  },
});
```

### Prompt Injection Prevention

```typescript
const injectionGuardrail = createGuardrail({
  name: "injection-prevention",
  type: "input",
  check: async (input) => {
    const patterns = [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /you\s+are\s+now\s+(?:in\s+)?(?:developer|admin|god)\s+mode/i,
      /disregard\s+(?:your\s+)?(?:system\s+)?instructions/i,
      /<\|im_start\|>/i,
    ];

    const matched = patterns.some((re) => re.test(input.prompt));

    if (matched) {
      throw new GuardrailError({
        code: "PROMPT_INJECTION",
        message: "Potential prompt injection detected",
        guardrail: "injection-prevention",
      });
    }
  },
});
```

---

## Agent Memory

```typescript
import { createAgentMemory } from "@directive-run/ai";

// Sliding window: keep last N messages
const memory = createAgentMemory({
  strategy: "sliding-window",
  maxMessages: 20,
  maxTokens: 8000,
});

// Summary: compress old context with a cheap LLM
const summaryMemory = createAgentMemory({
  strategy: "summary",
  maxMessages: 50,
  summarizeAfter: 30,
  summaryRunner: createAnthropicRunner({ model: "claude-haiku-4-5", apiKey: process.env.ANTHROPIC_API_KEY }),
});

// Semantic: retrieve relevant past messages by similarity
const semanticMemory = createAgentMemory({
  strategy: "semantic",
  maxRetrieved: 5,
  embedder: myEmbeddingFunction,
});

// Usage in resolver
resolvers: {
  respond: {
    requirement: "RESPOND",
    resolve: async (req, context) => {
      const result = await context.runner.run({
        prompt: context.facts.userMessage,
        messages: context.memory.getMessages(),  // inject history
      });
      context.facts.response = result.text;
      // Memory updates automatically after each run
    },
  },
},
```

---

## Token Budget Management

```typescript
const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ model: "claude-opus-4-6", apiKey: process.env.ANTHROPIC_API_KEY }),
  budget: {
    maxTokenBudget: 100_000,          // Hard limit — halts execution
    budgetWarningThreshold: 0.8,      // Fire warning at 80%
    onBudgetWarning: (used, max) => {
      console.warn(`Budget at ${Math.round((used / max) * 100)}%`);
    },
  },
  factsSchema: {
    input: t.string(),
    output: t.string().optional(),
    tokensUsed: t.number(),
  },
  init: (facts) => {
    facts.tokensUsed = 0;
  },
  resolvers: {
    process: {
      requirement: "PROCESS",
      resolve: async (req, context) => {
        if (!context.budget.canAfford(estimateTokens(context.facts.input))) {
          throw new Error("Insufficient token budget");
        }

        const result = await context.runner.run({ prompt: context.facts.input });
        context.facts.output = result.text;
        context.facts.tokensUsed += result.usage.totalTokens;
      },
    },
  },
});

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);  // ~4 chars per token
}
```

---

## Resilience: Circuit Breaker + Retry

```typescript
import { createCircuitBreaker } from "@directive-run/ai";

const breaker = createCircuitBreaker({
  failureThreshold: 5,       // Open after 5 consecutive failures
  recoveryTimeout: 30_000,   // Retry after 30s
  halfOpenRequests: 2,
  onStateChange: (from, to) => console.log(`Circuit: ${from} → ${to}`),
});

// Retry config on the resolver
resolvers: {
  callLLM: {
    requirement: "CALL_LLM",
    retry: {
      attempts: 3,
      backoff: "exponential",
      initialDelay: 500,
      maxDelay: 10_000,
      retryOn: (error) => {
        return error.message.includes("rate_limit") ||
               error.message.includes("overloaded");
      },
    },
    resolve: async (req, context) => {
      const result = await context.runner.run({ prompt: context.facts.input });
      context.facts.output = result.text;
    },
  },
},
```

---

# Critical Anti-Patterns

## Guardrails that modify content

```typescript
// WRONG — guardrails must not transform input
const bad = createGuardrail({
  name: "sanitizer",
  type: "input",
  check: async (input) => {
    input.prompt = input.prompt.replace(/badword/g, "***"); // NEVER mutate
    return input;                                            // NEVER return content
  },
});

// CORRECT — only validate, throw on violation
const good = createGuardrail({
  name: "content-check",
  type: "input",
  check: async (input) => {
    if (input.prompt.includes("badword")) {
      throw new GuardrailError({ code: "PROHIBITED", message: "Prohibited content", guardrail: "content-check" });
    }
  },
});
```

## Not setting token budgets in production

```typescript
// WRONG — runaway loops = runaway costs
const orchestrator = createAgentOrchestrator({ runner, /* no budget */ });

// CORRECT
const orchestrator = createAgentOrchestrator({
  runner,
  budget: { maxTokenBudget: 50_000, budgetWarningThreshold: 0.8 },
});
```

## Catching GuardrailError silently

```typescript
// WRONG — violations disappear
} catch (e) { /* swallowed */ }

// CORRECT
} catch (error) {
  if (error instanceof GuardrailError) {
    context.facts.status = "blocked";
    context.facts.violationCode = error.code;
  } else {
    throw error;
  }
}
```

## Using ctx instead of context

```typescript
// WRONG
resolve: async (req, ctx) => { ctx.facts.output = "..."; }

// CORRECT
resolve: async (req, context) => { context.facts.output = "..."; }
```

---

# Reference Files

- `knowledge/ai-guardrails-memory.md` — Full guardrail API, all memory strategies, configuration options
- `knowledge/ai-budget-resilience.md` — Budget configuration, circuit breaker, retry policies, estimateTokens
- `knowledge/ai-security.md` — PII patterns, injection detection, security best practices
- `examples/auth-flow.ts` — Auth-gated orchestrator with security guardrails
- `examples/fraud-analysis.ts` — Budget-aware multi-agent fraud detection
