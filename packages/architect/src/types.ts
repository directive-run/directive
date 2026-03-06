/**
 * Type definitions for AI Architect — self-modifying Directive systems.
 *
 * The AI Architect gives an LLM architectural control over a Directive
 * system: observe state, create/remove constraints and resolvers
 * at runtime with safety guardrails, audit trails, and kill switches.
 *
 * @module
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type { DiscoverySession } from "./discovery.js";

// ============================================================================
// Definition Types
// ============================================================================

export type ArchitectDefType =
  | "constraint"
  | "resolver"
  | "effect"
  | "derivation";

// ============================================================================
// Capabilities
// ============================================================================

/** Controls what the AI architect can do to the system. */
export interface ArchitectCapabilities {
  /** Can create/remove constraints. Default: true */
  constraints?: boolean;
  /** Can create/remove resolvers. Default: true */
  resolvers?: boolean;
  /** Can create/remove effects. Default: false (Phase 1 excluded) */
  effects?: boolean;
  /** Can create/remove derivations. Default: false (Phase 1 excluded) */
  derivations?: boolean;
  /**
   * Fact access level.
   * - 'read-only': Can observe facts but not mutate them directly.
   * - 'read-write': Can also set facts directly.
   * Default: 'read-only'
   */
  facts?: "read-only" | "read-write";
}

// ============================================================================
// Triggers
// ============================================================================

/** When does the AI architect analyze the system? */
export interface ArchitectTriggers {
  /** Trigger when the system encounters an error. Default: false */
  onError?: boolean;
  /** Trigger when a requirement has no matching resolver. Default: false */
  onUnmetRequirement?: boolean;
  /** Trigger when specific fact keys change. */
  onFactChange?: string[];
  /** Periodic analysis interval (e.g., '5m', '30s', '1h'). */
  onSchedule?: string;
  /** Allow manual analysis via architect.analyze(). Default: true */
  onDemand?: boolean;
  /** Minimum interval between analyses in ms. Default: 60000 (60s). */
  minInterval?: number;
}

// ============================================================================
// Context
// ============================================================================

/** What the AI knows about the system it's managing. */
export interface ArchitectContext {
  /** Human-readable description of what the system does. */
  description: string;
  /** Goals the AI should optimize for. */
  goals?: string[];
  /** Additional context strings passed to the LLM. */
  notes?: string[];
}

// ============================================================================
// Safety
// ============================================================================

/** Approval requirement level per definition type. */
export type ApprovalLevel =
  /** Always require human approval. */
  | "always"
  /** Require approval for first registration; subsequent are auto-approved. */
  | "first-time"
  /** Auto-approve all changes (use with caution). */
  | "never";

/** Safety configuration for the AI architect. */
export interface ArchitectSafety {
  /** Maximum total dynamic definitions the AI can create. Default: 50 */
  maxDefinitions?: number;

  /** Approval requirements per definition type. */
  approval?: {
    constraints?: ApprovalLevel;
    resolvers?: ApprovalLevel;
    effects?: ApprovalLevel;
    derivations?: ApprovalLevel;
  };

  /** Run AI-generated functions in a sandboxed scope. Default: true */
  sandbox?: boolean;

  /** Enable rollback of AI changes. Default: true */
  rollback?: boolean;

  /** Enable full audit logging. Default: true */
  auditLog?: boolean;

  /** Blocked patterns in AI-generated code (added to defaults). */
  blockedPatterns?: string[];

  /** Allowed global APIs in sandboxed code. Default: ['Math', 'Date', 'JSON', 'console'] */
  allowedGlobals?: string[];

  /** Execution timeout for AI-generated functions in ms. Default: 5000 */
  executionTimeout?: number;

  /** Auto-reject pending approvals after this many ms. Default: 300000 (5 min). */
  approvalTimeout?: number;
}

// ============================================================================
// Budget
// ============================================================================

