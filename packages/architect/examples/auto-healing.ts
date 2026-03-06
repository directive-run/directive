/**
 * Auto-Healing Example
 *
 * Demonstrates health triggers + outcome tracking + constraint templates.
 * The AI detects health decline, applies a rate-limit template, and
 * tracks whether the action improved health.
 *
 * Run: npx tsx examples/auto-healing.ts
 */

import { createModule, createSystem, t } from "@directive-run/core";
import {
  createAIArchitect,
  computeHealthScore,
  createTemplateRegistry,
  createOutcomeTracker,
  maxConstraintsPerHour,
} from "@directive-run/architect";
import { mockRunner } from "@directive-run/architect/testing";

// 1. Define a system prone to API rate issues
const apiService = createModule("api", {
  schema: {
    requestCount: t.number(),
    errorRate: t.number(),
    status: t.string<"healthy" | "degraded" | "overloaded">(),
  },

  init: (facts) => {
    facts.requestCount = 0;
    facts.errorRate = 0;
    facts.status = "healthy";
  },

  constraints: {
    highErrorRate: {
      when: (facts) => facts.errorRate > 0.5,
      require: { type: "REDUCE_LOAD" },
    },
  },
});

const system = createSystem({ module: apiService });

// 2. Set up template registry — the AI can apply pre-built patterns
const templates = createTemplateRegistry();
console.log("Available templates:");
for (const tmpl of templates.list()) {
  console.log(`  - ${tmpl.id}: ${tmpl.name}`);
}

// 3. Set up outcome tracking — measures health impact of each action
const outcomeTracker = createOutcomeTracker({
  measurementDelay: 100, // Short delay for demo (normally 10s+)
  maxOutcomes: 50,
});

// 4. Create mock runner that simulates AI applying a rate-limit template
const runner = mockRunner([
  {
    // AI observes the system, sees high error rate
    toolCalls: [
      { name: "observe_system", arguments: "{}" },
    ],
    totalTokens: 200,
  },
  {
    // AI creates a constraint to rate-limit when requests spike
    toolCalls: [
      {
        name: "create_constraint",
        arguments: JSON.stringify({
          id: "rate-limit-requests",
          whenCode: "facts.requestCount > 100",
          require: { type: "THROTTLE", maxPerSecond: 50 },
          priority: 80,
        }),
      },
    ],
    totalTokens: 300,
  },
]);

// 5. Create architect with health triggers and policies
const architect = createAIArchitect({
  system,
  runner,
  budget: { tokens: 100_000, dollars: 10 },
  context: {
    description: "API gateway that needs rate limiting when overloaded",
    goals: ["Keep error rate below 10%", "Apply rate limiting automatically"],
  },
  safety: {
    approval: { constraints: "never" }, // Auto-approve for demo
  },
  triggers: {
    onHealthDecline: {
      threshold: 60,       // Trigger when health drops below 60
      pollInterval: "1s",  // Check every second (short for demo)
      minDrop: 5,
    },
  },
  outcomeTracking: { measurementDelay: 100 },
  templates: templates.list(),
  policies: [
    maxConstraintsPerHour(10), // Safety limit
  ],
  silent: true,
});

// 6. Listen for key events
architect.on("health-check", (event) => {
  console.log(`[health-check] score=${event.score} prev=${event.previousScore} triggered=${event.triggered}`);
});

architect.on("applied", (event) => {
  console.log(`[applied] ${event.action.tool} — ${event.action.arguments.id ?? "unknown"}`);
});

// 7. Simulate degradation
console.log("\n--- Simulating API overload ---");

system.facts.requestCount = 500;
system.facts.errorRate = 0.75;
system.facts.status = "overloaded";

// Check health before
const healthBefore = computeHealthScore(system);
console.log(`Health before: ${healthBefore.score}/100`);
if (healthBefore.warnings.length > 0) {
  console.log(`Warnings: ${healthBefore.warnings.join(", ")}`);
}

// 8. Run manual analysis (normally health trigger would fire automatically)
const analysis = await architect.analyze("System is overloaded, apply rate limiting");

console.log(`\n--- Analysis: ${analysis.actions.length} action(s) proposed ---`);
for (const action of analysis.actions) {
  console.log(`  ${action.tool}: ${JSON.stringify(action.arguments)}`);
  console.log(`  Status: ${action.approvalStatus}, Risk: ${action.risk}`);
}

// 9. Check active definitions
const active = architect.getActiveDefinitions();
console.log(`\nActive AI definitions: ${active.length}`);
for (const def of active) {
  console.log(`  ${def.type}:${def.id} (created ${new Date(def.createdAt).toISOString()})`);
}

// 10. Check outcomes
const outcomes = architect.getOutcomes();
console.log(`\nRecorded outcomes: ${outcomes.length}`);
for (const outcome of outcomes) {
  console.log(`  ${outcome.tool}: health ${outcome.healthBefore} → ${outcome.healthAfter} (delta: ${outcome.healthDelta})`);
}

// 11. Show audit trail
const audit = architect.getAuditLog();
console.log(`\nAudit log: ${audit.length} entries`);
for (const entry of audit.slice(-3)) {
  console.log(`  [${entry.trigger}] ${entry.tool} — applied=${entry.applied}`);
}

// 12. Clean up
architect.destroy();
console.log("\nDone.");
