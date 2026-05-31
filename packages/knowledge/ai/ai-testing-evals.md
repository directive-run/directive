# AI testing and evaluations

Mock runners, test orchestrators, snapshot helpers, simulators, and a dataset-driven evaluation framework. Import all testing utilities from `@directive-run/ai/testing`; eval criteria factories come from `@directive-run/ai/evals`.

## Decision tree

```
What are you testing?
├── Single-agent runs (unit/integration) → createTestOrchestrator
├── Multi-agent patterns                  → createTestMultiAgentOrchestrator
├── Just the runner contract              → createMockAgentRunner
├── Approval workflow                     → createApprovalSimulator (built into createTestOrchestrator)
├── Breakpoint pauses                     → createBreakpointSimulator
├── DAG topology                          → createTestDag + assertDagExecution
├── Failure modes (timeouts, errors)      → createFailingRunner
├── Snapshot constraint behavior          → createConstraintRecorder
└── Time-dependent logic                  → createTimeController

What are you evaluating?
├── Output quality                       → createEvalSuite + eval* criteria
├── Token / latency budgets              → evalCost + evalLatency
├── Output shape / size                  → evalOutputLength + evalStructure
├── Safety / PII                         → evalSafety
├── Reference match                      → evalMatch
├── Faithfulness / relevance / coherence → evalFaithfulness / evalRelevance / evalCoherence
├── LLM-as-judge                          → evalJudge
└── Custom assertion                     → evalAssert
```

## Mock runner

`createMockAgentRunner` returns `{ run, getCalls, getCallsFor, clearCalls, setResponse, setDefaultResponse }`. The factory takes a SINGLE options object — responses are keyed by **agent name**, NOT input pattern. (For input-pattern matching, use `generate` inside a response.) **The function is named `createMockAgentRunner`, not `createMockRunner`**.

```typescript
import { createMockAgentRunner } from "@directive-run/ai/testing";

const mock = createMockAgentRunner({
  responses: {
    analyst: { output: "Analysis: positive trend", totalTokens: 100 },
    writer:  { output: "Draft article…",            totalTokens: 200, delay: 50 },
    failing: { output: "n/a", error: new Error("simulated 503") },
  },
  defaultResponse: { output: "mock response", totalTokens: 10 },
  recordCalls: true,
});

const orchestrator = createAgentOrchestrator({ runner: mock.run });

await orchestrator.run({ name: "analyst", instructions: "…", model: "x" }, "Analyze this");

mock.getCalls();                // RecordedCall[] — every recorded run
mock.getCallsFor("analyst");    // RecordedCall[] — only this agent
mock.setResponse("analyst", { output: "different reply", totalTokens: 80 });
mock.clearCalls();
```

For dynamic responses keyed on input, use the `generate` callback inside the config:

```typescript
const mock = createMockAgentRunner({
  responses: {
    classifier: {
      output: "fallback",
      totalTokens: 10,
      generate: (input) => /summarize/i.test(input)
        ? { output: "Summary: …", totalTokens: 50 }
        : { output: "Default reply", totalTokens: 10 },
    },
  },
});
```

## Test orchestrator

`createTestOrchestrator` extends `AgentOrchestrator` with mock-runner wiring, an approval simulator, and call recording. Pass `mockResponses` and Directive constraints/resolvers exactly as you would to the production factory.

```typescript
import { createTestOrchestrator } from "@directive-run/ai/testing";
import { t } from "@directive-run/core";

const test = createTestOrchestrator({
  mockResponses: {
    analyst: { output: "Analysis: positive trend", totalTokens: 100 },
  },
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
      requirement: (r): r is { type: "RE_ANALYZE" } => r.type === "RE_ANALYZE",
      resolve: async (req, context) => { context.facts.confidence = 0.8; },
    },
  },
});

const result = await test.run({ name: "analyst", instructions: "…", model: "x" }, "Analyze");

test.getCalls();             // RecordedCall[]
test.getApprovalRequests();  // ApprovalRequest[] from the built-in simulator
test.mockRunner;             // the underlying MockAgentRunner
test.approvalSimulator;      // the built-in ApprovalSimulator
test.resetAll();             // reset orchestrator + clear calls + clear approvals
```

## Test multi-agent orchestrator

