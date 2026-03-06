/**
 * Basic Observe Example
 *
 * Minimal setup: create a system, attach an AI architect, run one analysis.
 * Uses mockRunner for portability — swap with your real AgentRunner.
 *
 * Run: npx tsx examples/basic-observe.ts
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { createAIArchitect } from "@directive-run/architect";
import { mockRunner } from "@directive-run/architect/testing";

// 1. Define a simple module with schema and a constraint
const app = createModule("app", {
  schema: {
    errorCount: t.number(),
    status: t.string<"ok" | "degraded" | "down">(),
  },

  init: (facts) => {
    facts.errorCount = 0;
    facts.status = "ok";
  },

  constraints: {
    tooManyErrors: {
      when: (facts) => facts.errorCount > 5,
      require: { type: "RESET_ERRORS" },
    },
  },

  resolvers: {
    resetErrors: {
      requirement: "RESET_ERRORS",
      resolve: async (req, context) => {
        context.facts.errorCount = 0;
        context.facts.status = "ok";
      },
    },
  },
});

// 2. Create the system
const system = createSystem({ module: app });

// 3. Set up a mock runner that simulates the LLM observing the system
//    In production, use your real runner (OpenAI, Anthropic, etc.)
const runner = mockRunner([
  {
    // The LLM calls observe_system to see current state
    toolCalls: [
      { name: "observe_system", arguments: "{}" },
    ],
    totalTokens: 150,
  },
]);

// 4. Create the AI Architect with a budget
const architect = createAIArchitect({
  system,
  runner,
  budget: { tokens: 50_000, dollars: 5 },
  context: {
    description: "An error-tracking system that resets errors when they pile up",
    goals: ["Keep errorCount under control", "Maintain 'ok' status"],
  },
  safety: {
    approval: { constraints: "always", resolvers: "always" },
  },
  silent: true,
});

// 5. Subscribe to events
architect.on((event) => {
  console.log(`[${event.type}]`, "timestamp" in event ? event.timestamp : "");
});

// 6. Simulate some errors
(system.facts as Record<string, unknown>).errorCount = 8;
(system.facts as Record<string, unknown>).status = "degraded";

// 7. Run an analysis
const analysis = await architect.analyze("Why is the system degraded?");

console.log("\n--- Analysis Result ---");
console.log(`Trigger: ${analysis.trigger}`);
console.log(`Actions proposed: ${analysis.actions.length}`);
console.log(`Tokens used: ${analysis.tokensUsed}`);
console.log(`Duration: ${analysis.durationMs}ms`);

for (const action of analysis.actions) {
  console.log(`\nAction: ${action.tool}`);
  console.log(`  Risk: ${action.risk}`);
  console.log(`  Confidence: ${action.confidence}`);
  console.log(`  Requires approval: ${action.requiresApproval}`);
}

// 8. Check budget
const budget = architect.getBudgetUsage();
console.log(`\nBudget: ${budget.tokens} tokens, $${budget.dollars}`);

// 9. Clean up
architect.destroy();
console.log("\nDone.");
