# API Skeleton

> Auto-generated from api-reference.json. Do not edit manually.
> Validated in CI — if this file is stale, run `pnpm --filter @directive-run/knowledge generate`.

## @directive-run/core

### Functions

- `applyPatch` — Apply a {@link PatchSpec} — assign facts from literals, payload copies
- `completeTimer` — Transition: mark the timer completed. For countdown mode when
  ```ts
  function completeTimer(state: TimerFactState): TimerFactState
  ```
- `createAuditLedger` — Create an audit ledger that subscribes to the given system's
  ```ts
  function createAuditLedger(opts: AuditLedgerOptions = {}): AuditLedger
  ```
- `createModule` — Create a module definition with full type inference.
  ```ts
  export function createModule<
  ```
- `createModuleFactory` — Create a module factory that produces named instances from a single definition.
  ```ts
  export function createModuleFactory<const M extends ModuleSchema>(
  ```
- `createRequirementStatusPlugin` — Create a plugin that tracks requirement status for reactive UI updates.
- `createStatusHook` — Create a hook factory for requirement status.
- `createSystem` — Create a Directive system.
  ```ts
  export function createSystem<S extends ModuleSchema>(
  ```
- `createSystemWithStatus` — Create a Directive system with a status plugin pre-configured.
  ```ts
  function createSystemWithStatus(options: CreateSystemWithStatusOptions<M>): SystemWithStatus<M>
  ```
- `defaultClock` — Returns `realClock()` always.
  ```ts
  function defaultClock(): SignalClock
  ```
- `describePredicate` — Render a {@link FactPredicate} as a precise human-readable sentence.
  ```ts
  function describePredicate(predicate: FactPredicate<F>, opts: DescribeOptions = {}): string
  ```
- `diffClauses` — Diff two predicate trees and return the list of leaf-level changes.
  ```ts
  function diffClauses(before: unknown, after: unknown): Change[]
  ```
- `diffRules` — Diff two snapshots of a system's constraint whenSpec map.
  ```ts
  function diffRules(options: DiffRulesOptions): RulesDiffReport
  ```
- `diffSnapshots` — Compare two distributable snapshots and return the differences.
- `elapsedMs` — Compute elapsed ms for a given timer state at a given clock-now.
  ```ts
  function elapsedMs(state: TimerFactState, nowMs: number): number
  ```
- `evaluateKeySelector` — Build a stable dedup key by selecting fields from a requirement payload.
  ```ts
  function evaluateKeySelector(selector: readonly string[], source: Record<string, unknown>): string
  ```
