# API Reference — @directive-run/architect

## Table of Contents

- [Core](#core)
  - [createAIArchitect](#createaiarchitect)
  - [parseInterval](#parseinterval)
- [Adaptive Context](#adaptive-context)
  - [createHealthTrend](#createhealthtrend)
  - [buildAdaptiveContext](#buildadaptivecontext)
- [Audit](#audit)
  - [createAuditLog](#createauditlog)
- [Custom Tools](#custom-tools)
  - [createCustomToolRegistry](#createcustomtoolregistry)
- [Discovery](#discovery)
  - [createDiscoverySession](#creatediscoverysession)
- [Fallback](#fallback)
  - [cachedResponseStrategy](#cachedresponsestrategy)
  - [heuristicStrategy](#heuristicstrategy)
  - [blockStrategy](#blockstrategy)
  - [runFallback](#runfallback)
- [Federation](#federation)
  - [exportPattern](#exportpattern)
  - [importPattern](#importpattern)
- [Graph](#graph)
  - [extractSystemGraph](#extractsystemgraph)
- [Hash](#hash)
  - [fnv1a](#fnv1a)
- [Health](#health)
  - [computeHealthScore](#computehealthscore)
  - [analyzeGraph](#analyzegraph)
- [Kill Switch](#kill-switch)
  - [killAll](#killall)
- [Metrics](#metrics)
  - [createNoopMetrics](#createnoopmetrics)
- [Outcomes](#outcomes)
  - [createOutcomeTracker](#createoutcometracker)
- [Persistence](#persistence)
  - [createInMemoryAuditStore](#createinmemoryauditstore)
  - [createInMemoryCheckpointStore](#createinmemorycheckpointstore)
- [Policies](#policies)
  - [evaluatePolicies](#evaluatepolicies)
  - [getBlockingViolation](#getblockingviolation)
  - [requiresApprovalOverride](#requiresapprovaloverride)
  - [maxConstraintsPerHour](#maxconstraintsperhour)
  - [protectFactKeys](#protectfactkeys)
  - [requireApprovalAboveRisk](#requireapprovalaboverisk)
- [Replay](#replay)
  - [createReplayRecorder](#createreplayrecorder)
  - [replayWithArchitect](#replaywitharchitect)
- [Sandbox](#sandbox)
  - [staticAnalysis](#staticanalysis)
  - [compileSandboxed](#compilesandboxed)
  - [createWorkerSandbox](#createworkersandbox)
- [Service](#service)
  - [executeWithRetry](#executewithretry)
  - [wireServiceHooks](#wireservicehooks)
- [Templates](#templates)
  - [createTemplateRegistry](#createtemplateregistry)
  - [BUILT_IN_TEMPLATES](#built_in_templates)
- [Testing](#testing)
  - [mockRunner](#mockrunner)
  - [createTestArchitect](#createtestarchitect)
  - [createTestSystem](#createtestsystem)
  - [Assertion Helpers](#assertion-helpers)
- [Configuration Reference](#configuration-reference)
- [Event Reference](#event-reference)
- [Tool Reference](#tool-reference)

---

## Core

### createAIArchitect

```typescript
function createAIArchitect(options: AIArchitectOptions): AIArchitect
```

Main factory. Creates an AI Architect that observes and modifies a Directive system. One architect per system (mutex enforced).

See [Configuration Reference](#configuration-reference) for `AIArchitectOptions`.

**Returns:** `AIArchitect` instance with methods:

| Method | Returns | Description |
|--------|---------|-------------|
| `analyze(prompt?, options?)` | `Promise<ArchitectAnalysis>` | Trigger an analysis cycle |
| `approve(actionId)` | `Promise<boolean>` | Approve a pending action |
| `reject(actionId)` | `Promise<boolean>` | Reject a pending action |
| `rollback(actionId)` | `RollbackResult` | Undo an applied action |
| `previewRollback(actionId)` | `RollbackPreview \| null` | Preview what rollback would do |
| `rollbackBatch(actionIds)` | `RollbackBatchResult` | Atomically rollback multiple actions |
| `toSource(actionId)` | `string \| null` | Export action code for copy-paste |
| `kill()` | `KillResult` | Remove ALL AI definitions immediately |
| `resetBudget()` | `void` | Reset budget counters |
| `getActiveDefinitions()` | `ActiveDefinition[]` | List active AI-created definitions |
| `on(listener)` | `() => void` | Subscribe to all events |
| `on(type, listener)` | `() => void` | Subscribe to specific event type |
| `getAuditLog(query?)` | `AuditEntry[]` | Query audit trail |
| `getPendingApprovals()` | `ArchitectAction[]` | Get pending approval requests |
| `getRollbackEntries()` | `RollbackEntry[]` | Get rollback-capable entries |
| `getBudgetUsage()` | `BudgetUsage` | Get current budget consumption |
| `discover(options?)` | `DiscoverySession` | Start a discovery session |
| `whatIf(action, options?)` | `Promise<WhatIfResult>` | Simulate an action |
| `graph(options?)` | `SystemGraph` | Extract constraint graph |
| `record()` | `ReplayRecorder` | Create a replay recorder |
| `exportPattern(actionId, options?)` | `FederationExport \| null` | Export action as pattern |
| `importPattern(pattern)` | `Promise<FederationImportResult>` | Import a federated pattern |
| `getOutcomes()` | `ActionOutcome[]` | Get recorded outcomes |
| `getOutcomePatterns()` | `OutcomePattern[]` | Get aggregated outcome patterns |
| `registerTool(def)` | `void` | Register a custom tool |
| `unregisterTool(name)` | `boolean` | Unregister a custom tool |
| `status()` | `ArchitectStatus` | Get architect status summary |
| `destroy()` | `void` | Stop the architect |

### parseInterval

```typescript
function parseInterval(interval: string): number
```

Parse a human-readable interval string (`"30s"`, `"5m"`, `"1h"`, `"1d"`) into milliseconds.

---

## Adaptive Context

Enrich LLM prompts with outcome history and health trends.

### createHealthTrend

```typescript
function createHealthTrend(maxSamples?: number): HealthTrend
```

Create a health trend tracker. Records scores over time and determines direction.

**`HealthTrend`** interface:

| Method | Returns | Description |
|--------|---------|-------------|
| `record(score)` | `void` | Record a health score sample |
| `getSamples()` | `Array<{ score, timestamp }>` | Get all samples |
| `direction()` | `"improving" \| "declining" \| "stable"` | Get trend direction |
| `formatForPrompt()` | `string` | Format for LLM prompt |

### buildAdaptiveContext

```typescript
function buildAdaptiveContext(data: AdaptiveContextData, config?: AdaptiveContextConfig): string
```

Build a markdown string of learning context for LLM prompt injection. Includes outcomes, patterns, health trend, template stats, and guidance.

---

## Audit

### createAuditLog

```typescript
function createAuditLog(options?: { maxEntries?: number }): AuditLog
```

Create a hash-chained append-only audit log. Ring buffer caps at `maxEntries` (default: 1000).

**`AuditLog`** interface:

| Method | Returns | Description |
|--------|---------|-------------|
| `append(opts)` | `AuditEntry` | Append an entry |
| `query(query?)` | `AuditEntry[]` | Filter entries |
| `get(id)` | `AuditEntry \| undefined` | Get entry by ID |
| `verify()` | `boolean` | Verify hash chain integrity |
| `markRolledBack(id)` | `void` | Mark an entry as rolled back |
| `count()` | `number` | Total entry count |

---

## Custom Tools

### createCustomToolRegistry

```typescript
function createCustomToolRegistry(maxTools?: number, handlerTimeout?: number): CustomToolRegistry
```

Create a registry for user-defined tools. Custom tools participate in the full pipeline: LLM prompt, approval, audit, rollback.

**`CustomToolDef`** shape:

```typescript
interface CustomToolDef {
  name: string;
  description: string;
  parameters: Record<string, ArchitectToolParam>;
  mutates?: boolean;
  handler: (args: Record<string, unknown>, context: CustomToolContext) => CustomToolResult | Promise<CustomToolResult>;
}
```

---

## Discovery

### createDiscoverySession

```typescript
function createDiscoverySession(
  system: System,
  runner?: AgentRunner,
  options?: DiscoveryOptions,
  onTokens?: (tokens: number) => void,
): DiscoverySession
```

Observe a running system and identify patterns suggesting missing constraints/resolvers.

**`DiscoverySession`** interface:

| Property/Method | Type | Description |
|----------------|------|-------------|
| `stop()` | `Promise<DiscoveryReport>` | Stop early and get report |
| `progress()` | `{ eventCount, patternCount, elapsedMs }` | Current progress |
| `done` | `Promise<DiscoveryReport>` | Resolves when session completes |

**`DiscoveryPattern.type`** values: `"recurring-unmet"`, `"fact-oscillation"`, `"error-cycle"`, `"idle-state"`

---

## Fallback

Graceful degradation when the LLM is unavailable.

### cachedResponseStrategy

```typescript
function cachedResponseStrategy(opts?: { maxPerTrigger?: number; maxAgeMs?: number }): FallbackStrategy
```

Replay the most recent cached LLM response for the same trigger type.

### heuristicStrategy

```typescript
function heuristicStrategy(rules: HeuristicRule[]): FallbackStrategy
```

Apply deterministic rules when the LLM is unavailable. Rules checked in order — first match wins.

### blockStrategy

```typescript
function blockStrategy(): FallbackStrategy
```

Block all actions (safest fallback). Returns empty tool calls.

### runFallback

```typescript
function runFallback(strategies: FallbackStrategy[], context: FallbackContext): FallbackResult | null
```

Try strategies in order until one handles the failure.

---

## Federation

Export and import anonymized patterns across systems.

### exportPattern

```typescript
function exportPattern(action: ArchitectAction, options?: ExportPatternOptions): FederationExport
```

Export an applied action as a shareable, anonymized pattern with FNV-1a hash.

### importPattern

```typescript
async function importPattern(pattern: FederationPattern, system: System, runner: AgentRunner): Promise<FederationImportResult>
```

Import a federated pattern by adapting it to the local system's schema via LLM.

---

## Graph

### extractSystemGraph

```typescript
function extractSystemGraph(system: System, options?: ExtractGraphOptions): SystemGraph
```

Extract a data-only graph of the system's constraints, resolvers, facts, and relationships. Render with D3, React Flow, etc.

**`SystemGraph`** shape:

```typescript
interface SystemGraph {
  nodes: GraphNode[];   // { id, type, label, aiCreated, metadata? }
  edges: GraphEdge[];   // { source, target, type, label? }
  metadata: GraphMetadata; // { nodeCount, edgeCount, aiNodeCount, extractedAt }
}
```

---

## Hash

### fnv1a

```typescript
function fnv1a(input: string): string
```

Synchronous FNV-1a hash. Returns 8-character hex string. Not cryptographic — used for audit chain integrity and federation pattern hashing.

---

## Health

### computeHealthScore

```typescript
function computeHealthScore(system: System): HealthScore
```

Compute a normalized 0-100 health score across 4 dimensions (25pts each): settled state, unmet requirements, constraint health, resolver health.

**`HealthScore`** shape:

```typescript
interface HealthScore {
  score: number;
  breakdown: { settled: number; unmetRequirements: number; constraintHealth: number; resolverHealth: number };
  warnings: string[];
}
```

### analyzeGraph

```typescript
function analyzeGraph(graph: SystemGraph): GraphAnalysis
```

Analyze a system graph for structural issues using Tarjan's SCC algorithm.

**`GraphAnalysis`** shape:

```typescript
interface GraphAnalysis {
  cycles: string[][];
  orphanConstraints: string[];
  deadResolvers: string[];
  recommendations: string[];
}
```

---

## Kill Switch

### killAll

```typescript
function killAll(system: System, dynamicIds: Set<string>): KillResult
```

Synchronously remove ALL AI-created definitions. One call, no async, no race conditions.

**`KillResult`** shape:

```typescript
interface KillResult {
  removed: number;
  definitions: Array<{ type: ArchitectDefType; id: string }>;
  timestamp: number;
}
```

---

## Metrics

### createNoopMetrics

```typescript
function createNoopMetrics(): MetricsProvider
```

No-op metrics provider — zero overhead. Used as default when no provider is configured.

**`MetricsProvider`** interface:

| Method | Description |
|--------|-------------|
| `counter(name, delta?, labels?)` | Increment a counter |
| `gauge(name, value, labels?)` | Set a gauge value |
| `histogram(name, value, labels?)` | Record a histogram value |
| `startSpan?(name, attributes?)` | Start a tracing span |
| `init?()` | Initialize provider |
| `close?()` | Flush and close |

---

## Outcomes

### createOutcomeTracker

```typescript
function createOutcomeTracker(config?: OutcomeTrackingConfig): OutcomeTracker
```

Track health impact of applied actions. Schedules health measurement after each action and aggregates patterns by tool.

**`OutcomeTrackingConfig`** shape:

```typescript
interface OutcomeTrackingConfig {
  measurementDelay?: number;  // ms before measuring health (default: 10000)
  maxOutcomes?: number;       // FIFO eviction cap (default: 200)
}
```

---

## Persistence

Pluggable audit storage and state checkpointing.

### createInMemoryAuditStore

```typescript
function createInMemoryAuditStore(maxEntries?: number): AuditStore
```

In-memory audit store with hash chain verification. Reference implementation.

### createInMemoryCheckpointStore

```typescript
function createInMemoryCheckpointStore(): CheckpointStore
```

In-memory checkpoint store holding a single checkpoint. For testing.

**`AuditStore`** interface: `append(entry)`, `query(q?)`, `count()`, `verifyChain()`, `init?()`, `close?()`

**`CheckpointStore`** interface: `save(checkpoint)`, `load()`, `init?()`, `close?()`

---

## Policies

Meta-constraints on the architect itself. Evaluated before every action is applied.

### evaluatePolicies

```typescript
function evaluatePolicies(policies: ArchitectPolicy[], context: PolicyContext): PolicyViolation[]
```

Evaluate all policies against the current context. Returns violations (empty if all pass).

### getBlockingViolation

```typescript
function getBlockingViolation(violations: PolicyViolation[]): PolicyViolation | null
```

Return the first blocking violation, or null.

### requiresApprovalOverride

```typescript
function requiresApprovalOverride(violations: PolicyViolation[]): boolean
```

Check if any violation requires approval override.

### maxConstraintsPerHour

```typescript
function maxConstraintsPerHour(n: number): ArchitectPolicy
```

Built-in policy: block creation of more than `n` constraints per hour.

### protectFactKeys

```typescript
function protectFactKeys(patterns: string[]): ArchitectPolicy
```

Built-in policy: require approval when modifying fact keys matching patterns. Supports trailing `*` glob (e.g., `"auth.*"`).

### requireApprovalAboveRisk

```typescript
function requireApprovalAboveRisk(level: "low" | "medium" | "high"): ArchitectPolicy
```

Built-in policy: require approval for actions above a given risk level.

---

## Replay

Record system events and replay with an AI architect.

### createReplayRecorder

```typescript
function createReplayRecorder(system: System): ReplayRecorder
```

Create a recorder that captures system events (fact changes, settlement changes, unmet requirements, errors).

**`ReplayRecorder`** interface: `start()`, `stop(): ReplayRecording`, `isRecording()`, `eventCount()`

### replayWithArchitect

```typescript
async function replayWithArchitect(recording: ReplayRecording, runner: AgentRunner, options?: ReplayOptions): Promise<ReplayResult>
```

Replay a recording through an AI architect. Returns original events vs. proposed architect actions.

---

## Sandbox

6-layer defense-in-depth for AI-generated code.

### staticAnalysis

```typescript
function staticAnalysis(code: string, extraBlocked?: string[], maxCodeSize?: number): StaticAnalysisResult
```

Pattern-based static analysis. Checks for blocked identifiers using word-boundary matching.

**`StaticAnalysisResult`** shape:

```typescript
interface StaticAnalysisResult {
  safe: boolean;
  violations: string[];
  warnings: string[];
}
```

### compileSandboxed

```typescript
function compileSandboxed(code: string, options?: SandboxCompileOptions): CompiledFunction
```

Compile AI-generated code into a sandboxed function with Proxy membranes and restricted scope.

### createWorkerSandbox

```typescript
function createWorkerSandbox(code: string, options?: SandboxCompileOptions): WorkerCompiledFunction
```

Worker-thread sandbox with real timeout enforcement (Node.js only). Falls back to `compileSandboxed` if `worker_threads` unavailable.

---

## Service

Route architect events to external services (Slack, Postgres, monitoring).

### executeWithRetry

```typescript
async function executeWithRetry<T>(payload: T, config: ResilientHookConfig<T>): Promise<void>
```

Execute a handler with retry logic (exponential/linear/fixed backoff). Never throws — sends to dead letter on exhaustion.

### wireServiceHooks

```typescript
function wireServiceHooks(options: WireServiceHooksOptions): () => void
```

Wire service hooks to architect events. Returns an unsubscribe function.

**`ArchitectServiceHooks`** shape:

```typescript
interface ArchitectServiceHooks {
  onAnalysis?: HookValue<ArchitectAnalysis>;
  onAction?: HookValue<ArchitectAction>;
  onError?: HookValue<Error>;
  onKill?: HookValue<KillResult>;
  onAudit?: HookValue<AuditEntry>;
}
```

---

## Templates

Pre-built pattern library for common system behaviors.

### createTemplateRegistry

```typescript
function createTemplateRegistry(customTemplates?: ConstraintTemplate[]): TemplateRegistry
```

Create a template registry with built-in and optional custom templates.

**`TemplateRegistry`** interface:

| Method | Returns | Description |
|--------|---------|-------------|
| `list()` | `ConstraintTemplate[]` | All registered templates |
| `get(id)` | `ConstraintTemplate \| undefined` | Get by ID |
| `register(template)` | `void` | Add a custom template |
| `formatForPrompt()` | `string` | Format for LLM context |
| `instantiate(id, params)` | `TemplateInstantiation \| null` | Instantiate a template |

### BUILT_IN_TEMPLATES

```typescript
const BUILT_IN_TEMPLATES: ConstraintTemplate[]
```

Built-in templates: `rate-limit`, `circuit-breaker`, `retry-backoff`, `health-check`, `cooldown`.

---

## Testing

Import from `@directive-run/architect/testing`.

### mockRunner

```typescript
function mockRunner(responses: MockRunnerResponse[]): MockAgentRunner
```

Create a mock AgentRunner. Responses consumed in order; returns empty after exhaustion. Has `.calls` array for assertions.

### createTestArchitect

```typescript
function createTestArchitect(system: System, options?: TestArchitectOptions): TestArchitectResult
```

Create an architect configured for testing (auto-approve, large budget, event collection).

**`TestArchitectResult`** shape:

```typescript
interface TestArchitectResult {
  architect: AIArchitect;
  runner: AgentRunner;
  events: Array<{ type: string; [key: string]: unknown }>;
}
```

### createTestSystem

```typescript
function createTestSystem(initialFacts?: Record<string, unknown>): TestSystem
```

Create a mock System for testing. Includes test helpers: `_emitFactChange()`, `_emitSettled()`, `_setFacts()`, `_setInspection()`.

### Assertion Helpers

| Function | Description |
|----------|-------------|
| `assertAnalysisActions(analysis, count)` | Assert action count |
| `assertActionTool(action, toolName)` | Assert tool name |
| `assertApproved(action)` | Assert approved/auto-approved |
| `assertKilled(architect)` | Assert 0 active definitions |
| `assertBudgetWithin(architect, tokens, dollars)` | Assert budget limits |
| `createTestAuditStore(maxEntries?)` | In-memory audit store for tests |
| `createTestCheckpointStore()` | In-memory checkpoint store for tests |

---

## Configuration Reference

```typescript
interface AIArchitectOptions {
  system: System;                         // Required — live Directive system
  runner: AgentRunner;                    // Required — LLM runner
  budget: ArchitectBudget;                // Required — { tokens, dollars, costPerThousandTokens? }

  preset?: ArchitectPreset;               // "observer" | "advisor" | "operator" | "autonomous"
  capabilities?: ArchitectCapabilities;   // { constraints?, resolvers?, effects?, derivations?, facts? }
  triggers?: ArchitectTriggers;           // { onError?, onUnmetRequirement?, onFactChange?, onSchedule?, onDemand?, minInterval?, onHealthDecline? }
  context?: ArchitectContext;             // { description, goals?, notes? }
  safety?: ArchitectSafety;               // { maxDefinitions?, approval?: { constraints?, resolvers?, effects?, derivations?, facts? }, sandbox?, rollback?, auditLog?, blockedPatterns?, allowedGlobals?, executionTimeout?, approvalTimeout? }
  model?: string;                         // Model override for runner
  policies?: ArchitectPolicy[];           // Meta-constraints on the architect
  serviceHooks?: ArchitectServiceHooks;   // External service integrations
  outcomeTracking?: OutcomeTrackingConfig; // { measurementDelay?, maxOutcomes? }
  customTools?: CustomToolDef[];          // Additional AI tools
  templates?: ConstraintTemplate[];       // Custom constraint templates
  adaptiveContext?: AdaptiveContextConfig; // { includeOutcomes?, includeHealthTrend?, includeTemplateStats?, maxOutcomeEntries?, customBuilder? }
  persistence?: PersistenceConfig;        // { audit?, checkpoint?, checkpointInterval? }
  fallback?: { strategies?: FallbackStrategy[], maxConsecutiveFailures? }; // LLM fallback config
  metrics?: MetricsProvider;              // Observability provider
  silent?: boolean;                       // Suppress BSL license notice
}
```

---

## Event Reference

All events extend `ArchitectEventBase` (`{ type, timestamp }`).

| Type | Interface | Key Fields |
|------|-----------|------------|
| `observing` | `ArchitectProgressEvent` | — |
| `reasoning` | `ArchitectProgressEvent` | — |
| `generating` | `ArchitectProgressEvent` | — |
| `validating` | `ArchitectProgressEvent` | — |
| `analysis-start` | `ArchitectAnalysisStartEvent` | — |
| `analysis-complete` | `ArchitectAnalysisCompleteEvent` | `analysis: ArchitectAnalysis` |
| `action` | `ArchitectActionEvent` | `action: ArchitectAction` |
| `approval-required` | `ArchitectActionEvent` | `action: ArchitectAction` |
| `approval-response` | `ArchitectActionEvent` | `action: ArchitectAction` |
| `applied` | `ArchitectActionEvent` | `action: ArchitectAction` |
| `rollback` | `ArchitectRollbackEvent` | `action?: ArchitectAction` |
| `error` | `ArchitectErrorEvent` | `error: Error`, `action?: ArchitectAction` |
| `budget-warning` | `ArchitectBudgetEvent` | `budgetUsed`, `budgetPercent` |
| `budget-exceeded` | `ArchitectBudgetEvent` | `budgetUsed`, `budgetPercent` |
| `killed` | `ArchitectKilledEvent` | `killResult: KillResult` |
| `plan-step` | `ArchitectPlanStepEvent` | `stepIndex`, `totalSteps`, `action?` |
| `reasoning-chunk` | `ArchitectReasoningChunkEvent` | `chunk`, `accumulated` |
| `policy-warning` | `ArchitectPolicyWarningEvent` | `policy`, `action` |
| `approval-timeout` | `ArchitectApprovalTimeoutEvent` | `action: ArchitectAction` |
| `fallback-activated` | `ArchitectFallbackEvent` | `strategy`, `error`, `consecutiveFailures` |
| `health-check` | `ArchitectHealthCheckEvent` | `score`, `previousScore`, `threshold`, `triggered` |

---

## Tool Reference

9 built-in LLM tools available to the AI architect.

### Read Tools

| Tool | Description | Capability |
|------|-------------|------------|
| `observe_system` | Inspect full system state (facts, constraints, resolvers, requirements) | Always |
| `read_facts` | Read current fact values | Always |
| `list_definitions` | List dynamic definitions, grouped by type | Always |
| `explain` | Explain how a requirement is being resolved | Always |

### Mutate Tools

| Tool | Description | Capability | Parameters |
|------|-------------|------------|------------|
| `create_constraint` | Register a new constraint | `constraints` | `id`, `whenCode`, `require`, `priority?` |
| `create_resolver` | Register a new resolver | `resolvers` | `id`, `requirement`, `resolveCode` |
| `create_effect` | Register a new effect | `effects` | `id`, `runCode` |
| `create_derivation` | Register a new derivation | `derivations` | `id`, `deriveCode` |
| `set_fact` | Set a fact value directly | `facts: "read-write"` | `key`, `value` |
| `remove_definition` | Remove an AI-created definition | Any mutation | `type`, `id` |
| `rollback` | Roll back a previously applied action | Any mutation | `actionId` |
