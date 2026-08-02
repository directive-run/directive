/**
 * AI Adapter – Constraint-driven agent orchestration with guardrails
 *
 * Philosophy: "Use Directive WITH any LLM agent framework"
 * - Your framework handles LLM tool execution
 * - Directive adds safety guardrails, approval workflows, state persistence
 *
 * Also available (tree-shakable subpath exports):
 * - `@directive-run/ai/multi-agent` – Multi-agent orchestration, patterns, communication, checkpoints
 * - `@directive-run/ai/predicate` – LLM-emit-predicate (FactPredicate from natural-language intent)
 * - `@directive-run/ai/guardrails` – Built-in + prompt-injection + PII + semantic-cache guardrails
 * - `@directive-run/ai/devtools` – Debug timeline + DevTools WebSocket server + health monitor
 * - `@directive-run/ai/evals` – Evaluation framework (cost, latency, judge, safety, etc.)
 * - `@directive-run/ai/mcp` – Model Context Protocol client + types
 * - `@directive-run/ai/testing` – Mock runners, test orchestrators, assertion helpers
 * - `@directive-run/ai/anthropic` – Anthropic Claude adapter
 * - `@directive-run/ai/openai` – OpenAI / Azure / Together adapter
 * - `@directive-run/ai/ollama` – Local Ollama inference adapter
 * - `@directive-run/ai/gemini` – Google Gemini adapter
 *
 * @example
 * ```typescript
 * import { createAgentOrchestrator } from '@directive-run/ai'
 *
 * const orchestrator = createAgentOrchestrator({
 *   runner: myAgentRunner,
 *   constraints: {
 *     needsExpertReview: {
 *       when: (facts) => facts.decision.confidence < 0.7,
 *       require: (facts) => ({ type: 'EXPERT_AGENT', query: facts.userQuery })
 *     },
 *     budgetLimit: {
 *       when: (facts) => facts.tokenUsage > 10000,
 *       require: { type: 'PAUSE_AGENTS' }
 *     }
 *   },
 *   guardrails: {
 *     input: [(data) => validatePII(data.input)],
 *     output: [(data) => checkToxicity(data.output)]
 *   }
 * })
 * ```
 */

// ============================================================================
// Types (from dedicated module)
// ============================================================================

export type {
  AgentLike,
  RunResult,
  TokenUsage,
  Message,
  ToolCall,
  AgentRunner,
  StreamingCallbackRunner,
  RunOptions,
  AdapterHooks,
  GuardrailFn,
  GuardrailContext,
  GuardrailResult,
  InputGuardrailData,
  OutputGuardrailData,
  ToolCallGuardrailData,
  GuardrailRetryConfig,
  AgentRetryConfig,
  NamedGuardrail,
  GuardrailsConfig,
  AgentState,
  ApprovalState,
  RejectedRequest,
  ApprovalRequest,
  OrchestratorConstraint,
  OrchestratorResolverContext,
  OrchestratorResolver,
  OrchestratorState,
  OrchestratorLifecycleHooks,
  MultiAgentLifecycleHooks,
  GuardrailErrorCode,
  SchemaValidationResult,
  SchemaValidator,
  // DAG types
  DagNodeStatus,
  DagExecutionContext,
  DagNode,
  DagPattern,
  // Debug configuration
  OrchestratorDebugConfig,
  // Debug Timeline event types
  DebugEventType,
  DebugEventBase,
  AgentStartEvent,
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentRetryEvent,
  GuardrailCheckEvent,
  ConstraintEvaluateEvent,
  ResolverStartEvent,
  ResolverCompleteEvent,
  ResolverErrorEvent,
  ApprovalRequestEvent,
  ApprovalResponseEvent,
  HandoffStartEvent,
  HandoffCompleteEvent,
  PatternStartEvent,
  PatternCompleteEvent,
  DagNodeUpdateEvent,
  // Task event types
  TaskStartEvent,
  TaskCompleteEvent,
  TaskErrorEvent,
  TaskProgressEvent,
  DebugEvent,
  // Self-Healing types
  AgentHealthState,
  RerouteEvent,
  RerouteDebugEvent,
  HealthMonitorConfig,
  SelfHealingConfig,
  MultiAgentSelfHealingConfig,
  AgentCircuitBreakerConfig,
  // Breakpoint event types
  BreakpointHitEvent,
  BreakpointResumedEvent,
  // Cross-agent derivation types
  CrossAgentSnapshot,
  CrossAgentDerivationFn,
  // Scratchpad types
  Scratchpad,
  // New debug event types
  DerivationUpdateEvent,
  ScratchpadUpdateEvent,
  ReflectionIterationEvent,
  RaceStartEvent,
  RaceWinnerEvent,
  RaceCancelledEvent,
  DebateRoundEvent,
  // Checkpoint state types
  PatternCheckpointConfig,
  CheckpointContext,
  PatternCheckpointBase,
  SequentialCheckpointState,
  SupervisorCheckpointState,
  ReflectCheckpointState,
  DebateCheckpointState,
  DagCheckpointState,
  PatternCheckpointState,
  CheckpointProgress,
  CheckpointDiff,
  CheckpointSaveEvent,
  CheckpointRestoreEvent,
  GoalCheckpointConfig,
  GoalCheckpointState,
} from "./types.js";

