/**
 * Testing Utilities - Helpers for testing Directive systems
 *
 * Features:
 * - Mock resolvers with manual resolve/reject
 * - Fake timers integration (works with Vitest/Jest fake timers)
 * - Assertion helpers
 * - Facts history tracking
 * - Pending requirements tracking
 */

import { createSystem } from "../core/system.js";
import type {
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  ModuleDef,
  ModuleSchema,
  ModulesMap,
  NamespacedSystem,
  Requirement,
  RequirementWithId,
  SingleModuleSystem,
  SystemInspection,
} from "../core/types.js";

// ============================================================================
// Fake Timers Integration
// ============================================================================

/**
 * Flush all pending microtasks by awaiting multiple rounds of `Promise.resolve()`.
 *
 * Call this after advancing fake timers to ensure all Promise callbacks
 * (including nested microtasks) have run before making assertions.
 *
 * @returns A promise that resolves after all pending microtasks have been drained.
 *
 * @example
 * ```typescript
 * vi.useFakeTimers();
 * system.start();
 * system.facts.userId = 1; // Triggers constraint
 * await flushMicrotasks(); // Let reconciliation start
 * vi.advanceTimersByTime(100); // Advance resolver delay
 * await flushMicrotasks(); // Let resolver complete
 * ```
 *
 * @public
 */