/** Token and dollar budget for LLM calls. REQUIRED to prevent bill shock. */
export interface ArchitectBudget {
  /** Max tokens across all LLM calls. */
  tokens: number;
  /** Max dollar spend across all LLM calls. */
  dollars: number;
  /** C7: Cost per 1K tokens for dollar estimation. Default: 0.003 */
  costPerThousandTokens?: number;
}

// ============================================================================
// Architect Options
// ============================================================================

/** Item 23: autonomy presets. */
export type ArchitectPreset = "observer" | "advisor" | "operator" | "autonomous";

/** Configuration for createAIArchitect(). */
export interface AIArchitectOptions {
  /** The live Directive system to manage. */
  system: System;

  /** LLM runner for AI reasoning. */
  runner: AgentRunner;

  /** Token/dollar budget. REQUIRED to prevent bill shock. */
  budget: ArchitectBudget;

  /** What the AI can do. */
  capabilities?: ArchitectCapabilities;

  /** When the AI analyzes. */
  triggers?: ArchitectTriggers;

  /** System context for the AI. */
  context?: ArchitectContext;

  /** Safety configuration. */
  safety?: ArchitectSafety;

  /** Model override for the LLM runner. */
  model?: string;

  /** External service integration hooks. */
  serviceHooks?: ArchitectServiceHooks;

  /** Item 23: autonomy preset. Applied first, explicit options override. */
  preset?: ArchitectPreset;

  /** Item 33: policies — meta-constraints on the architect itself. */
  policies?: ArchitectPolicy[];
}

// ============================================================================
// Structured Reasoning
// ============================================================================

/** Structured reasoning output from the AI architect. */
export interface ActionReasoning {
  /** What triggered this analysis. */
  trigger: string;
  /** What the AI observed about the system. */
  observation: string;
  /** Why this action is the right response. */
  justification: string;
  /** What the AI expects to happen after the action. */
  expectedOutcome: string;
  /** Raw reasoning text from the LLM. */
  raw: string;
}

// ============================================================================
// Actions & Events
// ============================================================================

/** An action the AI architect wants to take. */
export interface ArchitectAction {
  /** Unique ID for this action. */
  id: string;
  /** The tool the AI called. */
  tool: string;
  /** Arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** AI's structured reasoning for this action. */
  reasoning: ActionReasoning;
  /** Confidence score 0-1 from the AI. */
  confidence: number;
  /** Risk assessment. */
  risk: "low" | "medium" | "high";
  /** The definition that was created/removed (if applicable). */
  definition?: {
    type: ArchitectDefType;
    id: string;
    code?: string;
  };
  /** M13: the original trigger that caused this action. */
  originalTrigger?: ArchitectAnalysis["trigger"];
  /** Whether this action requires human approval. */
  requiresApproval: boolean;
  /** Current approval status. */
  approvalStatus: "pending" | "approved" | "rejected" | "auto-approved";
  /** Timestamp when action was created. */
  timestamp: number;
}

/** Result of an AI analysis cycle. */
export interface ArchitectAnalysis {
  /** What triggered this analysis. */
  trigger: "error" | "unmet-requirement" | "fact-change" | "schedule" | "demand";
  /** Additional trigger context. */
  triggerContext?: string;
  /** Actions the AI decided to take. */
  actions: ArchitectAction[];
  /** Total tokens used in this analysis. */
  tokensUsed: number;
  /** Duration of the analysis in ms. */
  durationMs: number;
  /** Timestamp. */
  timestamp: number;
}

// ============================================================================
// Audit Log
// ============================================================================

