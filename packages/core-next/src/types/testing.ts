/**
 * Copied from 1.35 (packages/core/src/utils/testing.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type {
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  Requirement,
  RequirementWithId,
  SingleModuleSystem,
} from "./index.js";

// ============================================================================
// Fake Timers (for standalone use without vi.useFakeTimers)
// ============================================================================

/**
 * Standalone fake timer controller for tests that do not use Vitest/Jest fake timers.
 *
 * @remarks
 * For most tests, prefer Vitest's `vi.useFakeTimers()` paired with
 * {@link settleWithFakeTimers} for better integration. Use this interface
 * only when you need a lightweight, framework-independent timer mock.
 *
 * @public
 */
export interface FakeTimers {
  /** Advance time by a number of milliseconds, firing any timers that fall within the window. */
  advance(ms: number): Promise<void>;
  /** Advance to the next scheduled timer and fire its callback. */
  next(): Promise<void>;
  /** Run all pending timers in chronological order. */
  runAll(): Promise<void>;
  /** Get the current fake time in milliseconds. */
  now(): number;
  /** Reset the clock to time 0 and discard all scheduled timers. */
  reset(): void;
}

// ============================================================================
// Mock Resolvers
// ============================================================================

/**
 * Context passed to mock resolver resolve functions.
 *
 * @public
 */
