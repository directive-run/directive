/**
 * Directive - Constraint-driven runtime for TypeScript
 *
 * Declare requirements. Let the runtime resolve them.
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
	// Schema
	Schema,
	SchemaType,
	InferSchema,
	InferSchemaType,
	// Consolidated Module Schema
	ModuleSchema,
	DerivationsSchema,
	EventsSchema,
	EventPayloadSchema,
	InferFacts,
	InferDerivations,
	InferEventPayloadFromSchema,
	InferEvents,
	InferRequirementPayloadFromSchema,
	InferRequirements,
	InferRequirementTypes,
	// Facts
	Facts,
	FactsSnapshot,
	FactsStore,
	FactChange,
	// Derivations
	DerivationsDef,
	DerivationState,
	DerivedValues,
	TypedDerivationsDef,
	// Effects
	EffectsDef,
	// Requirements
	Requirement,
	RequirementWithId,
	RequirementKeyFn,
	RequirementPayloadSchema,
	RequirementsSchema,
	RequirementOutput,
	// Constraints
	ConstraintsDef,
	ConstraintState,
	TypedConstraintDef,
	TypedConstraintsDef,
	// Resolvers
	ResolversDef,
	ResolverContext,
	ResolverStatus,
	RetryPolicy,
	BatchConfig,
	TypedResolverContext,
	TypedResolverDef,
	TypedResolversDef,
	// Plugins
	Plugin,
	ReconcileResult,
	Snapshot,
	RecoveryStrategy,
	// Errors
	ErrorSource,
	ErrorBoundaryConfig,
	// Module
	ModuleDef,
	ModuleHooks,
	TypedEventsDef,
	// Events
	EventsDef,
	SystemEvent,
	EventsAccessorFromSchema,
	DispatchEventsFromSchema,
	FlexibleEventHandler,
	// System
	System,
	SystemConfig,
	SystemInspection,
	SystemSnapshot,
	DistributableSnapshotOptions,
	DistributableSnapshot,
	DebugConfig,
	TimeTravelAPI,
	RequirementExplanation,
	// Accessors
	DeriveAccessor,
	EventsAccessor,
	DerivationKeys,
	DerivationReturnType,
	// Typed Helper Utilities
	TypedConstraint,
	TypedResolver,
	// Composition (Namespaced Multi-Module)
	ModulesMap,
	NamespacedFacts,
	MutableNamespacedFacts,
	NamespacedDerivations,
	UnionEvents,
	NamespacedSystem,
	NamespacedEventsAccessor,
	CreateSystemOptionsNamed,
	// Single Module (no namespace)
	CreateSystemOptionsSingle,
	SingleModuleSystem,
	// Type Guards
	SystemMode,
	AnySystem,
	// Cross-Module Dependencies (for modules)
	CrossModuleDeps,
	CrossModuleFactsWithSelf,
	CrossModuleDerivationFn,
	CrossModuleDerivationsDef,
	CrossModuleConstraintDef,
	CrossModuleConstraintsDef,
	CrossModuleEffectDef,
	CrossModuleEffectsDef,
} from "./core/types.js";

// ============================================================================
// Core Classes
// ============================================================================

export { DirectiveError } from "./core/types.js";

// ============================================================================
// Schema Type Builders
// ============================================================================

/**
 * Schema type builders for defining fact types.
 *
 * Provides type-safe schema definitions with optional runtime validation:
 *
 * **Basic Types:**
 * - `t.string<T>()` - String type (with optional literal union)
 * - `t.number()` - Number type with `.min()` and `.max()` validation
 * - `t.boolean()` - Boolean type
 * - `t.bigint()` - BigInt type for large integers
 *
 * **Complex Types:**
 * - `t.array<T>()` - Array type with `.of()`, `.nonEmpty()`, `.minLength()`, `.maxLength()`
 * - `t.object<T>()` - Object type with `.shape()`, `.nonNull()`, `.hasKeys()`
 * - `t.record<V>(valueType)` - Record/map type `Record<string, V>`
 * - `t.tuple(types...)` - Fixed-length tuple type
 * - `t.union(types...)` - Union of multiple types
 *
 * **Literal & Enum Types:**
 * - `t.enum(...values)` - String enum from literal values
 * - `t.literal(value)` - Exact value matching (string, number, or boolean)
 *
 * **Wrappers:**
 * - `t.nullable(type)` - Nullable wrapper (`T | null`)
 * - `t.optional(type)` - Optional wrapper (`T | undefined`)
 *
 * **Validation Types:**
 * - `t.date()` - Date type
 * - `t.uuid()` - UUID string format
 * - `t.email()` - Email string format
 * - `t.url()` - URL string format
 *
 * **Escape Hatch:**
 * - `t.any<T>()` - Bypass validation (warns in dev)
 *
 * **Chainable Methods (available on most types):**
 * - `.default(value)` - Set default value
 * - `.transform(fn)` - Transform values
 * - `.brand<B>()` - Add branded/nominal type
 * - `.describe(text)` - Add schema documentation
 * - `.refine(predicate, message)` - Custom validation with error message
 * - `.nullable()` - Make nullable (chainable alternative to `t.nullable()`)
 * - `.optional()` - Make optional (chainable alternative to `t.optional()`)
 * - `.validate(fn)` - Add custom validator
 *
 * @example
 * ```ts
 * import { t } from 'directive';
 *
 * const schema = {
 *   facts: {
 *     count: t.number().min(0).default(0),
 *     name: t.string().describe("User's display name"),
 *     status: t.enum("idle", "loading", "success", "error"),
 *     user: t.object<User>().nullable(),
 *     config: t.object<Config>().optional(),
 *     userId: t.string().brand<"UserId">(),
 *     age: t.number().refine(n => n >= 0, "Age must be non-negative"),
 *   },
 *   derivations: {
 *     doubled: t.number(),
 *   },
 *   events: {
 *     increment: {},
 *     setStatus: { status: t.enum("idle", "loading", "success", "error") },
 *   },
 *   requirements: {},
 * };
 * ```
 */