export { GuardrailError, isGuardrailError } from "./types.js";

// ============================================================================
// Orchestrator
// ============================================================================

export {
  createAgentOrchestrator,
  type OrchestratorOptions,
  type OrchestratorStreamResult,
  type OrchestratorStreamChunk,
  type RunCallOptions,
  type AgentOrchestrator,
} from "./agent-orchestrator.js";

// ============================================================================
// Built-in Guardrails
// ============================================================================

/**
 * @deprecated Import from `@directive-run/ai/guardrails` instead. Will be removed in v2.
 * Re-exported from the main barrel for backwards compatibility this cycle.
 */
export {
  createPIIGuardrail,
  createModerationGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
  createLengthGuardrail,
  createContentFilterGuardrail,
  type RateLimitGuardrail,
} from "./builtin-guardrails.js";

/**
 * Mandatory companion to `liveContext`. Closes the source →
 * fact → agent-prompt PII bypass at the fact-store boundary. Symmetric
 * with the other built-in guardrails: re-exported here so consumers
 * who follow the "main-barrel" idiom find it, AND from the
 * `@directive-run/ai/guardrails` subpath for tree-shakable imports.
 *
 * @deprecated Prefer `@directive-run/ai/guardrails` for tree-shaking.
 * Will be removed from the main barrel in v2.
 */
export {
  createFactPIIGuardrail,
  type FactPIIGuardrailMode,
  type FactPIIErrorMode,
  type FactPIIGuardrailOptions,
  type FactPIICategory,
  type FactPIIMatch,
} from "./guardrails/fact-pii.js";

// ============================================================================
// Agent Utilities
// ============================================================================

export {
  isAgentRunning,
  hasPendingApprovals,
  estimateCost,
  validateBaseURL,
  createRunner,
  type CreateRunnerOptions,
  type ParseEventStreamOptions,
  type ParsedResponse,
  type RunnerStreamingSupport,
  type StreamEventResult,
  type StreamTotals,
  type StreamWireFormat,
} from "./agent-utils.js";

// ============================================================================
// Middleware Composition
// ============================================================================

export { pipe, type RunnerMiddleware } from "./pipe.js";

// ============================================================================
// Re-exports from Sub-modules
// ============================================================================

// Memory system
export {
  createAgentMemory,
  createSlidingWindowStrategy,
  createTokenBasedStrategy,
  createHybridStrategy,
  createTruncationSummarizer,
  createKeyPointsSummarizer,
  createLLMSummarizer,
  type AgentMemory,
  type AgentMemoryConfig,
  type MemoryState,
  type MemoryManageResult,
  type MemoryStrategy,
  type MemoryStrategyConfig,
  type MemoryStrategyResult,
  type MessageSummarizer,
} from "./memory.js";

// Streaming utilities
export {
  createStreamingRunner,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
  createToxicityStreamingGuardrail,
  combineStreamingGuardrails,
  adaptOutputGuardrail,
  collectTokens,
  tapStream,
  filterStream,
  mapStream,
  type TokenChunk,
  type ToolStartChunk,
  type ToolEndChunk,
  type MessageChunk,
  type GuardrailTriggeredChunk,
  type ProgressChunk,
  type DoneChunk,
  type ErrorChunk,
  type StreamChunk,
  type StreamRestartChunk,
  type StreamRestartReason,
  type StreamRunOptions,
  type StreamRunner,
  type StreamingRunResult,
  type StreamingGuardrail,
  type StreamingGuardrailResult,
  type BackpressureStrategy,
  type MultiplexedStreamChunk,
  type MultiplexedStreamResult,
  type MergedTaggedStreamResult,
  mergeTaggedStreams,
  StreamConsumerError,
  isStreamConsumerError,
} from "./streaming.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 * Re-exported from the main barrel for backwards compatibility this cycle.
 */
