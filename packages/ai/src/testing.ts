/**
 * Directive AI Testing Utilities
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
} from "./types.js";
import { createAgentOrchestrator, type OrchestratorOptions, type AgentOrchestrator } from "./agent-orchestrator.js";
import { createMultiAgentOrchestrator, type MultiAgentOrchestratorOptions, type MultiAgentOrchestrator } from "./multi-agent-orchestrator.js";

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

      // Notify waiters (resolve matching ones, remove them from array)
      for (let i = requestWaiters.length - 1; i >= 0; i--) {
        const waiter = requestWaiters[i]!;
        if (waiter.predicate(request)) {
          requestWaiters.splice(i, 1);
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

    reject(requestId: string, reason?: string) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        pending.resolve("rejected");
        pendingRequests.delete(requestId);
        // Store reason on the request for test assertions
        const request = requests.find((r) => r.id === requestId);
        if (request) {
          (request as ApprovalRequest & { rejectionReason?: string }).rejectionReason = reason;
        }
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
        const entry = {
          predicate,
          resolve: (req: ApprovalRequest) => {
            clearTimeout(timeout);
            resolve(req);
          },
        };

        const timeout = setTimeout(() => {
          const idx = requestWaiters.indexOf(entry);
          if (idx >= 0) {
            requestWaiters.splice(idx, 1);
          }
          reject(new Error("Timeout waiting for approval request"));
        }, timeoutMs);

        requestWaiters.push(entry);
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

// ============================================================================
// Multi-Agent Test Orchestrator
// ============================================================================

/** Options for test multi-agent orchestrator */
export interface TestMultiAgentOrchestratorOptions extends Omit<MultiAgentOrchestratorOptions, "runner"> {
  /** Mock responses keyed by agent ID — internally mapped to agent names for the mock runner */
  mockResponses?: Record<string, MockAgentConfig>;
  /** Default mock response for unmatched agents */
  defaultMockResponse?: MockAgentConfig;
}