```typescript
import {
  createTestMultiAgentOrchestrator,
  createMockAgentRunner,
  assertMultiAgentState,
} from "@directive-run/ai/testing";
import { sequential } from "@directive-run/ai/multi-agent";

const mock = createMockAgentRunner({
  responses: {
    researcher: { output: "research notes", totalTokens: 150 },
    writer:     { output: "draft article", totalTokens: 200 },
  },
});

const orch = createTestMultiAgentOrchestrator({
  agents: {
    researcher: { name: "researcher", instructions: "research", model: "x" },
    writer:     { name: "writer",     instructions: "write",    model: "x" },
  },
  patterns: {
    pipeline: sequential(["researcher", "writer"]),
  },
  runner: mock.run,
});

orch.start();
await orch.runPattern("pipeline", "Write about AI");

assertMultiAgentState(orch, {
  status: "completed",
});
```

## Snapshot / introspection helpers

| Helper | Purpose |
|---|---|
| `createConstraintRecorder()` | Records every constraint evaluation as a `ConstraintSnapshot`; pair with `assertOrchestratorState`. |
| `assertOrchestratorState(orch, expected)` | Diffs facts, status, and constraint state against an expected shape. |
| `assertMultiAgentState(orch, expected)` | Same shape, for multi-agent. |
| `assertScratchpadState(orch, expected)` | Checks the multi-agent scratchpad contents. |
| `assertDerivedValues(orch, expected)` | Diffs derivation values. |
| `assertTimelineEvents(timeline, expected)` | Asserts a sequence of timeline event types/payloads. |
| `assertDagExecution(events, expected)` | Asserts DAG node execution order. |
| `assertBreakpointHit(events, expected)` | Asserts a breakpoint was hit with given metadata. |
| `assertRerouted(events, expected)` | Asserts a self-healing reroute fired (when configured). |
| `assertAgentHealth(monitor, agentId, expected)` | Asserts a health score range / passing failed counts. |
| `assertCheckpoint(cp, expected)` | Asserts checkpoint shape (state version, conversation length, etc.). |
| `assertMultiplexedStream(stream, expected)` | Asserts a multiplexed stream produced expected per-agent chunks. |

There is no `assertAgentCalled` / `assertAgentNotCalled` / `assertTokensUsed` / `assertGuardrailPassed` / `assertGuardrailBlocked` — those don't exist. Use `mock.getCalls()` + `expect()` from your test framework, and inspect `result.tokenUsage` and `result.guardrailEvents` directly.

```typescript
import { expect } from "vitest";

const calls = mock.getCallsFor("analyst");
expect(calls).toHaveLength(1);
expect(calls[0].input).toMatch(/analyze/i);

expect(result.tokenUsage).toBeLessThan(500);
```

## Simulators

```typescript
import {
  createFailingRunner,
  createApprovalSimulator,
  createBreakpointSimulator,
  createTimeController,
  createTestCheckpointStore,
  createTestReflectionEvaluator,
  createTestEmbedder,
} from "@directive-run/ai/testing";
```

### `createFailingRunner(error?, options?)`

Returns an `AgentRunner` that throws (or fails after N successes). Replaces the imagined `createErrorSimulator` / `createLatencySimulator`.

```typescript
const failing = createFailingRunner(new Error("rate_limit"), {
  delay: 100,
  failAfter: 2, // first 2 calls succeed, then it starts throwing
});

const orchestrator = createAgentOrchestrator({
  runner: failing,
  selfHealing: { fallbackRunners: [backupRunner] },
});
```

For latency-only simulation, set `delay` on a `MockAgentConfig`:

```typescript
const slow = createMockAgentRunner({
  responses: { writer: { output: "slow reply", totalTokens: 50, delay: 800 } },
});
```

### `createApprovalSimulator(options?)`

Drives the approval workflow deterministically — auto-approve, auto-reject, or queue.

```typescript
const sim = createApprovalSimulator({ defaultAction: "approve" });

const orchestrator = createAgentOrchestrator({
  runner,
  autoApproveToolCalls: false,
  onApprovalRequest: (req) => sim.handle(req),
});

const requests = sim.getRequests();
sim.clearRequests();
```

### `createBreakpointSimulator(options?)`

Resolves breakpoints automatically, with optional modifications. Pair with the orchestrator's `breakpoints:` config.

### `createTimeController(startTime?)`

Drives `Date.now()` and `setTimeout` deterministically — required when testing budget windows, retry backoffs, or memory expiry.

### `createTestCheckpointStore()`

In-memory checkpoint store for round-tripping `checkpoint()` + `restore()` without disk IO.

### `createTestReflectionEvaluator(options?)`

Deterministic evaluator for `reflect()` patterns — scores can be hard-coded per iteration.

### `createTestEmbedder()`