export async function flushMicrotasks(): Promise<void> {
  // Multiple rounds to catch nested microtasks
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/**
 * Wait for the system to settle with fake timers enabled.
 *
 * Repeatedly advances fake timers in discrete steps while flushing microtasks,
 * until no resolvers remain inflight or the time budget is exhausted.
 *
 * @param system - The Directive system to wait on (must expose {@link SystemInspection} via `inspect()`).
 * @param advanceTime - Function that advances fake timers by a given number of milliseconds (e.g., `vi.advanceTimersByTime`).
 * @param options - Configuration for total time budget, step size, and iteration limit.
 * @returns A promise that resolves once the system is idle.
 *
 * @throws Error if the system does not settle within the configured time budget.
 *
 * @example
 * ```typescript
 * vi.useFakeTimers();
 * const system = createSystem({ modules: [myModule] });
 * system.start();
 * system.dispatch({ type: "triggerAsync" });
 *
 * await settleWithFakeTimers(system, vi.advanceTimersByTime, {
 *   totalTime: 1000,
 *   stepSize: 10,
 * });
 *
 * expect(system.facts.result).toBe("done");
 * ```
 *
 * @public
 */
export async function settleWithFakeTimers(
  system: { inspect(): SystemInspection },
  advanceTime: (ms: number) => void,
  options: {
    /** Total time to advance (default: 5000ms) */
    totalTime?: number;
    /** Time to advance each step (default: 10ms) */
    stepSize?: number;
    /** Maximum iterations before giving up (default: 1000) */
    maxIterations?: number;
  } = {},
): Promise<void> {
  const { totalTime = 5000, stepSize = 10, maxIterations = 1000 } = options;

  let elapsed = 0;
  let iterations = 0;

  while (elapsed < totalTime && iterations < maxIterations) {
    // Flush microtasks first (handles queueMicrotask, Promise.resolve)
    await flushMicrotasks();

    // Check if settled
    const inspection = system.inspect();
    if (inspection.inflight.length === 0) {
      // One more flush to be safe
      await flushMicrotasks();
      return;
    }

    // Advance fake timers
    advanceTime(stepSize);
    elapsed += stepSize;
    iterations++;
  }

  // Final check
  const finalInspection = system.inspect();
  if (finalInspection.inflight.length > 0) {
    const resolverIds = finalInspection.inflight
      .map((r) => r.resolverId)
      .join(", ");
    throw new Error(
      `[Directive] settleWithFakeTimers did not settle after ${totalTime}ms. ${finalInspection.inflight.length} resolvers still inflight: ${resolverIds}`,
    );
  }
}

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

/**
 * Create standalone fake timers for testing without a framework timer mock.
 *
 * @remarks
 * For most tests, prefer Vitest's `vi.useFakeTimers()` paired with
 * {@link settleWithFakeTimers}. This factory is useful when you need an
 * isolated timer that does not interfere with global timer state.
 *
 * @returns A {@link FakeTimers} controller with `advance`, `next`, `runAll`, `now`, and `reset` methods.
 *
 * @example
 * ```typescript
 * const timers = createFakeTimers();
 * // schedule work, then:
 * await timers.advance(500);
 * expect(timers.now()).toBe(500);
 * ```
 *
 * @public
 */
export function createFakeTimers(): FakeTimers {
  let currentTime = 0;
  const timers: Array<{ time: number; callback: () => void }> = [];

  return {
    async advance(ms: number): Promise<void> {
      const targetTime = currentTime + ms;

      // Run all timers that would fire during this advance
      while (timers.length > 0 && timers[0]!.time <= targetTime) {
        const timer = timers.shift()!;
        currentTime = timer.time;
        timer.callback();
        await Promise.resolve(); // Allow microtasks
      }

      currentTime = targetTime;
    },

    async next(): Promise<void> {
      if (timers.length === 0) return;

      const timer = timers.shift()!;
      currentTime = timer.time;
      timer.callback();
      await Promise.resolve();
    },

    async runAll(): Promise<void> {
      while (timers.length > 0) {
        await this.next();
      }
    },

    now(): number {
      return currentTime;
    },

    reset(): void {
      currentTime = 0;
      timers.length = 0;
    },
  };
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
  // biome-ignore lint/suspicious/noExplicitAny: Facts type varies by system
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
interface MockResolverDef {
  requirement: (req: Requirement) => boolean;
  resolve: (req: Requirement, ctx: MockResolverContext) => Promise<void>;
}

/**
 * Create a simple mock resolver that matches requirements by type and optionally
 * records calls, injects delays, or throws errors.
 *
 * @param typeOrOptions - A requirement type string, or a full {@link MockResolverOptions} object.
 * @returns A resolver definition that can be spread into a module's `resolvers` map.
 *
 * @example
 * ```typescript
 * const calls: Requirement[] = [];
 * const mock = createMockResolver({ requirement: (r): r is MyReq => r.type === "LOAD", calls });
 * ```
 *
 * @public
 */
export function createMockResolver<R extends Requirement = Requirement>(
  typeOrOptions: string | MockResolverOptions<R>,
): MockResolverDef {
  const options: MockResolverOptions<R> =
    typeof typeOrOptions === "string"
      ? {
          requirement: ((req: Requirement) => req.type === typeOrOptions) as (
            req: Requirement,
          ) => req is R,
        }
      : typeOrOptions;

  const calls: R[] = options.calls ?? [];

  return {
    requirement:
      options.requirement ?? ((_req: Requirement): _req is R => true),
    async resolve(req: Requirement, ctx: MockResolverContext): Promise<void> {
      calls.push(req as R);

      if (options.delay) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
      }

      if (options.error) {
        throw typeof options.error === "string"
          ? new Error(options.error)
          : options.error;
      }

      if (options.resolve) {
        await options.resolve(req as R, ctx);
      }
    },
  };
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

/**
 * Create a mock resolver that captures requirements instead of resolving them,
 * giving you manual control over when and how each requirement completes.
 *
 * @param _requirementType - The requirement `type` string this mock handles (used for documentation; matching is done by the test harness).
 * @returns A {@link MockResolver} with a `handler` function suitable for passing to {@link createTestSystem} mocks.
 *
 * @example
 * ```typescript
 * const fetchMock = mockResolver<{ type: "FETCH_USER"; id: string }>("FETCH_USER");
 *
 * const system = createTestSystem({
 *   modules: [userModule],
 *   mocks: {
 *     resolvers: {
 *       FETCH_USER: { resolve: fetchMock.handler },
 *     },
 *   },
 * });
 *
 * system.facts.userId = "123";
 * await flushMicrotasks();
 *
 * // Requirement is pending
 * expect(fetchMock.calls).toHaveLength(1);
 * expect(fetchMock.calls[0].id).toBe("123");
 *
 * // Manually resolve it
 * fetchMock.resolve({ name: "John" });
 * await flushMicrotasks();
 *
 * expect(system.facts.user).toEqual({ name: "John" });
 * ```
 *
 * @public
 */
export function mockResolver<R extends Requirement = Requirement>(
  _requirementType: string,
): MockResolver<R> & {
  /** Handler that can be passed to createTestSystem mocks */
  handler: (req: Requirement, ctx: MockResolverContext) => Promise<void>;
} {
  const calls: R[] = [];
  const pending: Array<{
    requirement: R;
    resolve: (result?: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  const mock: MockResolver<R> = {
    get calls() {
      return calls;
    },
    get pending() {
      return pending;
    },
    resolve(result?: unknown) {
      const item = pending.shift();
      if (item) {
        item.resolve(result);
      }
    },
    reject(error: Error) {
      const item = pending.shift();
      if (item) {
        item.reject(error);
      }
    },
    resolveAll(result?: unknown) {
      while (pending.length > 0) {
        this.resolve(result);
      }
    },
    rejectAll(error: Error) {
      while (pending.length > 0) {
        this.reject(error);
      }
    },
    reset() {
      calls.length = 0;
      pending.length = 0;
    },
  };

  const handler = (
    req: Requirement,
    _ctx: MockResolverContext,
  ): Promise<void> => {
    calls.push(req as R);
    return new Promise<void>((resolve, reject) => {
      pending.push({
        requirement: req as R,
        resolve: (val?: unknown) => resolve(val as void),
        reject,
      });
    });
  };

  return {
    ...mock,
    handler,
  };
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
  // biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
  plugins?: any[];
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
  // biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
  plugins?: any[];
}

/**
 * Create a Directive system instrumented for testing.
 *
 * Wraps {@link createSystem} with an automatic tracking plugin that records
 * dispatched events, resolver calls, fact changes, and generated requirements.
 * Mock resolvers can be injected via `options.mocks.resolvers` to replace
 * real resolvers by requirement type.
 *
 * @param options - System configuration with optional mock resolvers and additional plugins.
 * @returns A {@link TestSystem} or {@link TestSystemSingle} with assertion helpers, idle waiting, and history tracking.
 *
 * @example
 * ```typescript
 * // Namespaced (multiple modules)
 * const system = createTestSystem({
 *   modules: { counter: counterModule },
 *   mocks: { resolvers: { INCREMENT: { resolve: (req, context) => { context.facts.count++; } } } },
 * });
 *
 * // Single module
 * const system = createTestSystem({
 *   module: counterModule,
 * });
 * system.start();
 * ```
 *
 * @public
 */
export function createTestSystem<S extends ModuleSchema>(
  options: CreateTestSystemOptionsSingle<S>,
): TestSystemSingle<S>;
export function createTestSystem<Modules extends ModulesMap>(
  options: CreateTestSystemOptions<Modules>,
): TestSystem<Modules>;
export function createTestSystem<
  S extends ModuleSchema,
  Modules extends ModulesMap,
>(
  options:
    | CreateTestSystemOptionsSingle<S>
    | CreateTestSystemOptions<Modules>,
): TestSystemSingle<S> | TestSystem<Modules> {
  // Single module mode: wrap into namespaced and delegate
  if ("module" in options) {
    return createTestSystemSingle(
      options as CreateTestSystemOptionsSingle<S>,
    );
  }

  return createTestSystemNamed(options as CreateTestSystemOptions<Modules>);
}

function createTestSystemSingle<S extends ModuleSchema>(
  options: CreateTestSystemOptionsSingle<S>,
): TestSystemSingle<S> {
  const eventHistory: Array<{ type: string; [key: string]: unknown }> = [];
  const resolverCalls = new Map<string, Requirement[]>();
  const allRequirements: RequirementWithId[] = [];
  const factsHistory: FactChangeRecord[] = [];

  // Create mock resolvers
  const mockResolvers: Record<string, MockResolverDef> = {};
  if (options.mocks?.resolvers) {
    for (const [type, mockOptions] of Object.entries(options.mocks.resolvers)) {
      const calls: Requirement[] = [];
      resolverCalls.set(type, calls);
      mockResolvers[type] = createMockResolver({ ...mockOptions, calls });
    }
  }

  // Create module with mock resolvers
  // biome-ignore lint/suspicious/noExplicitAny: Mock resolvers have simplified types
  const moduleWithMocks: ModuleDef<S> = {
    ...options.module,
    resolvers: {
      ...options.module.resolvers,
      ...mockResolvers,
    } as any,
  };

  // Create tracking plugin
  const trackingPlugin = {
    name: "__test-tracking__",
    onFactSet: (fullKey: string, value: unknown, previousValue: unknown) => {
      factsHistory.push({
        key: fullKey,
        fullKey,
        namespace: undefined,
        previousValue,
        newValue: value,
        timestamp: Date.now(),
      });
    },
    onRequirementCreated: (requirement: RequirementWithId) => {
      allRequirements.push(requirement);
    },
  };

  // Create the underlying single-module system
  const system = createSystem({
    ...options,
    module: moduleWithMocks,
    plugins: [trackingPlugin, ...(options.plugins ?? [])],
  // biome-ignore lint/suspicious/noExplicitAny: Internal overload compatibility
  } as any) as SingleModuleSystem<S>;

  // Wrap dispatch to track events
  const originalDispatch = system.dispatch.bind(system);
  // biome-ignore lint/suspicious/noExplicitAny: Event type varies
  (system as any).dispatch = (event: any) => {
    eventHistory.push(event);
    originalDispatch(event);
  };

  const testSystem: TestSystemSingle<S> = {
    ...system,
    eventHistory,
    resolverCalls,

    get allRequirements() {
      return allRequirements;
    },

    getFactsHistory(): FactChangeRecord[] {
      return [...factsHistory];
    },

    resetFactsHistory(): void {
      factsHistory.length = 0;
    },

    async waitForIdle(maxWait = 5000): Promise<void> {
      const startTime = Date.now();

      const checkIdle = async (): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const inspection = system.inspect();
        if (inspection.inflight.length > 0) {
          if (Date.now() - startTime > maxWait) {
            const resolverIds = inspection.inflight
              .map((r) => r.id)
              .join(", ");
            throw new Error(
              `[Directive] waitForIdle timed out after ${maxWait}ms. ${inspection.inflight.length} resolvers still inflight: ${resolverIds}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10));

          return checkIdle();
        }
      };

      return checkIdle();
    },

    assertRequirement(type: string): void {
      const hasRequirement = allRequirements.some(
        (r) => r.requirement.type === type,
      );
      if (!hasRequirement) {
        throw new Error(
          `[Directive] Expected requirement of type "${type}" but none found`,
        );
      }
    },

    assertResolverCalled(type: string, times?: number): void {
      const calls = resolverCalls.get(type) ?? [];
      if (times !== undefined) {
        if (calls.length !== times) {
          throw new Error(
            `[Directive] Expected resolver "${type}" to be called ${times} times but was called ${calls.length} times`,
          );
        }
      } else if (calls.length === 0) {
        throw new Error(
          `[Directive] Expected resolver "${type}" to be called but it was not`,
        );
      }
    },

    assertFactSet(key: string, value?: unknown): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length === 0) {
        throw new Error(
          `[Directive] Expected fact "${key}" to be set but it was not`,
        );
      }
      if (value !== undefined) {
        const hasValue = changes.some((c) => c.newValue === value);
        if (!hasValue) {
          const actualValues = changes
            .map((c) => JSON.stringify(c.newValue))
            .join(", ");
          throw new Error(
            `[Directive] Expected fact "${key}" to be set to ${JSON.stringify(value)} but got: ${actualValues}`,
          );
        }
      }
    },

    assertFactChanges(key: string, times: number): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length !== times) {
        throw new Error(
          `[Directive] Expected fact "${key}" to change ${times} times but it changed ${changes.length} times`,
        );
      }
    },
  };

  return testSystem;
}

function createTestSystemNamed<Modules extends ModulesMap>(
  options: CreateTestSystemOptions<Modules>,
): TestSystem<Modules> {
  const eventHistory: Array<{ type: string; [key: string]: unknown }> = [];
  const resolverCalls = new Map<string, Requirement[]>();
  const allRequirements: RequirementWithId[] = [];
  const factsHistory: FactChangeRecord[] = [];

  // Create mock resolvers
  const mockResolvers: Record<string, MockResolverDef> = {};
  if (options.mocks?.resolvers) {
    for (const [type, mockOptions] of Object.entries(options.mocks.resolvers)) {
      const calls: Requirement[] = [];
      resolverCalls.set(type, calls);
      mockResolvers[type] = createMockResolver({ ...mockOptions, calls });
    }
  }

  // Create modules with mock resolvers
  const modulesWithMocks: Modules = {} as Modules;
  for (const [name, module] of Object.entries(options.modules)) {
    // biome-ignore lint/suspicious/noExplicitAny: Module types are complex
    (modulesWithMocks as any)[name] = {
      ...module,
      resolvers: {
        ...module.resolvers,
        ...mockResolvers,
      },
    };
  }

  // Get module namespaces for key parsing
  const moduleNamespaces = new Set(Object.keys(options.modules));

  // Create tracking plugin
  const trackingPlugin = {
    name: "__test-tracking__",
    onFactSet: (fullKey: string, value: unknown, previousValue: unknown) => {
      // Parse namespaced key (e.g., "test::value" -> namespace: "test", key: "value")
      const SEPARATOR = "::";
      const sepIndex = fullKey.indexOf(SEPARATOR);
      let namespace: string | undefined;
      let key: string;

      if (sepIndex > 0) {
        const possibleNamespace = fullKey.substring(0, sepIndex);
        if (moduleNamespaces.has(possibleNamespace)) {
          namespace = possibleNamespace;
          key = fullKey.substring(sepIndex + SEPARATOR.length);
        } else {
          key = fullKey;
        }
      } else {
        key = fullKey;
      }

      factsHistory.push({
        key,
        fullKey,
        namespace,
        previousValue,
        newValue: value,
        timestamp: Date.now(),
      });
    },
    onRequirementCreated: (requirement: RequirementWithId) => {
      allRequirements.push(requirement);
    },
  };

  // Create the underlying system
  const system = createSystem({
    ...options,
    modules: modulesWithMocks,
    plugins: [trackingPlugin, ...(options.plugins ?? [])],
  }) as NamespacedSystem<Modules>;

  // Wrap dispatch to track events
  const originalDispatch = system.dispatch.bind(system);
  // biome-ignore lint/suspicious/noExplicitAny: Event type varies
  (system as any).dispatch = (event: any) => {
    eventHistory.push(event);
    originalDispatch(event);
  };

  const testSystem: TestSystem<Modules> = {
    ...system,
    eventHistory,
    resolverCalls,

    get allRequirements() {
      return allRequirements;
    },

    getFactsHistory(): FactChangeRecord[] {
      return [...factsHistory];
    },

    resetFactsHistory(): void {
      factsHistory.length = 0;
    },

    async waitForIdle(maxWait = 5000): Promise<void> {
      const startTime = Date.now();

      const checkIdle = async (): Promise<void> => {
        // Wait for microtasks
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Check if there are inflight resolvers
        const inspection = system.inspect();
        if (inspection.inflight.length > 0) {
          // Check timeout
          if (Date.now() - startTime > maxWait) {
            const resolverIds = inspection.inflight.map((r) => r.id).join(", ");
            throw new Error(
              `[Directive] waitForIdle timed out after ${maxWait}ms. ${inspection.inflight.length} resolvers still inflight: ${resolverIds}`,
            );
          }
          // Wait a bit more and check again
          await new Promise((resolve) => setTimeout(resolve, 10));
          return checkIdle();
        }
      };

      return checkIdle();
    },

    assertRequirement(type: string): void {
      const hasRequirement = allRequirements.some(
        (r) => r.requirement.type === type,
      );
      if (!hasRequirement) {
        throw new Error(
          `[Directive] Expected requirement of type "${type}" but none found`,
        );
      }
    },

    assertResolverCalled(type: string, times?: number): void {
      const calls = resolverCalls.get(type) ?? [];
      if (times !== undefined) {
        if (calls.length !== times) {
          throw new Error(
            `[Directive] Expected resolver "${type}" to be called ${times} times but was called ${calls.length} times`,
          );
        }
      } else if (calls.length === 0) {
        throw new Error(
          `[Directive] Expected resolver "${type}" to be called but it was not`,
        );
      }
    },

    assertFactSet(key: string, value?: unknown): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length === 0) {
        throw new Error(
          `[Directive] Expected fact "${key}" to be set but it was not`,
        );
      }
      if (value !== undefined) {
        const hasValue = changes.some((c) => c.newValue === value);
        if (!hasValue) {
          const actualValues = changes
            .map((c) => JSON.stringify(c.newValue))
            .join(", ");
          throw new Error(
            `[Directive] Expected fact "${key}" to be set to ${JSON.stringify(value)} but got: ${actualValues}`,
          );
        }
      }
    },

    assertFactChanges(key: string, times: number): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length !== times) {
        throw new Error(
          `[Directive] Expected fact "${key}" to change ${times} times but it changed ${changes.length} times`,
        );
      }
    },
  };

  return testSystem;
}

// ============================================================================
// Dynamic Definition Assertions
// ============================================================================

/**
 * Assert that a definition was dynamically registered on the system.
 *
 * @param system - The Directive system to check.
 * @param type - The definition type: "constraint", "resolver", "derivation", or "effect".
 * @param id - The definition ID.
 * @throws Error if the definition is not dynamic.
 *
 * @example
 * ```typescript
 * system.constraints.register("myRule", { when: () => true, require: { type: "DO" } });
 * assertDynamic(system, "constraint", "myRule"); // passes
 * assertDynamic(system, "constraint", "staticRule"); // throws
 * ```
 *
 * @public
 */
export function assertDynamic(
  system: {
    constraints: { isDynamic(id: string): boolean };
    effects: { isDynamic(id: string): boolean };
    resolvers: { isDynamic(id: string): boolean };
    derive: { isDynamic(id: string): boolean };
  },
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string,
): void {
  const isDynamic = getDynamicCheck(system, type, id);
  if (!isDynamic) {
    throw new Error(
      `[Directive] Expected ${type} "${id}" to be dynamic, but it is not.`,
    );
  }
}

/**
 * Assert that a definition is NOT dynamically registered (i.e., is static or does not exist).
 *
 * @param system - The Directive system to check.
 * @param type - The definition type: "constraint", "resolver", "derivation", or "effect".
 * @param id - The definition ID.
 * @throws Error if the definition is dynamic.
 *
 * @example
 * ```typescript
 * assertNotDynamic(system, "constraint", "staticRule"); // passes
 * system.constraints.register("myRule", def);
 * assertNotDynamic(system, "constraint", "myRule"); // throws
 * ```
 *
 * @public
 */
export function assertNotDynamic(
  system: {
    constraints: { isDynamic(id: string): boolean };
    effects: { isDynamic(id: string): boolean };
    resolvers: { isDynamic(id: string): boolean };
    derive: { isDynamic(id: string): boolean };
  },
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string,
): void {
  const isDynamic = getDynamicCheck(system, type, id);
  if (isDynamic) {
    throw new Error(
      `[Directive] Expected ${type} "${id}" to NOT be dynamic, but it is.`,
    );
  }
}

/** @internal */
function getDynamicCheck(
  system: {
    constraints: { isDynamic(id: string): boolean };
    effects: { isDynamic(id: string): boolean };
    resolvers: { isDynamic(id: string): boolean };
    derive: { isDynamic(id: string): boolean };
  },
  type: "constraint" | "resolver" | "derivation" | "effect",
  id: string,
): boolean {
  switch (type) {
    case "constraint":
      return system.constraints.isDynamic(id);
    case "resolver":
      return system.resolvers.isDynamic(id);
    case "derivation":
      return system.derive.isDynamic(id);
    case "effect":
      return system.effects.isDynamic(id);
  }
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
}

/**
 * Track which constraints, resolvers, effects, and derivations are exercised
 * during a test scenario. Returns a coverage report after the scenario runs.
 *
 * @example
 * ```typescript
 * const { run, report } = createCoverageTracker(system);
 *
 * await run(async () => {
 *   system.facts.userId = 123;
 *   await system.settle();
 *   system.facts.userId = 0;
 *   await system.settle();
 * });
 *
 * const coverage = report();
 * expect(coverage.constraintCoverage).toBe(1); // All constraints hit
 * expect(coverage.constraintsMissed.size).toBe(0);
 * ```
 */
export function createCoverageTracker(
  // biome-ignore lint/suspicious/noExplicitAny: Works with any system type
  system: SingleModuleSystem<any> | NamespacedSystem<any>,
): {
  /** Run a test scenario while tracking coverage. */
  run: (scenario: () => Promise<void> | void) => Promise<void>;
  /** Get the coverage report. */
  report: () => CoverageReport;
} {
  const constraintsHit = new Set<string>();
  const resolversRun = new Set<string>();
  const effectsRun = new Set<string>();
  const derivationsComputed = new Set<string>();

  let unsub: (() => void) | null = null;

  return {
    async run(scenario) {
      unsub = system.observe((event) => {
        switch (event.type) {
          case "constraint.evaluate":
            if (event.active) constraintsHit.add(event.id);
            break;
          case "resolver.start":
            resolversRun.add(event.resolver);
            break;
          case "effect.run":
            effectsRun.add(event.id);
            break;
          case "derivation.compute":
            derivationsComputed.add(event.id);
            break;
        }
      });

      try {
        await scenario();
      } finally {
        unsub?.();
        unsub = null;
      }
    },

    report(): CoverageReport {
      const inspection = system.inspect();

      const allConstraints = new Set(inspection.constraints.map((c) => c.id));
      const allResolvers = new Set(
        inspection.resolverDefs.map((r) => r.id),
      );

      const constraintsMissed = new Set<string>();
      for (const id of allConstraints) {
        if (!constraintsHit.has(id)) constraintsMissed.add(id);
      }

      const resolversMissed = new Set<string>();
      for (const id of allResolvers) {
        if (!resolversRun.has(id)) resolversMissed.add(id);
      }

      return {
        constraintsHit,
        constraintsMissed,
        resolversRun,
        resolversMissed,
        effectsRun,
        derivationsComputed,
        constraintCoverage:
          allConstraints.size === 0
            ? 1
            : constraintsHit.size / allConstraints.size,
        resolverCoverage:
          allResolvers.size === 0
            ? 1
            : resolversRun.size / allResolvers.size,
      };
    },
  };
}

// ============================================================================
// Test Observer
// ============================================================================

/**
 * Create a test observer that collects all observation events.
 * Useful for assertion-based testing of system behavior.
 *
 * @example
 * ```typescript
 * const observer = createTestObserver(system);
 *
 * system.facts.count = 5;
 * await system.settle();
 *
 * expect(observer.events.filter(e => e.type === "constraint.evaluate")).toHaveLength(1);
 * expect(observer.ofType("resolver.complete")).toHaveLength(1);
 *
 * observer.clear();
 * observer.dispose();
 * ```
 */
export function createTestObserver(
  // biome-ignore lint/suspicious/noExplicitAny: Works with any system type
  system: SingleModuleSystem<any> | NamespacedSystem<any>,
): {
  /** All collected events. */
  events: import("../core/types/system.js").ObservationEvent[];
  /** Filter events by type. */
  ofType: <T extends import("../core/types/system.js").ObservationEvent["type"]>(
    type: T,
  ) => Extract<import("../core/types/system.js").ObservationEvent, { type: T }>[];
  /** Clear collected events. */
  clear: () => void;
  /** Stop observing. */
  dispose: () => void;
} {
  const events: import("../core/types/system.js").ObservationEvent[] = [];
  const unsub = system.observe((event) => events.push(event));

  return {
    events,
    ofType(type) {
      return events.filter((e) => e.type === type) as any;
    },
    clear() {
      events.length = 0;
    },
    dispose() {
      unsub();
    },
  };
}