// Multi-agent orchestration
export {
  createMultiAgentOrchestrator,
  Semaphore,
  parallel,
  sequential,
  supervisor,
  dag,
  reflect,
  race,
  debate,
  goal,
  allReadyStrategy,
  highestImpactStrategy,
  costEfficientStrategy,
  runDebate,
  selectAgent,
  runAgentRequirement,
  concatResults,
  pickBestResult,
  collectOutputs,
  aggregateTokens,
  composePatterns,
  findAgentsByCapability,
  capabilityRoute,
  spawnOnCondition,
  derivedConstraint,
  spawnPool,
  patternToJSON,
  patternFromJSON,
  getPatternStep,
  getCheckpointProgress,
  diffCheckpoints,
  forkFromCheckpoint,
  type MultiAgentOrchestrator,
  type MultiAgentOrchestratorOptions,
  type MultiAgentState,
  type TaskRegistration,
  type TaskContext,
  type AgentRegistration,
  type AgentRegistry,
  type ExecutionPattern,
  type ParallelPattern,
  type SequentialPattern,
  type SupervisorPattern,
  type ReflectPattern,
  type RacePattern,
  type RaceResult,
  type RaceSuccessEntry,
  type ReflectIterationRecord,
  type DebateConfig,
  type DebateResult,
  type DebatePattern,
  type GoalPattern,
  type GoalNode,
  type GoalResult,
  type GoalStepMetrics,
  type GoalMetrics,
  type AgentSelectionStrategy,
  type RelaxationTier,
  type RelaxationStrategy,
  type RelaxationRecord,
  type RelaxationContext,
  type SpawnOnConditionOptions,
  type SpawnPoolConfig,
  type SerializedPattern,
  type SerializedDagNode,
  type SerializedGoalNode,
  type HandoffRequest,
  type HandoffResult,
  type RunAgentRequirement,
  type MultiAgentRunCallOptions,
  type MultiAgentStreamCallOptions,
} from "./multi-agent-orchestrator.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Pattern visualization
export {
  patternToMermaid,
  type MermaidOptions,
  type MermaidDirection,
  type MermaidNodeShapes,
} from "./pattern-mermaid.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Agent communication
export {
  createMessageBus,
  createAgentNetwork,
  createResponder,
  createDelegator,
  createPubSub,
  type MessageBus,
  type MessageBusConfig,
  type AgentNetwork,
  type AgentNetworkConfig,
  type AgentInfo,
  type AgentMessage,
  type AgentMessageType,
  type TypedAgentMessage,
  type RequestMessage,
  type ResponseMessage,
  type DelegationMessage,
  type DelegationResultMessage,
  type QueryMessage,
  type InformMessage,
  type UpdateMessage,
  type MessageHandler,
  type Subscription,
  type MessageFilter,
} from "./communication.js";

// Observability — runtime createObservability/createAgentMetrics moved to alpha (re-evaluating vs OTel)
export type {
  ObservabilityInstance,
  ObservabilityConfig,
  MetricType,
  MetricDataPoint,
  AggregatedMetric,
  TraceSpan,
  AlertConfig,
  AlertEvent,
  DashboardData,
} from "@directive-run/core/plugins";

// OTLP Exporter
export {
  createOTLPExporter,
  type OTLPExporterConfig,
  type OTLPExporter,
} from "@directive-run/core/plugins";

// Circuit Breaker
export {
  createCircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  /** @see HealthCircuitState — health-monitor-specific circuit state */
  type CircuitState,
} from "@directive-run/core/plugins";

// Audit Trail
export {
  createAuditTrail,
  createAgentAuditHandlers,
  type AuditPluginConfig,
  type AuditInstance,
  type AuditEventType,
} from "./plugins/audit.js";

/**
 * @deprecated Import from `@directive-run/ai/guardrails` instead. Will be removed in v2.
 */
// Prompt Injection Guardrails
export {
  createPromptInjectionGuardrail,
  createUntrustedContentGuardrail,
  detectPromptInjection,
  sanitizeInjection,
  markUntrustedContent,
  DEFAULT_INJECTION_PATTERNS,
  STRICT_INJECTION_PATTERNS,
  type PromptInjectionGuardrailOptions,
  type InjectionDetectionResult,
} from "./guardrails/prompt-injection.js";

// Compliance (GDPR/CCPA)
export {
  createCompliance,
  createInMemoryComplianceStorage,
  type ComplianceConfig,
  type ComplianceInstance,
  type ComplianceStorage,
} from "./plugins/compliance.js";

/**
 * @deprecated Import from `@directive-run/ai/guardrails` instead. Will be removed in v2.
 */