/** A single entry in the architect's audit log. */
export interface AuditEntry {
  /** Unique ID. */
  id: string;
  /** Timestamp. */
  timestamp: number;
  /** What triggered this entry. */
  trigger: ArchitectAnalysis["trigger"];
  /** The tool that was called. */
  tool: string;
  /** Arguments to the tool. */
  arguments: Record<string, unknown>;
  /** AI's structured reasoning. */
  reasoning: ActionReasoning;
  /** Definition type (if applicable). */
  definitionType?: ArchitectDefType;
  /** Definition ID (if applicable). */
  definitionId?: string;
  /** The code string for generated functions. */
  code?: string;
  /** Whether approval was required. */
  approvalRequired: boolean;
  /** Whether it was approved. */
  approved: boolean;
  /** Whether the action was successfully applied. */
  applied: boolean;
  /** Error message if the action failed. */
  error?: string;
  /** Whether this action was later rolled back. */
  rolledBack?: boolean;
  /** M6: reference to original audit entry this is rolling back. */
  rollbackOf?: string;
  /** Hash of this entry for chain integrity. */
  hash: string;
  /** Hash of previous entry. null for first entry. */
  prevHash: string | null;
}

/** Query options for filtering the audit log. */
export interface AuditQuery {
  /** Filter by trigger type. */
  trigger?: ArchitectAnalysis["trigger"];
  /** Filter by definition type. */
  definitionType?: ArchitectDefType;
  /** Filter entries after this timestamp. */
  after?: number;
  /** Filter entries before this timestamp. */
  before?: number;
  /** Filter by approval status. */
  approved?: boolean;
  /** Filter by applied status. */
  applied?: boolean;
  /** Maximum number of entries to return. */
  limit?: number;
}

// ============================================================================
// Rollback
// ============================================================================

/** Info about a rollback-capable change. */
export interface RollbackEntry {
  /** The audit entry ID this rollback corresponds to. */
  auditId: string;
  /** Definition type. */
  type: ArchitectDefType;
  /** Definition ID. */
  id: string;
  /** The operation that was performed. */
  operation: "register" | "unregister";
  /** The original definition (for unregister rollbacks). */
  original?: unknown;
  /** The definition that was registered (for register rollbacks). */
  registered?: unknown;
  /** Whether this has been rolled back. */
  rolledBack: boolean;
}

/** Preview of what a rollback would do. */
export interface RollbackPreview {
  /** The action being rolled back. */
  actionId: string;
  /** What will be restored or removed. */
  operations: Array<{
    type: ArchitectDefType;
    id: string;
    action: "unregister" | "re-register";
  }>;
}

/** Result of a batch rollback. */
export interface RollbackBatchResult {
  /** Number of actions successfully rolled back. */
  succeeded: number;
  /** Number of actions that failed to roll back. */
  failed: number;
  /** Details per action. */
  results: Array<{
    actionId: string;
    success: boolean;
    error?: string;
  }>;
}

// ============================================================================
// Active Definitions
// ============================================================================

/** An AI-created definition that is currently active. */
export interface ActiveDefinition {
  /** Definition type. */
  type: ArchitectDefType;
  /** Definition ID. */
  id: string;
  /** The audit entry that created it. */
  auditId: string;
  /** When it was created. */
  createdAt: number;
  /** The source code of the definition. */
  code?: string;
}

// ============================================================================
// Kill Switch
// ============================================================================

/** Result of a kill switch activation. */
export interface KillResult {
  /** Number of definitions removed. */
  removed: number;
  /** Definitions that were removed. */
  definitions: Array<{ type: ArchitectDefType; id: string }>;
  /** Timestamp of kill. */
  timestamp: number;
}

// ============================================================================
// Events
// ============================================================================

/** Event types emitted by the architect. */
export type ArchitectEventType =
  // Progress events
  | "observing"
  | "reasoning"
  | "generating"
  | "validating"
  // Lifecycle events
  | "analysis-start"
  | "analysis-complete"
  | "action"
  | "approval-required"
  | "approval-response"
  | "applied"
  | "rollback"
  | "error"
  // Budget events
  | "budget-warning"
  | "budget-exceeded"
  // Kill switch
  | "killed"
  // Item 26: Multi-step reasoning
  | "plan-step"
  // Item 27: Streaming
  | "reasoning-chunk"
  // M4: Policy warnings (distinct from errors)
  | "policy-warning"
  // M8: Approval timeout
  | "approval-timeout";

