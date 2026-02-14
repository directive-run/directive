/**
 * OpenAI Agents Testing Utilities
 *
 * Provides testing helpers for:
 * - Mock agent runners with configurable responses
 * - Guardrail testing with assertions
 * - Approval workflow simulation
 * - Snapshot testing for constraint evaluation
 *
 * @example
 * ```typescript
 * import { createMockAgentRunner, testGuardrail, createApprovalSimulator } from '@directive-run/ai';
 *
 * describe('MyOrchestrator', () => {
 *   it('should block PII in input', async () => {
 *     const result = await testGuardrail(createPIIGuardrail(), {
 *       input: 'My SSN is 123-45-6789',
 *     });
 *     expect(result.passed).toBe(false);
 *     expect(result.reason).toContain('PII');
 *   });
 * });
 * ```
 */

import type {
  AgentLike,
  RunResult,
  Message,
  ToolCall,
  RunOptions,
  AgentRunner,
  GuardrailFn,
  InputGuardrailData,
  OutputGuardrailData,
  ToolCallGuardrailData,
  GuardrailContext,
  GuardrailResult,
  ApprovalRequest,
  OrchestratorOptions,
  AgentOrchestrator,
} from "./index.js";
import { createAgentOrchestrator } from "./index.js";

// ============================================================================
// Mock Agent Runner
// ============================================================================

/** Configuration for mock agent responses */
export interface MockAgentConfig<T = unknown> {
  /** Final output to return */
  output: T;
  /** Messages to emit during run */
  messages?: Message[];
  /** Tool calls to emit during run */
  toolCalls?: ToolCall[];
  /** Total tokens to report */
  totalTokens?: number;
  /** Delay before responding (ms) */
  delay?: number;
  /** Error to throw instead of returning */
  error?: Error;
  /** Function to generate dynamic responses */
  generate?: (input: string, agent: AgentLike) => Partial<MockAgentConfig<T>>;
}

/** Mock agent runner options */
export interface MockAgentRunnerOptions {
  /** Default response for unmatched agents */
  defaultResponse?: MockAgentConfig;
  /** Responses keyed by agent name */
  responses?: Record<string, MockAgentConfig>;
  /** Record all calls for assertions */
  recordCalls?: boolean;
  /** Callback for each run */
  onRun?: (agent: AgentLike, input: string) => void;
}

/** Recorded call for assertions */
export interface RecordedCall {
  agent: AgentLike;
  input: string;
  options?: RunOptions;
  timestamp: number;
}

/** Mock agent runner instance */
export interface MockAgentRunner {
  /** The run function to pass to orchestrator */
  run: AgentRunner;
  /** Get all recorded calls */
  getCalls(): RecordedCall[];
  /** Get calls for a specific agent */
  getCallsFor(agentName: string): RecordedCall[];
  /** Clear recorded calls */
  clearCalls(): void;
  /** Set response for an agent */
  setResponse<T>(agentName: string, config: MockAgentConfig<T>): void;
  /** Set default response */
  setDefaultResponse<T>(config: MockAgentConfig<T>): void;
}

/**
 * Create a mock agent runner for testing.
 *
 * @example
 * ```typescript
 * const mock = createMockAgentRunner({
 *   responses: {
 *     'my-agent': {
 *       output: 'Hello, world!',
 *       totalTokens: 100,
 *     },
 *   },
 * });
 *
 * const orchestrator = createAgentOrchestrator({ runner: mock.run });
 * const result = await orchestrator.run(myAgent, 'Hi');
 *
 * expect(result.output).toBe('Hello, world!');
 * expect(mock.getCalls()).toHaveLength(1);
 * ```
 */