export { t, type Branded, type ExtendedSchemaType, type ChainableSchemaType } from "./core/facts.js";

// ============================================================================
// Module & System
// ============================================================================

export {
	createModule,
	type ModuleConfig,
	type ModuleConfigWithDeps,
} from "./core/module.js";
export { createSystem } from "./core/system.js";
export {
	module,
	type ModuleBuilder,
} from "./core/builder.js";

// Convenience helper for status plugin setup
export { createSystemWithStatus } from "./utils/system-with-status.js";

// Helper factory functions for external constraint/resolver definitions
export {
	constraintFactory,
	resolverFactory,
	typedConstraint,
	typedResolver,
} from "./core/types.js";

// ============================================================================
// Requirements Helpers
// ============================================================================

export {
	req,
	forType,
	isRequirementType,
	generateRequirementId,
	RequirementSet,
} from "./core/requirements.js";

// ============================================================================
// Type Guards
// ============================================================================

export {
	isSingleModuleSystem,
	isNamespacedSystem,
} from "./core/types/composition.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Backoff strategy constants for retry policies.
 * Use for autocomplete when configuring resolver retry policies.
 *
 * @example
 * ```ts
 * import { Backoff } from 'directive';
 *
 * const resolver = {
 *   requirement: "FETCH_DATA",
 *   retry: {
 *     attempts: 3,
 *     backoff: Backoff.Exponential, // Autocomplete-friendly!
 *     initialDelay: 100,
 *   },
 *   resolve: async (req, ctx) => { ... },
 * };
 * ```
 */
export const Backoff = {
	/** No delay between retries */
	None: "none",
	/** Linear delay increase (initialDelay * attempt) */
	Linear: "linear",
	/** Exponential delay increase (initialDelay * 2^attempt) */
	Exponential: "exponential",
} as const;

// ============================================================================
// Lower-level APIs (for advanced use)
// ============================================================================

export { createFacts, createFactsStore, createFactsProxy } from "./core/facts.js";
export { createDerivationsManager } from "./core/derivations.js";
export { createEffectsManager } from "./core/effects.js";
export { createConstraintsManager } from "./core/constraints.js";
export { createResolversManager, type InflightInfo } from "./core/resolvers.js";
export { createPluginManager } from "./core/plugins.js";
export { createErrorBoundaryManager } from "./core/errors.js";
export { createTimeTravelManager, createDisabledTimeTravel } from "./utils/time-travel.js";
export { createEngine } from "./core/engine.js";

// ============================================================================
// Tracking (for custom derivations)
// ============================================================================

export {
	getCurrentTracker,
	isTracking,
	withTracking,
	withoutTracking,
	trackAccess,
} from "./core/tracking.js";

// ============================================================================
// Requirement Status Utilities
// ============================================================================

export {
	createRequirementStatusPlugin,
	createStatusHook,
	type RequirementTypeStatus,
} from "./utils/requirement-status.js";

// ============================================================================
// Distributable Snapshot Utilities
// ============================================================================

export {
	isSnapshotExpired,
	validateSnapshot,
	type DistributableSnapshotLike,
} from "./utils/utils.js";

// ============================================================================
// OpenAI Agents Adapter
// ============================================================================

export {
	createAgentOrchestrator,
	createOrchestratorBuilder,
	createPIIGuardrail,
	createModerationGuardrail,
	createRateLimitGuardrail,
	createToolGuardrail,
	isAgentRunning,
	hasPendingApprovals,
	estimateCost,
	GuardrailError,
	isGuardrailError,
	type AgentLike,
	type RunResult,
	type Message,
	type ToolCall,
	type RunFn,
	type RunOptions,
	type GuardrailFn,
	type GuardrailContext,
	type GuardrailResult,
	type InputGuardrailData,
	type OutputGuardrailData,
	type ToolCallGuardrailData,
	type NamedGuardrail,
	type GuardrailsConfig,
	type AgentState,
	type ApprovalState,
	type ApprovalRequest,
	type OrchestratorState,
	type OrchestratorConstraint,
	type OrchestratorResolver,
	type OrchestratorResolverContext,
	type OrchestratorOptions,
	type AgentOrchestrator,
	type OrchestratorBuilder,
	type GuardrailErrorCode,
} from "./adapters/openai-agents.js";