/** Item 20: Discriminated union event types. */
export interface ArchitectEventBase {
  type: ArchitectEventType;
  timestamp: number;
}

export interface ArchitectProgressEvent extends ArchitectEventBase {
  type: "observing" | "reasoning" | "generating" | "validating";
}

export interface ArchitectAnalysisStartEvent extends ArchitectEventBase {
  type: "analysis-start";
}

export interface ArchitectAnalysisCompleteEvent extends ArchitectEventBase {
  type: "analysis-complete";
  analysis: ArchitectAnalysis;
}

export interface ArchitectActionEvent extends ArchitectEventBase {
  type: "action" | "approval-required" | "approval-response" | "applied";
  action: ArchitectAction;
}

export interface ArchitectRollbackEvent extends ArchitectEventBase {
  type: "rollback";
  action?: ArchitectAction;
}

export interface ArchitectErrorEvent extends ArchitectEventBase {
  type: "error";
  error: Error;
  action?: ArchitectAction;
}

export interface ArchitectBudgetEvent extends ArchitectEventBase {
  type: "budget-warning" | "budget-exceeded";
  budgetUsed: { tokens: number; dollars: number };
  budgetPercent: number;
}

export interface ArchitectKilledEvent extends ArchitectEventBase {
  type: "killed";
  killResult: KillResult;
}

/** Item 26: Plan step event for multi-step reasoning. */
export interface ArchitectPlanStepEvent extends ArchitectEventBase {
  type: "plan-step";
  stepIndex: number;
  totalSteps: number;
  action?: ArchitectAction;
}

/** Item 27: Streaming reasoning chunk event. */
export interface ArchitectReasoningChunkEvent extends ArchitectEventBase {
  type: "reasoning-chunk";
  chunk: string;
  accumulated: string;
}

/** M4: Policy warning event — distinct from errors for non-blocking policy violations. */
export interface ArchitectPolicyWarningEvent extends ArchitectEventBase {
  type: "policy-warning";
  policy: ArchitectPolicy;
  action: ArchitectAction;
}

/** M8: Approval timeout event — emitted before auto-rejection. */
export interface ArchitectApprovalTimeoutEvent extends ArchitectEventBase {
  type: "approval-timeout";
  action: ArchitectAction;
}

/** Discriminated union of all event types. Backward-compatible — consumers already switch on event.type. */
export type ArchitectEvent =
  | ArchitectProgressEvent
  | ArchitectAnalysisStartEvent
  | ArchitectAnalysisCompleteEvent
  | ArchitectActionEvent
  | ArchitectRollbackEvent
  | ArchitectErrorEvent
  | ArchitectBudgetEvent
  | ArchitectKilledEvent
  | ArchitectPlanStepEvent
  | ArchitectReasoningChunkEvent
  | ArchitectPolicyWarningEvent
  | ArchitectApprovalTimeoutEvent;

/** Listener for architect events. */
export type ArchitectEventListener = (event: ArchitectEvent) => void;

/** M10: Type-safe event map for discriminated on() overload. */
export interface ArchitectEventMap {
  "observing": ArchitectProgressEvent;
  "reasoning": ArchitectProgressEvent;
  "generating": ArchitectProgressEvent;
  "validating": ArchitectProgressEvent;
  "analysis-start": ArchitectAnalysisStartEvent;
  "analysis-complete": ArchitectAnalysisCompleteEvent;
  "action": ArchitectActionEvent;
  "approval-required": ArchitectActionEvent;
  "approval-response": ArchitectActionEvent;
  "applied": ArchitectActionEvent;
  "rollback": ArchitectRollbackEvent;
  "error": ArchitectErrorEvent;
  "budget-warning": ArchitectBudgetEvent;
  "budget-exceeded": ArchitectBudgetEvent;
  "killed": ArchitectKilledEvent;
  "plan-step": ArchitectPlanStepEvent;
  "reasoning-chunk": ArchitectReasoningChunkEvent;
  "policy-warning": ArchitectPolicyWarningEvent;
  "approval-timeout": ArchitectApprovalTimeoutEvent;
}