export function createMockAgentRunner(
  options: MockAgentRunnerOptions = {}
): MockAgentRunner {
  const {
    defaultResponse = { output: "mock response", totalTokens: 10 },
    responses = {},
    recordCalls = true,
    onRun,
  } = options;

  const calls: RecordedCall[] = [];
  const responseMap = new Map<string, MockAgentConfig>(Object.entries(responses));
  let currentDefault = defaultResponse;

  const run: AgentRunner = async <T>(
    agent: AgentLike,
    input: string,
    runOptions?: RunOptions
  ): Promise<RunResult<T>> => {
    onRun?.(agent, input);

    if (recordCalls) {
      calls.push({
        agent,
        input,
        options: runOptions,
        timestamp: Date.now(),
      });
    }

    // Get config for this agent
    let config = responseMap.get(agent.name) ?? currentDefault;

    // Apply dynamic generation if present
    if (config.generate) {
      const generated = config.generate(input, agent);
      config = { ...config, ...generated };
    }

    // Handle error case
    if (config.error) {
      throw config.error;
    }

    // Apply delay
    if (config.delay && config.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.delay));
    }

    // Emit messages
    const messages = config.messages ?? [];
    for (const message of messages) {
      runOptions?.onMessage?.(message);
    }

    // Emit tool calls
    const toolCalls = config.toolCalls ?? [];
    for (const toolCall of toolCalls) {
      runOptions?.onToolCall?.(toolCall);
    }

    return {
      output: config.output as T,
      messages,
      toolCalls,
      totalTokens: config.totalTokens ?? 10,
    };
  };

  return {
    run,
    getCalls: () => [...calls],
    getCallsFor: (name) => calls.filter((c) => c.agent.name === name),
    clearCalls: () => calls.length = 0,
    setResponse: (name, config) => responseMap.set(name, config),
    setDefaultResponse: (config) => currentDefault = config,
  };
}

// ============================================================================
// Guardrail Testing
// ============================================================================

/** Test input for guardrail testing */
export type GuardrailTestInput<T> =
  T extends InputGuardrailData ? { input: string; agentName?: string } :
  T extends OutputGuardrailData ? { output: unknown; agentName?: string; input?: string; messages?: Message[] } :
  T extends ToolCallGuardrailData ? { toolCall: ToolCall; agentName?: string; input?: string } :
  Partial<T>;

/** Extended guardrail result with test assertions */
export interface GuardrailTestResult extends GuardrailResult {
  /** Time taken to evaluate (ms) */
  duration: number;
  /** The data that was tested */
  testedData: unknown;
  /** Assert that the guardrail passed */
  assertPassed(): void;
  /** Assert that the guardrail failed */
  assertFailed(expectedReason?: string | RegExp): void;
  /** Assert that transformation occurred */
  assertTransformed(expected?: unknown): void;
}

/**
 * Test a guardrail with assertions.
 *
 * @example
 * ```typescript
 * // Test PII detection
 * const result = await testGuardrail(createPIIGuardrail(), {
 *   input: 'My SSN is 123-45-6789',
 * });
 * result.assertFailed(/PII/);
 *
 * // Test input transformation
 * const redactResult = await testGuardrail(createPIIGuardrail({ redact: true }), {
 *   input: 'My SSN is 123-45-6789',
 * });
 * redactResult.assertPassed();
 * redactResult.assertTransformed();
 * ```
 */
export async function testGuardrail<T>(
  guardrail: GuardrailFn<T>,
  testInput: GuardrailTestInput<T>,
  context?: Partial<GuardrailContext>
): Promise<GuardrailTestResult> {
  // Build full data object
  const data = {
    agentName: "test-agent",
    input: "",
    ...testInput,
  } as unknown as T;

  // Build context
  const fullContext: GuardrailContext = {
    agentName: (testInput as { agentName?: string }).agentName ?? "test-agent",
    input: (testInput as { input?: string }).input ?? "",
    facts: context?.facts ?? {},
    ...context,
  };

  const start = Date.now();
  const result = await guardrail(data, fullContext);
  const duration = Date.now() - start;

  return {
    ...result,
    duration,
    testedData: data,
    assertPassed() {
      if (!result.passed) {
        throw new Error(`Expected guardrail to pass, but it failed: ${result.reason}`);
      }
    },
    assertFailed(expectedReason) {
      if (result.passed) {
        throw new Error("Expected guardrail to fail, but it passed");
      }
      if (expectedReason !== undefined) {
        if (typeof expectedReason === "string" && !result.reason?.includes(expectedReason)) {
          throw new Error(
            `Expected failure reason to include "${expectedReason}", got: ${result.reason}`
          );
        }
        if (expectedReason instanceof RegExp && !expectedReason.test(result.reason ?? "")) {
          throw new Error(
            `Expected failure reason to match ${expectedReason}, got: ${result.reason}`
          );
        }
      }
    },
    assertTransformed(expected) {
      if (result.transformed === undefined) {
        throw new Error("Expected guardrail to transform input, but no transformation occurred");
      }
      if (expected !== undefined && result.transformed !== expected) {
        throw new Error(
          `Expected transformation to be ${JSON.stringify(expected)}, got: ${JSON.stringify(result.transformed)}`
        );
      }
    },
  };
}

