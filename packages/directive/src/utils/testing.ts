/**
 * Testing Utilities - Helpers for testing Directive systems
 *
 * Features:
 * - Mock resolvers
 * - Fake timers integration (works with Vitest/Jest fake timers)
 * - Assertion helpers
 * - Snapshot testing support
 */

import { createSystem, type CreateSystemOptions } from "../core/system.js";
import type {
	ModuleDef,
	ModuleSchema,
	Requirement,
	System,
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
export async function settleWithFakeTimers<M extends ModuleSchema>(
	system: System<M>,
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
		throw new Error(
			`[Directive] settleWithFakeTimers did not settle after ${totalTime}ms. ` +
				`${finalInspection.inflight.length} resolvers still inflight: ` +
				finalInspection.inflight.map((r) => r.resolverId).join(", "),
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
			? { requirement: ((req: Requirement) => req.type === typeOrOptions) as (req: Requirement) => req is R }
			: typeOrOptions;

	const calls: R[] = options.calls ?? [];

	return {
		requirement: options.requirement ?? ((_req: Requirement): _req is R => true),
		async resolve(req: Requirement, ctx: MockResolverContext): Promise<void> {
			calls.push(req as R);

			if (options.delay) {
				await new Promise((resolve) => setTimeout(resolve, options.delay));
			}

			if (options.error) {
				throw typeof options.error === "string" ? new Error(options.error) : options.error;
			}

			if (options.resolve) {
				await options.resolve(req as R, ctx);
			}
		},
	};
}

// ============================================================================
// Test System
// ============================================================================

export interface TestSystem<M extends ModuleSchema> extends System<M> {
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
	/** Assert that a requirement was created */
	assertRequirement(type: string): void;
	/** Assert that a resolver was called */
	assertResolverCalled(type: string, times?: number): void;
}

export interface CreateTestSystemOptions<M extends ModuleSchema>
	extends Omit<CreateSystemOptions<M>, "plugins"> {
	/** Mock resolvers by type */
	mocks?: {
		resolvers?: Record<string, MockResolverOptions>;
	};
}

/**
 * Create a test system with additional testing utilities.
 */
export function createTestSystem<M extends ModuleSchema>(
	options: CreateTestSystemOptions<M>,
): TestSystem<M> {
	const eventHistory: Array<{ type: string; [key: string]: unknown }> = [];
	const resolverCalls = new Map<string, Requirement[]>();

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
	// biome-ignore lint/suspicious/noExplicitAny: Module types are complex
	const modulesWithMocks = options.modules.map((module: ModuleDef<any>) => ({
		...module,
		resolvers: {
			...module.resolvers,
			...mockResolvers,
		},
	}));

	// Create the underlying system
	const system = createSystem({
		...options,
		// biome-ignore lint/suspicious/noExplicitAny: Module types are complex
		modules: modulesWithMocks as Array<ModuleDef<any>>,
	}) as System<M>;

	// Wrap dispatch to track events
	const originalDispatch = system.dispatch.bind(system);
	// biome-ignore lint/suspicious/noExplicitAny: Event type varies
	(system as any).dispatch = (event: any) => {
		eventHistory.push(event);
		originalDispatch(event);
	};

	const testSystem: TestSystem<M> = {
		...system,
		eventHistory,
		resolverCalls,

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
						throw new Error(
							`[Directive] waitForIdle timed out after ${maxWait}ms. ` +
								`${inspection.inflight.length} resolvers still inflight: ` +
								inspection.inflight.map((r) => r.id).join(", "),
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
			const inspection = system.inspect();
			const hasRequirement = inspection.unmet.some(
				(r) => r.requirement.type === type,
			);
			if (!hasRequirement) {
				throw new Error(`Expected requirement of type "${type}" but none found`);
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
				throw new Error(`Expected resolver "${type}" to be called but it was not`);
			}
		},
	};

	return testSystem;
}