// ============================================================================
// AI Architect Instance
// ============================================================================

/** The AI Architect instance returned by createAIArchitect(). */
export interface AIArchitect {
  /**
   * Manually trigger an analysis.
   * The AI will observe the system, reason about it, and propose actions.
   * @param prompt - Optional prompt for the analysis.
   * @param options - Optional analysis options.
   */
  analyze(prompt?: string, options?: { mode?: "single" | "plan" }): Promise<ArchitectAnalysis>;

  /**
   * Approve a pending action by its ID.
   * Returns true if the action was found and approved.
   */
  approve(actionId: string): Promise<boolean>;

  /**
   * Reject a pending action by its ID.
   * Returns true if the action was found and rejected.
   */
  reject(actionId: string): Promise<boolean>;

  /**
   * Roll back a previously applied action.
   * Returns true if the rollback succeeded.
   */
  rollback(actionId: string): boolean;

  /** Preview what a rollback would do without executing it. */
  previewRollback(actionId: string): RollbackPreview | null;

  /** Atomically rollback multiple actions. */
  rollbackBatch(actionIds: string[]): RollbackBatchResult;

  /** Export an approved action's code for copy-paste into codebase. */
  toSource(actionId: string): string | null;

  /** Synchronous kill switch — removes ALL AI definitions immediately. */
  kill(): KillResult;

  /** Reset budget counters. */
  resetBudget(): void;

  /** Get all AI-created definitions currently active. */
  getActiveDefinitions(): ActiveDefinition[];

  /** Listen to architect events. Returns unsubscribe function. */
  on(listener: ArchitectEventListener): () => void;
  /** M10: Type-safe overload — listener receives the specific event type. */
  on<T extends ArchitectEventType>(type: T, listener: (event: ArchitectEventMap[T]) => void): () => void;

  /** Query audit log with filters. */
  getAuditLog(query?: AuditQuery): AuditEntry[];

  /** Get all pending approval requests. */
  getPendingApprovals(): ArchitectAction[];

  /** Get all rollback-capable entries. */
  getRollbackEntries(): RollbackEntry[];

  /** Get current budget usage. */
  getBudgetUsage(): { tokens: number; dollars: number; percent: { tokens: number; dollars: number } };

  /** Item 19: Start a discovery session to observe the system for patterns. */
  discover(options?: DiscoveryOptions): DiscoverySession;

  /** Item 19: Run a what-if analysis for a proposed action. */
  whatIf(action: ArchitectAction, options?: WhatIfOptions): Promise<WhatIfResult>;

  /** Item 19: Extract the system's constraint graph. */
  graph(options?: Omit<import("./graph.js").ExtractGraphOptions, "dynamicIds">): SystemGraph;

  /** Item 19: Create a replay recorder for this system. */
  record(): import("./replay.js").ReplayRecorder;

  /** Item 19: Export an applied action as a shareable federation pattern. */
  exportAction(actionId: string, options?: import("./federation.js").ExportPatternOptions): FederationExport | null;

  /** Item 19: Import a federated pattern and register for approval. */
  importPattern(pattern: FederationPattern): Promise<FederationImportResult>;

  /** Item 24: Get current architect status summary. */
  status(): ArchitectStatus;

  /** Stop the architect (clears scheduled triggers, removes watchers). */
  destroy(): void;
}

/** Item 24: Status summary of the architect. */
export interface ArchitectStatus {
  budget: {
    tokens: number;
    dollars: number;
    percentTokens: number;
    percentDollars: number;
  };
  circuitBreaker: CircuitBreakerState;
  activeDefinitions: number;
  pendingApprovals: number;
  auditEntries: number;
  uptime: number;
  isDestroyed: boolean;
}

// ============================================================================
// Sandbox Types
// ============================================================================

