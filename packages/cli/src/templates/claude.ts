import { getKnowledge } from "../lib/knowledge.js";

/**
 * Generate Claude Code rules (~30KB).
 * Strategy: Full anti-patterns + core-patterns + naming + schema-types (most critical),
 * condensed summaries for everything else.
 */
export function generateClaudeRules(): string {
  // These 4 files are included in full (~25KB)
  const corePatterns = getKnowledge("core-patterns");
  const antiPatterns = getKnowledge("anti-patterns");
  const naming = getKnowledge("naming");
  const schemaTypes = getKnowledge("schema-types");

  return `# Directive — Complete AI Coding Rules

> Constraint-driven runtime for TypeScript. Declare requirements, let the runtime resolve them.
> https://directive.run | \`npm install @directive-run/core\`
> Full reference with examples: https://directive.run/llms.txt

## Core Patterns

${corePatterns}

---

## Anti-Patterns (All 36)

${antiPatterns}

### AI Package Anti-Patterns (21-36)

| # | WRONG | CORRECT |
|---|-------|---------|
| 21 | TS types for factsSchema: \`{ confidence: number }\` | Use \`{ confidence: t.number() }\` |
| 22 | \`facts.cache.push(item)\` in orchestrator | \`facts.cache = [...facts.cache, item]\` |
| 23 | Returning data from orchestrator \`resolve\` | Resolvers return \`void\` — mutate \`context.facts\` |
| 24 | Forgetting \`orchestrator.start()\` multi-agent | Single: implicit. Multi: must call \`start()\` |
| 25 | Catching \`Error\` not \`GuardrailError\` | \`GuardrailError\` has \`.guardrailName\`, \`.errorCode\` |
| 26 | \`from '@directive-run/ai'\` for adapters | Subpath: \`from '@directive-run/ai/openai'\` |
| 27 | Assuming \`{ input_tokens }\` structure | Normalized: \`{ inputTokens, outputTokens }\` |
| 28 | Same CircuitBreaker across agents | Create separate instances per dependency |
| 29 | \`budgetWarningThreshold: 1.5\` | Must be 0-1 (percentage) |
| 30 | \`race\` minSuccess > agents.length | Must be \`1 ≤ minSuccess ≤ agents.length\` |
| 31 | Async summarizer with autoManage: true | Use \`autoManage: false\` for sync control |
| 32 | Side effects in reflect \`evaluator\` | Evaluator must be pure |
| 33 | Task calling \`runSingleAgent\` | Tasks can't call agents — separate node |
| 34 | Task expecting object input | Input is always \`string\` — \`JSON.parse(input)\` |
| 35 | Task ID same as agent ID | IDs share namespace — distinct names |
| 36 | \`from '@directive-run/ai/mcp'\` | \`from '@directive-run/ai'\` (main export) |

---

## Naming Conventions

${naming}

---

## Schema Type Builders

${schemaTypes}

---

## Multi-Module Quick Reference

\`\`\`typescript
// Two modules with cross-module dependency
const authSchema = { facts: { token: t.string(), isAuth: t.boolean() } };
const authModule = createModule("auth", { schema: authSchema, /* ... */ });

const cartModule = createModule("cart", {
  schema: { facts: { items: t.array<CartItem>() } },
  crossModuleDeps: { auth: authSchema },  // Declare dependency
  constraints: {
    checkout: {
      when: (facts) => facts.self.items.length > 0 && facts.auth.isAuth,  // facts.self.* for own, facts.auth.* for cross
      require: () => ({ type: "CHECKOUT" }),
    },
  },
  // ...
});

const system = createSystem({ modules: { auth: authModule, cart: cartModule } });
// Access: system.facts.auth.token, system.events.cart.addItem({...})
\`\`\`

Key rules:
- \`facts.self.*\` for own module facts in constraints/resolvers
- \`facts.otherModule.*\` for cross-module reads
- \`crossModuleDeps\` must declare consumed schemas
- \`system.events.moduleName.eventName(payload)\` for namespaced events
- The \`::\` separator is internal — always use dot notation

---

## Constraints

- \`when(facts)\` → boolean. When true, requirement is emitted.
- \`require(facts)\` → \`{ type: "TYPE", ...data }\` object (never string literal)
- \`priority: number\` — higher evaluated first
- \`after: ["constraintName"]\` — ordering within same priority
- Async: \`async: true\` + \`deps: ['factName']\` (deps REQUIRED for async)
- Constraints DECLARE needs, resolvers FULFILL them — decoupled.

---

## Resolvers

- \`resolve(req, context)\` — async, returns \`void\`. Mutate \`context.facts.*\`.
- \`requirement: "TYPE"\` — which type this handles
- \`key: (req) => string\` — deduplication key
- \`retry: { attempts: 3, backoff: "exponential", initialDelay: 100 }\`
- \`batch: { maxSize: 10, windowMs: 50 }\` for N+1 prevention
- Always \`await system.settle()\` after start to wait for resolution

---

## System API

- \`system.facts.fieldName\` — read/write facts
- \`system.derive.derivationName\` — read derived values
- \`system.events.eventName(payload)\` — dispatch events
- \`system.subscribe(listener)\` — subscribe to all changes
- \`system.read(key)\` — read fact or derivation by string key
- \`system.inspect()\` — full state snapshot
- \`system.settle()\` — wait for async operations
- \`system.start()\` / \`system.stop()\` / \`system.destroy()\`

---

## React (\`@directive-run/react\`)

\`\`\`typescript
import { useSelector, useEvent } from "@directive-run/react";

const count = useSelector(system, (s) => s.facts.count);
const events = useEvent(system);
// onClick={() => events.increment()}
\`\`\`

**NO** \`useDirective()\` hook. Use \`useSelector\` + \`useEvent\`.

---

## Plugins (\`@directive-run/core/plugins\`)

\`devtoolsPlugin()\`, \`loggingPlugin()\`, \`persistencePlugin(config)\`,
\`createCircuitBreaker(config)\`, \`createObservability(config)\`

---

## AI Package (\`@directive-run/ai\`)

### Single-Agent Orchestrator

\`\`\`typescript
import { createAgentOrchestrator, t } from '@directive-run/ai';
import { createAnthropicRunner } from '@directive-run/ai/anthropic';

const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ apiKey }),
  factsSchema: { result: t.string(), confidence: t.number() },
  init: (facts) => { facts.result = ""; facts.confidence = 0; },
  maxTokenBudget: 100000,
  budgetWarningThreshold: 0.8,
  guardrails: { input: [...], output: [...] },
  memory: createAgentMemory({ strategy: createSlidingWindowStrategy({ maxMessages: 30 }) }),
  debug: true,
});

const result = await orchestrator.run(agent, "analyze this");
\`\`\`

### Multi-Agent

\`\`\`typescript
import { createMultiAgentOrchestrator, parallel, sequential, dag } from '@directive-run/ai';

const orch = createMultiAgentOrchestrator({
  agents: { researcher: agentA, writer: agentB },
  patterns: {
    pipeline: sequential(["researcher", "writer"]),
    brainstorm: parallel(["researcher", "writer"], mergeResults),
    workflow: dag([
      { id: "research", handler: "researcher" },
      { id: "write", handler: "writer", dependencies: ["research"] },
    ]),
  },
  runner,
});
orch.start();  // Required for multi-agent!
\`\`\`

8 patterns: \`parallel\`, \`sequential\`, \`supervisor\`, \`dag\`, \`reflect\`, \`race\`, \`debate\`, \`goal\`

### Adapter Imports (Subpath!)

\`\`\`typescript
import { createAnthropicRunner } from '@directive-run/ai/anthropic';
import { createOpenAIRunner } from '@directive-run/ai/openai';
import { createOllamaRunner } from '@directive-run/ai/ollama';
import { createGeminiRunner } from '@directive-run/ai/gemini';
\`\`\`

### Guardrails

\`createPIIGuardrail\`, \`createModerationGuardrail\`, \`createRateLimitGuardrail\`,
\`createToolGuardrail\`, \`createOutputSchemaGuardrail\`, \`createLengthGuardrail\`,
\`createContentFilterGuardrail\`

\`GuardrailResult: { passed: boolean, reason?: string, transformed?: unknown }\`

### Memory

\`createAgentMemory({ strategy, summarizer?, autoManage? })\`
Strategies: \`createSlidingWindowStrategy\`, \`createTokenBasedStrategy\`, \`createHybridStrategy\`
Summarizers: \`createTruncationSummarizer\`, \`createKeyPointsSummarizer\`, \`createLLMSummarizer(runner)\`

### Streaming

\`\`\`typescript
const streamResult = orchestrator.runStream(agent, "analyze");
for await (const chunk of streamResult.stream) {
  switch (chunk.type) {
    case "token": process.stdout.write(chunk.data); break;
    case "done": console.log("Tokens:", chunk.totalTokens); break;
    case "error": console.error(chunk.error); break;
  }
}
\`\`\`

Backpressure: \`"buffer"\` (default), \`"block"\`, \`"drop"\`
`;
}