// Enhanced PII Guardrails
export {
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
  detectPII,
  detectAndRedactPII,
  redactPII,
  type EnhancedPIIGuardrailOptions,
  type PIIDetectionResult,
  type DetectedPII,
  type PIIType,
  type PIIDetector,
  type RedactionStyle,
} from "./guardrails/pii-enhanced.js";

/**
 * @deprecated Import from `@directive-run/ai/guardrails` instead. Will be removed in v2.
 */
// ANN Index
export {
  createBruteForceIndex,
  createVPTreeIndex,
  type ANNIndex,
  type ANNSearchResult,
  type VPTreeIndexConfig,
} from "./guardrails/ann-index.js";

/**
 * @deprecated Import from `@directive-run/ai/guardrails` instead. Will be removed in v2.
 */
export {
  createSemanticCache,
  createSemanticCacheGuardrail,
  createBatchedEmbedder,
  createTestEmbedder,
  createInMemoryStorage,
  type Embedding,
  type SemanticCache,
  type SemanticCacheConfig,
  type CacheEntry,
  type CacheLookupResult,
  type CacheStats,
  type SemanticCacheStorage,
  type BatchedEmbedder,
  type EmbedderFn,
} from "./guardrails/semantic-cache.js";

// Stream Channels
export {
  createStreamChannel,
  createBidirectionalStream,
  pipeThrough,
  mergeStreams,
  type StreamChannel,
  type StreamChannelConfig,
  type StreamChannelState,
  type BidirectionalStream,
} from "./stream-channel.js";

// RAG Enricher
export {
  createRAGEnricher,
  createJSONFileStore,
  type RAGChunk,
  type RAGStorage,
  type RAGEnricherConfig,
  type RAGEnrichOptions,
  type RAGEnricher,
  type JSONFileStoreOptions,
} from "./rag.js";

// SSE Transport
export {
  createSSETransport,
  type SSEEvent,
  type SSETransportConfig,
  type SSETransport,
} from "./sse-transport.js";

// Intelligent Retry
export {
  withRetry,
  parseHttpStatus,
  parseRetryAfter,
  RetryExhaustedError,
  type RetryConfig,
} from "./retry.js";

// Provider Fallback
export {
  withFallback,
  AllProvidersFailedError,
  type FallbackConfig,
} from "./fallback.js";

// Cost Budget Guards
export {
  withBudget,
  BudgetExceededError,
  type BudgetConfig,
  type BudgetRunner,
  type BudgetWindow,
  type TokenPricing,
  type BudgetExceededDetails,
} from "./budget.js";

// Smart Model Selection
export {
  withModelSelection,
  byInputLength,
  byAgentName,
  byPattern,
  type ModelRule,
  type ModelSelectionConfig,
} from "./model-selector.js";

// Structured Outputs
export {
  withStructuredOutput,
  extractJsonFromOutput,
  StructuredOutputError,
  type StructuredOutputConfig,
  type SafeParseable,
  type SafeParseResult,
} from "./structured-output.js";

/**
 * @deprecated Import from `@directive-run/ai/predicate` instead. Will be removed in v2.
 */
// LLM-emit-predicate — typed FactPredicate from natural-language intent
export {
  predicateFromIntent,
  predicateFromIntentRaw,
  predicateFromIntentWithProvenance,
  predicateToolSpec,
  predicateToolSpecAnthropic,
  predicateToolSpecOpenAI,
  PredicateFromIntentError,
  type PredicateFromIntentOptions,
  type PredicateFromIntentDiagnostics,
  type PredicateFromIntentProvenance,
  type PredicateFromIntentWithProvenanceResult,
  type PredicateToolSpec,
  type PredicateToolSpecAnthropic,
  type PredicateToolSpecOpenAI,
  type PredicateToolSpecOptions,
} from "./predicate-from-intent.js";

// Batch Queue
export {
  createBatchQueue,
  type BatchQueue,
  type BatchQueueConfig,
} from "./batch.js";

// Constraint-Driven Provider Routing
export {
  createConstraintRouter,
  type ConstraintRouterConfig,
  type ConstraintRouterRunner,
  type RoutingProvider,
  type RoutingFacts,
  type ProviderStats,
  type RoutingConstraint,
} from "./provider-routing.js";

/**
 * @deprecated Import from `@directive-run/ai/devtools` instead. Will be removed in v2.
 */
// Debug Timeline
export {
  createDebugTimeline,
  createDebugTimelinePlugin,
  type DebugTimeline,
  type DebugTimelineOptions,
  type DebugTimelineListener,
} from "./debug-timeline.js";

/**
 * @deprecated Import from `@directive-run/ai/devtools` instead. Will be removed in v2.
 */
