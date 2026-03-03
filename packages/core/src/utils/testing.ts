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
  ModulesMap,
  NamespacedSystem,
  Requirement,
  RequirementWithId,
  SystemInspection,
} from "../core/types.js";

// ============================================================================
// Fake Timers Integration
// ============================================================================

/**
 * Flush all pending microtasks.
 * Call this after advancing fake timers to ensure all Promise callbacks run.
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
 */
export async function flushMicrotasks(): Promise<void> {
  // Multiple rounds to catch nested microtasks
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/**
 * Wait for the system to settle with fake timers enabled.
 * Combines timer advancement with microtask flushing.
 *
 * @param system - The Directive system
 * @param advanceTime - Function to advance fake timers (e.g., vi.advanceTimersByTime)
 * @param options - Configuration options
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

export interface FakeTimers {
  /** Advance time by a number of milliseconds */
  advance(ms: number): Promise<void>;
  /** Advance to the next scheduled timer */
  next(): Promise<void>;
  /** Run all pending timers */
  runAll(): Promise<void>;
  /** Get current fake time */
  now(): number;
  /** Reset to time 0 */
  reset(): void;
}

/**
 * Create standalone fake timers for testing.
 * Note: For most tests, prefer using Vitest's vi.useFakeTimers() with
 * settleWithFakeTimers() for better integration.
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

/** Context passed to mock resolver resolve functions */
export interface MockResolverContext {
  /** Facts object (use type assertion for specific facts) */
  // biome-ignore lint/suspicious/noExplicitAny: Facts type varies by system
  facts: any;
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

export interface MockResolverOptions<R extends Requirement = Requirement> {
  /** Predicate to check if this resolver handles a requirement */
  requirement?: (req: Requirement) => req is R;
  /** Mock implementation */
  resolve?: (req: R, ctx: MockResolverContext) => void | Promise<void>;
  /** Delay before resolving (ms) */
  delay?: number;
  /** Simulate an error */
  error?: Error | string;
  /** Track calls */
  calls?: R[];
}

/** Internal resolver definition type for mock resolvers */
interface MockResolverDef {
  requirement: (req: Requirement) => boolean;
  resolve: (req: Requirement, ctx: MockResolverContext) => Promise<void>;
}

/**
 * Create a mock resolver for testing.
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
 * Use this when you need fine-grained control over when and how requirements resolve.
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
 * Create a mock resolver that captures requirements instead of resolving them.
 * This gives you manual control over requirement resolution in tests.
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
        resolve: () => resolve(),
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

/** Record of a single fact change */
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

export interface TestSystem<Modules extends ModulesMap>
  extends NamespacedSystem<Modules> {
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

export interface CreateTestSystemOptions<Modules extends ModulesMap>
  extends Omit<CreateSystemOptionsNamed<Modules>, "plugins"> {
  /** Mock resolvers by type */
  mocks?: {
    resolvers?: Record<string, MockResolverOptions>;
  };
  /** Additional plugins (tracking plugin is added automatically) */
  // biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
  plugins?: Array<any>;
}

/**
 * Create a test system with additional testing utilities.
 */
export function createTestSystem<Modules extends ModulesMap>(
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
          `Expected requirement of type "${type}" but none found`,
        );
      }
    },

    assertResolverCalled(type: string, times?: number): void {
      const calls = resolverCalls.get(type) ?? [];
      if (times !== undefined) {
        if (calls.length !== times) {
          throw new Error(
            `Expected resolver "${type}" to be called ${times} times but was called ${calls.length} times`,
          );
        }
      } else if (calls.length === 0) {
        throw new Error(
          `Expected resolver "${type}" to be called but it was not`,
        );
      }
    },

    assertFactSet(key: string, value?: unknown): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length === 0) {
        throw new Error(`Expected fact "${key}" to be set but it was not`);
      }
      if (value !== undefined) {
        const hasValue = changes.some((c) => c.newValue === value);
        if (!hasValue) {
          const actualValues = changes
            .map((c) => JSON.stringify(c.newValue))
            .join(", ");
          throw new Error(
            `Expected fact "${key}" to be set to ${JSON.stringify(value)} but got: ${actualValues}`,
          );
        }
      }
    },

    assertFactChanges(key: string, times: number): void {
      const changes = factsHistory.filter((c) => c.key === key);
      if (changes.length !== times) {
        throw new Error(
          `Expected fact "${key}" to change ${times} times but it changed ${changes.length} times`,
        );
      }
    },
  };

  return testSystem;
}
