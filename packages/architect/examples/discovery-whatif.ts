/**
 * Discovery + What-If Cascade Example
 *
 * Advanced workflow: discover system patterns → simulate proposed
 * actions with cascade analysis → apply recommendations.
 *
 * Run: npx tsx examples/discovery-whatif.ts
 */

import { createModule, createSystem, t } from "@directive-run/core";
import {
  createAIArchitect,
  extractSystemGraph,
  computeHealthScore,
  analyzeGraph,
} from "@directive-run/architect";
import { mockRunner } from "@directive-run/architect/testing";

// 1. Define a multi-constraint system
const orderSystem = createModule("orders", {
  schema: {
    pendingOrders: t.number(),
    failedPayments: t.number(),
    retryCount: t.number(),
    processingRate: t.number(),
    status: t.string<"idle" | "processing" | "backlogged" | "error">(),
  },

  init: (facts) => {
    facts.pendingOrders = 0;
    facts.failedPayments = 0;
    facts.retryCount = 0;
    facts.processingRate = 100;
    facts.status = "idle";
  },

  constraints: {
    backlogDetection: {
      when: (facts) => facts.pendingOrders > 50,
      require: { type: "SCALE_UP" },
    },
    paymentRetry: {
      when: (facts) => facts.failedPayments > 0 && facts.retryCount < 3,
      require: { type: "RETRY_PAYMENTS" },
    },
  },

  resolvers: {
    scaleUp: {
      requirement: "SCALE_UP",
      resolve: async (req, context) => {
        context.facts.processingRate = Math.min(
          context.facts.processingRate * 2,
          1000,
        );
      },
    },
    retryPayments: {
      requirement: "RETRY_PAYMENTS",
      resolve: async (req, context) => {
        context.facts.retryCount += 1;
        context.facts.failedPayments = Math.max(
          context.facts.failedPayments - 1,
          0,
        );
      },
    },
  },
});

const system = createSystem({ module: orderSystem });

// 2. Set up mock runner for discovery + what-if + analysis
const runner = mockRunner([
  // Discovery: AI analyzes observed patterns
  {
    toolCalls: [{ name: "observe_system", arguments: "{}" }],
    totalTokens: 100,
  },
  // What-if analysis: AI evaluates proposed action
  {
    toolCalls: [{ name: "observe_system", arguments: "{}" }],
    totalTokens: 100,
  },
  // Main analysis: AI proposes a constraint
  {
    toolCalls: [
      {
        name: "create_constraint",
        arguments: JSON.stringify({
          id: "auto-backlog-alert",
          whenCode: "facts.pendingOrders > 100 && facts.processingRate < 50",
          require: { type: "ALERT_OPS", severity: "high" },
          priority: 90,
        }),
      },
    ],
    totalTokens: 250,
  },
]);

const architect = createAIArchitect({
  system,
  runner,
  budget: { tokens: 100_000, dollars: 10 },
  context: {
    description: "Order processing system with payment retry and auto-scaling",
    goals: [
      "Process orders within 5 minutes",
      "Retry failed payments up to 3 times",
      "Alert ops when backlog is critical",
    ],
  },
  safety: {
    approval: { constraints: "never" },
  },
  silent: true,
});

// ─── Step 1: Extract and analyze the constraint graph ────────────────────────

console.log("=== Step 1: System Graph Analysis ===\n");

const graph = architect.graph();
console.log(`Nodes: ${graph.nodes.length}`);
for (const node of graph.nodes) {
  console.log(`  [${node.type}] ${node.label}${node.aiCreated ? " (AI)" : ""}`);
}

console.log(`\nEdges: ${graph.edges.length}`);
for (const edge of graph.edges) {
  console.log(`  ${edge.source} --(${edge.type})--> ${edge.target}`);
}

