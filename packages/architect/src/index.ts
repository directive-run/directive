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
export { createAIArchitect } from "./architect.js";

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
  ArchitectEventType,
  ArchitectEventListener,
  // Audit
  AuditEntry,
  AuditQuery,
  // Rollback
  RollbackEntry,
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
  WhatIfOptions,
  WhatIfResult,
  WhatIfStep,
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
} from "./types.js";

// Sandbox (for advanced use / custom tool development)
export { staticAnalysis, compileSandboxed, SandboxError } from "./sandbox.js";

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

// Service Hooks
export { wireServiceHooks, type WireServiceHooksOptions } from "./service.js";

// Testing utilities
export {
  mockRunner,
  createTestArchitect,
  assertAnalysisActions,
  assertActionTool,
  assertApproved,
  assertKilled,
  assertBudgetWithin,
  type MockRunnerResponse,
  type TestArchitectOptions,
  type TestArchitectResult,
} from "./testing.js";