// ============================================================================
// OpenAI Agents Streaming
// ============================================================================

export {
	createStreamingRunner,
	createToxicityStreamingGuardrail,
	createLengthStreamingGuardrail,
	createPatternStreamingGuardrail,
	combineStreamingGuardrails,
	adaptOutputGuardrail,
	collectTokens,
	tapStream,
	filterStream,
	mapStream,
	type StreamChunk,
	type TokenChunk,
	type ToolStartChunk,
	type ToolEndChunk,
	type MessageChunk,
	type GuardrailTriggeredChunk,
	type ProgressChunk,
	type DoneChunk,
	type ErrorChunk,
	type StreamRunOptions,
	type StreamRunFn,
	type StreamingRunResult,
	type StreamingGuardrail,
	type StreamingGuardrailResult,
	type BackpressureStrategy,
} from "./adapters/openai-agents-streaming.js";

// ============================================================================
// OpenAI Agents Multi-Agent Patterns
// ============================================================================

export {
	createMultiAgentOrchestrator,
	parallel,
	sequential,
	supervisor,
	selectAgent,
	runAgentRequirement,
	concatResults,
	pickBestResult,
	collectOutputs,
	aggregateTokens,
	type AgentRegistration,
	type AgentRegistry,
	type AgentRunState,
	type ParallelPattern,
	type SequentialPattern,
	type SupervisorPattern,
	type ExecutionPattern,
	type HandoffRequest,
	type HandoffResult,
	type AgentSelectionConstraint,
	type RunAgentRequirement,
	type MultiAgentOrchestratorOptions,
	type MultiAgentState,
	type MultiAgentOrchestrator as MultiAgentOrchestratorInstance,
} from "./adapters/openai-agents-multi.js";

// ============================================================================
// OpenAI Agents Testing Utilities
// ============================================================================

export {
	createMockAgentRunner,
	testGuardrail,
	testGuardrailBatch,
	createApprovalSimulator,
	createTestOrchestrator,
	createConstraintRecorder,
	assertOrchestratorState,
	createTimeController,
	type MockAgentConfig,
	type MockAgentRunnerOptions,
	type RecordedCall,
	type MockAgentRunner,
	type GuardrailTestInput,
	type GuardrailTestResult,
	type ApprovalSimulatorOptions,
	type ApprovalSimulator,
	type TestOrchestratorOptions,
	type TestOrchestrator,
	type ConstraintSnapshot,
} from "./adapters/openai-agents-testing.js";

// ============================================================================
// Security Guardrails
// ============================================================================

export {
	createPromptInjectionGuardrail,
	createUntrustedContentGuardrail,
	detectPromptInjection,
	sanitizeInjection,
	markUntrustedContent,
	DEFAULT_INJECTION_PATTERNS,
	STRICT_INJECTION_PATTERNS,
	createEnhancedPIIGuardrail,
	createOutputPIIGuardrail,
	detectPII,
	redactPII,
	regexDetector,
	createOutputSanitizer,
	composeGuardrails,
	conditionalGuardrail,
	retryableGuardrail,
	type InjectionPattern,
	type InjectionCategory,
	type InjectionDetectionResult,
	type PromptInjectionGuardrailOptions,
	type PIIType,
	type DetectedPII,
	type PIIDetectionResult,
	type PIIDetector,
	type RedactionStyle,
	type EnhancedPIIGuardrailOptions,
	type OutputSanitizerOptions,
} from "./adapters/guardrails/index.js";

// ============================================================================
// MCP Adapter
// ============================================================================

export {
	createMCPAdapter,
	convertToolsForLLM,
	mcpCallTool,
	mcpReadResource,
	mcpGetPrompt,
	mcpSyncResources,
	isMCPRequirement,
	isMCPCallToolRequirement,
	isMCPReadResourceRequirement,
	isMCPGetPromptRequirement,
	isMCPSyncResourcesRequirement,
	type MCPAdapter,
	type MCPServerConfig,
	type MCPTransport,
	type MCPTool,
	type MCPResource,
	type MCPPrompt,
	type MCPClient,
	type MCPCapabilities,
	type MCPToolResult,
	type MCPContent,
	type MCPToolConstraint,
	type MCPResourceMapping,
	type MCPAdapterConfig,
	type MCPAdapterEvents,
	type MCPRequirement,
	type MCPCallToolRequirement,
	type MCPReadResourceRequirement,
	type MCPGetPromptRequirement,
	type MCPSyncResourcesRequirement,
} from "./adapters/mcp.js";