// Health Monitor
export {
  createHealthMonitor,
  type HealthMonitor,
  type AgentHealthMetrics,
  /** @see CircuitState — core circuit breaker state */
  type HealthCircuitState,
} from "./health-monitor.js";

/**
 * @deprecated Import from `@directive-run/ai/devtools` instead. Will be removed in v2.
 */
// DevTools Server
export {
  createDevToolsServer,
  createWsTransport,
  connectDevTools,
  type DevToolsServer,
  type DevToolsServerConfig,
  type DevToolsClient,
  type DevToolsTransport,
  type DevToolsServerMessage,
  type DevToolsClientMessage,
  type DevToolsSnapshot,
  type WsTransportConfig,
  type ConnectDevToolsOptions,
  type DevToolsCompatibleOrchestrator,
} from "./devtools-server.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Checkpointing
export {
  createCheckpointId,
  validateCheckpoint,
  InMemoryCheckpointStore,
  type Checkpoint,
  type CheckpointStore,
  type CheckpointLocalState,
  type SingleAgentCheckpointLocalState,
  type MultiAgentCheckpointLocalState,
  type InMemoryCheckpointStoreOptions,
} from "./checkpoint.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Breakpoints
export {
  matchBreakpoint,
  createBreakpointId,
  createInitialBreakpointState,
  MAX_BREAKPOINT_HISTORY,
  type BreakpointType,
  type MultiAgentBreakpointType,
  type BreakpointConfig,
  type BreakpointContext,
  type BreakpointRequest,
  type BreakpointModifications,
  type BreakpointState,
} from "./breakpoints.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Reflection
export {
  withReflection,
  ReflectionExhaustedError,
  type ReflectionConfig,
  type ReflectionContext,
  type ReflectionEvaluation,
  type ReflectionEvaluator,
} from "./reflection.js";

/**
 * @deprecated Import from `@directive-run/ai/multi-agent` instead. Will be removed in v2.
 */
// Goal Utilities (standalone plan, validate, dependency graph, explain)
export {
  planGoal,
  validateGoal,
  getDependencyGraph,
  explainGoal,
  type GoalAgentDeclaration,
  type GoalDependencyEdge,
  type GoalDependencyGraph,
  type GoalValidationResult,
  type GoalPlanStep,
  type GoalExecutionPlan,
  type GoalExplanation,
  type GoalExplanationStep,
} from "./goal-utils.js";

// Meta Context (system introspection for LLM consumption)
export { formatSystemMeta, toAIContext } from "./meta-context.js";

/**
 * @deprecated Import from `@directive-run/ai/mcp` instead. Will be removed in v2.
 */
// MCP (Model Context Protocol)
export {
  createMCPAdapter,
  convertToolsForLLM,
  mcpCallTool,
  mcpReadResource,
  mcpGetPrompt,
  mcpSyncResources,
  type MCPAdapter,
} from "./mcp.js";
export type {
  MCPAdapterConfig,
  MCPTool,
  MCPToolResult,
  MCPToolConstraint,
  MCPServerConfig,
  MCPResource,
  MCPApprovalRequest,
  MCPCallToolRequirement,
  MCPReadResourceRequirement,
  MCPGetPromptRequirement,
  MCPSyncResourcesRequirement,
  MCPRequirement,
} from "./mcp-types.js";

/**
 * @deprecated Import from `@directive-run/ai/evals` instead. Will be removed in v2.
 */
// Evaluation Framework
export {
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
  type EvalCase,
  type EvalScore,
  type EvalContext,
  type EvalCriterionFn,
  type EvalCriterion,
  type EvalCaseResult,
  type EvalAgentSummary,
  type EvalResults,
  type EvalSuiteConfig,
  type EvalSuite,
  type EvalCostOptions,
  type EvalLatencyOptions,
  type EvalOutputLengthOptions,
  type EvalSafetyOptions,
  type EvalStructureOptions,
  type EvalJudgeOptions,
  type EvalMatchOptions,
  type EvalSemanticOptions,
  type EvalAssertOptions,
} from "./evals.js";

// OpenTelemetry Integration
export {
  createOtelPlugin,
  OtelStatusCode,
  type OtelSpan,
  type OtelTracer,
  type OtelPluginConfig,
  type SpanData,
  type OtelPlugin,
} from "./otel.js";

// Source primitive × OpenTelemetry — pipe core `system.observe()` source.*
// events into the same OtelTracer the AI plugin uses, so SREs can answer
// "which source is publishing?" / "did source mcp error attach?" from
// their tracing backend.
export {
  attachSourcesToOtel,
  type SourcesOtelOptions,
} from "./otel-sources.js";
