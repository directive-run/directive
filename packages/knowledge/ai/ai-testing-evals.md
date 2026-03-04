# AI Testing and Evaluations

Mock runners, test orchestrators, assertion helpers, simulators, and an evaluation framework with LLM-as-judge and dataset-driven quality gates.

## Decision Tree: "How do I test my AI code?"

```
What are you testing?
├── Single agent behavior → createTestOrchestrator + createMockRunner
├── Multi-agent patterns → createTestMultiAgentOrchestrator
├── Specific agent was called → assertAgentCalled(mockRunner, name)
├── Token budget behavior → createMockRunner with token counts
├── Guardrail logic → createTestOrchestrator with guardrails
│
What are you evaluating?
├── Output quality → createEvaluator with criteria
├── Automated grading → LLM-as-judge evaluator
├── Regression testing → dataset-driven evaluation
├── CI quality gates → evaluation thresholds
│
Where do I import from?
├── Test utilities → '@directive-run/ai/testing'
├── Evaluators → '@directive-run/ai/testing'
└── Schema builders → '@directive-run/ai' (main, for t.*())
```

## Mock Runners

Create deterministic runners that return predefined responses:

```typescript
import { createMockRunner } from "@directive-run/ai/testing";

// Pattern-matched responses
const mockRunner = createMockRunner([
  { input: /analyze/, output: "Analysis complete: positive trend", tokens: 100 },
  { input: /summarize/, output: "Summary: key findings are...", tokens: 50 },
  { input: /translate/, output: "Translation: Hola mundo", tokens: 30 },
]);

// Catch-all default response
const mockRunner = createMockRunner([
  { input: /specific/, output: "Matched specific" },
  { input: /.*/, output: "Default response", tokens: 10 },
]);
```

### Mock Runner with Side Effects

```typescript
const mockRunner = createMockRunner([
  {
    input: /analyze/,
    output: "Analysis complete",
    tokens: 100,
    // Simulate tool calls
    toolCalls: [
      { name: "search", arguments: '{"query":"data"}', result: "found 5 items" },
    ],
    // Simulate latency
    delayMs: 200,
  },
]);
```

## Test Orchestrator

Lightweight orchestrator for unit testing:

```typescript
import { createTestOrchestrator, createMockRunner, t } from "@directive-run/ai/testing";

const mockRunner = createMockRunner([
  { input: /analyze/, output: "Analysis: positive", tokens: 100 },
]);

const orchestrator = createTestOrchestrator({
  runner: mockRunner,
  factsSchema: {
    result: t.string(),
    confidence: t.number(),
  },
  init: (facts) => {
    facts.result = "";
    facts.confidence = 0;
  },
  constraints: {
    lowConfidence: {
      when: (facts) => facts.confidence < 0.5,
      require: { type: "RE_ANALYZE" },
    },
  },
  resolvers: {
    reAnalyze: {
      requirement: "RE_ANALYZE",
      resolve: async (req, context) => {
        context.facts.confidence = 0.8;
      },
    },
  },
});

const agent = {
  name: "analyst",
  instructions: "You are a data analyst.",
  model: "claude-sonnet-4-5",
};

const result = await orchestrator.run(agent, "Analyze this dataset");
```

## Assertion Helpers

Verify agent behavior after a test run:

```typescript
import {
  assertAgentCalled,
  assertAgentNotCalled,
  assertTokensUsed,
  assertGuardrailPassed,
  assertGuardrailBlocked,
} from "@directive-run/ai/testing";

// Assert an agent was called with a matching input
assertAgentCalled(mockRunner, "analyst");
assertAgentCalled(mockRunner, "analyst", /analyze/);

// Assert an agent was NOT called
assertAgentNotCalled(mockRunner, "editor");

// Assert token usage within bounds
assertTokensUsed(result, { min: 50, max: 200 });

// Assert guardrail behavior
assertGuardrailPassed(result, "pii-detection");
assertGuardrailBlocked(result, "content-filter");
```

## Test Multi-Agent Orchestrator

```typescript
import {
  createTestMultiAgentOrchestrator,
  createMockRunner,
  assertMultiAgentState,
} from "@directive-run/ai/testing";

const mockRunner = createMockRunner([
  { input: /research/, output: "Research findings: ...", tokens: 150 },
  { input: /write/, output: "Draft article: ...", tokens: 200 },
]);

const orchestrator = createTestMultiAgentOrchestrator({
  agents: {
    researcher: { name: "researcher", instructions: "Research.", model: "claude-sonnet-4-5" },
    writer: { name: "writer", instructions: "Write.", model: "claude-sonnet-4-5" },
  },
  patterns: {
    pipeline: sequential(["researcher", "writer"]),
  },
  runner: mockRunner,
});

orchestrator.start();
const result = await orchestrator.runPattern("pipeline", "Write about AI");

// Assert multi-agent state
assertMultiAgentState(orchestrator, {
  completedAgents: ["researcher", "writer"],
  activePattern: null,
});

assertAgentCalled(mockRunner, "researcher");
assertAgentCalled(mockRunner, "writer");
```

## Simulators

Simulate specific conditions for testing edge cases:

```typescript
import { createErrorSimulator, createLatencySimulator } from "@directive-run/ai/testing";

// Simulate errors on specific calls
const errorRunner = createErrorSimulator(baseRunner, {
  failOnCall: [2, 5],     // Fail on 2nd and 5th calls
  error: new Error("Rate limit exceeded"),
});

// Simulate variable latency
const slowRunner = createLatencySimulator(baseRunner, {
  minDelay: 100,
  maxDelay: 2000,
  distribution: "normal", // "uniform" | "normal"
});
```