/**
 * Test multiple inputs against a guardrail.
 *
 * @example
 * ```typescript
 * const results = await testGuardrailBatch(createPIIGuardrail(), [
 *   { input: 'Hello world', expect: 'pass' },
 *   { input: 'My SSN is 123-45-6789', expect: 'fail' },
 *   { input: 'Email: test@example.com', expect: 'fail' },
 * ]);
 *
 * expect(results.allPassed()).toBe(true);
 * ```
 */
export async function testGuardrailBatch<T>(
  guardrail: GuardrailFn<T>,
  testCases: Array<{
    input: GuardrailTestInput<T>;
    expect: "pass" | "fail" | "transform";
    context?: Partial<GuardrailContext>;
  }>
): Promise<{
  results: GuardrailTestResult[];
  allPassed(): boolean;
  failures(): Array<{ index: number; expected: string; actual: GuardrailTestResult }>;
}> {
  const results: GuardrailTestResult[] = [];
  const failures: Array<{ index: number; expected: string; actual: GuardrailTestResult }> = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i]!;
    const result = await testGuardrail(guardrail, testCase.input, testCase.context);
    results.push(result);

    const actualOutcome = !result.passed ? "fail" : result.transformed !== undefined ? "transform" : "pass";

    if (actualOutcome !== testCase.expect) {
      failures.push({ index: i, expected: testCase.expect, actual: result });
    }
  }

  return {
    results,
    allPassed: () => failures.length === 0,
    failures: () => failures,
  };
}

// ============================================================================
// Approval Simulation
// ============================================================================

/** Approval simulator options */
export interface ApprovalSimulatorOptions {
  /** Auto-approve requests matching this predicate */
  autoApprove?: (request: ApprovalRequest) => boolean;
  /** Auto-reject requests matching this predicate */
  autoReject?: (request: ApprovalRequest) => boolean | string;
  /** Delay before auto-approval/rejection (ms) */
  delay?: number;
  /** Record all requests for assertions */
  recordRequests?: boolean;
}

/** Approval simulator instance */
export interface ApprovalSimulator {
  /** Handle an approval request */
  handle(request: ApprovalRequest): Promise<"approved" | "rejected">;
  /** Get all recorded requests */
  getRequests(): ApprovalRequest[];
  /** Clear recorded requests */
  clearRequests(): void;
  /** Manually approve a request */
  approve(requestId: string): void;
  /** Manually reject a request */
  reject(requestId: string, reason?: string): void;
  /** Wait for a specific request */
  waitForRequest(predicate: (req: ApprovalRequest) => boolean, timeoutMs?: number): Promise<ApprovalRequest>;
}

/**
 * Create an approval simulator for testing approval workflows.
 *
 * @example
 * ```typescript
 * const simulator = createApprovalSimulator({
 *   autoApprove: (req) => req.type === 'tool_call' && req.data.name === 'search',
 *   autoReject: (req) => req.type === 'tool_call' && req.data.name === 'delete',
 * });
 *
 * // Use in tests
 * orchestrator.onApprovalRequest = (req) => simulator.handle(req);
 * ```
 */
