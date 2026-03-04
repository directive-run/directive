import { generateCursorRules } from "./cursor.js";
import { getKnowledge } from "../lib/knowledge.js";

/**
 * Generate GitHub Copilot instructions (~12KB).
 * Cursor content + all 20 anti-patterns + schema types detail + AI basics.
 */
export function generateCopilotRules(): string {
  const base = generateCursorRules();

  // Add anti-patterns 11-20 that cursor doesn't include
  const extraAntiPatterns = `
## Anti-Patterns 11-20

| # | WRONG | CORRECT |
|---|-------|---------|
| 11 | \`module("name").schema({...}).build()\` | Prefer \`createModule("name", {...})\` object syntax |
| 12 | Returning data from \`resolve\` | Resolvers return \`void\` — mutate \`context.facts\` |
| 13 | Async logic in \`init\` | \`init\` is synchronous, facts assignment only |
| 14 | \`await system.start()\` without settle | Add \`await system.settle()\` after start |
| 15 | Missing \`crossModuleDeps\` | Declare \`crossModuleDeps: { auth: authSchema }\` |
| 16 | \`require: "TYPE"\` string literal | \`require: { type: "TYPE" }\` object form |
| 17 | Passthrough derivation \`(f) => f.count\` | Remove — read fact directly |
| 18 | \`from '@directive-run/core/module'\` | \`from '@directive-run/core'\` (main export) |
| 19 | \`async when()\` without \`deps\` | Add \`deps: ['factName']\` for async constraints |
| 20 | No error boundary on resolver | Use try-catch or module error boundary config |
`;

  // Add multi-module basics
  const multiModule = `
## Multi-Module

\`\`\`typescript
const system = createSystem({
  modules: { auth: authModule, cart: cartModule },
});

// Access: system.facts.auth.token, system.events.cart.addItem({...})
// In constraints/resolvers: use facts.self.* for own module
// Declare deps: crossModuleDeps: { auth: authSchema }
\`\`\`
`;

  // Add AI basics
  const aiBasics = `
## AI Package Basics (\`@directive-run/ai\`)

\`\`\`typescript
import { createAgentOrchestrator, t } from '@directive-run/ai';
import { createAnthropicRunner } from '@directive-run/ai/anthropic'; // Subpath import!

const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY }),
  factsSchema: { result: t.string(), confidence: t.number() }, // Use t.*() !
  init: (facts) => { facts.result = ""; facts.confidence = 0; },
});

const result = await orchestrator.run(agent, "analyze this");
\`\`\`

**AI Anti-Patterns:**
- Use \`t.number()\` not \`number\` for factsSchema
- Subpath imports: \`from '@directive-run/ai/anthropic'\` not \`from '@directive-run/ai'\`
- Token usage normalized: \`{ inputTokens, outputTokens }\` (not provider-specific)
- \`facts.cache = [...facts.cache, item]\` not \`facts.cache.push(item)\`
`;

  return base + extraAntiPatterns + multiModule + aiBasics;
}
