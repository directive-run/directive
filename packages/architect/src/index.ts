/**
 * @directive-run/architect — AI Architect for Directive systems.
 *
 * Let an LLM observe, reason about, and modify your constraint-driven
 * runtime system with safety guardrails, audit trails, and kill switches.
 *
 * @example
 * ```typescript
 * import { createAIArchitect } from '@directive-run/architect';
 *
 * const architect = createAIArchitect({
 *   system,
 *   runner,
 *   budget: { tokens: 50_000, dollars: 5 },
 * });
 *
 * const analysis = await architect.analyze("Why is my system stuck?");
 * ```
 *
 * @module
 */

// Main API
export { createAIArchitect, parseInterval } from "./architect.js";

// Types
export type {
  // Options & Config
  AIArchitectOptions,
  ArchitectCapabilities,
  ArchitectTriggers,
  ArchitectContext,
  ArchitectSafety,
  ArchitectBudget,
  // Instance
  AIArchitect,
  // Actions & Analysis
  ArchitectAction,
  ArchitectAnalysis,
  ActionReasoning,
  ArchitectDefType,
  // Events
  ArchitectEvent,
  ArchitectEventBase,
  ArchitectProgressEvent,
  ArchitectAnalysisStartEvent,
  ArchitectAnalysisCompleteEvent,
  ArchitectActionEvent,
  ArchitectRollbackEvent,
  ArchitectErrorEvent,
  ArchitectBudgetEvent,
  ArchitectKilledEvent,
  ArchitectPlanStepEvent,
  ArchitectReasoningChunkEvent,
  ArchitectPolicyWarningEvent,
  ArchitectApprovalTimeoutEvent,
  ArchitectFallbackEvent,
  ArchitectFeedbackEvent,
  ArchitectStoriesResolvedEvent,
  ArchitectHealthCheckEvent,
  ArchitectEventType,
  ArchitectEventListener,
  ArchitectEventMap,
  // Audit
  AuditEntry,
  AuditQuery,
  // Rollback
  RollbackEntry,
  RollbackResult,
  RollbackPreview,
  RollbackBatchResult,
  // Active Definitions
  ActiveDefinition,
  // Kill Switch
  KillResult,
  // Safety
  ApprovalLevel,
  // Sandbox
  SandboxCompileOptions,
  StaticAnalysisResult,
  // Tools
  ArchitectToolDef,
  ArchitectToolParam,
  // Discovery
  DiscoveryOptions,
  DiscoveryProgress,
  DiscoveryPattern,
  DiscoveryRecommendation,
  DiscoveryReport,
  DiscoveryTimelineEvent,
  // What-If
  WhatIfInput,
  WhatIfOptions,
  WhatIfResult,
  WhatIfStep,
  WhatIfCascade,
  WhatIfCascadeRound,
  // Graph
  SystemGraph,
  GraphNode,
  GraphEdge,
  GraphMetadata,
  // Replay
  ReplayRecording,
  ReplayEvent,
  ReplayOptions,
  ReplayResult,
  // Federation
  FederationPattern,
  FederationExport,
  FederationImportResult,
  // Service Hooks
  ArchitectServiceHooks,
  // Budget
  BudgetUsage,
  // Status
  ArchitectStatus,
  // Presets
  ArchitectPreset,
  // Policies
  ArchitectPolicy,
  PolicyContext,
} from "./types.js";

// Sandbox (for advanced use / custom tool development)
export { staticAnalysis, compileSandboxed, createWorkerSandbox, SandboxError, type WorkerCompiledFunction } from "./sandbox.js";

// Audit (for custom integrations)
export { createAuditLog, type AuditLog } from "./audit.js";

// Kill switch (for emergency external use)
export { killAll } from "./kill-switch.js";

// Discovery
export { createDiscoverySession, type DiscoverySession } from "./discovery.js";

// What-If Analysis
export { createWhatIfAnalysis } from "./what-if.js";

// Visual Constraint Graph
export { extractSystemGraph, type ExtractGraphOptions } from "./graph.js";

// Architect Replay
export {
  createReplayRecorder,
  replayWithArchitect,
  type ReplayRecorder,
} from "./replay.js";

// Federation
export { exportPattern, importPattern, type ExportPatternOptions } from "./federation.js";

// Health Scoring + Graph Analysis
export { computeHealthScore, analyzeGraph, type HealthScore, type GraphAnalysis } from "./health.js";

// Service Hooks
export {
  wireServiceHooks,
  executeWithRetry,
  type WireServiceHooksOptions,
  type ResilientHookConfig,
  type RetryPolicy,
} from "./service.js";

// Policies
export {
  evaluatePolicies,
  getBlockingViolation,
  requiresApprovalOverride,
  maxConstraintsPerHour,
  protectFactKeys,
  requireApprovalAboveRisk,
  type PolicyViolation,
} from "./policies.js";

// LLM Fallback & Degradation
export {
  cachedResponseStrategy,
  heuristicStrategy,
  blockStrategy,
  runFallback,
  type FallbackStrategy,
  type FallbackContext,
  type FallbackResult,
  type FallbackConfig,
  type HeuristicRule,
} from "./fallback.js";

// Persistence Layer
export {
  createInMemoryAuditStore,
  createInMemoryCheckpointStore,
  type AuditStore,
  type CheckpointStore,
  type ArchitectCheckpoint,
  type GuardStateSnapshot,
  type PersistenceConfig,
} from "./persistence.js";

// Outcome Tracking
export {
  createOutcomeTracker,
  type ActionOutcome,
  type OutcomeTrackingConfig,
  type OutcomePattern,
  type OutcomeTracker,
} from "./outcomes.js";

// Custom Tool Registration
export {
  createCustomToolRegistry,
  type CustomToolDef,
  type CustomToolContext,
  type CustomToolResult,
  type CustomToolRegistry,
} from "./custom-tools.js";

// Adaptive Context
export {
  createHealthTrend,
  buildAdaptiveContext,
  type HealthTrend,
  type AdaptiveContextData,
  type AdaptiveContextConfig,
} from "./adaptive-context.js";

// Constraint Templates
export {
  createTemplateRegistry,
  BUILT_IN_TEMPLATES,
  type ConstraintTemplate,
  type TemplateParameter,
  type TemplateRegistry,
  type TemplateInstantiation,
} from "./templates.js";

// Intent / Stories
export {
  resolveStories,
  mergeStoryConfig,
  type Story,
  type StructuredStory,
  type StoryResolutionOptions,
  type StoryResolutionResult,
} from "./intent.js";

// Learning / Feedback
export {
  createFeedbackStore,
  type FeedbackStore,
  type FeedbackEntry,
  type FeedbackPattern,
  type LearningConfig,
} from "./learning.js";

// Metrics & Observability
export { createNoopMetrics, type MetricsProvider, type SpanHandle } from "./metrics.js";

// Hash utility
export { fnv1a } from "./hash.js";

// Testing utilities
export {
  mockRunner,
  createTestArchitect,
  createTestSystem,
  assertAnalysisActions,
  assertActionTool,
  assertApproved,
  assertKilled,
  assertBudgetWithin,
  assertFeedbackRecorded,
  createTestStories,
  createTestAuditStore,
  createTestCheckpointStore,
  type MockRunnerResponse,
  type TestArchitectOptions,
  type TestArchitectResult,
  type TestSystem,
} from "./testing.js";