export function createApprovalSimulator(
  options: ApprovalSimulatorOptions = {}
): ApprovalSimulator {
  const {
    autoApprove,
    autoReject,
    delay = 0,
    recordRequests = true,
  } = options;

  const requests: ApprovalRequest[] = [];
  const pendingRequests = new Map<string, { request: ApprovalRequest; resolve: (decision: "approved" | "rejected") => void }>();
  const requestWaiters: Array<{ predicate: (req: ApprovalRequest) => boolean; resolve: (req: ApprovalRequest) => void }> = [];

  return {
    async handle(request: ApprovalRequest): Promise<"approved" | "rejected"> {
      if (recordRequests) {
        requests.push(request);
      }

      // Notify waiters
      for (const waiter of requestWaiters) {
        if (waiter.predicate(request)) {
          waiter.resolve(request);
        }
      }

      // Apply delay
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Check auto-reject first (security-first)
      if (autoReject) {
        const rejectResult = autoReject(request);
        if (rejectResult) {
          return "rejected";
        }
      }

      // Check auto-approve
      if (autoApprove && autoApprove(request)) {
        return "approved";
      }

      // Wait for manual decision
      return new Promise((resolve) => {
        pendingRequests.set(request.id, { request, resolve });
      });
    },

    getRequests: () => [...requests],
    clearRequests: () => requests.length = 0,

    approve(requestId: string) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pending.resolve("approved");
        pendingRequests.delete(requestId);
      }
    },

    reject(requestId: string, _reason?: string) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pending.resolve("rejected");
        pendingRequests.delete(requestId);
      }
    },

    waitForRequest(predicate, timeoutMs = 5000): Promise<ApprovalRequest> {
      // Check existing requests first
      const existing = requests.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }

      // Wait for future request
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout waiting for approval request"));
        }, timeoutMs);

        requestWaiters.push({
          predicate,
          resolve: (req) => {
            clearTimeout(timeout);
            resolve(req);
          },
        });
      });
    },
  };
}

// ============================================================================
// Test Orchestrator Factory
// ============================================================================

/** Options for test orchestrator */
export interface TestOrchestratorOptions<F extends Record<string, unknown>> extends Omit<OrchestratorOptions<F>, "runner"> {
  /** Mock responses for agents */
  mockResponses?: Record<string, MockAgentConfig>;
  /** Default mock response */
  defaultMockResponse?: MockAgentConfig;
}

/** Test orchestrator with additional testing utilities */
export interface TestOrchestrator<F extends Record<string, unknown>> extends AgentOrchestrator<F> {
  /** The mock runner */
  mockRunner: MockAgentRunner;
  /** Approval simulator */
  approvalSimulator: ApprovalSimulator;
  /** Get recorded agent calls */
  getCalls(): RecordedCall[];
  /** Get approval requests */
  getApprovalRequests(): ApprovalRequest[];
  /** Reset all state */
  resetAll(): void;
}

/**
 * Create a test orchestrator with mocking and simulation built in.
 *
 * @example
 * ```typescript
 * const test = createTestOrchestrator({
 *   mockResponses: {
 *     'my-agent': { output: 'test response' },
 *   },
 *   constraints: {
 *     needsApproval: {
 *       when: () => true,
 *       require: { type: 'NEED_APPROVAL' },
 *     },
 *   },
 * });
 *
 * await test.run(myAgent, 'Hello');
 * expect(test.getCalls()).toHaveLength(1);
 * ```
 */
export function createTestOrchestrator<F extends Record<string, unknown> = Record<string, never>>(
  options: TestOrchestratorOptions<F> = {}
): TestOrchestrator<F> {
  const {
    mockResponses,
    defaultMockResponse,
    ...orchestratorOptions
  } = options;

  const mockRunner = createMockAgentRunner({
    responses: mockResponses,
    defaultResponse: defaultMockResponse,
  });

  const approvalSimulator = createApprovalSimulator();

  const orchestrator = createAgentOrchestrator<F>({
    ...orchestratorOptions,
    runner: mockRunner.run,
    onApprovalRequest: (req) => {
      approvalSimulator.handle(req);
      orchestratorOptions.onApprovalRequest?.(req);
    },
  });

  return {
    ...orchestrator,
    mockRunner,
    approvalSimulator,
    getCalls: () => mockRunner.getCalls(),
    getApprovalRequests: () => approvalSimulator.getRequests(),
    resetAll() {
      orchestrator.reset();
      mockRunner.clearCalls();
      approvalSimulator.clearRequests();
    },
  };
}

// ============================================================================
// Snapshot Testing
// ============================================================================

/** Constraint evaluation snapshot */
export interface ConstraintSnapshot {
  constraintId: string;
  triggered: boolean;
  requirement?: unknown;
  facts: Record<string, unknown>;
  timestamp: number;
}