/** Options for compiling AI-generated code. */
export interface SandboxCompileOptions {
  /** Execution timeout in ms. Default: 5000 */
  timeout?: number;
  /** Allowed global APIs. Default: ['Math', 'Date', 'JSON', 'console'] */
  allowedGlobals?: string[];
  /** Blocked code patterns (added to defaults). */
  blockedPatterns?: string[];
  /** Whether the generated function can write to facts. Default: false */
  factWriteAccess?: boolean;
  /** Maximum code size in bytes. Default: 2048 */
  maxCodeSize?: number;
  /** Item 18: Use worker thread for real timeout enforcement (Node.js only). Default: false */
  useWorker?: boolean;
}

/** Result of static analysis on AI-generated code. */
export interface StaticAnalysisResult {
  /** Whether the code passed static analysis. */
  safe: boolean;
  /** Violations found. */
  violations: string[];
  /** Warnings (non-blocking). */
  warnings: string[];
}

// ============================================================================
// Tool Definition Types
// ============================================================================

/** Schema for an architect tool parameter. */
export interface ArchitectToolParam {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  enum?: string[];
}

/** Definition of a tool the AI can call. */
export interface ArchitectToolDef {
  /** Tool name (e.g., 'observe_system'). */
  name: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** Parameter schema. */
  parameters: Record<string, ArchitectToolParam>;
  /** Which capability this tool requires (null = always available). */
  requiredCapability?: keyof ArchitectCapabilities | null;
  /** Whether this tool mutates the system. */
  mutates: boolean;
}

// ============================================================================
// Guard Types
// ============================================================================

/** Circuit breaker state. */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/** Guard configuration. */
export interface GuardConfig {
  /** Debounce window per trigger type in ms. Default: 3000 */
  debounceMs?: number;
  /** Max LLM calls per minute. Default: 6 */
  maxCallsPerMinute?: number;
  /** Failures before circuit opens. Default: 3 */
  circuitBreakerThreshold?: number;
  /** Circuit breaker window in ms. Default: 60000 */
  circuitBreakerWindowMs?: number;
  /** Max cascade depth (AI → trigger → AI cycles). Default: 3 */
  maxCascadeDepth?: number;
  /** Max sync execution time in ms. Default: 50 */
  maxExecutionTimeMs?: number;
  /** Max total AI-created definitions. Default: 50 */
  maxDefinitions?: number;
  /** Max pending actions. Default: 10 */
  maxPending?: number;
  /** Max actions per hour. Default: 20 */
  maxPerHour?: number;
}

// ============================================================================
// Pipeline Types
// ============================================================================

/** A queued trigger waiting for debounce. */
export interface QueuedTrigger {
  type: ArchitectAnalysis["trigger"];
  context?: string;
  /** Store generation counter at time of trigger. */
  version: number;
  timestamp: number;
}

// ============================================================================
// Discovery Types
// ============================================================================

/** Options for constraint discovery mode. */
export interface DiscoveryOptions {
  /** Duration to observe in ms. Default: 300000 (5 min) */
  duration?: number;
  /** Max timeline events to collect. Default: 500 */
  maxEvents?: number;
  /** Whether to send patterns to LLM for recommendations. Default: true */
  useAI?: boolean;
}

/** Progress callback for discovery. */
export interface DiscoveryProgress {
  /** Events collected so far. */
  eventCount: number;
  /** Patterns identified so far. */
  patternCount: number;
  /** Time elapsed in ms. */
  elapsedMs: number;
}

/** A pattern identified during discovery. */
export interface DiscoveryPattern {
  /** Pattern type. */
  type: "recurring-unmet" | "fact-oscillation" | "error-cycle" | "idle-state";
  /** Human-readable description. */
  description: string;
  /** How many times this pattern was observed. */
  occurrences: number;
  /** Relevant fact keys. */
  factKeys: string[];
  /** Confidence 0-1. */
  confidence: number;
}

