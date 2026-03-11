# API Skeleton

> Auto-generated from api-reference.json. Do not edit manually.
> Validated in CI — if this file is stale, run `pnpm --filter @directive-run/knowledge generate`.

## @directive-run/core

### Functions

- `createConstraintFactory` — Create a typed constraint factory for a specific schema.
- `createConstraintsManager` — Create a manager that evaluates constraint rules and produces unmet
  ```ts
  function createConstraintsManager(options: CreateConstraintsOptions<S>): ConstraintsManager<S>
  ```
- `createDerivationsManager` — Create a manager for lazily-evaluated, auto-tracked derived values.
  ```ts
  function createDerivationsManager(options: CreateDerivationsOptions<S, D>): DerivationsManager<S, D>
  ```
- `createDisabledHistory` — Create a no-op history manager for use when history is disabled.
  ```ts
  function createDisabledHistory(): HistoryManager<S>
  ```
- `createEffectsManager` — Create a manager for fire-and-forget side effects that run after facts
  ```ts
  function createEffectsManager(options: CreateEffectsOptions<S>): EffectsManager<S>
  ```
- `createEngine` — Create the core Directive reconciliation engine that wires facts, derivations,
  ```ts
  function createEngine(config: SystemConfig<any>): System<any>
  ```
- `createErrorBoundaryManager` — Create a manager that handles errors from constraints, resolvers, effects,
  ```ts
  function createErrorBoundaryManager(options: CreateErrorBoundaryOptions = {}): ErrorBoundaryManager
  ```
- `createFacts` — Convenience factory that creates both a {@link FactsStore} and its
  ```ts
  function createFacts(options: CreateFactsStoreOptions<S>): { store: FactsStore<S>; facts: Facts<S>; }
  ```
- `createFactsProxy` — Create a Proxy wrapper around a {@link FactsStore} for clean property-style
  ```ts
  function createFactsProxy(store: FactsStore<S>, schema: S): Facts<S>
  ```
- `createFactsStore` — Create a reactive facts store backed by a Map with schema validation,
  ```ts
  function createFactsStore(options: CreateFactsStoreOptions<S>): FactsStore<S>
  ```
- `createHistoryManager` — Create a snapshot-based history manager backed by a ring buffer.
  ```ts
  function createHistoryManager(options: CreateHistoryOptions<S>): HistoryManager<S>
  ```
- `createModule` — Create a module definition with full type inference.
  ```ts
  export function createModule<
  ```
- `createModuleFactory` — Create a module factory that produces named instances from a single definition.
  ```ts
  export function createModuleFactory<const M extends ModuleSchema>(
  ```
- `createPluginManager` — Create a {@link PluginManager} that broadcasts lifecycle events to registered plugins.
  ```ts
  function createPluginManager(): PluginManager<S>
  ```
- `createRequirementStatusPlugin` — Create a plugin that tracks requirement status for reactive UI updates.
- `createResolverFactory` — Create a typed resolver factory for a specific schema.
- `createResolversManager` — Create a manager that fulfills requirements by matching them to resolver
  ```ts
  function createResolversManager(options: CreateResolversOptions<S>): ResolversManager<S>
  ```
- `createRetryLaterManager` — Create a manager for deferred retry scheduling with exponential backoff.
- `createStatusHook` — Create a hook factory for requirement status.
- `createSystem` — Create a Directive system.
  ```ts
  export function createSystem<S extends ModuleSchema>(
  ```
- `createSystemWithStatus` — Create a Directive system with a status plugin pre-configured.
  ```ts
  function createSystemWithStatus(options: CreateSystemWithStatusOptions<M>): SystemWithStatus<M>
  ```
- `diffSnapshots` — Compare two distributable snapshots and return the differences.
- `forType` — Create a type-guard function suitable for a resolver's `requirement`
  ```ts
  export function forType<R extends Requirement>(
  ```
- `getCurrentTracker` — Get the current tracking context.
  ```ts
  function getCurrentTracker(): TrackingContext
  ```
- `isNamespacedSystem` — Check if a system is a namespaced (multi-module) system.
  ```ts
  function isNamespacedSystem(system: AnySystem): boolean
  ```
- `isRequirementType` — Type-narrowing guard that checks whether a requirement's `type` matches the
  ```ts
  function isRequirementType(req: Requirement, type: T): boolean
  ```
- `isSignedSnapshot` — Check if a snapshot is signed.
  ```ts
  function isSignedSnapshot(snapshot: DistributableSnapshotLike<T> | SignedSnapshot<T>): boolean
  ```
- `isSingleModuleSystem` — Check if a system is a single module system.
  ```ts
  function isSingleModuleSystem(system: AnySystem): boolean
  ```
- `isSnapshotExpired` — Check if a distributable snapshot has expired.
  ```ts
  function isSnapshotExpired(snapshot: DistributableSnapshotLike<T>, now: number = Date.now()): boolean
  ```
- `isTracking` — Check if we're currently tracking dependencies.
  ```ts
  function isTracking(): boolean
  ```
- `req` — Create a typed requirement factory for a given requirement type string.
  ```ts
  function req(type: T): <P extends Record<string, unknown>>(props: P) => Requirement & { type: T; } & P
  ```
- `shallowEqual` — Shallow equality comparison for objects.
  ```ts
  function shallowEqual(a: T, b: T): boolean
  ```
- `signSnapshot` — Sign a distributable snapshot using HMAC-SHA256.
  ```ts
  function signSnapshot(snapshot: DistributableSnapshotLike<T>, secret: string | Uint8Array): Promise<SignedSnapshot<T>>
  ```
- `trackAccess` — Track a specific key in the current context.
  ```ts
  function trackAccess(key: string): void
  ```
- `typedConstraint` — Type-safe constraint creator.
  ```ts
  function typedConstraint(constraint: TypedConstraint<S, R>): TypedConstraint<S, R>
  ```
- `typedResolver` — Type-safe resolver creator.
  ```ts
  function typedResolver(resolver: TypedResolver<S, R>): TypedResolver<S, R>
  ```
- `validateSnapshot` — Validate a distributable snapshot and return its data.
  ```ts
  function validateSnapshot(snapshot: DistributableSnapshotLike<T>, now: number = Date.now()): T
  ```
- `verifySnapshotSignature` — Verify the signature of a signed snapshot.
  ```ts
  function verifySnapshotSignature(signedSnapshot: SignedSnapshot<T>, secret: string | Uint8Array): Promise<boolean>
  ```
- `withoutTracking` — Run a function without tracking.
  ```ts
  function withoutTracking(fn: () => T): T
  ```
- `withTracking` — Run a function with dependency tracking.
  ```ts
  function withTracking(fn: () => T): { value: T; deps: Set<string>; }
  ```

### Classes

- `DirectiveError` — Extended Error class with source tracking, recovery metadata, and
  ```ts
  class DirectiveError
  ```
- `RequirementSet` — A deduplicated collection of {@link RequirementWithId} entries keyed by
  ```ts
  class RequirementSet
  ```

### Interfaces

- `AnySystem` — Base system type for type guards.
  ```ts
  export interface AnySystem {
  ```
- `BatchConfig` — Batch configuration
  ```ts
  export interface BatchConfig {
  ```
- `BatchItemResult` — Result for a single item in a batch resolution.
  ```ts
  export interface BatchItemResult<T = unknown> {
  ```
- `ChainableSchemaType` — Chainable schema type with all common methods
  ```ts
  export interface ChainableSchemaType<T> extends ExtendedSchemaType<T> {
  ```
- `ConstraintsControl` — Runtime control for constraints
  ```ts
  export interface ConstraintsControl {
  ```
- `ConstraintState` — Internal constraint state
  ```ts
  export interface ConstraintState {
  ```
- `CreateSystemOptionsNamed` — Options for createSystem with object modules (namespaced mode).
  ```ts
  export interface CreateSystemOptionsNamed<Modules extends ModulesMap> {
  ```
- `CreateSystemOptionsSingle` — Options for createSystem with a single module (no namespacing).
  ```ts
  export interface CreateSystemOptionsSingle<S extends ModuleSchema> {
  ```
- `CrossModuleConstraintDef` — Constraint definition with cross-module typed facts.
  ```ts
  export interface CrossModuleConstraintDef<
  ```
- `CrossModuleEffectDef` — Effect definition with cross-module typed facts.
  ```ts
  export interface CrossModuleEffectDef<
  ```
- `DerivationsControl` — Runtime control for derivations (dynamic registration + value access)
  ```ts
  export interface DerivationsControl {
  ```
- `DerivationState` — Internal derivation state
  ```ts
  export interface DerivationState<T> {
  ```
- `DistributableSnapshot` — A distributable snapshot containing computed state.
  ```ts
  export interface DistributableSnapshot<T = Record<string, unknown>> {
  ```
- `DistributableSnapshotLike` — Distributable snapshot type for type-safe helper functions.
  ```ts
  export interface DistributableSnapshotLike<T = Record<string, unknown>> {
  ```
- `DistributableSnapshotOptions` — Options for creating a distributable snapshot.
  ```ts
  export interface DistributableSnapshotOptions {
  ```
- `EffectsControl` — Runtime control for effects
  ```ts
  export interface EffectsControl {
  ```
- `ErrorBoundaryConfig` — Error boundary configuration
  ```ts
  export interface ErrorBoundaryConfig {
  ```
- `ExtendedSchemaType` — Extended SchemaType with type name for better error messages
  ```ts
  export interface ExtendedSchemaType<T> extends SchemaType<T> {
  ```
- `FactChange` — Fact change record
  ```ts
  export interface FactChange {
  ```
- `FactsSnapshot` — Read-only snapshot of facts
  ```ts
  export interface FactsSnapshot<S extends Schema = Schema> {
  ```
- `FactsStore` — Mutable facts store
  ```ts
  export interface FactsStore<S extends Schema = Schema>
  ```
- `HistoryAPI` — History API for snapshot navigation, changesets, and export/import
  ```ts
  export interface HistoryAPI {
  ```
- `HistoryConfig` — History configuration for snapshot-based state history (undo/redo, rollback, audit trails)
  ```ts
  export interface HistoryConfig {
  ```
- `HistoryState` — Reactive history state for framework hooks
  ```ts
  export interface HistoryState {
  ```
- `InflightInfo` — Summary of a resolver that is currently in flight.
  ```ts
  export interface InflightInfo {
  ```
- `ModuleConfig` — Module configuration with consolidated schema.
  ```ts
  export interface ModuleConfig<M extends ModuleSchema> {
  ```
- `ModuleConfigWithDeps` — Module configuration with cross-module dependencies for type-safe access
  ```ts
  export interface ModuleConfigWithDeps<
  ```