Deterministic embedder (no network calls) for `createSemanticCache` testing.

## Evaluation framework

`createEvalSuite` runs a dataset of test cases through one or more agents, scores each output with one or more `EvalCriterion`, and returns aggregate results. Criteria are NOT a `criteria.*()` namespace — they're top-level `eval*` factories.

```typescript
import {
  createEvalSuite,
  evalCost,
  evalLatency,
  evalOutputLength,
  evalSafety,
  evalStructure,
  evalMatch,
  evalJudge,
  evalFaithfulness,
  evalRelevance,
  evalCoherence,
  evalAssert,
} from "@directive-run/ai/evals";

const suite = createEvalSuite({
  agents: [analystAgent, writerAgent],
  runner,
  dataset: [
    { id: "ts-basics",   input: "What is TypeScript?",   expected: "TypeScript is…",       tags: ["basics"] },
    { id: "monads",      input: "Explain monads",         expected: "A monad is…",         tags: ["advanced"] },
    { id: "ssr-tradeoffs", input: "Server vs client rendering", expected: "Tradeoffs…",    tags: ["advanced"] },
  ],
  criteria: {
    cost:      evalCost({ maxTokensPerRun: 500 }),
    latency:   evalLatency({ maxMs: 5000 }),
    safety:    evalSafety(),
    relevance: evalRelevance({ embedder: embedderFn, minSimilarity: 0.7 }),
    judge:     evalJudge({ runner, judge: judgeAgent }),
  },
  concurrency: 4,
  onCaseComplete: (caseResult) => console.log(`✓ ${caseResult.caseId} — ${caseResult.score.toFixed(2)}`),
});

const results = await suite.run();

console.log(results.summary.averageScore);  // 0.82
console.log(results.summary.passRate);      // 0.90
console.log(results.cases);                 // EvalCaseResult[]
console.log(results.agentSummaries);        // EvalAgentSummary[] (per-agent breakdown)
console.log(results.totalTokens, results.durationMs);
```

### Custom criterion

A criterion is `{ name, fn, threshold?, weight? }` where `fn` returns `{ score, passed?, reason?, durationMs? }`. **Scorers must be pure** — no side effects.

```typescript
const codeQuality = {
  name: "code-quality",
  threshold: 0.6,
  weight: 1.0,
  fn: (ctx) => {
    const start = Date.now();
    const output = String(ctx.result.output);
    const hasCode = /\b(function|const|class)\b/.test(output);
    const hasExplanation = output.length > 100;

    const score = hasCode && hasExplanation ? 1.0 : hasCode ? 0.7 : 0.2;
    return {
      score,
      passed: score >= 0.6,
      reason: hasCode && hasExplanation ? "code with explanation"
            : hasCode ? "code only"
            : "no code",
      durationMs: Date.now() - start,
    };
  },
};

const suite = createEvalSuite({
  agents: [coderAgent],
  runner,
  dataset,
  criteria: { codeQuality },
});
```

### LLM-as-judge

```typescript
import { evalJudge } from "@directive-run/ai/evals";

const judge = evalJudge({
  runner,                     // any AgentRunner — typically a smaller/cheaper model
  judge: judgeAgent,          // the AgentLike to invoke
  promptTemplate: `…`,        // optional — defaults to a JSON-output rubric
  timeoutMs: 30_000,
});
```

The judge returns `{ score: number, reason?: string }` parsed from JSON. The default prompt enforces "Respond with ONLY a JSON object: …" — override `promptTemplate` if you need a different rubric.

### CI quality gates

```typescript
const results = await suite.run();

if (results.summary.averageScore < 0.75) {
  console.error(`Quality gate failed: ${results.summary.averageScore} < 0.75`);
  process.exit(1);
}

for (const [criterionName, summary] of Object.entries(results.summary.byCriterion)) {
  if (summary.averageScore < 0.6) {
    console.error(`${criterionName} regressed: ${summary.averageScore}`);
    process.exit(1);
  }
}
```

## Anti-patterns

### Calling `createMockRunner` (singular, with input-pattern array)

```typescript
// WRONG — createMockRunner does not exist; the array-pattern form does not exist
createMockRunner([{ input: /analyze/, output: "…" }])

// CORRECT — keyed by agent name
createMockAgentRunner({
  responses: { analyst: { output: "…", totalTokens: 100 } },
})
```

### Importing hallucinated assertions