---

## Evaluation Framework

Measure and gate AI output quality with structured evaluations.

### Built-In Criteria

10+ evaluation criteria available out of the box:

```typescript
import { createEvaluator, criteria } from "@directive-run/ai/testing";

const evaluator = createEvaluator({
  criteria: [
    criteria.relevance(),        // Is the output relevant to the input?
    criteria.coherence(),        // Is the output logically coherent?
    criteria.completeness(),     // Does it fully address the prompt?
    criteria.accuracy(),         // Is the information correct?
    criteria.conciseness(),      // Is it free of unnecessary content?
    criteria.helpfulness(),      // Is it useful to the user?
    criteria.harmlessness(),     // Is it free of harmful content?
    criteria.factuality(),       // Are claims factually supported?
    criteria.creativity(),       // Does it show original thinking?
    criteria.instructionFollow(),// Does it follow the prompt instructions?
  ],
});
```

### Custom Criteria

```typescript
const evaluator = createEvaluator({
  criteria: [
    {
      name: "code-quality",
      description: "Does the output contain valid, well-structured code?",
      scorer: (input, output) => {
        const hasCode = output.includes("function") || output.includes("const ");
        const hasExplanation = output.length > 100;

        if (hasCode && hasExplanation) {
          return { score: 1.0, reason: "Contains code with explanation" };
        }
        if (hasCode) {
          return { score: 0.7, reason: "Code present but no explanation" };
        }

        return { score: 0.2, reason: "No code block found" };
      },
    },
  ],
});
```

### Anti-Pattern #32: Side effects in evaluator scorer

```typescript
// WRONG — scorers must be pure functions
{
  name: "quality",
  scorer: (input, output) => {
    // Side effects: writing files, calling APIs, mutating state
    fs.writeFileSync("eval.log", output);
    metrics.increment("evals");

    return { score: 0.8, reason: "OK" };
  },
}

// CORRECT — scorers are pure, return score + reason only
{
  name: "quality",
  scorer: (input, output) => {
    const wordCount = output.split(/\s+/).length;
    const isDetailed = wordCount > 50;

    return {
      score: isDetailed ? 1.0 : 0.5,
      reason: isDetailed ? "Detailed response" : "Too brief",
    };
  },
}
```

### LLM-as-Judge

Use an LLM to evaluate output quality:

```typescript
import { createLLMJudge } from "@directive-run/ai/testing";

const judge = createLLMJudge({
  runner,
  model: "claude-sonnet-4-5",
  criteria: ["relevance", "accuracy", "completeness"],
  rubric: `
    Score 1.0: Fully addresses the prompt with accurate, complete information.
    Score 0.7: Mostly accurate but missing some details.
    Score 0.3: Partially relevant, significant gaps.
    Score 0.0: Irrelevant or incorrect.
  `,
});

const evalResult = await judge.evaluate({
  input: "Explain quantum computing",
  output: agentOutput,
  reference: "Optional reference answer for comparison",
});

console.log(evalResult.score);   // 0.85
console.log(evalResult.reason);  // "Accurate explanation with good examples..."
```

### Dataset-Driven Evaluation

Run evaluations against a dataset for regression testing:

```typescript
import { createEvaluationSuite } from "@directive-run/ai/testing";

const suite = createEvaluationSuite({
  evaluator,
  dataset: [
    {
      input: "What is TypeScript?",
      expectedOutput: "TypeScript is a typed superset of JavaScript...",
      tags: ["basics"],
    },
    {
      input: "Explain monads",
      expectedOutput: "A monad is a design pattern...",
      tags: ["advanced"],
    },
  ],
});

const report = await suite.run(agent, runner);

console.log(report.averageScore);    // 0.82
console.log(report.passRate);        // 0.90 (90% above threshold)
console.log(report.failedCases);     // Cases that scored below threshold
```

### CI Quality Gates

Fail CI pipelines when quality drops below a threshold:

```typescript
const report = await suite.run(agent, runner);

// Threshold-based gate
if (report.averageScore < 0.75) {
  console.error(`Quality gate failed: ${report.averageScore} < 0.75`);
  process.exit(1);
}

// Per-criteria gates
for (const criterion of report.criteria) {
  if (criterion.averageScore < 0.6) {
    console.error(`${criterion.name} failed: ${criterion.averageScore}`);
    process.exit(1);
  }
}
```

## Quick Reference

| API | Import Path | Purpose |
|---|---|---|
| `createMockRunner` | `@directive-run/ai/testing` | Deterministic test runner |
| `createTestOrchestrator` | `@directive-run/ai/testing` | Lightweight test orchestrator |
| `createTestMultiAgentOrchestrator` | `@directive-run/ai/testing` | Multi-agent test orchestrator |
| `assertAgentCalled` | `@directive-run/ai/testing` | Verify agent was invoked |
| `assertMultiAgentState` | `@directive-run/ai/testing` | Verify multi-agent state |
| `createEvaluator` | `@directive-run/ai/testing` | Rule-based evaluation |
| `createLLMJudge` | `@directive-run/ai/testing` | LLM-as-judge evaluation |
| `createEvaluationSuite` | `@directive-run/ai/testing` | Dataset-driven evaluation |
| `createErrorSimulator` | `@directive-run/ai/testing` | Simulate failures |
| `createLatencySimulator` | `@directive-run/ai/testing` | Simulate latency |