/** A recommendation from discovery analysis. */
export interface DiscoveryRecommendation {
  /** What type of definition to create. */
  type: ArchitectDefType;
  /** Suggested ID. */
  id: string;
  /** Why this is recommended. */
  reasoning: string;
  /** Source code via toSource(). */
  toSource: () => string;
  /** Which pattern this addresses. */
  pattern: DiscoveryPattern;
}

/** Complete discovery report. */
export interface DiscoveryReport {
  /** Patterns identified. */
  patterns: DiscoveryPattern[];
  /** AI recommendations (if useAI was true). */
  recommendations: DiscoveryRecommendation[];
  /** Timeline of events observed. */
  timeline: DiscoveryTimelineEvent[];
  /** Total observation duration in ms. */
  durationMs: number;
  /** Timestamp when discovery started. */
  startedAt: number;
}

/** A single event in the discovery timeline. */
export interface DiscoveryTimelineEvent {
  /** Timestamp. */
  timestamp: number;
  /** Event type. */
  type: "fact-change" | "unmet-requirement" | "error" | "settled";
  /** Relevant data. */
  data: Record<string, unknown>;
}

// ============================================================================
// What-If Types
// ============================================================================

/** Options for what-if analysis. */
export interface WhatIfOptions {
  /** Whether to include LLM summary. Default: false */
  includeSummary?: boolean;
}

/** Result of a what-if analysis. */
export interface WhatIfResult {
  /** The action being analyzed. */
  action: ArchitectAction;
  /** Predicted steps/effects. */
  steps: WhatIfStep[];
  /** Overall risk score (higher = riskier). */
  riskScore: number;
  /** LLM summary if requested. */
  summary?: string;
}

/** A predicted step in what-if analysis. */
export interface WhatIfStep {
  /** What would happen. */
  description: string;
  /** Which facts would change. */
  factChanges: Array<{ key: string; from: unknown; to: unknown }>;
  /** Which constraints would fire. */
  constraintsFiring: string[];
  /** Which resolvers would activate. */
  resolversActivating: string[];
}

// ============================================================================
// Graph Types
// ============================================================================

/** A visual representation of the system's constraint graph. */
export interface SystemGraph {
  /** All nodes. */
  nodes: GraphNode[];
  /** All edges. */
  edges: GraphEdge[];
  /** Graph metadata. */
  metadata: GraphMetadata;
}

/** A node in the system graph. */
export interface GraphNode {
  /** Unique node ID. */
  id: string;
  /** Node type. */
  type: "fact" | "constraint" | "resolver" | "derivation" | "effect";
  /** Display label. */
  label: string;
  /** Whether this was created by AI. */
  aiCreated: boolean;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
}

/** An edge in the system graph. */
export interface GraphEdge {
  /** Source node ID. */
  source: string;
  /** Target node ID. */
  target: string;
  /** Edge type. */
  type: "depends-on" | "resolves" | "produces" | "triggers";
  /** Display label. */
  label?: string;
}

/** Metadata about the graph. */
export interface GraphMetadata {
  /** Total node count. */
  nodeCount: number;
  /** Total edge count. */
  edgeCount: number;
  /** Number of AI-created nodes. */
  aiNodeCount: number;
  /** Timestamp when graph was extracted. */
  extractedAt: number;
}

// ============================================================================
// Replay Types
// ============================================================================

/** A recorded session for replay. */
export interface ReplayRecording {
  /** All recorded events. */
  events: ReplayEvent[];
  /** Initial system state. */
  initialState: Record<string, unknown>;
  /** Duration of recording in ms. */
  durationMs: number;
  /** Timestamp when recording started. */
  startedAt: number;
}

/** A single event in a replay recording. */
export interface ReplayEvent {
  /** Timestamp relative to recording start. */
  offsetMs: number;
  /** Event type. */
  type: "fact-snapshot" | "settlement-change" | "requirement-unmet" | "error";
  /** Facts snapshot at this point. */
  facts: Record<string, unknown>;
  /** Unmet requirements at this point. */
  unmetRequirements: string[];
  /** Additional data. */
  data?: Record<string, unknown>;
}