export interface MockResolverContext {
  /** Facts object (use type assertion for specific facts) */
  facts: any;
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

/**
 * Configuration for a simple mock resolver created via {@link createMockResolver}.
 *
 * @typeParam R - The requirement type this resolver handles.
 *
 * @public
 */
export interface MockResolverOptions<R extends Requirement = Requirement> {
  /** Predicate to check if this resolver handles a given requirement. */
  requirement?: (req: Requirement) => req is R;
  /** Mock implementation invoked when the resolver runs. */
  resolve?: (req: R, ctx: MockResolverContext) => void | Promise<void>;
  /** Artificial delay in milliseconds before the resolver completes. */
  delay?: number;
  /** Error (or message string) to throw, simulating a resolver failure. */
  error?: Error | string;
  /** Array that receives every requirement passed to this resolver. */
  calls?: R[];
}

/** Internal resolver definition type for mock resolvers */
export interface MockResolverDef {
  requirement: (req: Requirement) => boolean;
  resolve: (req: Requirement, ctx: MockResolverContext) => Promise<void>;
}

// ============================================================================
// Mock Resolver (Advanced)
// ============================================================================

/**
 * A mock resolver that captures requirements for manual resolution.
 *
 * @remarks
 * Use this when you need fine-grained control over when and how requirements
 * resolve. Requirements are queued in `pending` and stay unresolved until you
 * explicitly call `resolve()` or `reject()`.
 *
 * @typeParam R - The requirement type this resolver handles.
 *
 * @public
 */
export interface MockResolver<R extends Requirement = Requirement> {
  /** All requirements received by this resolver */
  readonly calls: R[];
  /** Pending requirements waiting to be resolved/rejected */
  readonly pending: Array<{
    requirement: R;
    resolve: (result?: unknown) => void;
    reject: (error: Error) => void;
  }>;
  /** Resolve the next pending requirement */
  resolve(result?: unknown): void;
  /** Reject the next pending requirement */
  reject(error: Error): void;
  /** Resolve all pending requirements */
  resolveAll(result?: unknown): void;
  /** Reject all pending requirements */
  rejectAll(error: Error): void;
  /** Clear call history and pending queue */
  reset(): void;
}

// ============================================================================
// Fact Change Tracking
// ============================================================================

/**
 * Record of a single fact change captured by the test tracking plugin.
 *
 * @public
 */
export interface FactChangeRecord {
  /** The fact key that changed (without namespace prefix for namespaced systems) */
  key: string;
  /** The full key including namespace prefix (e.g., "test::value") */
  fullKey: string;
  /** The namespace (e.g., "test") - undefined for single-module systems */
  namespace?: string;
  /** The previous value */
  previousValue: unknown;
  /** The new value */
  newValue: unknown;
  /** Timestamp of the change */
  timestamp: number;
}

// ============================================================================
// Test System
// ============================================================================

/** Common testing utilities shared by both single-module and namespaced test systems. */
export interface TestSystemBase {
  /**
   * Wait for all pending operations to complete.
   * @param maxWait - Maximum time to wait in ms (default: 5000)
   * @throws Error if timeout is exceeded with resolvers still inflight
   */
  waitForIdle(maxWait?: number): Promise<void>;
  /** Get the history of dispatched events */
  eventHistory: Array<{ type: string; [key: string]: unknown }>;
  /** Get resolver call history */
  resolverCalls: Map<string, Requirement[]>;
  /**
   * Get all requirements that have been generated (both resolved and pending).
   * Unlike `inspect().unmet`, this includes requirements that have already been handled.
   */
  readonly allRequirements: RequirementWithId[];
  /**
   * Get all fact changes since system start or last reset.
   */
  getFactsHistory(): FactChangeRecord[];
  /**
   * Reset the facts history tracking.
   */
  resetFactsHistory(): void;
  /** Assert that a requirement was created */
  assertRequirement(type: string): void;
  /** Assert that a resolver was called */
  assertResolverCalled(type: string, times?: number): void;
  /**
   * Assert that a fact was set to a specific value.
   */
  assertFactSet(key: string, value?: unknown): void;
  /**
   * Assert the number of times a fact was changed.
   */
  assertFactChanges(key: string, times: number): void;
}

/**
 * A single-module Directive system augmented with testing utilities.
 *
 * @remarks
 * Extends {@link SingleModuleSystem} with event/resolver/fact tracking, idle
 * waiting, and assertion helpers. Created via {@link createTestSystem}.
 *
 * @typeParam S - The module schema.
 *
 * @public
 */
export interface TestSystemSingle<S extends ModuleSchema>
  extends SingleModuleSystem<S>,
    TestSystemBase {}

/**
 * A Directive system augmented with testing utilities.
 *
 * @remarks
 * Extends {@link NamespacedSystem} with event/resolver/fact tracking, idle
 * waiting, and assertion helpers. Created via {@link createTestSystem}.
 *
 * @typeParam Modules - The modules map that defines the system's schema.
 *
 * @public
 */
export interface TestSystem<Modules extends ModulesMap>
  extends NamespacedSystem<Modules>,
    TestSystemBase {}

/**
 * Options for {@link createTestSystem}, extending the standard system options
 * with mock resolver injection and automatic tracking.
 *
 * @typeParam Modules - The modules map that defines the system's schema.
 *
 * @public
 */
export interface CreateTestSystemOptions<Modules extends ModulesMap>
  extends Omit<CreateSystemOptionsNamed<Modules>, "plugins"> {
  /** Mock resolvers by type */
  mocks?: {
    resolvers?: Record<string, MockResolverOptions>;
  };
  /** Additional plugins (tracking plugin is added automatically) */
  plugins?: any[];
  /**
   * How many fact changes to keep (default 10,000).
   *
   * The log holds a reference to the value before and after every change, so
   * it pins every intermediate object a test produces. Now that batched writes
   * are recorded that is nearly every write, and a handler writing in a loop
   * can retain a lot: twenty thousand writes measured at fourteen megabytes.
   * Oldest are dropped first, with a warning — a silently truncated log would
   * fail an exact-count assertion for a reason nothing explains.
   */
  maxFactsHistory?: number;
}

/**
 * Options for {@link createTestSystem} with a single module (no namespacing).
 *
 * @typeParam S - The module schema.
 *
 * @public
 */
export interface CreateTestSystemOptionsSingle<S extends ModuleSchema>
  extends Omit<CreateSystemOptionsSingle<S>, "plugins"> {
  /** Mock resolvers by type */
  mocks?: {
    resolvers?: Record<string, MockResolverOptions>;
  };
  /** Additional plugins (tracking plugin is added automatically) */
  plugins?: any[];
  /**
   * How many fact changes to keep (default 10,000).
   *
   * The log holds a reference to the value before and after every change, so
   * it pins every intermediate object a test produces. Now that batched writes
   * are recorded that is nearly every write, and a handler writing in a loop
   * can retain a lot: twenty thousand writes measured at fourteen megabytes.
   * Oldest are dropped first, with a warning — a silently truncated log would
   * fail an exact-count assertion for a reason nothing explains.
   */
  maxFactsHistory?: number;
}

// ============================================================================
// Constraint Coverage
// ============================================================================

/** Coverage report for a Directive system. */
export interface CoverageReport {
  /** Constraints that evaluated to true at least once. */
  constraintsHit: Set<string>;
  /** Constraints that never evaluated to true. */
  constraintsMissed: Set<string>;
  /** Resolvers that started at least once. */
  resolversRun: Set<string>;
  /** Resolvers that never started. */
  resolversMissed: Set<string>;
  /** Effects that ran at least once. */
  effectsRun: Set<string>;
  /** Derivations that recomputed at least once. */
  derivationsComputed: Set<string>;
  /** Coverage percentage (constraintsHit / total constraints). */
  constraintCoverage: number;
  /** Coverage percentage (resolversRun / total resolvers). */
  resolverCoverage: number;
  /** Coverage percentage (effectsRun / total effects). */
  effectCoverage: number;
  /** Coverage percentage (derivationsComputed / total derivations). */
  derivationCoverage: number;
}