- `ModuleDef` — Module definition using consolidated schema.
  ```ts
  export interface ModuleDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `ModuleHooks` — Lifecycle hooks for modules
  ```ts
  export interface ModuleHooks<_M extends ModuleSchema> {
  ```
- `ModuleSchema` — Consolidated module schema - single source of truth for all types.
  ```ts
  export interface ModuleSchema {
  ```
- `NamespacedSystem` — System interface for namespaced modules.
  ```ts
  export interface NamespacedSystem<Modules extends ModulesMap> {
  ```
- `PendingRetry` — A queued retry entry tracking its source, attempt count, and scheduled time.
  ```ts
  export interface PendingRetry {
  ```
- `Plugin` — Plugin interface for extending Directive functionality.
  ```ts
  export interface Plugin<M extends ModuleSchema = ModuleSchema> {
  ```
- `ReconcileResult` — Reconcile result
  ```ts
  export interface ReconcileResult {
  ```
- `Requirement` — Base requirement structure
  ```ts
  export interface Requirement {
  ```
- `RequirementExplanation` — Explanation of why a requirement exists
  ```ts
  export interface RequirementExplanation {
  ```
- `RequirementTypeStatus` — Status of a requirement type
  ```ts
  export interface RequirementTypeStatus {
  ```
- `RequirementWithId` — Requirement with computed identity
  ```ts
  export interface RequirementWithId {
  ```
- `ResolverContext` — Resolver context passed to resolve function
  ```ts
  export interface ResolverContext<S extends Schema = Schema> {
  ```
- `ResolversControl` — Runtime control for resolvers
  ```ts
  export interface ResolversControl {
  ```
- `RetryLaterConfig` — Configuration for retry-later strategy.
  ```ts
  export interface RetryLaterConfig {
  ```
- `RetryPolicy` — Retry policy configuration
  ```ts
  export interface RetryPolicy {
  ```
- `SchemaType` — Primitive type definitions for schema
  ```ts
  export interface SchemaType<T> {
  ```
- `SignedSnapshot` — A signed distributable snapshot.
  ```ts
  export interface SignedSnapshot<T = Record<string, unknown>>
  ```
- `SingleModuleSystem` — System interface for a single module (no namespace).
  ```ts
  export interface SingleModuleSystem<S extends ModuleSchema> {
  ```
- `Snapshot` — Snapshot for time-travel
  ```ts
  export interface Snapshot {
  ```
- `SnapshotDiff` — Result of diffing two snapshots.
  ```ts
  export interface SnapshotDiff {
  ```
- `SnapshotDiffEntry` — Diff result for a single changed value.
  ```ts
  export interface SnapshotDiffEntry {
  ```
- `SnapshotMeta` — Lightweight snapshot metadata (no facts data — keeps re-renders cheap)
  ```ts
  export interface SnapshotMeta {
  ```
- `SystemConfig` — System configuration
  ```ts
  export interface SystemConfig<M extends ModuleSchema = ModuleSchema> {
  ```
- `SystemEvent` — System event
  ```ts
  export interface SystemEvent {
  ```
- `SystemInspection` — System inspection result
  ```ts
  export interface SystemInspection {
  ```
- `SystemSnapshot` — Serializable system snapshot for SSR/persistence
  ```ts
  export interface SystemSnapshot {
  ```
- `TraceConfig` — Trace configuration for per-run reconciliation changelogs
  ```ts
  export interface TraceConfig {
  ```
- `TraceEntry` — A structured record of one reconciliation run — fact changes, derivation recomputes, constraints hit, resolvers, effects.
  ```ts
  export interface TraceEntry {
  ```
- `TypedConstraint` — External constraint definition with full typing.
  ```ts
  export interface TypedConstraint<
  ```
- `TypedConstraintDef` — Constraint definition with typed requirements.
  ```ts
  export interface TypedConstraintDef<M extends ModuleSchema> {
  ```
- `TypedResolver` — External resolver definition with full typing.
  ```ts
  export interface TypedResolver<
  ```
- `TypedResolverContext` — Resolver context with typed facts.
  ```ts
  export interface TypedResolverContext<M extends ModuleSchema> {
  ```
- `TypedResolverDef` — Typed resolver definition for a specific requirement type.
  ```ts
  export interface TypedResolverDef<
  ```

### Types

- `BatchResolveResults` — Results from batch resolution with per-item status.
  ```ts
  export type BatchResolveResults<T = unknown> = Array<BatchItemResult<T>>;
  ```
- `Branded` — Branded type - adds a unique brand to a base type
  ```ts
  export type Branded<T, B extends string> = T & { readonly [Brand]: B };
  ```
- `ConstraintsDef` — Map of constraint definitions (generic)
  ```ts
  export type ConstraintsDef<S extends Schema> = Record<
  ```
- `CrossModuleConstraintsDef` — Cross-module constraints definition.
  ```ts
  export type CrossModuleConstraintsDef<
  ```
- `CrossModuleDeps` — Map of namespace to schema for cross-module dependencies.
  ```ts
  export type CrossModuleDeps = Record<string, ModuleSchema>;
  ```
- `CrossModuleDerivationFn` — Derivation function with cross-module typed facts.
  ```ts
  export type CrossModuleDerivationFn<
  ```
- `CrossModuleDerivationsDef` — Cross-module derivations definition.
  ```ts
  export type CrossModuleDerivationsDef<
  ```
- `CrossModuleEffectsDef` — Cross-module effects definition.
  ```ts
  export type CrossModuleEffectsDef<
  ```
- `CrossModuleFactsWithSelf` — Cross-module facts type using "self" for own module.
  ```ts
  export type CrossModuleFactsWithSelf<
  ```
- `DerivationKeys` — Derivation keys from module schema.
  ```ts
  export type DerivationKeys<M extends ModuleSchema> = keyof M["derivations"] &
  ```
- `DerivationReturnType` — Get derivation return type from module schema.
  ```ts
  export type DerivationReturnType<
  ```
- `DerivationsDef` — Map of derivation definitions.
  ```ts
  export type DerivationsDef<S extends Schema> = Record<
  ```
- `DerivationsSchema` — Derivations schema - maps derivation names to their return types.
  ```ts
  export type DerivationsSchema = Record<string, SchemaType<unknown> | unknown>;
  ```
- `DeriveAccessor` — Derive accessor from module schema.
  ```ts
  export type DeriveAccessor<M extends ModuleSchema> = InferDerivations<M>;
  ```
- `DerivedValues` — Computed derived values.
  ```ts
  export type DerivedValues<S extends Schema, D extends DerivationsDef<S>> = {
  ```
- `DispatchEventsFromSchema` — Dispatch events union type from a module schema.
  ```ts
  export type DispatchEventsFromSchema<M extends ModuleSchema> = InferEvents<M>;
  ```
- `EffectCleanup` — A cleanup function returned by an effect's `run()`.
  ```ts
  export type EffectCleanup = () => void;
  ```
- `EffectsDef` — Map of effect definitions
  ```ts
  export type EffectsDef<S extends Schema> = Record<string, EffectDef<S>>;
  ```
- `ErrorSource` — Error source types
  ```ts
  export type ErrorSource =
  ```
- `EventPayloadSchema` — Event payload schema - maps property names to their types.
  ```ts
  export type EventPayloadSchema = Record<string, SchemaType<unknown> | unknown>;
  ```
- `EventsAccessor` — Events accessor from module schema.
  ```ts
  export type EventsAccessor<M extends ModuleSchema> =
  ```
- `EventsAccessorFromSchema` — Events accessor type from a module schema.
  ```ts
  export type EventsAccessorFromSchema<M extends ModuleSchema> = {
  ```
- `EventsDef` — Events definition - accepts any event handler signature
  ```ts
  export type EventsDef<S extends Schema> = Record<
  ```
- `EventsSchema` — Events schema - maps event names to their payload schemas.
  ```ts
  export type EventsSchema = Record<string, EventPayloadSchema>;
  ```
- `FactKeys` — Fact keys from module schema.
  ```ts
  export type FactKeys<M extends ModuleSchema> = keyof M["facts"] & string;
  ```
- `FactReturnType` — Get fact return type from module schema.
  ```ts
  export type FactReturnType<
  ```
- `Facts` — Proxy-based facts accessor (cleaner API)
  ```ts
  export type Facts<S extends Schema = Schema> = InferSchema<S> & {
  ```
- `FlexibleEventHandler` — Flexible event handler that accepts either:
  ```ts
  export type FlexibleEventHandler<S extends Schema> = (
  ```
- `HistoryOption` — History option: boolean shorthand or full config (presence implies enabled)
  ```ts
  export type HistoryOption = boolean | HistoryConfig;
  ```
- `InferDerivations` — Infer derivation values from a module schema.
  ```ts
  export type InferDerivations<M extends ModuleSchema> = {
  ```
- `InferEventPayloadFromSchema` — Infer event payload type from an event payload schema.
  ```ts
  export type InferEventPayloadFromSchema<P extends EventPayloadSchema> = {
  ```
- `InferEvents` — Infer all events from a module schema as a discriminated union.
  ```ts
  export type InferEvents<M extends ModuleSchema> = {
  ```
- `InferFacts` — Infer the facts type from a module schema.
  ```ts
  export type InferFacts<M extends ModuleSchema> = InferSchema<M["facts"]>;
  ```
- `InferRequirementPayloadFromSchema` — Infer requirement payload type from a requirement payload schema.
  ```ts
  export type InferRequirementPayloadFromSchema<
  ```
- `InferRequirements` — Infer all requirements from a module schema as a discriminated union.
  ```ts
  export type InferRequirements<M extends ModuleSchema> = {
  ```
- `InferRequirementTypes` — Infer requirement type names from a module schema.
  ```ts
  export type InferRequirementTypes<M extends ModuleSchema> =
  ```
- `InferSchema` — Extract the TypeScript type from a schema (removes readonly from const type params)
  ```ts
  export type InferSchema<S extends Schema> = {
  ```
- `InferSchemaType` — Infer a single type from a SchemaType, Zod schema, or plain type.
  ```ts
  export type InferSchemaType<T> = T extends SchemaType<infer U>
  ```
- `InferSelectorState` — Combined facts + derivations — matches the useSelector proxy at runtime.
  ```ts
  export type InferSelectorState<M extends ModuleSchema> = InferFacts<M> &
  ```
- `ModulesMap` — Map of module name to module definition (object form).
  ```ts
  export type ModulesMap = Record<string, ModuleDef<any>>;
  ```
- `MutableNamespacedFacts` — Mutable version for constraint/resolver callbacks.
  ```ts
  export type MutableNamespacedFacts<Modules extends ModulesMap> = {
  ```
- `NamespacedDerivations` — Namespace derivations under module keys.
  ```ts
  export type NamespacedDerivations<Modules extends ModulesMap> = {
  ```
- `NamespacedEventsAccessor` — Events accessor that groups event dispatchers by module namespace.
  ```ts
  export type NamespacedEventsAccessor<Modules extends ModulesMap> = {
  ```
- `NamespacedFacts` — Namespace facts under module keys.
  ```ts
  export type NamespacedFacts<Modules extends ModulesMap> = {
  ```
- `ObservableKeys` — All observable keys (facts + derivations) from module schema.
  ```ts
  export type ObservableKeys<M extends ModuleSchema> =
  ```
- `RecoveryStrategy` — Recovery strategy for errors
  ```ts
  export type RecoveryStrategy =
  ```
- `RequirementKeyFn` — Requirement key function for custom deduplication
  ```ts
  export type RequirementKeyFn<R extends Requirement = Requirement> = (
  ```
- `RequirementOutput` — Requirement output from a constraint.
  ```ts
  export type RequirementOutput<R> = R | R[] | null;
  ```
- `RequirementPayloadSchema` — Requirement payload schema - maps property names to their types.
  ```ts
  export type RequirementPayloadSchema = Record<
  ```
- `RequirementsSchema` — Requirements schema definition - maps requirement type names to their payload schemas.
  ```ts
  export type RequirementsSchema = Record<string, RequirementPayloadSchema>;
  ```
- `ResolversDef` — Map of resolver definitions
  ```ts
  export type ResolversDef<S extends Schema> = Record<
  ```
- `ResolverStatus` — Resolver status
  ```ts
  export type ResolverStatus =
  ```
- `Schema` — Schema definition mapping keys to types.
  ```ts
  export type Schema = Record<string, SchemaType<unknown> | unknown>;
  ```
- `SystemMode` — System mode discriminator.
  ```ts
  export type SystemMode = "single" | "namespaced";
  ```
- `TraceOption` — Trace option: boolean shorthand or full config (presence implies enabled)
  ```ts
  export type TraceOption = boolean | TraceConfig;
  ```
- `TypedConstraintsDef` — Typed constraints definition using the module schema.
  ```ts
  export type TypedConstraintsDef<M extends ModuleSchema> = Record<
  ```
- `TypedDerivationsDef` — Typed derivations definition using the module schema.
  ```ts
  export type TypedDerivationsDef<M extends ModuleSchema> = {
  ```
- `TypedEventsDef` — Typed events definition using the module schema.
  ```ts
  export type TypedEventsDef<M extends ModuleSchema> = {
  ```
- `TypedResolversDef` — Typed resolvers definition using the module schema.
  ```ts
  export type TypedResolversDef<M extends ModuleSchema> = Record<
  ```
- `UnionEvents` — Union of all module events (not namespaced).
  ```ts
  export type UnionEvents<Modules extends ModulesMap> = {
  ```

### Constants

- `Backoff` — Backoff strategy constants for retry policies.
  ```ts
  export const Backoff = {
  ```
- `t` — Schema type builders for defining fact types.
  ```ts
  export const t = {
  ```


## @directive-run/ai

### Functions

- `adaptOutputGuardrail` — Convert a regular output guardrail to a streaming guardrail.
  ```ts
  function adaptOutputGuardrail(name: string, guardrail: GuardrailFn<OutputGuardrailData>, options: {
  ```
- `aggregateTokens` — Sum the total token counts from an array of run results.
  ```ts
  function aggregateTokens(results: RunResult<unknown>[]): number
  ```
- `allReadyStrategy` — Create a selection strategy that runs all ready agents concurrently.
  ```ts
  function allReadyStrategy(): AgentSelectionStrategy
  ```
- `byAgentName` — Match by agent name (exact string match).
  ```ts
  function byAgentName(name: string, model: string): ModelRule
  ```
- `byInputLength` — Match when input character length is at most `maxLength`.
  ```ts
  function byInputLength(maxLength: number, model: string): ModelRule
  ```
- `byPattern` — Match by regex pattern on the input text.
  ```ts
  function byPattern(pattern: RegExp, model: string): ModelRule
  ```
- `capabilityRoute` — Create a constraint that auto-routes to an agent based on required capabilities.
- `collectOutputs` — Extract the `output` value from each run result into an array.
  ```ts
  function collectOutputs(results: RunResult<T>[]): T[]
  ```
- `collectTokens` — Collect all tokens from a stream into a string.
  ```ts
  function collectTokens(stream: AsyncIterable<StreamChunk>): Promise<string>
  ```
- `combineStreamingGuardrails` — Combine multiple streaming guardrails into one.
- `composePatterns` — Compose multiple execution patterns into a pipeline where each pattern's
- `concatResults` — Merge run results by concatenating their outputs into a single string.
  ```ts
  function concatResults(results: RunResult<unknown>[], separator = "\n\n"): string
  ```
- `connectDevTools` — Connect DevTools to an orchestrator instance.
- `convertToolsForLLM` — Convert MCP tools to a format suitable for LLM tool calling.
- `costEfficientStrategy` — Create a selection strategy that prefers agents with lower token cost per satisfaction delta.
  ```ts
  function costEfficientStrategy(): AgentSelectionStrategy
  ```
- `createAgentAuditHandlers` — Create audit event handlers for agent orchestrator integration.
- `createAgentMemory` — Create an agent memory instance for managing conversation history.
  ```ts
  function createAgentMemory(config: AgentMemoryConfig): AgentMemory
  ```
- `createAgentNetwork` — Create an agent network for coordinated communication.
  ```ts
  function createAgentNetwork(config: AgentNetworkConfig): AgentNetwork
  ```
- `createAgentOrchestrator` — Create a constraint-driven agent orchestrator backed by a Directive System.
  ```ts
  function createAgentOrchestrator(options: OrchestratorOptions<F>): AgentOrchestrator<F>
  ```
- `createAuditTrail` — Create an audit trail instance for enterprise-grade audit logging.
  ```ts
  function createAuditTrail(config: AuditPluginConfig = {}): AuditInstance
  ```
- `createBatchedEmbedder` — Create a batched embedder that groups multiple texts into single API calls.
  ```ts
  function createBatchedEmbedder(config: {
  ```
- `createBatchQueue` — Create a batch queue for grouping agent calls.
  ```ts
  function createBatchQueue(runner: AgentRunner, config: BatchQueueConfig = {}): BatchQueue
  ```
- `createBidirectionalStream` — Create a bidirectional stream channel for two-way communication between agents.
- `createBreakpointId` — Create a unique breakpoint ID
  ```ts
  function createBreakpointId(): string
  ```
- `createBruteForceIndex` — Create a brute-force exact search index.
  ```ts
  function createBruteForceIndex(): ANNIndex
  ```
- `createCheckpointId` — Create a unique checkpoint ID
  ```ts
  function createCheckpointId(): string
  ```
- `createCircuitBreaker` — Create a circuit breaker for protecting against cascading failures.
  ```ts
  declare function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker
  ```
- `createCompliance` — Create a compliance instance for GDPR/CCPA data subject rights.
  ```ts
  function createCompliance(config: ComplianceConfig): ComplianceInstance
  ```
- `createConstraintRouter` — Create a constraint-driven provider router.
  ```ts
  function createConstraintRouter(config: ConstraintRouterConfig): ConstraintRouterRunner
  ```
- `createContentFilterGuardrail` — Create an output guardrail that blocks content matching any of the provided patterns.
  ```ts
  function createContentFilterGuardrail(options: {
  ```
- `createDebugTimeline` — Create a debug timeline for recording and correlating AI events.
  ```ts
  function createDebugTimeline(options: DebugTimelineOptions = {}): DebugTimeline
  ```
- `createDebugTimelinePlugin` — Create a Directive plugin that bridges core constraint/resolver events
- `createDelegator` — Create a task delegator for handling incoming delegations.
- `createDevToolsServer` — Create a DevTools server that bridges orchestrator state to DevTools UI clients.
  ```ts
  function createDevToolsServer(config: DevToolsServerConfig): DevToolsServer
  ```
- `createEnhancedPIIGuardrail` — Create an enhanced PII detection guardrail.
  ```ts
  function createEnhancedPIIGuardrail(options: EnhancedPIIGuardrailOptions = {}): GuardrailFn<InputGuardrailData>
  ```
- `createEvalSuite` — Create an evaluation suite for testing agents against a dataset.
  ```ts
  function createEvalSuite(config: EvalSuiteConfig): EvalSuite
  ```
- `createHealthMonitor` — Create a health monitor that tracks per-agent metrics.
  ```ts
  function createHealthMonitor(config: HealthMonitorConfig = {}): HealthMonitor
  ```
- `createHybridStrategy` — Create a hybrid strategy that combines message count and token limits.
  ```ts
  function createHybridStrategy(defaultConfig: MemoryStrategyConfig = {}): MemoryStrategy
  ```
- `createInitialBreakpointState` — Create initial breakpoint state
  ```ts
  function createInitialBreakpointState(): BreakpointState
  ```
- `createInMemoryComplianceStorage` — Create an in-memory compliance storage adapter
  ```ts
  function createInMemoryComplianceStorage(): ComplianceStorage
  ```
- `createInMemoryStorage` — Create an in-memory cache storage backend.
  ```ts
  function createInMemoryStorage(): SemanticCacheStorage
  ```
- `createJSONFileStore` — Create a RAGStorage backed by a JSON file (lazy-loaded, cached in memory).
  ```ts
  function createJSONFileStore(options: JSONFileStoreOptions): RAGStorage
  ```
- `createKeyPointsSummarizer` — Create a summarizer that extracts user questions from messages.
  ```ts
  function createKeyPointsSummarizer(): MessageSummarizer
  ```
- `createLengthGuardrail` — Create an output guardrail that enforces maximum length constraints on agent output,
  ```ts
  function createLengthGuardrail(options: {
  ```
- `createLengthStreamingGuardrail` — Create a streaming guardrail that limits output length.
  ```ts
  function createLengthStreamingGuardrail(options: {
  ```
- `createLLMSummarizer` — Create a summarizer that delegates to an LLM for conversation compression.
  ```ts
  function createLLMSummarizer(llmCall: (prompt: string) => Promise<string>, options: {
  ```
- `createMCPAdapter` — Create an MCP adapter for Directive integration.
  ```ts
  function createMCPAdapter(config: MCPAdapterConfig): MCPAdapter
  ```
- `createMessageBus` — Note: `publish()` is fire-and-forget -- it returns the message ID synchronously
  ```ts
  function createMessageBus(config: MessageBusConfig = {}): MessageBus
  ```
- `createModerationGuardrail` — Create a content moderation guardrail that delegates to a user-supplied check function.
  ```ts
  function createModerationGuardrail(options: {
  ```
- `createMultiAgentOrchestrator` — Create a multi-agent orchestrator backed by a Directive System.
  ```ts
  function createMultiAgentOrchestrator(options: MultiAgentOrchestratorOptions): MultiAgentOrchestrator
  ```
- `createOtelPlugin` — Create an OpenTelemetry plugin for AI observability.
  ```ts
  function createOtelPlugin(config: OtelPluginConfig): OtelPlugin
  ```
- `createOTLPExporter` — Create an OTLP exporter for sending metrics and traces to OpenTelemetry-compatible backends.
  ```ts
  declare function createOTLPExporter(config: OTLPExporterConfig): OTLPExporter
  ```
- `createOutputPIIGuardrail` — Create an output PII guardrail (for checking agent responses).
  ```ts
  function createOutputPIIGuardrail(options: EnhancedPIIGuardrailOptions = {}): GuardrailFn<OutputGuardrailData>
  ```
- `createOutputSchemaGuardrail` — Create an output guardrail that validates agent output against a schema using
  ```ts
  function createOutputSchemaGuardrail(options: {
  ```
- `createOutputTypeGuardrail` — Create an output guardrail that performs lightweight runtime type checks without
  ```ts
  function createOutputTypeGuardrail(options: {
  ```
- `createPatternStreamingGuardrail` — Create a streaming guardrail that detects patterns (regex-based).
  ```ts
  function createPatternStreamingGuardrail(options: {
  ```
- `createPIIGuardrail` — Create a PII detection guardrail that scans input text for personally identifiable
  ```ts
  function createPIIGuardrail(options: {
  ```
- `createPromptInjectionGuardrail` — Create a prompt injection detection guardrail.
  ```ts
  function createPromptInjectionGuardrail(options: PromptInjectionGuardrailOptions = {}): GuardrailFn<InputGuardrailData>
  ```
- `createPubSub` — Create a pub/sub helper for topic-based communication.
- `createRAGEnricher` — Create a RAG enricher that retrieves relevant document chunks and
  ```ts
  function createRAGEnricher(config: RAGEnricherConfig): RAGEnricher
  ```
- `createRateLimitGuardrail` — Create a rate limit guardrail that tracks token and request counts over a sliding
  ```ts
  function createRateLimitGuardrail(options: {
  ```
- `createResponder` — Create a request-response helper for handling incoming requests.
- `createRunner` — Create an {@link AgentRunner} from `buildRequest`/`parseResponse` helpers, reducing
  ```ts
  function createRunner(options: CreateRunnerOptions): AgentRunner
  ```
- `createSemanticCache` — Create a semantic cache instance.
  ```ts
  function createSemanticCache(config: SemanticCacheConfig): SemanticCache
  ```
- `createSemanticCacheGuardrail` — Create a semantic caching input guardrail.
  ```ts
  function createSemanticCacheGuardrail(config: {
  ```
- `createSlidingWindowStrategy` — Create a sliding window memory strategy that keeps the most recent N messages.
  ```ts
  function createSlidingWindowStrategy(defaultConfig: MemoryStrategyConfig = {}): MemoryStrategy
  ```
- `createSSETransport` — Create an SSE transport that converts a token stream into Server-Sent Events.
  ```ts
  function createSSETransport(config: SSETransportConfig = {}): SSETransport
  ```
- `createStreamChannel` — Create a stream channel for async data transfer.
  ```ts
  function createStreamChannel(config: StreamChannelConfig = {}): StreamChannel<T>
  ```
- `createStreamingRunner` — Create a streaming runner that wraps a base run function.
  ```ts
  function createStreamingRunner(baseRunner: StreamingCallbackRunner, options: {
  ```
- `createTestEmbedder` — Create a simple hash-based "embedder" for testing.
  ```ts
  function createTestEmbedder(dimensions = 128): EmbedderFn
  ```
- `createTokenBasedStrategy` — Create a token-based memory strategy that keeps messages until a token limit is reached.
  ```ts
  function createTokenBasedStrategy(defaultConfig: MemoryStrategyConfig = {}): MemoryStrategy
  ```
- `createToolGuardrail` — Create a tool-call guardrail that restricts which tools an agent may invoke.
  ```ts
  function createToolGuardrail(options: {
  ```
- `createToxicityStreamingGuardrail` — Create a streaming guardrail that detects toxic content.
  ```ts
  function createToxicityStreamingGuardrail(options: {
  ```
- `createTruncationSummarizer` — Create a simple truncation summarizer that clips messages to a maximum length.
  ```ts
  function createTruncationSummarizer(maxLength = 500): MessageSummarizer
  ```
- `createUntrustedContentGuardrail` — Create a guardrail that applies stricter checks to marked untrusted content.
  ```ts
  function createUntrustedContentGuardrail(options: {
  ```
- `createVPTreeIndex` — Create a VP-Tree (Vantage Point Tree) index for efficient approximate nearest neighbor search.
  ```ts
  function createVPTreeIndex(vpConfig: VPTreeIndexConfig = {}): ANNIndex
  ```
- `createWsTransport` — Create a DevTools transport using the Node.js `ws` WebSocket library.
  ```ts
  function createWsTransport(config: WsTransportConfig = {}): Promise<DevToolsTransport>
  ```
- `dag` — Create a directed acyclic graph (DAG) execution pattern.
  ```ts
  function dag(nodes: Record<string, DagNode>, merge?: (context: DagExecutionContext) => T | Promise<T>, options?: {
  ```
- `debate` — Create a debate pattern where agents compete and an evaluator picks the best.
  ```ts
  function debate(config: DebateConfig<T>): DebatePattern<T>
  ```
- `derivedConstraint` — Create a constraint that fires when a cross-agent derivation meets a condition.
  ```ts
  function derivedConstraint(derivationId: string, condition: (value: unknown) => boolean, action: {
  ```
- `detectPII` — Detect PII in text without using as a guardrail.
  ```ts
  function detectPII(text: string, options: {
  ```
- `detectPromptInjection` — Detect prompt injection patterns in text.
- `diffCheckpoints` — Compute the diff between two checkpoint states of the same pattern type.
  ```ts
  function diffCheckpoints(a: PatternCheckpointState, b: PatternCheckpointState): CheckpointDiff
  ```
- `estimateCost` — Estimate the dollar cost of an agent run based on total token usage.
  ```ts
  function estimateCost(tokenUsage: number, ratePerMillionTokens: number): number
  ```
- `evalAssert` — Assert eval results meet requirements — designed for CI pipelines.
  ```ts
  function evalAssert(results: EvalResults, options: EvalAssertOptions): void
  ```
- `evalCoherence` — Evaluate coherence — whether the output is logically consistent and well-structured.
  ```ts
  function evalCoherence(options: EvalSemanticOptions): EvalCriterion
  ```
- `evalCost` — Evaluate cost efficiency — scores based on token usage relative to a budget.
  ```ts
  function evalCost(options: EvalCostOptions): EvalCriterion
  ```
- `evalFaithfulness` — Evaluate faithfulness — whether the output is grounded in the provided context.
  ```ts
  function evalFaithfulness(options: EvalSemanticOptions): EvalCriterion
  ```
- `evalJudge` — Evaluate output quality by delegating to a judge agent that scores from 0.0 to 1.0.
  ```ts
  function evalJudge(options: EvalJudgeOptions): EvalCriterion
  ```
- `evalLatency` — Evaluate latency — scores based on agent run duration.
  ```ts
  function evalLatency(options: EvalLatencyOptions): EvalCriterion
  ```
- `evalMatch` — Evaluate exact or substring match against expected output.
  ```ts
  function evalMatch(options: EvalMatchOptions = {}): EvalCriterion
  ```
- `evalOutputLength` — Evaluate output length — ensures output is within an acceptable range.
  ```ts
  function evalOutputLength(options: EvalOutputLengthOptions): EvalCriterion
  ```
- `evalRelevance` — Evaluate relevance — whether the output directly addresses the input question.
  ```ts
  function evalRelevance(options: EvalSemanticOptions): EvalCriterion
  ```
- `evalSafety` — Evaluate safety — checks output for blocked patterns or category-based content.
  ```ts
  function evalSafety(options: EvalSafetyOptions = {}): EvalCriterion
  ```
- `evalStructure` — Evaluate output structure — checks that output matches an expected format.
  ```ts
  function evalStructure(options: EvalStructureOptions): EvalCriterion
  ```
- `explainGoal` — Generate a human-readable explanation of a goal execution result.
  ```ts
  function explainGoal(result: GoalResult<T>): GoalExplanation
  ```
- `extractJsonFromOutput` — Default JSON extractor — finds the first `{...}` or `[...]` in output.
  ```ts
  function extractJsonFromOutput(output: string): unknown
  ```
- `filterStream` — Filter stream chunks by type.
- `findAgentsByCapability` — Find agents in a registry that match all required capabilities.
  ```ts
  function findAgentsByCapability(registry: AgentRegistry, requiredCapabilities: string[]): string[]
  ```
- `forkFromCheckpoint` — Fork an orchestrator from a checkpoint — creates a new independent orchestrator
- `getCheckpointProgress` — Compute progress metrics from a pattern checkpoint state.
  ```ts
  function getCheckpointProgress(state: PatternCheckpointState): CheckpointProgress
  ```
- `getDependencyGraph` — Get the dependency graph for a set of agent declarations.
  ```ts
  function getDependencyGraph(agents: Record<string, GoalAgentDeclaration>): GoalDependencyGraph
  ```
- `getPatternStep` — Get the current step/round/iteration count from a pattern checkpoint state.
  ```ts
  function getPatternStep(state: PatternCheckpointState): number
  ```
- `goal` — Create a goal-driven execution pattern where agents are selected and run
  ```ts
  function goal(nodes: Record<string, GoalNode>, when: (facts: Record<string, unknown>) => boolean, options?: {
  ```
- `hasPendingApprovals` — Check whether there are tool-call approvals waiting for user confirmation.
  ```ts
  function hasPendingApprovals(state: ApprovalState): boolean
  ```
- `highestImpactStrategy` — Create a selection strategy that picks agents with the highest historical impact.
  ```ts
  function highestImpactStrategy(opts?: {
  ```
- `isAgentRunning` — Check whether an agent is currently executing a run.
  ```ts
  function isAgentRunning(state: AgentState): boolean
  ```
- `isGuardrailError` — Check if an error is a GuardrailError.
  ```ts
  function isGuardrailError(error: unknown): boolean
  ```
- `mapStream` — Transform stream chunks.
  ```ts
  function mapStream(stream: AsyncIterable<StreamChunk>, fn: (chunk: StreamChunk) => R | Promise<R>): AsyncIterable<R>
  ```
- `markUntrustedContent` — Mark content as potentially untrusted (from external sources).
  ```ts
  function markUntrustedContent(content: string, source: string): string
  ```
- `matchBreakpoint` — Match a breakpoint configuration against the current execution point.
- `mcpCallTool` — Create a requirement to call an MCP tool.
  ```ts
  function mcpCallTool(server: string, tool: string, args: Record<string, unknown>): MCPCallToolRequirement
  ```
- `mcpGetPrompt` — Create a requirement to get an MCP prompt.
  ```ts
  function mcpGetPrompt(server: string, prompt: string, args?: Record<string, string>): MCPGetPromptRequirement
  ```
- `mcpReadResource` — Create a requirement to read an MCP resource.
  ```ts
  function mcpReadResource(server: string, uri: string): MCPReadResourceRequirement
  ```
- `mcpSyncResources` — Create a requirement to sync MCP resources.
  ```ts
  function mcpSyncResources(server?: string, pattern?: string | RegExp): MCPSyncResourcesRequirement
  ```
- `mergeStreams` — Merge multiple async iterables into a single stream.
  ```ts
  function mergeStreams(...sources: AsyncIterable<T>[]): AsyncIterable<T>
  ```
- `mergeTaggedStreams` — Merge multiple tagged async iterables into a single multiplexed stream.
  ```ts
  function mergeTaggedStreams(sources: TaggedSource[]): MergedTaggedStreamResult
  ```
- `parallel` — Create a parallel execution pattern that runs handlers concurrently and merges results.
- `parseHttpStatus` — Extract HTTP status code from error message or error properties.
  ```ts
  function parseHttpStatus(error: Error): number | null
  ```
- `parseRetryAfter` — Extract Retry-After value (in ms) from error message.
  ```ts
  function parseRetryAfter(error: Error): number | null
  ```
- `patternFromJSON` — Restore an execution pattern from its serialized JSON form.
  ```ts
  function patternFromJSON(json: SerializedPattern, overrides?: Partial<ExecutionPattern<T>>): ExecutionPattern<T>
  ```
- `patternToJSON` — Serialize an execution pattern to a JSON-safe object.
  ```ts
  function patternToJSON(pattern: ExecutionPattern<unknown>): SerializedPattern
  ```
- `patternToMermaid` — Convert an execution pattern to a Mermaid diagram string.
  ```ts
  function patternToMermaid(pattern: ExecutionPattern<unknown> | SerializedPattern, options?: MermaidOptions): string
  ```
- `pickBestResult` — Pick the highest-scoring result from an array using a scoring function.
  ```ts
  function pickBestResult(results: RunResult<T>[], score: (result: RunResult<T>) => number): RunResult<T>
  ```
- `pipe` — Compose middleware left-to-right onto a base runner.
  ```ts
  function pipe(runner: AgentRunner, ...middlewares: RunnerMiddleware[]): AgentRunner
  ```
- `pipeThrough` — Pipe one stream channel through a transform function into another.
- `planGoal` — Dry-run goal execution to preview the plan without running agents.
- `race` — Create a race pattern that runs handlers concurrently and returns the first successful result.
  ```ts
  function race(handlers: string[], options?: {
  ```
- `redactPII` — Redact detected PII from text
  ```ts
  function redactPII(text: string, items: DetectedPII[], style: RedactionStyle = "typed"): string
  ```
- `reflect` — Create a reflect pattern that iterates between a producer and evaluator until quality is met.
  ```ts
  function reflect(handler: string, evaluator: string, options?: {
  ```
- `runAgentRequirement` — Create a `RUN_AGENT` requirement object for use in constraint `require()` functions.
  ```ts
  function runAgentRequirement(agent: string, input: string, context?: Record<string, unknown>): RunAgentRequirement
  ```
- `runDebate` — Run a debate imperatively on an orchestrator without pattern registration.
- `sanitizeInjection` — Sanitize text by removing detected injection patterns.
  ```ts
  function sanitizeInjection(text: string, patterns: InjectionPattern[] = DEFAULT_INJECTION_PATTERNS): string
  ```
- `selectAgent` — Create a constraint that routes to a specific agent when a condition is met.
- `sequential` — Create a sequential execution pattern that pipes output from one handler to the next.
  ```ts
  function sequential(handlers: string[], options?: {
  ```
- `spawnOnCondition` — Create a constraint that auto-runs a single agent when a condition is met.
  ```ts
  function spawnOnCondition(config: {
  ```
- `spawnPool` — Create a constraint that spawns a pool of agent instances when a condition is met.
- `supervisor` — Create a supervisor pattern where a coordinating agent delegates work to a pool of workers.
  ```ts
  function supervisor(supervisorAgent: string, workers: string[], options?: {
  ```
- `tapStream` — Tap into a stream without consuming it.
- `validateBaseURL` — Validate that a base URL uses the `http:` or `https:` protocol.
  ```ts
  function validateBaseURL(baseURL: string): void
  ```
- `validateCheckpoint` — Validate that an unknown value is a valid Checkpoint
  ```ts
  function validateCheckpoint(data: unknown): boolean
  ```
- `validateGoal` — Validate a set of agent declarations for goal execution.
  ```ts
  function validateGoal(agents: Record<string, GoalAgentDeclaration>): GoalValidationResult
  ```
- `withBudget` — Wrap an AgentRunner with cost budget guards.
  ```ts
  function withBudget(runner: AgentRunner, config: BudgetConfig): BudgetRunner
  ```
- `withFallback` — Wrap multiple AgentRunners into a fallback chain.
  ```ts
  function withFallback(runners: AgentRunner[], config: FallbackConfig = {}): AgentRunner
  ```
- `withModelSelection` — Wrap an AgentRunner with rule-based model selection.
  ```ts
  function withModelSelection(runner: AgentRunner, configOrRules: ModelSelectionConfig | ModelRule[]): AgentRunner
  ```
- `withReflection` — Wrap an AgentRunner with reflection (self-improvement) logic.
  ```ts
  function withReflection(runner: AgentRunner, config: ReflectionConfig<T>): AgentRunner
  ```
- `withRetry` — Wrap an AgentRunner with intelligent retry logic.
  ```ts
  function withRetry(runner: AgentRunner, config: RetryConfig = {}): AgentRunner
  ```
- `withStructuredOutput` — Wrap an AgentRunner with structured output parsing and validation.
  ```ts
  function withStructuredOutput(runner: AgentRunner, config: StructuredOutputConfig<T>): AgentRunner
  ```

### Classes

- `AllProvidersFailedError` — Error thrown when all providers in the fallback chain have failed.
  ```ts
  class AllProvidersFailedError
  ```
- `BudgetExceededError` — Error thrown when a budget limit is exceeded.
  ```ts
  class BudgetExceededError
  ```
- `CircuitBreakerOpenError` — Error thrown when a request is rejected because the circuit is open
  ```ts
  class CircuitBreakerOpenError
  ```
- `GuardrailError` — Structured error for guardrail failures.
  ```ts
  class GuardrailError
  ```
- `InMemoryCheckpointStore` — In-memory checkpoint store with FIFO eviction and time-based retention.
  ```ts
  class InMemoryCheckpointStore
  ```
- `ReflectionExhaustedError` — Error thrown when reflection iterations are exhausted and onExhausted is "throw"
  ```ts
  class ReflectionExhaustedError
  ```
- `RetryExhaustedError` — Error enriched with retry metadata, thrown when all retries are exhausted.
  ```ts
  class RetryExhaustedError
  ```
- `Semaphore` — Async semaphore for controlling concurrent access.
  ```ts
  class Semaphore
  ```
- `StructuredOutputError` — Error thrown when structured output parsing fails after all retries.
  ```ts
  class StructuredOutputError
  ```

### Interfaces

- `AdapterHooks` — Lifecycle hooks for adapter-level observability.
  ```ts
  export interface AdapterHooks {
  ```
- `AgentCircuitBreakerConfig` — Circuit breaker config for AI agent self-healing (simplified subset of core CircuitBreakerConfig)
  ```ts
  export interface AgentCircuitBreakerConfig {
  ```
- `AgentCompleteEvent` — Agent complete event
  ```ts
  export interface AgentCompleteEvent extends DebugEventBase {
  ```
- `AgentErrorEvent` — Agent error event
  ```ts
  export interface AgentErrorEvent extends DebugEventBase {
  ```
- `AgentHealthMetrics` — Per-agent health metrics
  ```ts
  export interface AgentHealthMetrics {
  ```
- `AgentHealthState` — Health state for an agent stored in facts
  ```ts
  export interface AgentHealthState {
  ```
- `AgentInfo` — Agent registration info
  ```ts
  export interface AgentInfo {
  ```
- `AgentLike` — Simplified Agent interface
  ```ts
  export interface AgentLike {
  ```
- `AgentMemory` — Agent memory instance
  ```ts
  export interface AgentMemory {
  ```
- `AgentMemoryConfig` — Agent memory configuration
  ```ts
  export interface AgentMemoryConfig {
  ```
- `AgentMessage` — Base message structure
  ```ts
  export interface AgentMessage {
  ```
- `AgentNetwork` — Agent network instance
  ```ts
  export interface AgentNetwork {
  ```
- `AgentNetworkConfig` — Agent network configuration
  ```ts
  export interface AgentNetworkConfig {
  ```
- `AgentOrchestrator` — Orchestrator instance
  ```ts
  export interface AgentOrchestrator<F extends Record<string, unknown>> {
  ```
- `AgentRegistration` — Configuration for a registered agent
  ```ts
  export interface AgentRegistration {
  ```
- `AgentRegistry` — Agent registry configuration
  ```ts
  export interface AgentRegistry {
  ```
- `AgentRetryConfig` — Retry configuration for agent runs
  ```ts
  export interface AgentRetryConfig {
  ```
- `AgentRetryEvent` — Agent retry event
  ```ts
  export interface AgentRetryEvent extends DebugEventBase {
  ```
- `AgentSelectionStrategy` — Agent selection strategy for goal pattern
  ```ts
  export interface AgentSelectionStrategy {
  ```
- `AgentStartEvent` — Agent start event
  ```ts
  export interface AgentStartEvent extends DebugEventBase {
  ```
- `AgentState` — Agent state in facts
  ```ts
  export interface AgentState {
  ```
- `AggregatedMetric` — Aggregated metric for dashboard display
  ```ts
  interface AggregatedMetric {
  ```
- `AlertConfig` — Alert configuration
  ```ts
  interface AlertConfig {
  ```
- `AlertEvent` — Alert event when threshold is crossed
  ```ts
  interface AlertEvent {
  ```
- `ANNIndex` — ANN Index interface - pluggable vector search backend
  ```ts
  export interface ANNIndex {
  ```
- `ANNSearchResult` — Search result from an ANN index
  ```ts
  export interface ANNSearchResult {
  ```
- `ApprovalRequest` — Approval request
  ```ts
  export interface ApprovalRequest {
  ```
- `ApprovalRequestEvent` — Approval request event
  ```ts
  export interface ApprovalRequestEvent extends DebugEventBase {
  ```
- `ApprovalResponseEvent` — Approval response event
  ```ts
  export interface ApprovalResponseEvent extends DebugEventBase {
  ```
- `ApprovalState` — Approval state
  ```ts
  export interface ApprovalState {
  ```
- `AuditInstance` — Audit trail instance
  ```ts
  export interface AuditInstance {
  ```
- `AuditPluginConfig` — Audit plugin configuration
  ```ts
  export interface AuditPluginConfig {
  ```
- `BatchedEmbedder` — Batched embedder instance with dispose capability
  ```ts
  export interface BatchedEmbedder {
  ```
- `BidirectionalStream` — Bidirectional stream between two agents
  ```ts
  export interface BidirectionalStream<TSend, TReceive> {
  ```
- `BreakpointConfig` — Breakpoint configuration
  ```ts
  export interface BreakpointConfig<T extends string = BreakpointType> {
  ```
- `BreakpointContext` — Context available when a breakpoint fires
  ```ts
  export interface BreakpointContext {
  ```
- `BreakpointHitEvent` — Breakpoint hit event
  ```ts
  export interface BreakpointHitEvent extends DebugEventBase {
  ```
- `BreakpointModifications` — Modifications that can be applied when resuming a breakpoint
  ```ts
  export interface BreakpointModifications {
  ```
- `BreakpointRequest` — A pending breakpoint request
  ```ts
  export interface BreakpointRequest {
  ```
- `BreakpointResumedEvent` — Breakpoint resumed event
  ```ts
  export interface BreakpointResumedEvent extends DebugEventBase {
  ```
- `BreakpointState` — Breakpoint state stored in facts
  ```ts
  export interface BreakpointState {
  ```
- `BudgetWindow` — Rolling budget window configuration.
  ```ts
  export interface BudgetWindow {
  ```
- `CacheEntry` — Cached response entry
  ```ts
  export interface CacheEntry {
  ```
- `CacheLookupResult` — Cache lookup result
  ```ts
  export interface CacheLookupResult {
  ```
- `CacheStats` — Cache statistics
  ```ts
  export interface CacheStats {
  ```
- `Checkpoint` — Full checkpoint data
  ```ts
  export interface Checkpoint {
  ```
- `CheckpointContext` — Context passed to conditional checkpoint predicates
  ```ts
  export interface CheckpointContext {
  ```
- `CheckpointDiff` — Diff between two checkpoint states
  ```ts
  export interface CheckpointDiff {
  ```
- `CheckpointProgress` — Progress computed from a checkpoint state
  ```ts
  export interface CheckpointProgress {
  ```
- `CheckpointRestoreEvent` — Checkpoint restore event
  ```ts
  export interface CheckpointRestoreEvent extends DebugEventBase {
  ```
- `CheckpointSaveEvent` — Checkpoint save event
  ```ts
  export interface CheckpointSaveEvent extends DebugEventBase {
  ```
- `CheckpointStore` — Checkpoint store interface
  ```ts
  export interface CheckpointStore {
  ```
- `CircuitBreaker` — Circuit breaker instance
  ```ts
  interface CircuitBreaker {
  ```
- `CircuitBreakerConfig` — Circuit breaker configuration
  ```ts
  interface CircuitBreakerConfig {
  ```
- `CircuitBreakerStats` — Circuit breaker statistics
  ```ts
  interface CircuitBreakerStats {
  ```
- `ComplianceConfig` — Compliance configuration
  ```ts
  export interface ComplianceConfig {
  ```
- `ComplianceInstance` — Compliance instance
  ```ts
  export interface ComplianceInstance {
  ```
- `ComplianceStorage` — Storage adapter for compliance data
  ```ts
  export interface ComplianceStorage {
  ```
- `ConnectDevToolsOptions` — Options for connecting DevTools to an orchestrator
  ```ts
  export interface ConnectDevToolsOptions {
  ```
- `ConstraintEvaluateEvent` — Constraint evaluate event
  ```ts
  export interface ConstraintEvaluateEvent extends DebugEventBase {
  ```
- `CreateRunnerOptions` — Options for creating an AgentRunner from buildRequest/parseResponse
  ```ts
  export interface CreateRunnerOptions {
  ```
- `CrossAgentSnapshot` — Snapshot of all agent states for cross-agent derivations
  ```ts
  export interface CrossAgentSnapshot {
  ```
- `DagCheckpointState` — Checkpoint state for DAG pattern
  ```ts
  export interface DagCheckpointState extends PatternCheckpointBase {
  ```
- `DagExecutionContext` — Execution context available to DAG node callbacks
  ```ts
  export interface DagExecutionContext {
  ```
- `DagNode` — A node in a DAG execution pattern
  ```ts
  export interface DagNode {
  ```
- `DagNodeUpdateEvent` — DAG node update event
  ```ts
  export interface DagNodeUpdateEvent extends DebugEventBase {
  ```
- `DagPattern` — DAG execution pattern — nodes are agents, edges are reactive conditions
  ```ts
  export interface DagPattern<T = unknown> {
  ```
- `DashboardData` — Dashboard data for UI display
  ```ts
  interface DashboardData {
  ```
- `DebateCheckpointState` — Checkpoint state for debate pattern
  ```ts
  export interface DebateCheckpointState extends PatternCheckpointBase {
  ```
- `DebatePattern` — Debate pattern - agents compete, evaluator judges across rounds.
  ```ts
  export interface DebatePattern<T = unknown> {
  ```
- `DebateResult` — Return type from debate pattern execution
  ```ts
  export interface DebateResult<T = unknown> {
  ```
- `DebateRoundEvent` — Debate round event — emitted after each round's judgement
  ```ts
  export interface DebateRoundEvent extends DebugEventBase {
  ```
- `DebugEventBase` — Base debug event
  ```ts
  export interface DebugEventBase {
  ```
- `DebugTimeline` — Debug timeline instance
  ```ts
  export interface DebugTimeline {
  ```
- `DebugTimelineOptions` — Options for creating a debug timeline
  ```ts
  export interface DebugTimelineOptions {
  ```
- `DelegationMessage` — Delegation message
  ```ts
  export interface DelegationMessage extends AgentMessage {
  ```
- `DelegationResultMessage` — Delegation result message
  ```ts
  export interface DelegationResultMessage extends AgentMessage {
  ```
- `DerivationUpdateEvent` — Derivation update event
  ```ts
  export interface DerivationUpdateEvent extends DebugEventBase {
  ```
- `DevToolsClient` — A connected DevTools client
  ```ts
  export interface DevToolsClient {
  ```
- `DevToolsCompatibleOrchestrator` — Minimal orchestrator interface for DevTools connection
  ```ts
  export interface DevToolsCompatibleOrchestrator {
  ```
- `DevToolsServer` — DevTools server instance
  ```ts
  export interface DevToolsServer {
  ```
- `DevToolsServerConfig` — Configuration for the DevTools server
  ```ts
  export interface DevToolsServerConfig {
  ```
- `DevToolsSnapshot` — System snapshot sent to clients on demand
  ```ts
  export interface DevToolsSnapshot {
  ```
- `DevToolsTransport` — Transport layer for the DevTools server.
  ```ts
  export interface DevToolsTransport {
  ```
- `DoneChunk` — Stream completed
  ```ts
  export interface DoneChunk {
  ```
- `EnhancedPIIGuardrailOptions` — Options for enhanced PII guardrail
  ```ts
  export interface EnhancedPIIGuardrailOptions {
  ```
- `ErrorChunk` — Error during streaming
  ```ts
  export interface ErrorChunk {
  ```
- `EvalAgentSummary` — Per-agent summary
  ```ts
  export interface EvalAgentSummary {
  ```
- `EvalAssertOptions` — Options for eval assertions in CI
  ```ts
  export interface EvalAssertOptions {
  ```
- `EvalCase` — Single test case in the eval dataset
  ```ts
  export interface EvalCase {
  ```
- `EvalCaseResult` — Per-case detail result
  ```ts
  export interface EvalCaseResult {
  ```
- `EvalContext` — Context passed to eval criterion functions
  ```ts
  export interface EvalContext {
  ```
- `EvalCostOptions` — Options for cost evaluation
  ```ts
  export interface EvalCostOptions {
  ```
- `EvalCriterion` — Named eval criterion
  ```ts
  export interface EvalCriterion {
  ```
- `EvalJudgeOptions` — Evaluate with a custom LLM judge — uses a runner to grade the output.
  ```ts
  export interface EvalJudgeOptions {
  ```
- `EvalLatencyOptions` — Options for latency evaluation
  ```ts
  export interface EvalLatencyOptions {
  ```
- `EvalMatchOptions` — Evaluate exact or substring match against expected output.
  ```ts
  export interface EvalMatchOptions {
  ```
- `EvalOutputLengthOptions` — Options for output length evaluation
  ```ts
  export interface EvalOutputLengthOptions {
  ```
- `EvalResults` — Complete eval suite results
  ```ts
  export interface EvalResults {
  ```
- `EvalSafetyOptions` — Options for safety evaluation
  ```ts
  export interface EvalSafetyOptions {
  ```
- `EvalScore` — Result of evaluating a single criterion on a single case
  ```ts
  export interface EvalScore {
  ```
- `EvalSemanticOptions` — Options for LLM-based semantic evaluation criteria
  ```ts
  export interface EvalSemanticOptions {
  ```
- `EvalStructureOptions` — Options for output structure evaluation
  ```ts
  export interface EvalStructureOptions {
  ```
- `EvalSuite` — Eval suite instance
  ```ts
  export interface EvalSuite {
  ```
- `EvalSuiteConfig` — Configuration for createEvalSuite
  ```ts
  export interface EvalSuiteConfig {
  ```
- `GoalAgentDeclaration` — Minimal agent declaration for goal utilities (subset of GoalNode)
  ```ts
  export interface GoalAgentDeclaration {
  ```
- `GoalCheckpointState` — Serializable mid-goal state for save/resume
  ```ts
  export interface GoalCheckpointState extends PatternCheckpointBase {
  ```
- `GoalDependencyEdge` — Edge in the inferred dependency graph
  ```ts
  export interface GoalDependencyEdge {
  ```
- `GoalDependencyGraph` — Inferred dependency graph from produces/requires analysis
  ```ts
  export interface GoalDependencyGraph {
  ```
- `GoalExecutionPlan` — Result of a planGoal() dry-run
  ```ts
  export interface GoalExecutionPlan {
  ```
- `GoalExplanation` — Structured explanation of a goal execution
  ```ts
  export interface GoalExplanation {
  ```
- `GoalExplanationStep` — A single line in a goal execution explanation
  ```ts
  export interface GoalExplanationStep {
  ```
- `GoalMetrics` — Goal progress metrics
  ```ts
  export interface GoalMetrics {
  ```
- `GoalNode` — A node in a goal execution pattern
  ```ts
  export interface GoalNode {
  ```
- `GoalPattern` — Goal execution pattern — declare desired state, let the runtime resolve
  ```ts
  export interface GoalPattern<T = unknown> {
  ```
- `GoalPlanStep` — A single step in an execution plan
  ```ts
  export interface GoalPlanStep {
  ```
- `GoalResult` — Result of a goal pattern execution
  ```ts
  export interface GoalResult<T = unknown> {
  ```
- `GoalStepMetrics` — Goal step metrics
  ```ts
  export interface GoalStepMetrics {
  ```
- `GoalValidationResult` — Validation result
  ```ts
  export interface GoalValidationResult {
  ```
- `GuardrailCheckEvent` — Guardrail check event
  ```ts
  export interface GuardrailCheckEvent extends DebugEventBase {
  ```
- `GuardrailContext` — Guardrail context
  ```ts
  export interface GuardrailContext {
  ```
- `GuardrailResult` — Guardrail result
  ```ts
  export interface GuardrailResult {
  ```
- `GuardrailRetryConfig` — Retry configuration for guardrails
  ```ts
  export interface GuardrailRetryConfig {
  ```
- `GuardrailsConfig` — Guardrails configuration
  ```ts
  export interface GuardrailsConfig {
  ```
- `GuardrailTriggeredChunk` — Guardrail was triggered during streaming
  ```ts
  export interface GuardrailTriggeredChunk {
  ```
- `HandoffCompleteEvent` — Handoff complete event
  ```ts
  export interface HandoffCompleteEvent extends DebugEventBase {
  ```
- `HandoffRequest` — Handoff request between agents
  ```ts
  export interface HandoffRequest {
  ```
- `HandoffResult` — Handoff result
  ```ts
  export interface HandoffResult {
  ```
- `HandoffStartEvent` — Handoff start event
  ```ts
  export interface HandoffStartEvent extends DebugEventBase {
  ```
- `HealthMonitor` — Health monitor instance
  ```ts
  export interface HealthMonitor {
  ```
- `HealthMonitorConfig` — Health monitor configuration
  ```ts
  export interface HealthMonitorConfig {
  ```
- `InformMessage` — Inform message
  ```ts
  export interface InformMessage extends AgentMessage {
  ```
- `InMemoryCheckpointStoreOptions` — Options for InMemoryCheckpointStore
  ```ts
  export interface InMemoryCheckpointStoreOptions {
  ```
- `InputGuardrailData` — Input guardrail data
  ```ts
  export interface InputGuardrailData {
  ```
- `MCPAdapter` — MCP Adapter instance
  ```ts
  export interface MCPAdapter {
  ```
- `MCPAdapterConfig` — MCP Adapter configuration
  ```ts
  export interface MCPAdapterConfig {
  ```
- `MCPApprovalRequest` — MCP Approval request
  ```ts
  export interface MCPApprovalRequest {
  ```
- `MCPCallToolRequirement` — Requirement to call an MCP tool
  ```ts
  export interface MCPCallToolRequirement {
  ```
- `MCPGetPromptRequirement` — Requirement to get an MCP prompt
  ```ts
  export interface MCPGetPromptRequirement {
  ```
- `MCPReadResourceRequirement` — Requirement to read an MCP resource
  ```ts
  export interface MCPReadResourceRequirement {
  ```
- `MCPResource` — MCP Resource definition
  ```ts
  export interface MCPResource {
  ```
- `MCPServerConfig` — MCP Server connection configuration
  ```ts
  export interface MCPServerConfig {
  ```
- `MCPSyncResourcesRequirement` — Requirement to sync MCP resources
  ```ts
  export interface MCPSyncResourcesRequirement {
  ```
- `MCPTool` — MCP Tool definition
  ```ts
  export interface MCPTool {
  ```
- `MCPToolConstraint` — Constraint configuration for an MCP tool
  ```ts
  export interface MCPToolConstraint {
  ```
- `MCPToolResult` — Result from calling an MCP tool
  ```ts
  export interface MCPToolResult {
  ```
- `MemoryManageResult` — Result of memory management
  ```ts
  export interface MemoryManageResult {
  ```
- `MemoryState` — Memory state for a conversation
  ```ts
  export interface MemoryState {
  ```
- `MemoryStrategyConfig` — Configuration for memory management strategies
  ```ts
  export interface MemoryStrategyConfig {
  ```
- `MemoryStrategyResult` — Result of a memory strategy evaluation
  ```ts
  export interface MemoryStrategyResult {
  ```
- `MergedTaggedStreamResult` — Result from mergeTaggedStreams
  ```ts
  export interface MergedTaggedStreamResult {
  ```
- `Message` — Message from agent run
  ```ts
  export interface Message {
  ```
- `MessageBus` — Message bus instance
  ```ts
  export interface MessageBus {
  ```
- `MessageBusConfig` — Message bus configuration
  ```ts
  export interface MessageBusConfig {
  ```
- `MessageChunk` — Message added to conversation
  ```ts
  export interface MessageChunk {
  ```
- `MessageFilter` — Message filter criteria
  ```ts
  export interface MessageFilter {
  ```
- `MetricDataPoint` — A single metric data point
  ```ts
  interface MetricDataPoint {
  ```
- `ModelRule` — A single model selection rule. First match wins.
  ```ts
  export interface ModelRule {
  ```
- `ModelSelectionConfig` — Configuration for model selection.
  ```ts
  export interface ModelSelectionConfig {
  ```
- `MultiAgentCheckpointLocalState` — Checkpoint local state for multi-agent orchestrators
  ```ts
  export interface MultiAgentCheckpointLocalState {
  ```
- `MultiAgentLifecycleHooks` — Lifecycle hooks for multi-agent orchestrator observability
  ```ts
  export interface MultiAgentLifecycleHooks {
  ```
- `MultiAgentOrchestrator` — Multi-agent orchestrator instance
  ```ts
  export interface MultiAgentOrchestrator {
  ```
- `MultiAgentOrchestratorOptions` — Multi-agent orchestrator options
  ```ts
  export interface MultiAgentOrchestratorOptions {
  ```
- `MultiAgentRunCallOptions` — Per-call options for multi-agent runAgent/run
  ```ts
  export interface MultiAgentRunCallOptions extends RunOptions {
  ```
- `MultiAgentSelfHealingConfig` — Self-healing configuration for multi-agent orchestrator
  ```ts
  export interface MultiAgentSelfHealingConfig {
  ```
- `MultiAgentState` — Multi-agent state in facts
  ```ts
  export interface MultiAgentState {
  ```
- `MultiplexedStreamChunk` — A multiplexed stream chunk tagged with the agent that produced it
  ```ts
  export interface MultiplexedStreamChunk {
  ```
- `MultiplexedStreamResult` — Result from a parallel streaming operation
  ```ts
  export interface MultiplexedStreamResult<T = unknown> {
  ```
- `NamedGuardrail` — Named guardrail for better debugging
  ```ts
  export interface NamedGuardrail<T = unknown> {
  ```
- `ObservabilityConfig` — Observability configuration
  ```ts
  interface ObservabilityConfig {
  ```
- `ObservabilityInstance` — Observability instance
  ```ts
  interface ObservabilityInstance {
  ```
- `OrchestratorConstraint` — Constraint for orchestrator
  ```ts
  export interface OrchestratorConstraint<F extends Record<string, unknown>> {
  ```
- `OrchestratorDebugConfig` — Debug configuration for orchestrators
  ```ts
  export interface OrchestratorDebugConfig {
  ```
- `OrchestratorLifecycleHooks` — Lifecycle hooks for observability
  ```ts
  export interface OrchestratorLifecycleHooks {
  ```
- `OrchestratorOptions` — Orchestrator options
  ```ts
  export interface OrchestratorOptions<F extends Record<string, unknown>> {
  ```
- `OrchestratorResolver` — Resolver for orchestrator
  ```ts
  export interface OrchestratorResolver<
  ```
- `OrchestratorResolverContext` — Resolver context for orchestrator
  ```ts
  export interface OrchestratorResolverContext<
  ```
- `OrchestratorState` — Combined orchestrator state
  ```ts
  export interface OrchestratorState {
  ```
- `OrchestratorStreamResult` — Streaming run result from orchestrator
  ```ts
  export interface OrchestratorStreamResult<T = unknown> {
  ```
- `OtelPlugin` — OTEL Plugin instance
  ```ts
  export interface OtelPlugin {
  ```
- `OtelPluginConfig` — Configuration for the OTEL plugin
  ```ts
  export interface OtelPluginConfig {
  ```
- `OtelSpan` — Minimal span interface compatible with OpenTelemetry API
  ```ts
  export interface OtelSpan {
  ```
- `OtelTracer` — Tracer interface compatible with OpenTelemetry API
  ```ts
  export interface OtelTracer {
  ```
- `OTLPExporter` — OTLP exporter instance
  ```ts
  interface OTLPExporter {
  ```
- `OTLPExporterConfig` — OTLP exporter configuration
  ```ts
  interface OTLPExporterConfig {
  ```
- `OutputGuardrailData` — Output guardrail data
  ```ts
  export interface OutputGuardrailData {
  ```
- `ParallelPattern` — Parallel execution pattern - run handlers concurrently and merge results
  ```ts
  export interface ParallelPattern<T = unknown> {
  ```
- `ParsedResponse` — Parsed response from an LLM provider
  ```ts
  export interface ParsedResponse {
  ```
- `PatternCheckpointBase` — Common fields present on all pattern checkpoint states
  ```ts
  export interface PatternCheckpointBase {
  ```
- `PatternCheckpointConfig` — Universal checkpoint configuration for all execution patterns
  ```ts
  export interface PatternCheckpointConfig {
  ```
- `PatternCompleteEvent` — Pattern complete event
  ```ts
  export interface PatternCompleteEvent extends DebugEventBase {
  ```
- `PatternStartEvent` — Pattern start event
  ```ts
  export interface PatternStartEvent extends DebugEventBase {
  ```
- `ProgressChunk` — Progress update for UI feedback
  ```ts
  export interface ProgressChunk {
  ```
- `PromptInjectionGuardrailOptions` — Options for prompt injection guardrail
  ```ts
  export interface PromptInjectionGuardrailOptions {
  ```
- `QueryMessage` — Query message
  ```ts
  export interface QueryMessage extends AgentMessage {
  ```
- `RaceCancelledEvent` — Race cancelled event
  ```ts
  export interface RaceCancelledEvent extends DebugEventBase {
  ```
- `RacePattern` — Race pattern - first successful agent wins, rest cancelled.
  ```ts
  export interface RacePattern<T = unknown> {
  ```
- `RaceResult` — Return type from race pattern execution
  ```ts
  export interface RaceResult<T = unknown> {
  ```
- `RaceStartEvent` — Race start event
  ```ts
  export interface RaceStartEvent extends DebugEventBase {
  ```
- `RaceSuccessEntry` — Individual result entry returned when minSuccess > 1
  ```ts
  export interface RaceSuccessEntry<T = unknown> {
  ```
- `RaceWinnerEvent` — Race winner event
  ```ts
  export interface RaceWinnerEvent extends DebugEventBase {
  ```
- `RAGChunk` — A document chunk with embedding and metadata
  ```ts
  export interface RAGChunk {
  ```
- `RAGStorage` — Pluggable storage backend
  ```ts
  export interface RAGStorage {
  ```
- `RateLimitGuardrail` — Rate limiter with reset capability for testing
  ```ts
  export interface RateLimitGuardrail extends GuardrailFn<InputGuardrailData> {
  ```
- `ReflectCheckpointState` — Checkpoint state for reflect pattern
  ```ts
  export interface ReflectCheckpointState extends PatternCheckpointBase {
  ```
- `ReflectionConfig` — Configuration for the reflection wrapper
  ```ts
  export interface ReflectionConfig<T = unknown> {
  ```
- `ReflectionContext` — Context passed to the reflection evaluator
  ```ts
  export interface ReflectionContext {
  ```
- `ReflectionEvaluation` — Result of a reflection evaluation
  ```ts
  export interface ReflectionEvaluation {
  ```
- `ReflectionIterationEvent` — Reflection iteration event
  ```ts
  export interface ReflectionIterationEvent extends DebugEventBase {
  ```
- `ReflectIterationRecord` — Record of a single reflection iteration (for score history)
  ```ts
  export interface ReflectIterationRecord {
  ```
- `ReflectPattern` — Reflect pattern - produce, evaluate, retry with feedback.
  ```ts
  export interface ReflectPattern<T = unknown> {
  ```
- `RejectedRequest` — Rejected request with tracking information
  ```ts
  export interface RejectedRequest {
  ```
- `RelaxationContext` — Relaxation context passed to custom relaxation strategies
  ```ts
  export interface RelaxationContext {
  ```
- `RelaxationRecord` — Record of a relaxation event
  ```ts
  export interface RelaxationRecord {
  ```
- `RelaxationTier` — Relaxation tier — progressively applied when goal pursuit stalls
  ```ts
  export interface RelaxationTier {
  ```
- `RequestMessage` — Request message
  ```ts
  export interface RequestMessage extends AgentMessage {
  ```
- `RerouteDebugEvent` — Reroute debug event recorded when self-healing reroutes to an alternate agent
  ```ts
  export interface RerouteDebugEvent extends DebugEventBase {
  ```
- `RerouteEvent` — Reroute event fired when an agent is rerouted
  ```ts
  export interface RerouteEvent {
  ```
- `ResolverCompleteEvent` — Resolver complete event
  ```ts
  export interface ResolverCompleteEvent extends DebugEventBase {
  ```
- `ResolverErrorEvent` — Resolver error event
  ```ts
  export interface ResolverErrorEvent extends DebugEventBase {
  ```
- `ResolverStartEvent` — Resolver start event
  ```ts
  export interface ResolverStartEvent extends DebugEventBase {
  ```
- `ResponseMessage` — Response message
  ```ts
  export interface ResponseMessage extends AgentMessage {
  ```
- `RetryConfig` — Configuration for the intelligent retry wrapper.
  ```ts
  export interface RetryConfig {
  ```
- `RoutingConstraint` — User-supplied routing constraint.
  ```ts
  export interface RoutingConstraint {
  ```
- `RoutingFacts` — Runtime facts tracked by the router — exposed for user constraints.
  ```ts
  export interface RoutingFacts {
  ```
- `RoutingProvider` — Provider definition for the constraint router.
  ```ts
  export interface RoutingProvider {
  ```
- `RunAgentRequirement` — Run agent requirement
  ```ts
  export interface RunAgentRequirement extends Requirement {
  ```
- `RunCallOptions` — Per-call options for run()
  ```ts
  export interface RunCallOptions {
  ```
- `RunOptions` — Run options
  ```ts
  export interface RunOptions {
  ```
- `RunResult` — Agent run result
  ```ts
  export interface RunResult<T = unknown> {
  ```
- `SafeParseable` — Zod-compatible schema duck type — any object with a `safeParse` method.
  ```ts
  export interface SafeParseable<T = unknown> {
  ```
- `SchemaValidationResult` — Schema validation result
  ```ts
  export interface SchemaValidationResult {
  ```
- `Scratchpad` — Shared scratchpad interface for multi-agent collaboration
  ```ts
  export interface Scratchpad<
  ```
- `ScratchpadUpdateEvent` — Scratchpad update event
  ```ts
  export interface ScratchpadUpdateEvent extends DebugEventBase {
  ```
- `SelfHealingConfig` — Self-healing configuration for single-agent orchestrator
  ```ts
  export interface SelfHealingConfig {
  ```
- `SemanticCache` — Semantic cache instance
  ```ts
  export interface SemanticCache {
  ```
- `SemanticCacheConfig` — Semantic cache configuration
  ```ts
  export interface SemanticCacheConfig {
  ```
- `SemanticCacheStorage` — Storage interface for cache backends
  ```ts
  export interface SemanticCacheStorage {
  ```
- `SequentialCheckpointState` — Checkpoint state for sequential pattern
  ```ts
  export interface SequentialCheckpointState extends PatternCheckpointBase {
  ```
- `SequentialPattern` — Sequential execution pattern - pipeline of handlers
  ```ts
  export interface SequentialPattern<T = unknown> {
  ```
- `SerializedDagNode` — Serialized DAG node (functions stripped)
  ```ts
  export interface SerializedDagNode {
  ```
- `SerializedGoalNode` — Serialized goal node (functions stripped)
  ```ts
  export interface SerializedGoalNode {
  ```
- `SingleAgentCheckpointLocalState` — Checkpoint local state for single-agent orchestrators
  ```ts
  export interface SingleAgentCheckpointLocalState {
  ```
- `SpanData` — Serializable span data for export
  ```ts
  export interface SpanData {
  ```
- `SpawnOnConditionOptions` — Options for spawnOnCondition.
  ```ts
  export interface SpawnOnConditionOptions {
  ```
- `SpawnPoolConfig` — Configuration for spawnPool constraint-driven auto-scaling
  ```ts
  export interface SpawnPoolConfig {
  ```
- `StreamChannel` — Stream channel instance
  ```ts
  export interface StreamChannel<T> extends AsyncIterable<T> {
  ```
- `StreamChannelConfig` — Stream channel configuration
  ```ts
  export interface StreamChannelConfig {
  ```
- `StreamingGuardrail` — Streaming guardrail that evaluates partial output
  ```ts
  export interface StreamingGuardrail {
  ```
- `StreamingGuardrailResult` — Result from a streaming guardrail check
  ```ts
  export interface StreamingGuardrailResult {
  ```
- `StreamingRunResult` — Result from a streaming run
  ```ts
  export interface StreamingRunResult<T = unknown> {
  ```
- `StreamRunOptions` — Streaming run options
  ```ts
  export interface StreamRunOptions {
  ```
- `Subscription` — Subscription to messages
  ```ts
  export interface Subscription {
  ```
- `SupervisorCheckpointState` — Checkpoint state for supervisor pattern
  ```ts
  export interface SupervisorCheckpointState extends PatternCheckpointBase {
  ```
- `SupervisorPattern` — Supervisor pattern - one agent directs others
  ```ts
  export interface SupervisorPattern<T = unknown> {
  ```
- `TaskCompleteEvent` — Task complete event
  ```ts
  export interface TaskCompleteEvent extends DebugEventBase {
  ```
- `TaskContext` — Read-only context passed to task functions
  ```ts
  export interface TaskContext {
  ```
- `TaskErrorEvent` — Task error event
  ```ts
  export interface TaskErrorEvent extends DebugEventBase {
  ```
- `TaskProgressEvent` — Task progress event
  ```ts
  export interface TaskProgressEvent extends DebugEventBase {
  ```
- `TaskRegistration` — Configuration for a registered task (imperative code)
  ```ts
  export interface TaskRegistration {
  ```
- `TaskStartEvent` — Task start event
  ```ts
  export interface TaskStartEvent extends DebugEventBase {
  ```
- `TokenChunk` — Token chunk from streaming response
  ```ts
  export interface TokenChunk {
  ```
- `TokenPricing` — Token pricing for a specific model or provider.
  ```ts
  export interface TokenPricing {
  ```
- `TokenUsage` — Breakdown of token usage by input/output
  ```ts
  export interface TokenUsage {
  ```
- `ToolCall` — Tool call record
  ```ts
  export interface ToolCall {
  ```
- `ToolCallGuardrailData` — Tool call guardrail data
  ```ts
  export interface ToolCallGuardrailData {
  ```
- `ToolEndChunk` — Tool execution completed
  ```ts
  export interface ToolEndChunk {
  ```
- `ToolStartChunk` — Tool execution started
  ```ts
  export interface ToolStartChunk {
  ```
- `TraceSpan` — Trace span for distributed tracing
  ```ts
  interface TraceSpan {
  ```
- `UpdateMessage` — Update message
  ```ts
  export interface UpdateMessage extends AgentMessage {
  ```
- `VPTreeIndexConfig` — VP-Tree index configuration
  ```ts
  export interface VPTreeIndexConfig {
  ```
- `WsTransportConfig` — Configuration for the built-in Node.js `ws` transport.
  ```ts
  export interface WsTransportConfig {
  ```

### Types

- `AgentMessageType` — Message types for agent communication
  ```ts
  export type AgentMessageType =
  ```
- `AgentRunner` — Run function type
  ```ts
  export type AgentRunner = <T = unknown>(
  ```
- `AuditEventType` — Audit event types - 22 total covering all system operations
  ```ts
  export type AuditEventType =
  ```
- `BackpressureStrategy` — Backpressure strategy when consumer is slow
  ```ts
  export type BackpressureStrategy =
  ```
- `BreakpointType` — Breakpoint types for single-agent orchestrator
  ```ts
  export type BreakpointType =
  ```
- `BudgetRunner` — Helper type for accessing budget runner's getSpent method.
  ```ts
  export type BudgetRunner = AgentRunner & {
  ```
- `CheckpointLocalState` — Union of local state types
  ```ts
  export type CheckpointLocalState =
  ```
- `CircuitState` — Circuit breaker states
  ```ts
  type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
  ```
- `ConstraintRouterRunner` — Helper type for accessing router facts.
  ```ts
  export type ConstraintRouterRunner = AgentRunner & {
  ```
- `CrossAgentDerivationFn` — Function that computes a derived value from a cross-agent snapshot
  ```ts
  export type CrossAgentDerivationFn<T = unknown> = (
  ```
- `DagNodeStatus` — Status of a DAG node during execution
  ```ts
  export type DagNodeStatus =
  ```
- `DebateConfig` — Configuration for the debate() factory and runDebate() imperative API.
  ```ts
  export type DebateConfig<T = unknown> = Omit<DebatePattern<T>, "type">;
  ```
- `DebugEvent` — Union of all debug event types
  ```ts
  export type DebugEvent =
  ```
- `DebugEventType` — All debug event types
  ```ts
  export type DebugEventType =
  ```
- `DebugTimelineListener` — Callback fired when a new event is recorded
  ```ts
  export type DebugTimelineListener = (event: DebugEvent) => void;
  ```
- `DevToolsClientMessage` — Messages sent FROM clients TO the server
  ```ts
  export type DevToolsClientMessage =
  ```
- `DevToolsServerMessage` — Messages sent FROM the server TO clients
  ```ts
  export type DevToolsServerMessage =
  ```
- `EmbedderFn` — Function to generate embeddings for text
  ```ts
  export type EmbedderFn = (text: string) => Promise<Embedding>;
  ```
- `Embedding` — Vector embedding (array of numbers)
  ```ts
  export type Embedding = number[];
  ```
- `EvalCriterionFn` — Eval criterion function — scores an agent's output
  ```ts
  export type EvalCriterionFn = (
  ```
- `ExecutionPattern` — Union of all patterns
  ```ts
  export type ExecutionPattern<T = unknown> =
  ```
- `GuardrailErrorCode` — Error codes for guardrail errors
  ```ts
  export type GuardrailErrorCode =
  ```
- `GuardrailFn` — Guardrail function
  ```ts
  export type GuardrailFn<T = unknown> = (
  ```
- `HealthCircuitState` — Circuit state values
  ```ts
  export type HealthCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
  ```
- `MCPRequirement` — Union of all MCP requirements
  ```ts
  export type MCPRequirement =
  ```
- `MemoryStrategy` — Memory management strategy function
  ```ts
  export type MemoryStrategy = (
  ```
- `MessageHandler` — Message handler function
  ```ts
  export type MessageHandler = (
  ```
- `MessageSummarizer` — Summarizer function to compress older messages
  ```ts
  export type MessageSummarizer = (messages: Message[]) => Promise<string>;
  ```
- `MetricType` — Metric types that can be collected
  ```ts
  type MetricType = "counter" | "gauge" | "histogram" | "summary";
  ```
- `MultiAgentBreakpointType` — Extended breakpoint types for multi-agent orchestrator
  ```ts
  export type MultiAgentBreakpointType =
  ```
- `OrchestratorStreamChunk` — Stream chunk types for orchestrator — extends StreamChunk with approval events
  ```ts
  export type OrchestratorStreamChunk =
  ```
- `PatternCheckpointState` — Discriminated union of all pattern checkpoint states
  ```ts
  export type PatternCheckpointState =
  ```
- `ReflectionEvaluator` — Evaluator function for reflection
  ```ts
  export type ReflectionEvaluator<T = unknown> = (
  ```
- `RelaxationStrategy` — Relaxation strategy for when goal pursuit stalls
  ```ts
  export type RelaxationStrategy =
  ```
- `RunnerMiddleware` — A function that wraps an AgentRunner, returning a new AgentRunner.
  ```ts
  export type RunnerMiddleware = (runner: AgentRunner) => AgentRunner;
  ```
- `SchemaValidator` — Schema validator function type
  ```ts
  export type SchemaValidator<_T = unknown> = (
  ```
- `SerializedPattern` — JSON-safe representation of any execution pattern (all functions stripped)
  ```ts
  export type SerializedPattern =
  ```
- `StreamChannelState` — Stream channel state
  ```ts
  export type StreamChannelState = "open" | "closed" | "error";
  ```
- `StreamChunk` — Union of all stream chunk types
  ```ts
  export type StreamChunk =
  ```
- `StreamingCallbackRunner` — Callback-based streaming run function (e.g. for SSE-based LLM APIs)
  ```ts
  export type StreamingCallbackRunner = (
  ```
- `StreamRunner` — Stream run function type (mirrors OpenAI Agents streaming API)
  ```ts
  export type StreamRunner = <T = unknown>(
  ```
- `TypedAgentMessage` — Union of all message types
  ```ts
  export type TypedAgentMessage =
  ```

### Constants

- `DEFAULT_INJECTION_PATTERNS` — Default injection patterns - well-tested and low false-positive rate
  ```ts
  export const DEFAULT_INJECTION_PATTERNS: InjectionPattern[] = [
  ```
- `MAX_BREAKPOINT_HISTORY` — Maximum number of resolved/cancelled breakpoint IDs to retain (FIFO eviction)
  ```ts
  export const MAX_BREAKPOINT_HISTORY = 200;
  ```
- `OtelStatusCode` — OTEL status codes as a const object (no enum overhead)
  ```ts
  export const OtelStatusCode = {
  ```
- `STRICT_INJECTION_PATTERNS` — Strict patterns - more aggressive, may have higher false positives
  ```ts
  export const STRICT_INJECTION_PATTERNS: InjectionPattern[] = [
  ```