```typescript
// WRONG — none of these exist
import {
  assertAgentCalled,
  assertAgentNotCalled,
  assertTokensUsed,
  assertGuardrailPassed,
  assertGuardrailBlocked,
} from "@directive-run/ai/testing";

// CORRECT — use the mock's recorder + your test framework's assertions
const calls = mock.getCallsFor("analyst");
expect(calls).toHaveLength(1);
expect(result.tokenUsage).toBeLessThan(200);
```

### Importing `createEvaluator`, `criteria.*()`, `createLLMJudge`, `createEvaluationSuite`

```typescript
// WRONG — these are all hallucinated names
import { createEvaluator, criteria, createLLMJudge, createEvaluationSuite } from "@directive-run/ai/testing";
const evaluator = createEvaluator({ criteria: [criteria.relevance(), criteria.coherence()] });
const judge = createLLMJudge({ runner, model: "…", criteria: ["accuracy"], rubric: "…" });

// CORRECT — top-level eval factories + createEvalSuite
import { createEvalSuite, evalRelevance, evalCoherence, evalJudge } from "@directive-run/ai/evals";
const suite = createEvalSuite({
  agents: [agent],
  runner,
  dataset,
  criteria: {
    relevance: evalRelevance({ embedder, minSimilarity: 0.7 }),
    coherence: evalCoherence({ embedder, minSimilarity: 0.5 }),
    judge:     evalJudge({ runner, judge: judgeAgent }),
  },
});
```

### Importing `createErrorSimulator` / `createLatencySimulator`

```typescript
// WRONG — neither exists
import { createErrorSimulator, createLatencySimulator } from "@directive-run/ai/testing";

// CORRECT — createFailingRunner for errors; delay in MockAgentConfig for latency
import { createFailingRunner, createMockAgentRunner } from "@directive-run/ai/testing";
const failing = createFailingRunner(new Error("503"), { failAfter: 2, delay: 100 });
const slow = createMockAgentRunner({ responses: { writer: { output: "…", delay: 800 } } });
```

### Side-effecting scorers

```typescript
// WRONG — scorers run inside the eval suite and must be pure
{
  name: "quality",
  fn: (ctx) => {
    fs.writeFileSync("eval.log", String(ctx.result.output)); // ← side effect
    metrics.increment("evals");                                // ← side effect
    return { score: 0.8 };
  },
}

// CORRECT — log/metrics in onCaseComplete or after suite.run()
const suite = createEvalSuite({
  …,
  onCaseComplete: (caseResult) => {
    metrics.increment("evals");
    fs.appendFileSync("eval.log", JSON.stringify(caseResult) + "\n");
  },
});
```

## Quick reference

| API | Import path | Purpose |
|---|---|---|
| `createMockAgentRunner` | `@directive-run/ai/testing` | Deterministic mock runner with call recording |
| `createTestOrchestrator` | `@directive-run/ai/testing` | Single-agent orchestrator with mock + approval simulator |
| `createTestMultiAgentOrchestrator` | `@directive-run/ai/testing` | Multi-agent orchestrator wired to a mock runner |
| `createFailingRunner` | `@directive-run/ai/testing` | Runner that throws (or fails after N successes) |
| `createApprovalSimulator` | `@directive-run/ai/testing` | Deterministic approve/reject driver |
| `createBreakpointSimulator` | `@directive-run/ai/testing` | Deterministic breakpoint resolver |
| `createTimeController` | `@directive-run/ai/testing` | Virtual clock for budgets / backoffs / TTLs |
| `createTestCheckpointStore` | `@directive-run/ai/testing` | In-memory checkpoint store |
| `createTestReflectionEvaluator` | `@directive-run/ai/testing` | Deterministic evaluator for `reflect()` |
| `createTestEmbedder` | `@directive-run/ai/testing` | Deterministic embedder for cache tests |
| `assertOrchestratorState` / `assertMultiAgentState` / `assertScratchpadState` / `assertDerivedValues` / `assertTimelineEvents` / `assertDagExecution` / `assertBreakpointHit` / `assertRerouted` / `assertAgentHealth` / `assertCheckpoint` / `assertMultiplexedStream` | `@directive-run/ai/testing` | State/topology/event assertions |
| `createEvalSuite` | `@directive-run/ai/evals` | Dataset-driven multi-criterion eval runner |
| `evalCost` / `evalLatency` / `evalOutputLength` / `evalSafety` / `evalStructure` / `evalMatch` / `evalJudge` / `evalFaithfulness` / `evalRelevance` / `evalCoherence` / `evalAssert` | `@directive-run/ai/evals` | Built-in criterion factories |