- `evaluatePredicate` — Evaluate a {@link FactPredicate} against a fact scope. `prev` (a previous
  ```ts
  function evaluatePredicate(spec: unknown, facts: Scope, prev?: Scope, depth = 0): boolean
  ```
- `evaluatePredicateExplained` — Evaluate a predicate and return a per-clause breakdown — the data feed for
  ```ts
  function evaluatePredicateExplained(spec: unknown, facts: Scope, prev?: Scope, pathPrefix = ""): ClauseResult[]
  ```
- `evaluateTemplate` — Interpolate a {@link FactTemplate} against a scope. Single-pass character
  ```ts
  function evaluateTemplate(spec: FactTemplate, scope: Scope): string
  ```
- `extractDeps` — Collect the fact keys a predicate references. Used for static analysis,
  ```ts
  function extractDeps(spec: unknown, prefix = ""): Set<string>
  ```
- `extractTemplateKeys` — Collect the placeholder keys referenced by a template. The static-analysis
  ```ts
  function extractTemplateKeys(spec: FactTemplate): Set<string>
  ```
- `flattenPredicate` — Walk a predicate tree and emit every leaf clause with its dotted path.
  ```ts
  function flattenPredicate(spec: unknown, pathPrefix = "", out: LeafClause[] = []): LeafClause[]
  ```
- `forType` — Create a type-guard function suitable for a resolver's `requirement`
  ```ts
  export function forType<R extends Requirement>(
  ```
- `framesFromHistory` — Convert a history-manager export (the JSON produced by
  ```ts
  function framesFromHistory(historyExport: unknown): ReplayFrame<Record<string, unknown>>[]
  ```
- `framesFromSnapshots` — Convert an array of `{ id, timestamp?, facts }` snapshots — e.g. the
  ```ts
  function framesFromSnapshots(snapshots: unknown): ReplayFrame<Record<string, unknown>>[]
  ```
- `generateRequirementId` — Computes a stable identifier for a requirement, used for coalescing
  ```ts
  function generateRequirementId(req: Requirement, keyFn?: RequirementKeyFn): string
  ```
- `getKind` — Return the {@link SchemaKindNode} for a schema field. Prefers the
  ```ts
  function getKind(schema: unknown): SchemaKindNode
  ```
- `getOperatorsForKind` — Return the set of `PredicateOp` strings that are valid against a
  ```ts
  function getOperatorsForKind(node: SchemaKindNode): readonly PredicateOp[]
  ```
- `getSchemaFieldKinds` — Walk the `facts` block of a module schema and emit a flat map from
  ```ts
  function getSchemaFieldKinds(schema: unknown): Map<string, SchemaKindNode>
  ```
- `initialTimerState` — Initial state for a newly-created timer. Pass this to your Directive
  ```ts
  function initialTimerState(): TimerFactState
  ```
- `isNamespacedSystem` — Check if a system is a namespaced (multi-module) system.
  ```ts
  function isNamespacedSystem(system: AnySystem): boolean
  ```
- `isPredicate` — True when `v` is a data-form spec (predicate object/array) rather than a
  ```ts
  function isPredicate(v: unknown): boolean
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
- `isTemplate` — True when `v` is a {@link FactTemplate} (`{ $template: string }`).
  ```ts
  function isTemplate(v: unknown): boolean
  ```
- `listAllPredicateOperators` — Return all known predicate operators — convenience for prompt builders
  ```ts
  function listAllPredicateOperators(): readonly PredicateOp[]
  ```
- `memoizePredicate` — Memoize a predicate as a reusable evaluation closure.
  ```ts
  function memoizePredicate(predicate: object): (facts: Scope, prev?: Scope) => boolean
  ```
- `memorySink` — In-memory bounded ring-buffer sink. Drops oldest entries past
  ```ts
  function memorySink(opts: { capacity?: number } = {}): AuditLedgerSink
  ```
- `pauseTimer` — Transition: pause a running timer. Records the pause moment so a
  ```ts
  function pauseTimer(state: TimerFactState, nowMs: number): TimerFactState
  ```
- `predicateHash` — Compute a content-addressed hash for a {@link FactPredicate}. Canonicalised
  ```ts
  function predicateHash(spec: FactPredicate<F>): string
  ```
- `predicateToMongo` — Compile a {@link FactPredicate} to a MongoDB query document.
  ```ts
  function predicateToMongo(predicate: FactPredicate<F>, options: PredicateToMongoOptions = {}): Record<string, unknown>
  ```
- `predicateToPostgrest` — Compile a {@link FactPredicate} to a PostgREST querystring.
  ```ts
  function predicateToPostgrest(predicate: FactPredicate<F>, options: PredicateToPostgrestOptions = {}): string
  ```
- `predicateToSQL` — Compile a {@link FactPredicate} to a parameterized SQL statement.
  ```ts
  function predicateToSQL(predicate: FactPredicate<F>, options: PredicateToSqlOptions): PredicateToSqlResult
  ```
- `predicateToWhere` — Lower-level variant — returns just the `WHERE` clause body and the
- `predict` — Run a predicate against the current fact state and report whether it
  ```ts
  function predict(predicate: FactPredicate<F>, facts: F, prev?: F): PredictResult<F>
  ```
- `realClock` — Production clock — wraps `Date.now()` and `globalThis.setTimeout`.
  ```ts
  function realClock(): SignalClock
  ```
- `registerRepeat` — Transition: register a repeat firing. Increments `repeats` and
  ```ts
  function registerRepeat(state: TimerFactState, ms: number): TimerFactState
  ```
- `remainingMs` — Compute remaining ms for a countdown timer at a given clock-now.
  ```ts
  function remainingMs(state: TimerFactState, nowMs: number, totalMs: number): number
  ```
- `replayUnder` — Replay a recorded fact-frame history through two predicates — the
  ```ts
  function replayUnder(options: ReplayUnderOptions<F>): PredicateBacktestReport
  ```
- `req` — Create a typed requirement factory for a given requirement type string.
  ```ts
  function req(type: T): <P extends Record<string, unknown>>(props: P) => Requirement & { type: T; } & P
  ```
- `resetTimer` — Transition: reset a timer to idle. Loses all elapsed time + repeat
  ```ts
  function resetTimer(): TimerFactState
  ```
- `resumeTimer` — Transition: resume a paused timer. Adds the time spent paused into
  ```ts
  function resumeTimer(state: TimerFactState, nowMs: number): TimerFactState
  ```
- `shallowEqual` — Shallow equality comparison for objects.
  ```ts
  function shallowEqual(a: T, b: T): boolean
  ```
- `signSnapshot` — Sign a distributable snapshot using HMAC-SHA256.
  ```ts
  function signSnapshot(snapshot: DistributableSnapshotLike<T>, secret: string | Uint8Array): Promise<SignedSnapshot<T>>
  ```
- `startTimer` — Transition: start an idle (or reset) timer.
  ```ts
  function startTimer(state: TimerFactState, nowMs: number): TimerFactState
  ```
- `sweepUnder` — Sweep a predicate template's hole(s) across candidate values and replay
  ```ts
  function sweepUnder(options: SweepUnderOptions<F>): SweepReport
  ```
- `tickTimer` — Higher-level helper: given a timer state, total ms, and the current
- `timerOps` — Bundle of helpers for one timer in one module — convenience for
- `toReplayFrames` — Normalize a parsed-from-JSON history value into a `ReplayFrame[]`.
  ```ts
  function toReplayFrames(raw: unknown): ReplayFrame<Record<string, unknown>>[]
  ```
- `toRulesMap` — Coerce supported input shapes into a flat `Record<constraintId, whenSpec>`.
  ```ts
  function toRulesMap(raw: RulesMapInput): Record<string, unknown>
  ```
- `typedConstraint` — Type-safe constraint creator.
  ```ts
  function typedConstraint(constraint: TypedConstraint<S, R>): TypedConstraint<S, R>
  ```
- `typedResolver` — Type-safe resolver creator.
  ```ts
  function typedResolver(resolver: TypedResolver<S, R>): TypedResolver<S, R>
  ```
- `validatePredicate` — Throw when a predicate spec contains an operand that cannot survive a
  ```ts
  function validatePredicate(spec: unknown, path = ""): void
  ```
- `validatePredicateAgainstSchema` — Cross-check an LLM-emitted (or otherwise externally-sourced) predicate
- `validateSnapshot` — Validate a distributable snapshot and return its data.
  ```ts
  function validateSnapshot(snapshot: DistributableSnapshotLike<T>, now: number = Date.now()): T
  ```
- `verifySnapshotSignature` — Verify the signature of a signed snapshot.
- `virtualClock` — Virtual clock — advances only when `advanceBy(ms)` is called. All
  ```ts
  function virtualClock(initialMs = 0): SignalClock
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
- `ChainableSchemaType` — Chainable schema type with all common methods
  ```ts
  export interface ChainableSchemaType<T> extends ExtendedSchemaType<T> {
  ```
- `Change` — A single change between two predicates at a specific path.
  ```ts
  export interface Change {
  ```
- `CheckAbortOnFinding` — Returned by {@link doctor.checkAbortOn}.
  ```ts
  export interface CheckAbortOnFinding {
  ```
- `CheckAbortOnResult` — Result of {@link doctor.checkAbortOn}.
  ```ts
  export interface CheckAbortOnResult {
  ```
- `ClauseResult` — The per-clause result of an explained predicate evaluation. One entry per
  ```ts
  export interface ClauseResult {
  ```
- `ConstraintDefinition` — Constraint definition
  ```ts
  export interface ConstraintDef<
  ```
- `CreateSystemOptionsNamed` — Options for createSystem with object modules (namespaced mode).
  ```ts
  export interface CreateSystemOptionsNamed<Modules extends ModulesMap> {
  ```
- `CreateSystemOptionsSingle` — Options for createSystem with a single module (no namespacing).
  ```ts
  export interface CreateSystemOptionsSingle<S extends ModuleSchema> {
  ```
- `CrossModuleConstraintDefinition` — Constraint definition with cross-module typed facts.
  ```ts
  export interface CrossModuleConstraintDef<
  ```
- `CrossModuleEffectDefinition` — Effect definition with cross-module typed facts.
  ```ts
  export interface CrossModuleEffectDef<
  ```
- `DefinitionMeta` — Optional metadata for module, fact, event, constraint, resolver, effect, and derivation definitions.
  ```ts
  export interface DefinitionMeta {
  ```
- `DerivationDefinition` — Derivation definition function signature.
  ```ts
  export interface DerivationDef<
  ```
- `DerivationDefinitionWithMeta` — Derivation definition with metadata (object form).
  ```ts
  export interface DerivationDefWithMeta<
  ```
- `DerivationDefWithMeta` — Derivation definition with metadata (object form).
  ```ts
  export interface DerivationDefWithMeta<
  ```
- `DescribeOptions` — Options controlling how {@link describePredicate} renders a predicate.
  ```ts
  export interface DescribeOptions {
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
- `DynamicConstraintDef` — Constraint definition for dynamic registration — typed facts, relaxed requirements
  ```ts
  export interface DynamicConstraintDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `DynamicConstraintDefinition` — Constraint definition for dynamic registration — typed facts, relaxed requirements
  ```ts
  export interface DynamicConstraintDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `DynamicEffectDef` — Effect definition for dynamic registration — typed facts
  ```ts
  export interface DynamicEffectDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `DynamicResolverDef` — Resolver definition for dynamic registration — typed context.facts, relaxed requirement
  ```ts
  export interface DynamicResolverDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `DynamicResolverDefinition` — Resolver definition for dynamic registration — typed context.facts, relaxed requirement
  ```ts
  export interface DynamicResolverDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `EffectDefinition` — Effect definition - side effects with optional cleanup.
  ```ts
  export interface EffectDef<
  ```
- `ErrorBoundaryConfig` — Error boundary configuration
  ```ts
  export interface ErrorBoundaryConfig {
  ```
- `ExistingConstraint` — Shape of `system.inspect().constraints[N]` we care about — accepts any superset.
  ```ts
  export interface ExistingConstraint {
  ```
- `ExtendedSchemaType` — Extended SchemaType with type name for better error messages
  ```ts
  export interface ExtendedSchemaType<T> extends SchemaType<T> {
  ```
- `FactsSnapshot` — Read-only snapshot of facts
  ```ts
  export interface FactsSnapshot<S extends Schema = Schema> {
  ```
- `FactTemplate` — A fact-interpolating string expression. `${key}` placeholders are replaced
  ```ts
  export interface FactTemplate {
  ```
- `HistoryAPI` — History API for snapshot navigation, changesets, and export/import
  ```ts
  export interface HistoryAPI {
  ```
- `HistoryState` — Reactive history state for framework hooks
  ```ts
  export interface HistoryState {
  ```
- `LeafClause` — A leaf clause extracted from a predicate tree, keyed by its dotted path.
  ```ts
  export interface LeafClause {
  ```
- `MetaAccessor` — Metadata lookups, tag queries, and change notification.
  ```ts
  export interface MetaAccessor {
  ```
- `MetaMatch` — One definition returned by {@link MetaAccessor.byTag}.
  ```ts
  export interface MetaMatch {
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
- `ModuleDefinition` — Module definition using consolidated schema.
  ```ts
  export interface ModuleDef<M extends ModuleSchema = ModuleSchema> {
  ```
- `ModuleHooks` — Lifecycle hooks for modules
  ```ts
  export interface ModuleHooks<M extends ModuleSchema> {
  ```
- `ModuleSchema` — Consolidated module schema - single source of truth for all types.
  ```ts
  export interface ModuleSchema {
  ```
- `NamespacedSystem` — System interface for namespaced modules.
  ```ts
  export interface NamespacedSystem<Modules extends ModulesMap> {
  ```
- `PatchSpec` — An event handler written as data: assigns facts from literals, payload
  ```ts
  export interface PatchSpec<F, P> {
  ```
- `PayloadRef` — *Note: Directive's `$ref` is **not** a JSON Pointer or JSON Schema `$ref`.
  ```ts
  export interface PayloadRef<P> {
  ```
- `Plugin` — Plugin interface for extending Directive functionality.
  ```ts
  export interface Plugin<M extends ModuleSchema = ModuleSchema> {
  ```
- `PredicateBacktestReport` — The outcome of replaying a recorded history under two predicates — a
  ```ts
  export interface PredicateBacktestReport {
  ```
- `ReplayDiffSample` — A frame where the original and proposed predicate disagree.
  ```ts
  export interface ReplayDiffSample {
  ```
- `ReplayFrame` — One recorded fact-state frame.
  ```ts
  export interface ReplayFrame<F = Record<string, unknown>> {
  ```
- `Requirement` — Base requirement structure
  ```ts
  export interface Requirement {
  ```
- `RequirementTypeStatus` — Status of a requirement type
  ```ts
  export interface RequirementTypeStatus {
  ```
- `RequirementWithId` — Requirement with computed identity
  ```ts
  export interface RequirementWithId {
  ```
- `ResolverDefinition` — Single resolver definition (untyped - use TypedResolversDef for type safety)
  ```ts
  export interface ResolverDef<
  ```
- `RetryPolicy` — Retry policy configuration
  ```ts
  export interface RetryPolicy {
  ```
- `SchemaType` — Primitive type definitions for schema
  ```ts
  export interface SchemaType<T> {
  ```
- `ShouldRetryContext` — Context object passed as the optional third argument to
  ```ts
  export interface ShouldRetryContext {
  ```
- `SignalClock` — Stable interface for any time source.
  ```ts
  export interface SignalClock {
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
- `SourcePublish` — Type-wrapped as an interface (rather than a bare function type) so
  ```ts
  export interface SourcePublish {
  ```
- `SourcePublishFn` — Type-wrapped as an interface (rather than a bare function type) so
  ```ts
  export interface SourcePublish {
  ```
- `SweepHole` — A placeholder inside a predicate template — substituted from `sweep` values.
  ```ts
  export interface SweepHole {
  ```
- `SweepPoint` — One point on the sweep curve — one candidate value tuple.
  ```ts
  export interface SweepPoint {
  ```
- `SystemConfig` — System configuration
  ```ts
  export interface SystemConfig<M extends ModuleSchema = ModuleSchema> {
  ```
- `SystemInspection` — System inspection result
  ```ts
  export interface SystemInspection {
  ```
- `SystemSnapshot` — Serializable system snapshot for SSR/persistence
  ```ts
  export interface SystemSnapshot {
  ```
- `TimerFactState` — Persistent timer state — JSON-roundtrippable, suitable for storing
  ```ts
  export interface TimerFactState {
  ```
- `TraceEntry` — A structured record of one reconciliation run — fact changes, derivation recomputes, constraints hit, resolvers, effects.
  ```ts
  export interface TraceEntry {
  ```
- `TypedConstraintDefinition` — Constraint definition with typed requirements.
  ```ts
  export interface TypedConstraintDef<M extends ModuleSchema> {
  ```
- `TypedResolverDefinition` — Typed resolver definition for a specific requirement type.
  ```ts
  export interface TypedResolverDef<
  ```

### Types

- `Branded` — Branded type - adds a unique brand to a base type
  ```ts
  export type Branded<T, B extends string> = T & { readonly [Brand]: B };
  ```
- `ChangeKind` — Kind of change observed for a single clause.
  ```ts
  export type ChangeKind =
  ```
- `ConstraintsDefinition` — Map of constraint definitions (generic)
  ```ts
  export type ConstraintsDef<S extends Schema> = Record<
  ```
- `ConstraintStatus` — Status of a single constraint across the two snapshots.
  ```ts
  export type ConstraintStatus = "added" | "removed" | "changed" | "unchanged";
  ```
- `CrossModuleConstraintsDefinition` — Cross-module constraints definition.
  ```ts
  export type CrossModuleConstraintsDef<
  ```
- `CrossModuleDeps` — Map of namespace to schema for cross-module dependencies.
  ```ts
  export type CrossModuleDeps = Record<string, ModuleSchema>;
  ```
- `CrossModuleDerivationsDefinition` — Cross-module derivations definition.
  ```ts
  export type CrossModuleDerivationsDef<
  ```
- `CrossModuleEffectsDefinition` — Cross-module effects definition.
  ```ts
  export type CrossModuleEffectsDef<
  ```
- `DefinitionKind` — The seven things a system holds metadata for — the same seven the lookups on
  ```ts
  export type DefinitionKind =
  ```
- `DerivationsDefinition` — Map of derivation definitions (internal — always bare functions after unwrap).
  ```ts
  export type DerivationsDef<S extends Schema> = Record<
  ```
- `DynamicDefinitionKind` — The four kinds `register` / `assign` / `unregister` / `call` operate on.
  ```ts
  export type DynamicDefinitionKind = Extract<
  ```
- `EffectsDefinition` — Map of effect definitions
  ```ts
  export type EffectsDef<
  ```
- `EventsDefinition` — Events definition - accepts any event handler signature
  ```ts
  export type EventsDef<S extends Schema> = Record<
  ```
- `FactPredicate` — A declarative boolean spec over a fact namespace `F`. The data form of a
  ```ts
  export type FactPredicate<F> =
  ```
- `Facts` — Proxy-based facts accessor (cleaner API)
  ```ts
  export type Facts<S extends Schema = Schema> = InferSchema<S> & {
  ```
- `HistoryOption` — History option: boolean shorthand or full config (presence implies enabled)
  ```ts
  export type HistoryOption = boolean | HistoryConfig;
  ```
- `InferDerivations` — Infer derivation values from a module schema.
  ```ts
  export type InferDerivations<M extends ModuleSchema> = {
  ```
- `InferEvents` — Infer all events from a module schema as a discriminated union.
  ```ts
  export type InferEvents<M extends ModuleSchema> = {
  ```
- `InferFacts` — Infer the facts type from a module schema.
  ```ts
  export type InferFacts<M extends ModuleSchema> = InferSchema<M["facts"]>;
  ```
- `InferRequirements` — Infer all requirements from a module schema as a discriminated union.
  ```ts
  export type InferRequirements<M extends ModuleSchema> = {
  ```
- `InferRequirementTypes` — Infer requirement type names from a module schema.
  ```ts
  export type InferRequirementTypes<M extends ModuleSchema> =
  ```
- `InferSchemaType` — Infer a single type from a SchemaType, Zod schema, or plain type.
  ```ts
  export type InferSchemaType<T> = T extends SchemaType<infer U>
  ```
- `InferSelectorState` — Combined facts + derivations — matches the useSelector proxy at runtime.
  ```ts
  export type InferSelectorState<M extends ModuleSchema> = InferFacts<M> &
  ```
- `KeySelector` — *Note: despite the "Selector" name, this does not select from facts — it
  ```ts
  export type KeySelector<R> = readonly (keyof R & string)[];
  ```
- `ModulesMap` — Map of module name to module definition (object form).
  ```ts
  export type ModulesMap = Record<string, ModuleDef<any>>;
  ```
- `ObservationEvent` — Typed events emitted by system.observe().
  ```ts
  export type ObservationEvent =
  ```
- `OperatorObject` — The operator object permitted for a fact of type `V`. Built as a
  ```ts
  export type OperatorObject<V> =
  ```
- `PatchValue` — A patch value: a literal, a typed payload copy, or (for string facts) a
  ```ts
  export type PatchValue<V, P> =
  ```
- `PredicateClause` — Array form — explicit clauses, AND-ed. The codegen/devtools-friendly form.
  ```ts
  export type PredicateClause<F> = {
  ```
- `PredicateCombinator` — Combinator node — exactly one of `$all` / `$any` / `$not`.
  ```ts
  export type PredicateCombinator<F> =
  ```
- `PredicateCombinatorKey` — Combinator node keys.
  ```ts
  export type PredicateCombinatorKey = "$all" | "$any" | "$not";
  ```
- `PredicateObject` — Object form — every key is a fact name, every value a
  ```ts
  export type PredicateObject<F> = {
  ```
- `PredicateOp` — Comparison operator names — the `$`-prefixed keys inside an operator object.
  ```ts
  export type PredicateOp =
  ```
- `PredicateOverlapProof` — Discriminated proof of why two resolvers' `when:` predicates fire on
  ```ts
  export type PredicateOverlapProof =
  ```
- `ResolverAbortReason` — Why a resolver attempt was aborted, surfaced to {@link RetryPolicy.shouldRetry}
  ```ts
  export type ResolverAbortReason =
  ```
- `ResolversDefinition` — Map of resolver definitions
  ```ts
  export type ResolversDef<S extends Schema> = Record<
  ```
- `RulesMapInput` — Accepted shapes for the `before` / `after` predicate maps:
  ```ts
  export type RulesMapInput = unknown;
  ```
- `Schema` — Schema definition mapping keys to types.
  ```ts
  export type Schema = Record<string, SchemaType<unknown> | unknown>;
  ```
- `SchemaKind` — The closed set of kinds a Directive schema field can be.
  ```ts
  export type SchemaKind =
  ```
- `SchemaKindNode` — A tree-shaped discriminator for a schema field. Composite kinds
  ```ts
  export type SchemaKindNode = (
  ```
- `SchemaTypedResolversDefinition` — Map of typed resolver definitions (schema-based variant).
  ```ts
  export type SchemaTypedResolversDef<
  ```
- `SourceDropReason` — Why a source publish was rejected. Mirrored across the three
  ```ts
  export type SourceDropReason =
  ```
- `SourceReportError` — Source-side runtime-error reporter. Optional second argument to
  ```ts
  export type SourceReportError = (error: Error) => void;
  ```
- `SourcesDef` — Map of source definitions, keyed by source name. Collision rules match
  ```ts
  export type SourcesDef = Record<string, SourceDef>;
  ```
- `SourcesDefinition` — Map of source definitions, keyed by source name. Collision rules match
  ```ts
  export type SourcesDef = Record<string, SourceDef>;
  ```
- `SourceUnsubscribe` — Cleanup function returned by a source's `attach`.
  ```ts
  export type SourceUnsubscribe = () => void | Promise<void>;
  ```
- `SourceUnsubscribeFn` — Cleanup function returned by a source's `attach`.
  ```ts
  export type SourceUnsubscribe = () => void | Promise<void>;
  ```
- `SystemDerived` — Extract the typed derivations shape from a Directive system or module schema.
  ```ts
  export type SystemDerived<T> = T extends SingleModuleSystem<infer S>
  ```
- `SystemFacts` — Extract the typed facts shape from a Directive system or module schema.
  ```ts
  export type SystemFacts<T> = T extends SingleModuleSystem<infer S>
  ```
- `SystemMode` — System mode discriminator.
  ```ts
  export type SystemMode = "single" | "namespaced";
  ```
- `TraceOption` — Trace option: boolean shorthand or full config (presence implies enabled)
  ```ts
  export type TraceOption = boolean | TraceConfig;
  ```
- `TypedConstraintsDefinition` — Typed constraints definition using the module schema.
  ```ts
  export type TypedConstraintsDef<M extends ModuleSchema> = Record<
  ```
- `TypedEventsDefinition` — Typed events definition using the module schema.
  ```ts
  export type TypedEventsDef<M extends ModuleSchema> = {
  ```
- `TypedResolversDefinition` — Typed resolvers definition using the module schema.
  ```ts
  export type TypedResolversDef<M extends ModuleSchema> = Record<
  ```
- `VerifyResult` — Verify result — chain valid OR a break with full context for tamper visualization.
  ```ts
  export type VerifyResult =
  ```

### Constants

- `Backoff` — Backoff strategy constants for retry policies.
  ```ts
  export const Backoff = {
  ```
- `MAX_REPLAY_FRAMES` — Upper bound on the number of frames a single {@link replayUnder} call will
  ```ts
  export const MAX_REPLAY_FRAMES = 1_000_000;
  ```
- `MAX_SWEEP_POINTS` — Hard cap on points evaluated in a single sweep — protects against runaway grids.
  ```ts
  export const MAX_SWEEP_POINTS = 10_000;
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
- `attachSourcesToOtel` — Subscribe to a system's source-lifecycle events and emit OTel spans
  ```ts
  function attachSourcesToOtel(system: unknown, options: SourcesOtelOptions): () => void
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
- `createFactPIIGuardrail` — Create a Directive plugin that scans pii-tagged fact writes for PII and
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
- `describeUnpricedReason` — The one-line explanation for a call priced by estimate, shared so that every
  ```ts
  function describeUnpricedReason(reason: UnpricedReason): string
  ```
- `detectAndRedactPII` — Detect PII in text and return a result whose `redactedText` is populated.
  ```ts
  function detectAndRedactPII(text: string, options: {
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
- `formatSystemMeta` — Format a SystemInspection into a concise context string for LLM consumption.
  ```ts
  function formatSystemMeta(inspection: SystemInspection): string
  ```
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
- `isStreamConsumerError` — Is this error – or anything it was thrown through – a consumer-side throw?
  ```ts
  function isStreamConsumerError(error: unknown): boolean
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
- `predicateFromIntent` — Ask an LLM to emit a FactPredicate matching the user's intent, then
  ```ts
  function predicateFromIntent(opts: PredicateFromIntentOptions<F>): Promise<FactPredicate<F>>
  ```
- `predicateFromIntentRaw` — Lower-level variant — returns the validated predicate (or null) plus
  ```ts
  function predicateFromIntentRaw(opts: PredicateFromIntentOptions<F>): Promise<PredicateFromIntentDiagnostics<F>>
  ```
- `predicateFromIntentWithProvenance` — Like {@link predicateFromIntent} but additionally returns a structured
- `predicateToolSpecAnthropic` — Anthropic Messages API tool spec for predicate emission. Drop the
  ```ts
  function predicateToolSpecAnthropic(schema: unknown, opts: PredicateToolSpecOptions = {}): PredicateToolSpecAnthropic
  ```
- `predicateToolSpecOpenAI` — OpenAI Chat Completions / Responses API tool spec for predicate
  ```ts
  function predicateToolSpecOpenAI(schema: unknown, opts: PredicateToolSpecOptions = {}): PredicateToolSpecOpenAI
  ```
- `priceCall` — Price one call: what it cost, and on what basis.
  ```ts
  function priceCall(snapshot: UsageSnapshot, pricing: ResolvedPricing, estimate: number): PricedCall
  ```
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
- `requireModelPricing` — Look up one model's rates in a published pricing table, or throw saying why.
  ```ts
  function requireModelPricing(table: Record<string, ModelPricing>, model: string): ModelPricing
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
- `snapshotCallUsage` — Read a call result's token usage exactly once, and resolve it.
  ```ts
  function snapshotCallUsage(result: Pick<RunResult, "tokenUsage"> | undefined): UsageSnapshot
  ```
- `snapshotTokenPricing` — Validate a caller-supplied pricing object and snapshot its rates into owned
  ```ts
  function snapshotTokenPricing(pricing: TokenPricing | undefined, label: string, api: string): ResolvedPricing
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
- `toAIContext` — Convenience: inspect a system and format its metadata for LLM context.
  ```ts
  function toAIContext(system: {
  ```
- `toTokenPricingTable` — Widen a table of bare `{ input, output }` rates into {@link ModelPricing},
  ```ts
  function toTokenPricingTable(table: Record<string, BareTokenRates>, label?: string): Record<string, ModelPricing>
  ```
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
- `PredicateFromIntentError` — Thrown by `predicateFromIntent` on retry exhaustion. `predicateFromIntentRaw` returns these as a diagnostics payload instead.
  ```ts
  class PredicateFromIntentError
  ```
- `ProviderHTTPError` — A provider answered with an HTTP failure.
  ```ts
  class ProviderHTTPError
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
- `StreamConsumerError` — A consumer-supplied callback threw while consuming a stream.
  ```ts
  class StreamConsumerError
  ```
- `StructuredOutputError` — Error thrown when structured output parsing fails after all retries.
  ```ts
  class StructuredOutputError
  ```
- `UnpricedCallLimitError` — Error thrown when too many recent calls could only be charged at estimate.
  ```ts
  class UnpricedCallLimitError
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
- `BareTokenRates` — A bare per-million rate set, the input shape of {@link toTokenPricingTable}.
  ```ts
  export interface BareTokenRates {
  ```
- `BatchedEmbedder` — Batched embedder instance with destroy capability
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
- `DetectedPII` — Detected PII instance
  ```ts
  export interface DetectedPII {
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
- `FactPIIMatch` — Public match record for a single PII finding. Mirrors `DetectedPII` from
  ```ts
  export interface FactPIIMatch {
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
- `InjectionDetectionResult` — Detailed detection result
  ```ts
  export interface InjectionDetectionResult {
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
- `ModelPricing` — A pricing entry that carries both field spellings for the same rates.
  ```ts
  export interface ModelPricing extends TokenPricing {
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
- `MultiAgentStreamCallOptions` — Per-call options for multi-agent runAgentStream/runStream
  ```ts
  export interface MultiAgentStreamCallOptions {
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
- `ParseEventStreamOptions` — Options for {@link parseEventStream}.
  ```ts
  export interface ParseEventStreamOptions {
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
- `PIIDetectionResult` — PII detection result
  ```ts
  export interface PIIDetectionResult {
  ```
- `PIIDetector` — Custom PII detector interface
  ```ts
  export interface PIIDetector {
  ```
- `PredicateToolSpecAnthropic` — Anthropic Messages API tool shape. Drop into the `tools: [...]` array.
  ```ts
  export interface PredicateToolSpecAnthropic {
  ```
- `PredicateToolSpecOpenAI` — OpenAI Chat Completions / Responses API tool shape. Drop into the
  ```ts
  export interface PredicateToolSpecOpenAI {
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
- `ResolvedPricing` — A pricing object that has been validated and copied — all four rates
  ```ts
  export interface ResolvedPricing {
  ```
- `ResolvedUsage` — A provider-reported token usage that has been read once and validated —
  ```ts
  export interface ResolvedUsage {
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
- `RunnerStreamingSupport` — Optional streaming support for a runner built with {@link createRunner}.
  ```ts
  export interface RunnerStreamingSupport {
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
- `StreamEventResult` — Result from parsing a single streamed event (provider-specific).
  ```ts
  export interface StreamEventResult {
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
- `StreamRestartChunk` — A new generation started, and everything emitted for the previous one is
  ```ts
  export interface StreamRestartChunk {
  ```
- `StreamRunOptions` — Options for a {@link StreamRunner} – the function {@link createStreamingRunner}
  ```ts
  export interface StreamRunOptions {
  ```
- `StreamTotals` — Accumulated totals from a fully consumed event stream.
  ```ts
  export interface StreamTotals {
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
- `TokenPricing` — Per-million-token rates for a specific model or provider.
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
- `AgentRunner` — Run function type.
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
- `BudgetRunner` — Helper type for accessing a budget runner's spend accessors.
  ```ts
  export type BudgetRunner = AgentRunner & {
  ```
- `BudgetWindowName` — Which ceiling a {@link BudgetExceededDetails} is about.
  ```ts
  export type BudgetWindowName = "per-call" | "total" | "hour" | "day";
  ```
- `CheckpointLocalState` — Union of local state types
  ```ts
  export type CheckpointLocalState =
  ```
- `CircuitState` — Circuit breaker states
  ```ts
  type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
  ```
- `ConstraintRouterRunner` — Helper type for accessing router facts and pricing coverage.
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
- `FactPIICategory` — PII categories the built-in synchronous detector covers.
  ```ts
  export type FactPIICategory = "ssn" | "credit_card" | "email";
  ```
- `FactPIIErrorMode` — How to handle Error / AggregateError instances whose `.message`,
  ```ts
  export type FactPIIErrorMode = "redact" | "preserve" | "alert-only";
  ```
- `FactPIIGuardrailMode` — Behavior when a pii-tagged fact's incoming value contains detected PII.
  ```ts
  export type FactPIIGuardrailMode = "redact" | "alert";
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
- `PIIType` — Supported PII types
  ```ts
  export type PIIType =
  ```
- `PricedCall` — What one call costs, and how that number was arrived at.
  ```ts
  export type PricedCall =
  ```
- `RedactionStyle` — Redaction style
  ```ts
  export type RedactionStyle =
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
- `StreamRestartReason` — Why a new generation started – the runner was re-invoked and replays.
  ```ts
  export type StreamRestartReason = "retry" | "schema-retry" | "reroute";
  ```
- `StreamRunner` — Stream run function type (mirrors OpenAI Agents streaming API)
  ```ts
  export type StreamRunner = <T = unknown>(
  ```
- `StreamWireFormat` — How a provider frames the events it streams.
  ```ts
  export type StreamWireFormat = "sse" | "ndjson";
  ```
- `TypedAgentMessage` — Union of all message types
  ```ts
  export type TypedAgentMessage =
  ```
- `UnpricedReason` — Why a call was priced by estimate rather than by what the provider reported.
  ```ts
  export type UnpricedReason =
  ```
- `UsageSnapshot` — A call's token usage, read once at the boundary and resolved.
  ```ts
  export type UsageSnapshot =
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