/** Test multi-agent orchestrator with additional testing utilities */
export interface TestMultiAgentOrchestrator extends MultiAgentOrchestrator {
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
 * Create a test multi-agent orchestrator with mocking and simulation built in.
 *
 * @example
 * ```typescript
 * const test = createTestMultiAgentOrchestrator({
 *   agents: {
 *     researcher: { agent: { name: 'researcher' } },
 *     writer: { agent: { name: 'writer' } },
 *   },
 *   mockResponses: {
 *     researcher: { output: 'Research results', totalTokens: 100 },
 *     writer: { output: 'Written article', totalTokens: 200 },
 *   },
 * });
 *
 * const result = await test.runAgent('researcher', 'What is AI?');
 * expect(result.output).toBe('Research results');
 * expect(test.getCalls()).toHaveLength(1);
 * ```
 */
export function createTestMultiAgentOrchestrator(
  options: TestMultiAgentOrchestratorOptions
): TestMultiAgentOrchestrator {
  const {
    mockResponses = {},
    defaultMockResponse,
    ...orchestratorOptions
  } = options;

  // Map mock responses by agent name (from agent registration)
  const responsesByName: Record<string, MockAgentConfig> = {};
  for (const [agentId, config] of Object.entries(mockResponses)) {
    const registration = orchestratorOptions.agents[agentId];
    if (registration) {
      responsesByName[registration.agent.name] = config;
    }
  }

  const mockRunner = createMockAgentRunner({
    responses: responsesByName,
    defaultResponse: defaultMockResponse,
  });

  const approvalSimulator = createApprovalSimulator();

  const orchestrator = createMultiAgentOrchestrator({
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
// Multi-Agent Assertion Helpers
// ============================================================================

/**
 * Assert that a multi-agent orchestrator has specific state.
 *
 * @example
 * ```typescript
 * assertMultiAgentState(orchestrator, {
 *   agentStatus: { researcher: 'completed', writer: 'idle' },
 *   globalTokens: { min: 0, max: 1000 },
 *   pendingHandoffs: 0,
 * });
 * ```
 */
export function assertMultiAgentState(
  orchestrator: MultiAgentOrchestrator,
  expected: {
    agentStatus?: Record<string, "idle" | "running" | "completed" | "error">;
    totalTokens?: { agentId?: string; min?: number; max?: number };
    globalTokens?: { min?: number; max?: number };
    pendingHandoffs?: number;
  }
): void {
  if (expected.agentStatus) {
    for (const [agentId, expectedStatus] of Object.entries(expected.agentStatus)) {
      const state = orchestrator.getAgentState(agentId);
      if (!state) {
        throw new Error(`Expected agent "${agentId}" to exist, but it was not found`);
      }
      if (state.status !== expectedStatus) {
        throw new Error(
          `Expected agent "${agentId}" status to be "${expectedStatus}", got "${state.status}"`
        );
      }
    }
  }

  if (expected.totalTokens) {
    const { agentId, min, max } = expected.totalTokens;
    if (agentId) {
      const state = orchestrator.getAgentState(agentId);
      if (!state) {
        throw new Error(`Expected agent "${agentId}" to exist, but it was not found`);
      }
      if (min !== undefined && state.totalTokens < min) {
        throw new Error(
          `Expected agent "${agentId}" tokens to be at least ${min}, got ${state.totalTokens}`
        );
      }
      if (max !== undefined && state.totalTokens > max) {
        throw new Error(
          `Expected agent "${agentId}" tokens to be at most ${max}, got ${state.totalTokens}`
        );
      }
    } else {
      const allStates = orchestrator.getAllAgentStates();
      const total = Object.values(allStates).reduce((sum, s) => sum + s.totalTokens, 0);
      if (min !== undefined && total < min) {
        throw new Error(`Expected total tokens to be at least ${min}, got ${total}`);
      }
      if (max !== undefined && total > max) {
        throw new Error(`Expected total tokens to be at most ${max}, got ${total}`);
      }
    }
  }

  if (expected.globalTokens) {
    const { min, max } = expected.globalTokens;
    const total = orchestrator.totalTokens;
    if (min !== undefined && total < min) {
      throw new Error(`Expected global tokens to be at least ${min}, got ${total}`);
    }
    if (max !== undefined && total > max) {
      throw new Error(`Expected global tokens to be at most ${max}, got ${total}`);
    }
  }

  if (expected.pendingHandoffs !== undefined) {
    const pendingCount = orchestrator.getPendingHandoffs().length;
    if (pendingCount !== expected.pendingHandoffs) {
      throw new Error(
        `Expected ${expected.pendingHandoffs} pending handoffs, got ${pendingCount}`
      );
    }
  }
}

// ============================================================================
// DAG Testing Helpers
// ============================================================================

import type { DagNode, DagExecutionContext, DagNodeStatus, DagPattern } from "./types.js";
import { dag } from "./multi-agent-orchestrator.js";

/**
 * Create a test DAG pattern from a simplified node spec.
 *
 * @example
 * ```typescript
 * const pattern = createTestDag({
 *   A: { agent: "researcher" },
 *   B: { agent: "writer", deps: ["A"] },
 *   C: { agent: "reviewer", deps: ["B"] },
 * });
 * ```
 */
export function createTestDag<T = unknown>(
  nodes: Record<string, Pick<DagNode, "agent" | "deps" | "when" | "transform" | "timeout" | "priority">>,
  merge?: (context: DagExecutionContext) => T | Promise<T>,
  options?: { timeout?: number; maxConcurrent?: number; onNodeError?: "fail" | "skip-downstream" | "continue" },
): DagPattern<T> {
  const defaultMerge = (context: DagExecutionContext) => context.outputs as unknown as T;

  return dag<T>(nodes, merge ?? defaultMerge, options);
}

/**
 * Assert that a DAG execution produced the expected node statuses.
 *
 * @example
 * ```typescript
 * assertDagExecution(context, {
 *   nodeStatuses: { A: "completed", B: "completed", C: "skipped" },
 *   completedNodes: ["A", "B"],
 *   skippedNodes: ["C"],
 * });
 * ```
 */
export function assertDagExecution(
  context: DagExecutionContext,
  expected: {
    nodeStatuses?: Record<string, DagNodeStatus>;
    completedNodes?: string[];
    skippedNodes?: string[];
    errorNodes?: string[];
    outputContains?: Record<string, unknown>;
  },
): void {
  if (expected.nodeStatuses) {
    for (const [nodeId, expectedStatus] of Object.entries(expected.nodeStatuses)) {
      const actual = context.statuses[nodeId];
      if (actual !== expectedStatus) {
        throw new Error(
          `Expected node "${nodeId}" status to be "${expectedStatus}", got "${actual}"`
        );
      }
    }
  }

  if (expected.completedNodes) {
    for (const nodeId of expected.completedNodes) {
      if (context.statuses[nodeId] !== "completed") {
        throw new Error(
          `Expected node "${nodeId}" to be completed, got "${context.statuses[nodeId]}"`
        );
      }
    }
  }

  if (expected.skippedNodes) {
    for (const nodeId of expected.skippedNodes) {
      if (context.statuses[nodeId] !== "skipped") {
        throw new Error(
          `Expected node "${nodeId}" to be skipped, got "${context.statuses[nodeId]}"`
        );
      }
    }
  }

  if (expected.errorNodes) {
    for (const nodeId of expected.errorNodes) {
      if (context.statuses[nodeId] !== "error") {
        throw new Error(
          `Expected node "${nodeId}" to be error, got "${context.statuses[nodeId]}"`
        );
      }
    }
  }

  if (expected.outputContains) {
    for (const [nodeId, expectedOutput] of Object.entries(expected.outputContains)) {
      const actual = context.outputs[nodeId];
      if (actual !== expectedOutput) {
        throw new Error(
          `Expected node "${nodeId}" output to be ${JSON.stringify(expectedOutput)}, got ${JSON.stringify(actual)}`
        );
      }
    }
  }
}

// ============================================================================
// Debug Timeline Testing Helpers
// ============================================================================

import type { DebugEvent, DebugEventType } from "./types.js";
import { createDebugTimeline, type DebugTimeline } from "./debug-timeline.js";

/**
 * Create a test debug timeline pre-populated with events.
 *
 * @example
 * ```typescript
 * const timeline = createTestTimeline([
 *   { type: "agent_start", agentId: "researcher", inputLength: 42 },
 *   { type: "agent_complete", agentId: "researcher", outputLength: 100, durationMs: 500, totalTokens: 200 },
 * ]);
 *
 * expect(timeline.getEventsForAgent("researcher")).toHaveLength(2);
 * ```
 */
export function createTestTimeline(
  events?: Array<Partial<DebugEvent> & { type: DebugEventType }>,
  options?: { maxEvents?: number },
): DebugTimeline {
  const timeline = createDebugTimeline({ maxEvents: options?.maxEvents ?? 500 });

  if (events) {
    for (const event of events) {
      timeline.record({
        timestamp: Date.now(),
        snapshotId: null,
        agentId: "",
        ...event,
      } as Omit<DebugEvent, "id">);
    }
  }

  return timeline;
}

/**
 * Assert that a debug timeline contains expected events.
 *
 * @example
 * ```typescript
 * assertTimelineEvents(timeline, {
 *   totalEvents: 5,
 *   eventTypes: ["agent_start", "guardrail_check", "agent_complete"],
 *   agentEvents: { researcher: 3, writer: 2 },
 *   hasType: "guardrail_check",
 * });
 * ```
 */
export function assertTimelineEvents(
  timeline: DebugTimeline,
  expected: {
    totalEvents?: number;
    minEvents?: number;
    maxEvents?: number;
    eventTypes?: DebugEventType[];
    agentEvents?: Record<string, number>;
    hasType?: DebugEventType;
    doesNotHaveType?: DebugEventType;
  },
): void {
  const events = timeline.getEvents();

  if (expected.totalEvents !== undefined && events.length !== expected.totalEvents) {
    throw new Error(
      `Expected ${expected.totalEvents} timeline events, got ${events.length}`
    );
  }

  if (expected.minEvents !== undefined && events.length < expected.minEvents) {
    throw new Error(
      `Expected at least ${expected.minEvents} timeline events, got ${events.length}`
    );
  }

  if (expected.maxEvents !== undefined && events.length > expected.maxEvents) {
    throw new Error(
      `Expected at most ${expected.maxEvents} timeline events, got ${events.length}`
    );
  }

  if (expected.eventTypes) {
    for (const type of expected.eventTypes) {
      const found = events.some((e) => e.type === type);
      if (!found) {
        throw new Error(
          `Expected timeline to contain event of type "${type}", but none found`
        );
      }
    }
  }

  if (expected.agentEvents) {
    for (const [agentId, expectedCount] of Object.entries(expected.agentEvents)) {
      const actual = timeline.getEventsForAgent(agentId).length;
      if (actual !== expectedCount) {
        throw new Error(
          `Expected ${expectedCount} events for agent "${agentId}", got ${actual}`
        );
      }
    }
  }

  if (expected.hasType) {
    const found = events.some((e) => e.type === expected.hasType);
    if (!found) {
      throw new Error(
        `Expected timeline to contain event of type "${expected.hasType}"`
      );
    }
  }

  if (expected.doesNotHaveType) {
    const found = events.some((e) => e.type === expected.doesNotHaveType);
    if (found) {
      throw new Error(
        `Expected timeline NOT to contain event of type "${expected.doesNotHaveType}"`
      );
    }
  }
}

// ============================================================================
// Self-Healing Testing Helpers
// ============================================================================

import type { RerouteEvent } from "./types.js";
import type { HealthMonitor } from "./health-monitor.js";

/**
 * Create a runner that always fails, useful for testing self-healing.
 *
 * @example
 * ```typescript
 * const failing = createFailingRunner(new Error("Provider down"));
 * const orchestrator = createAgentOrchestrator({
 *   runner: failing,
 *   selfHealing: { fallbackRunners: [backupRunner] },
 * });
 * ```
 */
export function createFailingRunner(
  error?: Error,
  options?: { delay?: number; failAfter?: number },
): AgentRunner {
  let callCount = 0;
  const failAfter = options?.failAfter ?? 0;

  return async <T>(
    _agent: AgentLike,
    _input: string,
    _runOptions?: RunOptions,
  ): Promise<RunResult<T>> => {
    callCount++;

    if (failAfter > 0 && callCount <= failAfter) {
      return {
        output: "success" as T,
        messages: [],
        toolCalls: [],
        totalTokens: 10,
      };
    }

    if (options?.delay && options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }

    throw error ?? new Error("Runner failed");
  };
}

/**
 * Assert that an agent was rerouted during execution.
 *
 * @example
 * ```typescript
 * const events: RerouteEvent[] = [];
 * const orchestrator = createMultiAgentOrchestrator({
 *   selfHealing: {
 *     onReroute: (event) => events.push(event),
 *   },
 * });
 *
 * // ... trigger reroute ...
 * assertRerouted(events, {
 *   fromAgent: "primary",
 *   toAgent: "backup",
 *   reason: /circuit breaker/i,
 * });
 * ```
 */
export function assertRerouted(
  events: RerouteEvent[],
  expected: {
    fromAgent?: string;
    toAgent?: string;
    reason?: string | RegExp;
    minReroutes?: number;
  },
): void {
  if (events.length === 0) {
    throw new Error("Expected at least one reroute event, but none occurred");
  }

  if (expected.minReroutes !== undefined && events.length < expected.minReroutes) {
    throw new Error(
      `Expected at least ${expected.minReroutes} reroute events, got ${events.length}`
    );
  }

  if (expected.fromAgent) {
    const found = events.some((e) => e.originalAgent === expected.fromAgent);
    if (!found) {
      throw new Error(
        `Expected reroute from agent "${expected.fromAgent}", but no matching event found`
      );
    }
  }

  if (expected.toAgent) {
    const found = events.some((e) => e.reroutedTo === expected.toAgent);
    if (!found) {
      throw new Error(
        `Expected reroute to agent "${expected.toAgent}", but no matching event found`
      );
    }
  }

  if (expected.reason) {
    const found = events.some((e) => {
      if (typeof expected.reason === "string") {
        return e.reason.includes(expected.reason);
      }

      return expected.reason!.test(e.reason);
    });
    if (!found) {
      throw new Error(
        `Expected reroute reason matching ${expected.reason}, but no matching event found`
      );
    }
  }
}

/**
 * Assert the health state of an agent in the health monitor.
 *
 * @example
 * ```typescript
 * assertAgentHealth(monitor, "researcher", {
 *   minScore: 70,
 *   circuitState: "CLOSED",
 * });
 * ```
 */
export function assertAgentHealth(
  monitor: HealthMonitor,
  agentId: string,
  expected: {
    minScore?: number;
    maxScore?: number;
    circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN";
    minSuccessRate?: number;
  },
): void {
  const metrics = monitor.getMetrics(agentId);

  if (expected.minScore !== undefined && metrics.healthScore < expected.minScore) {
    throw new Error(
      `Expected agent "${agentId}" health score to be at least ${expected.minScore}, got ${metrics.healthScore}`
    );
  }

  if (expected.maxScore !== undefined && metrics.healthScore > expected.maxScore) {
    throw new Error(
      `Expected agent "${agentId}" health score to be at most ${expected.maxScore}, got ${metrics.healthScore}`
    );
  }

  if (expected.circuitState !== undefined && metrics.circuitState !== expected.circuitState) {
    throw new Error(
      `Expected agent "${agentId}" circuit state to be "${expected.circuitState}", got "${metrics.circuitState}"`
    );
  }

  if (expected.minSuccessRate !== undefined && metrics.successRate < expected.minSuccessRate) {
    throw new Error(
      `Expected agent "${agentId}" success rate to be at least ${expected.minSuccessRate}, got ${metrics.successRate}`
    );
  }
}