/**
 * Create a constraint evaluation recorder for snapshot testing.
 *
 * @example
 * ```typescript
 * const recorder = createConstraintRecorder();
 * const orchestrator = createAgentOrchestrator({
 *   plugins: [recorder.plugin],
 * });
 *
 * await orchestrator.run(agent, 'Hello');
 *
 * expect(recorder.getSnapshots()).toMatchSnapshot();
 * ```
 */
export function createConstraintRecorder(): {
  plugin: {
    name: string;
    onRequirementCreated: (data: { constraintId: string; requirement: unknown; facts: unknown }) => void;
  };
  getSnapshots(): ConstraintSnapshot[];
  clearSnapshots(): void;
} {
  const snapshots: ConstraintSnapshot[] = [];

  return {
    plugin: {
      name: "constraint-recorder",
      onRequirementCreated(data) {
        snapshots.push({
          constraintId: data.constraintId,
          triggered: true,
          requirement: data.requirement,
          facts: data.facts as Record<string, unknown>,
          timestamp: Date.now(),
        });
      },
    },
    getSnapshots: () => [...snapshots],
    clearSnapshots: () => snapshots.length = 0,
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that an orchestrator has specific state.
 *
 * @example
 * ```typescript
 * assertOrchestratorState(orchestrator, {
 *   agentStatus: 'completed',
 *   tokenUsage: { min: 0, max: 1000 },
 *   pendingApprovals: 0,
 * });
 * ```
 */
export function assertOrchestratorState<F extends Record<string, unknown>>(
  orchestrator: AgentOrchestrator<F>,
  expected: {
    agentStatus?: "idle" | "running" | "paused" | "completed" | "error";
    tokenUsage?: { min?: number; max?: number; exact?: number };
    pendingApprovals?: number;
    conversationLength?: { min?: number; max?: number; exact?: number };
  }
): void {
  const state = orchestrator.facts;

  if (expected.agentStatus !== undefined && state.agent.status !== expected.agentStatus) {
    throw new Error(
      `Expected agent status to be "${expected.agentStatus}", got "${state.agent.status}"`
    );
  }

  if (expected.tokenUsage !== undefined) {
    const { min, max, exact } = expected.tokenUsage;
    if (exact !== undefined && state.agent.tokenUsage !== exact) {
      throw new Error(
        `Expected token usage to be exactly ${exact}, got ${state.agent.tokenUsage}`
      );
    }
    if (min !== undefined && state.agent.tokenUsage < min) {
      throw new Error(
        `Expected token usage to be at least ${min}, got ${state.agent.tokenUsage}`
      );
    }
    if (max !== undefined && state.agent.tokenUsage > max) {
      throw new Error(
        `Expected token usage to be at most ${max}, got ${state.agent.tokenUsage}`
      );
    }
  }

  if (expected.pendingApprovals !== undefined && state.approval.pending.length !== expected.pendingApprovals) {
    throw new Error(
      `Expected ${expected.pendingApprovals} pending approvals, got ${state.approval.pending.length}`
    );
  }

  if (expected.conversationLength !== undefined) {
    const { min, max, exact } = expected.conversationLength;
    const len = state.conversation.length;
    if (exact !== undefined && len !== exact) {
      throw new Error(`Expected conversation length to be exactly ${exact}, got ${len}`);
    }
    if (min !== undefined && len < min) {
      throw new Error(`Expected conversation length to be at least ${min}, got ${len}`);
    }
    if (max !== undefined && len > max) {
      throw new Error(`Expected conversation length to be at most ${max}, got ${len}`);
    }
  }
}

// ============================================================================
// Fake Timers Support
// ============================================================================

/**
 * Create a time controller for testing time-dependent behavior.
 *
 * @example
 * ```typescript
 * const time = createTimeController();
 *
 * // Override Date.now
 * const originalNow = Date.now;
 * Date.now = () => time.now();
 *
 * time.advance(1000); // Advance 1 second
 *
 * // Restore
 * Date.now = originalNow;
 * ```
 */
export function createTimeController(startTime = Date.now()): {
  now(): number;
  advance(ms: number): void;
  set(time: number): void;
  reset(): void;
} {
  let currentTime = startTime;
  const initial = startTime;

  return {
    now: () => currentTime,
    advance: (ms) => { currentTime += ms; },
    set: (time) => { currentTime = time; },
    reset: () => { currentTime = initial; },
  };
}
