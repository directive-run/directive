import { getAllExamples, getAllKnowledge } from "../lib/knowledge.js";

/**
 * Generate llms.txt (no size limit).
 * Content: complete reference + all 7 examples + full 26-file knowledge base.
 */
export function generateLlmsTxt(): string {
  const knowledge = getAllKnowledge();
  const examples = getAllExamples();

  // Order: core knowledge first, then AI, then api-skeleton
  const coreOrder = [
    "core-patterns",
    "anti-patterns",
    "naming",
    "multi-module",
    "constraints",
    "resolvers",
    "error-boundaries",
    "testing",
    "time-travel",
    "schema-types",
    "system-api",
    "react-adapter",
    "plugins",
  ];

  const aiOrder = [
    "ai-orchestrator",
    "ai-multi-agent",
    "ai-tasks",
    "ai-agents-streaming",
    "ai-guardrails-memory",
    "ai-adapters",
    "ai-budget-resilience",
    "ai-mcp-rag",
    "ai-communication",
    "ai-debug-observability",
    "ai-security",
    "ai-testing-evals",
  ];

  const exampleOrder = [
    "counter",
    "auth-flow",
    "shopping-cart",
    "error-boundaries",
    "ai-orchestrator",
    "fraud-analysis",
    "ai-checkpoint",
  ];

  const sections = [
    "# Directive — Complete AI Reference (llms.txt)",
    "",
    "> Constraint-driven runtime for TypeScript.",
    "> Declare requirements. Let the runtime resolve them.",
    "> https://directive.run",
    "",
    "## Core API (@directive-run/core)",
    "",
  ];

  for (const name of coreOrder) {
    const content = knowledge.get(name);
    if (content) {
      sections.push(content, "", "---", "");
    }
  }

  sections.push("## AI Package (@directive-run/ai)", "");

  for (const name of aiOrder) {
    const content = knowledge.get(name);
    if (content) {
      sections.push(content, "", "---", "");
    }
  }

  // API Skeleton
  const apiSkeleton = knowledge.get("api-skeleton");
  if (apiSkeleton) {
    sections.push("## API Reference (Auto-Generated)", "", apiSkeleton, "");
  }

  // All examples
  sections.push("## Complete Examples", "");

  for (const name of exampleOrder) {
    const content = examples.get(name);
    if (content) {
      sections.push(
        `### ${name}`,
        "",
        "```typescript",
        content,
        "```",
        "",
      );
    }
  }

  return sections.join("\n");
}