/** Options for replay with architect. */
export interface ReplayOptions {
  /** Maximum events to process. Default: all */
  maxEvents?: number;
  /** Item 16: token budget cap for replay. Stop processing when exceeded. */
  budget?: { maxTokens: number };
}

/** Result of replaying with an architect. */
export interface ReplayResult {
  /** What actually happened (from recording). */
  original: ReplayEvent[];
  /** What the architect would have done. */
  withArchitect: Array<{
    /** The event that triggered the architect. */
    event: ReplayEvent;
    /** Actions the architect proposed. */
    proposedActions: ArchitectAction[];
  }>;
  /** Summary comparison. */
  comparison: {
    /** Total events in recording. */
    totalEvents: number;
    /** Events that would have triggered architect actions. */
    triggeredEvents: number;
    /** Total actions architect would have taken. */
    totalActions: number;
    /** Item 16: total tokens used during replay. */
    tokensUsed?: number;
  };
}

// ============================================================================
// Federation Types
// ============================================================================

/** A shareable, anonymized pattern. */
export interface FederationPattern {
  /** Unique hash of the pattern. */
  hash: string;
  /** Pattern type. */
  type: ArchitectDefType;
  /** Anonymized description. */
  description: string;
  /** Anonymized code template. */
  template: string;
  /** Effectiveness score 0-1. */
  effectiveness: number;
  /** Number of times this pattern has been used. */
  useCount: number;
  /** Tags for categorization. */
  tags: string[];
}

/** Result of exporting a pattern for federation. */
export interface FederationExport {
  /** The exported pattern. */
  pattern: FederationPattern;
  /** Whether the export was successful. */
  success: boolean;
  /** Item 13: error message if export failed. */
  error?: string;
}

/** Result of importing a federated pattern. */
export interface FederationImportResult {
  /** Whether the import was successful. */
  success: boolean;
  /** The adapted action. */
  action?: ArchitectAction;
  /** Error if import failed. */
  error?: string;
}

// ============================================================================
// Service Hooks Types
// ============================================================================

/** External service integration hooks. */
export interface ArchitectServiceHooks {
  /** Called when an analysis completes. */
  onAnalysis?: (analysis: ArchitectAnalysis) => void | Promise<void>;
  /** Called when an action is applied. */
  onAction?: (action: ArchitectAction) => void | Promise<void>;
  /** Called when an error occurs. */
  onError?: (error: Error) => void | Promise<void>;
  /** Called when the kill switch is activated. */
  onKill?: (result: KillResult) => void | Promise<void>;
  /** Called for every audit entry. */
  onAudit?: (entry: AuditEntry) => void | Promise<void>;
}

// ============================================================================
// Policy Types (Item 33)
// ============================================================================

/** Context passed to policy evaluation functions. */
export interface PolicyContext {
  /** Number of actions taken in the last hour. */
  actionsThisHour: number;
  /** Number of constraints created by the architect. */
  constraintsCreated: number;
  /** Number of resolvers created by the architect. */
  resolversCreated: number;
  /** Number of effects created by the architect. */
  effectsCreated: number;
  /** Number of derivations created by the architect. */
  derivationsCreated: number;
  /** Fact keys modified by the current action. */
  factKeysModified: string[];
  /** Percentage of budget used (0-100). */
  budgetUsedPercent: number;
  /** Total active definitions. */
  activeDefinitions: number;
  /** The last action taken (if any). */
  lastAction?: ArchitectAction;
  /** The current action being evaluated. */
  currentAction: ArchitectAction;
}

/** A meta-constraint on the architect's behavior. */
export interface ArchitectPolicy {
  /** Unique ID for this policy. */
  id: string;
  /** Human-readable description of the policy. */
  description: string;
  /** Predicate that determines when this policy applies. */
  when: (ctx: PolicyContext) => boolean;
  /** What to do when the policy is triggered. */
  action: "block" | "warn" | "require-approval";
}

