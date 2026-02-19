/**
 * AI Adapter – Constraint-driven agent orchestration with guardrails
 *
 * Philosophy: "Use Directive WITH any LLM agent framework"
 * - Your framework handles LLM tool execution
 * - Directive adds safety guardrails, approval workflows, state persistence
 *
 * Also available:
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
 *       require: { type: 'EXPERT_AGENT', query: facts.userQuery }
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
  DebugEvent,
  // Self-Healing types
  AgentHealthState,
  RerouteEvent,
  HealthMonitorConfig,
  SelfHealingConfig,
  MultiAgentSelfHealingConfig,
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
  type ParsedResponse,
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
  type StreamRunOptions,
  type StreamRunner,
  type StreamingRunResult,
  type StreamingGuardrail,
  type StreamingGuardrailResult,
  type BackpressureStrategy,
} from "./streaming.js";

// Multi-agent orchestration
export {
  createMultiAgentOrchestrator,
  Semaphore,
  parallel,
  sequential,
  supervisor,
  dag,
  selectAgent,
  runAgentRequirement,
  concatResults,
  pickBestResult,
  collectOutputs,
  aggregateTokens,
  composePatterns,
  findAgentsByCapability,
  capabilityRoute,
  type MultiAgentOrchestrator,
  type MultiAgentOrchestratorOptions,
  type MultiAgentState,
  type AgentRegistration,
  type AgentRegistry,
  type ExecutionPattern,
  type ParallelPattern,
  type SequentialPattern,
  type SupervisorPattern,
  type HandoffRequest,
  type HandoffResult,
  type RunAgentRequirement,
} from "./multi-agent-orchestrator.js";

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

// Observability
export {
  createObservability,
  createAgentMetrics,
  type ObservabilityInstance,
  type ObservabilityConfig,
  type MetricType,
  type MetricDataPoint,
  type AggregatedMetric,
  type TraceSpan,
  type AlertConfig,
  type AlertEvent,
  type DashboardData,
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
  type CircuitState,
} from "@directive-run/core/plugins";

// Audit Trail
export {
  createAuditTrail,
  createAgentAuditHandlers,
  type AuditPluginConfig,
  type AuditInstance,
} from "./plugins/audit.js";

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
} from "./guardrails/prompt-injection.js";

// Compliance (GDPR/CCPA)
export {
  createCompliance,
  createInMemoryComplianceStorage,
  type ComplianceConfig,
  type ComplianceInstance,
  type ComplianceStorage,
} from "./plugins/compliance.js";

// Enhanced PII Guardrails
export {
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
  detectPII,
  redactPII,
  type EnhancedPIIGuardrailOptions,
} from "./guardrails/pii-enhanced.js";

// ANN Index
export {
  createBruteForceIndex,
  createVPTreeIndex,
  type ANNIndex,
  type ANNSearchResult,
  type VPTreeIndexConfig,
} from "./guardrails/ann-index.js";

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

// P2: Intelligent Retry
export {
  withRetry,
  parseHttpStatus,
  parseRetryAfter,
  RetryExhaustedError,
  type RetryConfig,
} from "./retry.js";

// P0: Provider Fallback
export {
  withFallback,
  AllProvidersFailedError,
  type FallbackConfig,
} from "./fallback.js";

// P1: Cost Budget Guards
export {
  withBudget,
  BudgetExceededError,
  type BudgetConfig,
  type BudgetRunner,
  type BudgetWindow,
  type TokenPricing,
  type BudgetExceededDetails,
} from "./budget.js";

// P3: Smart Model Selection
export {
  withModelSelection,
  byInputLength,
  byAgentName,
  byPattern,
  type ModelRule,
  type ModelSelectionConfig,
} from "./model-selector.js";

// P6: Structured Outputs
export {
  withStructuredOutput,
  extractJsonFromOutput,
  StructuredOutputError,
  type StructuredOutputConfig,
  type SafeParseable,
  type SafeParseResult,
} from "./structured-output.js";

// P5: Batch Queue
export {
  createBatchQueue,
  type BatchQueue,
  type BatchQueueConfig,
} from "./batch.js";

// P4: Constraint-Driven Provider Routing
export {
  createConstraintRouter,
  type ConstraintRouterConfig,
  type ConstraintRouterRunner,
  type RoutingProvider,
  type RoutingFacts,
  type ProviderStats,
  type RoutingConstraint,
} from "./provider-routing.js";

// Debug Timeline
export {
  createDebugTimeline,
  createDebugTimelinePlugin,
  type DebugTimeline,
  type DebugTimelineOptions,
} from "./debug-timeline.js";

// Health Monitor
export {
  createHealthMonitor,
  type HealthMonitor,
  type AgentHealthMetrics,
  type CircuitState as HealthCircuitState,
} from "./health-monitor.js";

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