const graphAnalysis = analyzeGraph(graph);
console.log(`\nCycles: ${graphAnalysis.cycles.length}`);
console.log(`Orphan constraints: ${graphAnalysis.orphanConstraints.length}`);
console.log(`Dead resolvers: ${graphAnalysis.deadResolvers.length}`);
if (graphAnalysis.recommendations.length > 0) {
  console.log("Recommendations:");
  for (const rec of graphAnalysis.recommendations) {
    console.log(`  - ${rec}`);
  }
}

// ─── Step 2: Discovery session ───────────────────────────────────────────────

console.log("\n=== Step 2: Discovery Session ===\n");

// Simulate some system activity before discovery
const facts = system.facts as Record<string, unknown>;
facts.pendingOrders = 75;
facts.failedPayments = 3;
facts.status = "backlogged";

// Short discovery (50ms for demo — normally 5+ minutes)
const session = architect.discover({ duration: 50, useAI: false });

// Check progress
const progress = session.progress();
console.log(`Progress: ${progress.eventCount} events, ${progress.patternCount} patterns`);

// Wait for discovery to complete
const report = await session.done;
console.log(`\nDiscovery complete:`);
console.log(`  Duration: ${report.durationMs}ms`);
console.log(`  Timeline events: ${report.timeline.length}`);
console.log(`  Patterns found: ${report.patterns.length}`);

for (const pattern of report.patterns) {
  console.log(`  [${pattern.type}] ${pattern.description} (${pattern.occurrences}x, confidence: ${pattern.confidence})`);
}

// ─── Step 3: What-If Cascade Simulation ──────────────────────────────────────

console.log("\n=== Step 3: What-If Cascade Simulation ===\n");

// Simulate what would happen if we added a constraint
const whatIfResult = await architect.whatIf(
  {
    tool: "create_constraint",
    arguments: {
      id: "auto-backlog-alert",
      whenCode: "facts.pendingOrders > 100 && facts.processingRate < 50",
      require: { type: "ALERT_OPS", severity: "high" },
    },
  },
  {
    cascadeSteps: 3, // Simulate 3 rounds of constraint propagation
  },
);

console.log(`Risk score: ${whatIfResult.riskScore}`);
console.log(`Predicted steps: ${whatIfResult.steps.length}`);

for (const step of whatIfResult.steps) {
  console.log(`  ${step.description}`);
  if (step.factChanges.length > 0) {
    for (const change of step.factChanges) {
      console.log(`    ${change.key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
    }
  }
  if (step.constraintsFiring.length > 0) {
    console.log(`    Constraints firing: ${step.constraintsFiring.join(", ")}`);
  }
}

if (whatIfResult.cascade) {
  console.log(`\nCascade simulation:`);
  console.log(`  Rounds: ${whatIfResult.cascade.rounds.length}`);
  console.log(`  Total constraints fired: ${whatIfResult.cascade.totalConstraintsFired}`);
  console.log(`  Total resolvers activated: ${whatIfResult.cascade.totalResolversActivated}`);
  console.log(`  Settled: ${whatIfResult.cascade.settled}`);
}

// ─── Step 4: Apply the recommendation ────────────────────────────────────────

console.log("\n=== Step 4: Apply Recommendation ===\n");

const analysis = await architect.analyze("Add monitoring for critical backlog");

console.log(`Actions proposed: ${analysis.actions.length}`);
for (const action of analysis.actions) {
  console.log(`  ${action.tool}: ${action.arguments.id}`);
  console.log(`  Status: ${action.approvalStatus}`);
}

// Check health after
const health = computeHealthScore(system);
console.log(`\nHealth score: ${health.score}/100`);
console.log(`Active AI definitions: ${architect.getActiveDefinitions().length}`);

// Show status summary
const status = architect.status();
console.log(`\nArchitect status:`);
console.log(`  Budget: ${status.budget.tokens} tokens, $${status.budget.dollars}`);
console.log(`  Active defs: ${status.activeDefinitions}`);
console.log(`  Audit entries: ${status.auditEntries}`);
console.log(`  Circuit breaker: ${status.circuitBreaker}`);

// Clean up
architect.destroy();
console.log("\nDone.");
