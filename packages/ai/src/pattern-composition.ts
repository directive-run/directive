// ============================================================================
// Pattern Composition Helpers
// ============================================================================
//
// Extracted from multi-agent-orchestrator.ts — agent selection, result merging,
// pattern composition, constraint spawning, debate, derived constraints, and
// pool scaling utilities.
// ============================================================================

import type {
  RunResult,
  OrchestratorConstraint,
  OrchestratorState,
  DagPattern,
  DagExecutionContext,
  GoalPattern,
} from "./types.js";

import type {
  MultiAgentOrchestrator,
  RunAgentRequirement,
  DebatePattern,
  DebateResult,
  AgentRegistry,
  ExecutionPattern,
  ParallelPattern,
  SequentialPattern,
  SupervisorPattern,
  ReflectPattern,
  RacePattern,
} from "./multi-agent-orchestrator.js";

import type { ReflectionEvaluation } from "./reflection.js";

import { extractJsonFromOutput } from "./structured-output.js";

// ============================================================================
// Internal Helpers
// ============================================================================

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ============================================================================
// Agent Selection Helpers
// ============================================================================

/**
 * Create a constraint that routes to a specific agent when a condition is met.
 *
 * @param when - Predicate that triggers the constraint (may be async).
 * @param agent - Agent ID or function returning an agent ID to route to.
 * @param input - Input string or function returning the input for the selected agent.
 * @param priority - Optional constraint priority (higher = evaluated first).
 * @returns An {@link OrchestratorConstraint} that emits a `RUN_AGENT` requirement.
 *
 * @example
 * ```typescript
 * const constraints = {
 *   routeToExpert: selectAgent(
 *     (facts) => facts.complexity > 0.8,
 *     'expert',
 *     (facts) => facts.query,
 *   ),
 * };
 * ```
 */
export function selectAgent(
  when: (facts: Record<string, unknown>) => boolean | Promise<boolean>,
  agent: string | ((facts: Record<string, unknown>) => string),
  input: string | ((facts: Record<string, unknown>) => string),
  priority?: number,
): OrchestratorConstraint<Record<string, unknown>> {
  return {
    when: when as (
      facts: Record<string, unknown> & OrchestratorState,
    ) => boolean | Promise<boolean>,
    require: (facts: Record<string, unknown> & OrchestratorState) => {
      const selectedAgent = typeof agent === "function" ? agent(facts) : agent;
      const selectedInput = typeof input === "function" ? input(facts) : input;

      return {
        type: "RUN_AGENT",
        agent: selectedAgent,
        input: selectedInput,
      } as RunAgentRequirement;
    },
    priority,
  };
}

/**
 * Create a `RUN_AGENT` requirement object for use in constraint `require()` functions.
 *
 * @param agent - The agent ID to run.
 * @param input - The input string for the agent.
 * @param context - Optional additional context passed to the agent runner.
 * @returns A `RUN_AGENT` {@link RunAgentRequirement} object.
 *
 * @example
 * ```typescript
 * constraints: {
 *   needsResearch: {
 *     when: (facts) => facts.hasUnknowns,
 *     require: (facts) => runAgentRequirement('researcher', facts.query as string),
 *   },
 * }
 * ```
 */
export function runAgentRequirement(
  agent: string,
  input: string,
  context?: Record<string, unknown>,
): RunAgentRequirement {
  return {
    type: "RUN_AGENT",
    agent,
    input,
    context,
  };
}

// ============================================================================
// Result Merging Utilities
// ============================================================================

/**
 * Merge run results by concatenating their outputs into a single string.
 *
 * @param results - Array of run results to concatenate.
 * @param separator - String inserted between outputs (default: `"\n\n"`).
 * @returns The concatenated output string.
 */
export function concatResults(
  results: RunResult<unknown>[],
  separator = "\n\n",
): string {
  return results
    .map((r) =>
      typeof r.output === "string" ? r.output : safeStringify(r.output),
    )
    .join(separator);
}

/**
 * Pick the highest-scoring result from an array using a scoring function.
 *
 * @param results - Array of run results to compare.
 * @param score - Function that assigns a numeric score to each result (higher wins).
 * @returns The {@link RunResult} with the highest score.
 * @throws If the results array is empty.
 */
export function pickBestResult<T>(
  results: RunResult<T>[],
  score: (result: RunResult<T>) => number,
): RunResult<T> {
  if (results.length === 0) {
    throw new Error("[Directive MultiAgent] No results to pick from");
  }

  return results.reduce((best, current) =>
    score(current) > score(best) ? current : best,
  );
}

/**
 * Extract the `output` value from each run result into an array.
 *
 * @param results - Array of run results to collect from.
 * @returns An array of output values in the same order as the input results.
 */
export function collectOutputs<T>(results: RunResult<T>[]): T[] {
  return results.map((r) => r.output);
}

/**
 * Sum the total token counts from an array of run results.
 *
 * @param results - Array of run results to aggregate.
 * @returns The total number of tokens consumed across all results.
 */
export function aggregateTokens(results: RunResult<unknown>[]): number {
  return results.reduce((sum, r) => sum + r.totalTokens, 0);
}

// ============================================================================
// Pattern Composition
// ============================================================================

/**
 * Compose multiple execution patterns into a pipeline where each pattern's
 * output feeds as input to the next.
 *
 * @remarks
 * Between patterns, output is converted to a string input:
 * - `string` output passes through directly
 * - Objects are JSON-stringified
 * - Optionally provide a `transform` to customize between steps
 *
 * @param patterns - One or more execution patterns to chain together.
 * @returns An async function that runs the pipeline on a given orchestrator.
 *
 * @example
 * ```typescript
 * const workflow = composePatterns(
 *   parallel(['researcher', 'researcher'], concatResults),
 *   sequential(['writer', 'reviewer']),
 * );
 *
 * const result = await workflow(orchestrator, 'Research topic X');
 * ```
 */
export function composePatterns(
  ...patterns: ExecutionPattern[]
): (orchestrator: MultiAgentOrchestrator, input: string) => Promise<unknown> {
  if (patterns.length === 0) {
    throw new Error(
      "[Directive MultiAgent] composePatterns requires at least one pattern",
    );
  }

  return async (
    orchestrator: MultiAgentOrchestrator,
    input: string,
  ): Promise<unknown> => {
    let currentInput = input;
    let lastOutput: unknown = undefined;

    for (const pattern of patterns) {
      switch (pattern.type) {
        case "parallel": {
          const parallelPattern = pattern as ParallelPattern<unknown>;
          const inputsArr = parallelPattern.handlers.map(() => currentInput);
          lastOutput = await orchestrator.runParallel(
            parallelPattern.handlers,
            inputsArr,
            parallelPattern.merge,
            {
              minSuccess: parallelPattern.minSuccess,
              timeout: parallelPattern.timeout,
            },
          );
          break;
        }

        case "sequential": {
          const seqPattern = pattern as SequentialPattern<unknown>;
          const results = await orchestrator.runSequential(
            seqPattern.handlers,
            currentInput,
            { transform: seqPattern.transform },
          );

          const lastResult = results[results.length - 1];
          lastOutput = seqPattern.extract
            ? seqPattern.extract(lastResult?.output)
            : lastResult?.output;
          break;
        }

        case "supervisor": {
          const supPattern = pattern as SupervisorPattern<unknown>;
          const maxRounds = supPattern.maxRounds ?? 5;
          if (maxRounds < 1 || !Number.isFinite(maxRounds)) {
            throw new Error(
              "[Directive MultiAgent] supervisor maxRounds must be >= 1",
            );
          }
          const workerResults: RunResult<unknown>[] = [];
          let supervisorResult = await orchestrator.runAgent<unknown>(
            supPattern.supervisor,
            currentInput,
          );

          for (let round = 0; round < maxRounds; round++) {
            const raw = supervisorResult.output;
            let action: {
              action: string;
              worker?: string;
              workerInput?: string;
            };

            if (typeof raw === "string") {
              try {
                action = JSON.parse(raw);
              } catch {
                try {
                  const stripped = raw
                    .replace(/```(?:json|JSON)?\s*\n?/g, "")
                    .replace(/<[^>]+>/g, " ");
                  const extracted = extractJsonFromOutput(stripped);
                  if (
                    extracted &&
                    typeof extracted === "object" &&
                    "action" in (extracted as Record<string, unknown>)
                  ) {
                    action = extracted as typeof action;
                  } else {
                    break;
                  }
                } catch {
                  break;
                }
              }
            } else if (raw && typeof raw === "object" && "action" in raw) {
              action = raw as typeof action;
            } else {
              break;
            }

            if (action.action === "complete" || !action.worker) {
              break;
            }

            if (!supPattern.workers.includes(action.worker)) {
              break;
            }

            const workerResult = await orchestrator.runAgent(
              action.worker,
              action.workerInput ?? "",
            );
            workerResults.push(workerResult);

            supervisorResult = await orchestrator.runAgent(
              supPattern.supervisor,
              `Worker ${action.worker} completed with result: ${safeStringify(workerResult.output)}`,
            );
          }

          lastOutput = supPattern.extract
            ? supPattern.extract(supervisorResult.output, workerResults)
            : supervisorResult.output;
          break;
        }

        case "dag": {
          const dagPattern = pattern as DagPattern<unknown>;
          // DAG patterns must be run via runPattern to get full execution
          // We simulate by running agents individually following the DAG structure
          const dagContext: DagExecutionContext = {
            input: currentInput,
            outputs: Object.create(null),
            statuses: Object.create(null),
            errors: Object.create(null),
            results: Object.create(null),
          };

          // Simple sequential execution of DAG for composePatterns
          // (Full parallel DAG execution happens via runPattern/runDagPattern)
          if (
            typeof process !== "undefined" &&
            process.env?.NODE_ENV !== "production"
          ) {
            console.debug(
              "[Directive MultiAgent] composePatterns: DAG nodes executed sequentially — use runPattern() for full parallel DAG execution",
            );
          }
          const nodeIds = Object.keys(dagPattern.nodes);
          for (const nodeId of nodeIds) {
            const node = dagPattern.nodes[nodeId]!;
            dagContext.statuses[nodeId] = "running";
            try {
              let nodeInput = currentInput;
              if (node.transform) {
                nodeInput = node.transform(dagContext);
              } else if (node.deps && node.deps.length > 0) {
                const upstreamOutputs: Record<string, unknown> =
                  Object.create(null);
                for (const depId of node.deps) {
                  if (dagContext.outputs[depId] !== undefined) {
                    upstreamOutputs[depId] = dagContext.outputs[depId];
                  }
                }
                nodeInput = JSON.stringify(upstreamOutputs);
              }
              const result = await orchestrator.runAgent(
                node.handler,
                nodeInput,
              );
              dagContext.outputs[nodeId] = result.output;
              dagContext.results[nodeId] = result;
              dagContext.statuses[nodeId] = "completed";
            } catch (error) {
              dagContext.statuses[nodeId] = "error";
              dagContext.errors[nodeId] =
                error instanceof Error ? error.message : String(error);
              if (dagPattern.onNodeError === "fail") {
                throw error;
              }
            }
          }
          lastOutput = await dagPattern.merge(dagContext);
          break;
        }

        case "reflect": {
          const reflectPattern = pattern as ReflectPattern<unknown>;
          // Run producer→evaluator loop using runAgent
          const maxIter = reflectPattern.maxIterations ?? 2;
          const parseEval =
            reflectPattern.parseEvaluation ??
            ((output: unknown): ReflectionEvaluation => {
              if (typeof output === "string") {
                try {
                  return JSON.parse(output);
                } catch {
                  return { passed: false, feedback: output };
                }
              }
              if (output && typeof output === "object" && "passed" in output) {
                return output as ReflectionEvaluation;
              }

              return { passed: false, feedback: "Invalid evaluator output" };
            });
          const buildInput =
            reflectPattern.buildRetryInput ??
            ((inp: string, feedback: string) =>
              `${inp}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`);

          let effectiveInput = currentInput;
          let producerOutput: unknown;
          for (let i = 0; i < maxIter; i++) {
            const producerResult = await orchestrator.runAgent(
              reflectPattern.handler,
              effectiveInput,
            );
            producerOutput = producerResult.output;
            const producerStr =
              typeof producerOutput === "string"
                ? producerOutput
                : JSON.stringify(producerOutput);
            const evalResult = await orchestrator.runAgent(
              reflectPattern.evaluator,
              producerStr,
            );
            const evaluation = parseEval(evalResult.output);
            if (evaluation.passed) {
              break;
            }
            if (i < maxIter - 1 && evaluation.feedback) {
              effectiveInput = buildInput(currentInput, evaluation.feedback, i);
            }
          }
          lastOutput = reflectPattern.extract
            ? reflectPattern.extract(producerOutput)
            : producerOutput;
          break;
        }

        case "race": {
          const racePattern = pattern as RacePattern<unknown>;
          const raceResult = await orchestrator.runRace(
            racePattern.handlers,
            currentInput,
            { extract: racePattern.extract, timeout: racePattern.timeout },
          );
          lastOutput = raceResult.result;
          break;
        }

        case "debate": {
          const debatePattern = pattern as DebatePattern<unknown>;
          const debateResult = await orchestrator.runDebate(
            debatePattern.handlers,
            debatePattern.evaluator,
            currentInput,
            {
              maxRounds: debatePattern.maxRounds,
              extract: debatePattern.extract,
              parseJudgement: debatePattern.parseJudgement,
              signal: debatePattern.signal,
              timeout: debatePattern.timeout,
            },
          );
          lastOutput = debateResult.result;
          break;
        }

        case "goal": {
          const cp = pattern as GoalPattern<unknown>;
          const initialFacts =
            typeof currentInput === "string"
              ? { input: currentInput }
              : (() => {
                  try {
                    return JSON.parse(currentInput);
                  } catch {
                    return { input: currentInput };
                  }
                })();
          const goalResult = await orchestrator.runGoal(
            cp.nodes,
            initialFacts,
            cp.when,
            {
              satisfaction: cp.satisfaction,
              maxSteps: cp.maxSteps,
              extract: cp.extract,
              timeout: cp.timeout,
              signal: cp.signal,
              selectionStrategy: cp.selectionStrategy,
              relaxation: cp.relaxation,
              onStep: cp.onStep,
              onStall: cp.onStall,
            },
          );
          lastOutput = goalResult.result;
          break;
        }

        default:
          throw new Error(
            `[Directive MultiAgent] composePatterns: unknown pattern type "${(pattern as ExecutionPattern).type}"`,
          );
      }

      // Convert output to string for next pattern's input
      if (lastOutput !== undefined) {
        currentInput =
          typeof lastOutput === "string"
            ? lastOutput
            : safeStringify(lastOutput);
      }
    }

    return lastOutput;
  };
}

/**
 * Find agents in a registry that match all required capabilities.
 *
 * @param registry - The agent registry to search.
 * @param requiredCapabilities - Capabilities that each matching agent must have.
 * @returns An array of agent IDs whose `capabilities` include every required capability.
 *
 * @example
 * ```typescript
 * const agents = {
 *   researcher: { agent: researchAgent, capabilities: ['search', 'summarize'] },
 *   coder: { agent: coderAgent, capabilities: ['code', 'debug'] },
 *   writer: { agent: writerAgent, capabilities: ['write', 'edit'] },
 * };
 *
 * const matches = findAgentsByCapability(agents, ['search']);
 * // Returns ['researcher']
 * ```
 */
export function findAgentsByCapability(
  registry: AgentRegistry,
  requiredCapabilities: string[],
): string[] {
  return Object.entries(registry)
    .filter(([, reg]) => {
      const caps = reg.capabilities ?? [];

      return requiredCapabilities.every((c) => caps.includes(c));
    })
    .map(([id]) => id);
}

/**
 * Create a constraint that auto-routes to an agent based on required capabilities.
 *
 * When the condition fires, it finds agents matching the capabilities returned by
 * `getCapabilities`, then emits a `RUN_AGENT` requirement for the best match.
 *
 * @param registry - The agent registry to search for matching capabilities.
 * @param getCapabilities - Function that extracts required capabilities from facts.
 * @param getInput - Function that extracts the input string from facts.
 * @param options - Optional `priority` and custom `select` function.
 * @returns An {@link OrchestratorConstraint} that routes to a capability-matched agent.
 *
 * @example
 * ```typescript
 * const routeByCapability = capabilityRoute(
 *   agents,
 *   (facts) => facts.requiredCapabilities as string[],
 *   (facts) => facts.query as string,
 * );
 * ```
 */
export function capabilityRoute(
  registry: AgentRegistry,
  getCapabilities: (facts: Record<string, unknown>) => string[],
  getInput: (facts: Record<string, unknown>) => string,
  options?: {
    priority?: number;
    select?: (matches: string[], registry: AgentRegistry) => string;
  },
): OrchestratorConstraint<Record<string, unknown>> {
  const { priority, select } = options ?? {};

  // Cache matches between when() and require() using a generation counter
  // to ensure require() only uses cache from the same evaluation cycle
  let cachedMatches: string[] = [];
  let cacheGeneration = 0;
  let requireGeneration = -1;

  return {
    when: (facts) => {
      const caps = getCapabilities(facts);
      cachedMatches = findAgentsByCapability(registry, caps);
      cacheGeneration++;

      return cachedMatches.length > 0;
    },
    require: (facts) => {
      // Use cached matches only if from the current when() call
      const matches =
        cacheGeneration !== requireGeneration && cachedMatches.length > 0
          ? ((requireGeneration = cacheGeneration), cachedMatches)
          : findAgentsByCapability(registry, getCapabilities(facts));

      if (matches.length === 0) {
        throw new Error(
          `[Directive MultiAgent] No agent matches capabilities: ${getCapabilities(facts).join(", ")}`,
        );
      }

      const chosen = select ? select(matches, registry) : matches[0]!;

      return {
        type: "RUN_AGENT",
        agent: chosen,
        input: getInput(facts),
      } as RunAgentRequirement;
    },
    priority,
  };
}

// ============================================================================
// Constraint-Driven Agent Spawning
// ============================================================================

let spawnOnConditionOptionsWarned = false;

/**
 * Options for spawnOnCondition.
 */
export interface SpawnOnConditionOptions {
  /** Priority for the constraint (higher = evaluated first) */
  priority?: number;
  /** Additional context passed to the agent */
  context?: Record<string, unknown>;
}

/**
 * Create a constraint that auto-runs a single agent when a condition is met.
 *
 * The orchestrator's built-in `RUN_AGENT` resolver handles execution --
 * you only need to add this to your `constraints` config.
 *
 * @param config - Condition, agent ID, input builder, and optional priority/context.
 * @returns An {@link OrchestratorConstraint} that emits a `RUN_AGENT` requirement.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { reviewer: { agent: reviewerAgent } },
 *   constraints: {
 *     autoReview: spawnOnCondition({
 *       when: (facts) => (facts.confidence as number) < 0.7,
 *       agent: 'reviewer',
 *       input: (facts) => `Review this: ${facts.lastOutput}`,
 *     }),
 *   },
 * });
 * ```
 */
export function spawnOnCondition(config: {
  when: (facts: Record<string, unknown>) => boolean;
  agent: string;
  input: (facts: Record<string, unknown>) => string;
  /** Priority for the constraint (higher = evaluated first) */
  priority?: number;
  /** Additional context passed to the agent */
  context?: Record<string, unknown>;
  options?: SpawnOnConditionOptions;
}): OrchestratorConstraint<Record<string, unknown>> {
  const { when, agent, input, priority, context, options } = config;
  if (options && !spawnOnConditionOptionsWarned) {
    spawnOnConditionOptionsWarned = true;
    console.warn(
      "[Directive MultiAgent] spawnOnCondition `options` is deprecated. Use top-level `priority` and `context` instead.",
    );
  }
  const effectivePriority = priority ?? options?.priority;
  const effectiveContext = context ?? options?.context;

  return {
    when,
    require: (facts) =>
      ({
        type: "RUN_AGENT",
        agent,
        input: input(facts),
        context: effectiveContext,
      }) as RunAgentRequirement,
    priority: effectivePriority,
  };
}

// ============================================================================
// Debate Pattern
// ============================================================================

/** Configuration for the debate() factory and runDebate() imperative API. @see DebatePattern */
export type DebateConfig<T = unknown> = Omit<DebatePattern<T>, "type">;

/**
 * Create a debate pattern where agents compete and an evaluator picks the best.
 *
 * @remarks
 * Flow:
 * 1. All agents produce proposals in parallel
 * 2. Evaluator receives all proposals and picks a winner
 * 3. Optionally repeat with evaluator feedback for refinement
 *
 * @param config - Debate configuration with `handlers`, `evaluator`, and optional settings.
 * @returns A {@link DebatePattern} configuration object.
 * @see {@link runDebate} for the imperative API
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: {
 *     optimist: { agent: optimistAgent },
 *     pessimist: { agent: pessimistAgent },
 *     judge: { agent: judgeAgent },
 *   },
 *   patterns: {
 *     debate: debate({
 *       handlers: ['optimist', 'pessimist'],
 *       evaluator: 'judge',
 *       maxRounds: 2,
 *     }),
 *   },
 * });
 *
 * const result = await orchestrator.runPattern('debate', 'Should we invest in X?');
 * ```
 */
export function debate<T = unknown>(config: DebateConfig<T>): DebatePattern<T> {
  const {
    handlers,
    evaluator,
    maxRounds,
    extract,
    parseJudgement,
    signal,
    timeout,
  } = config;

  if (handlers.length < 2) {
    throw new Error(
      "[Directive MultiAgent] debate requires at least 2 handlers",
    );
  }
  if (maxRounds != null && (maxRounds < 1 || !Number.isFinite(maxRounds))) {
    throw new Error("[Directive MultiAgent] debate maxRounds must be >= 1");
  }

  return {
    type: "debate",
    handlers,
    evaluator,
    maxRounds,
    extract,
    parseJudgement,
    signal,
    timeout,
  };
}

/**
 * Run a debate imperatively on an orchestrator without pattern registration.
 *
 * Delegates to `orchestrator.runDebate()` so that lifecycle hooks, debug timeline,
 * and signal propagation all work correctly.
 *
 * @param orchestrator - The multi-agent orchestrator instance to run the debate on.
 * @param config - Debate configuration with agents, evaluator, and optional settings.
 * @param input - The initial input/prompt for the debate.
 * @returns The winning agent's output, the winner ID, and all proposals from each round.
 * @see {@link debate} for the declarative pattern API
 */
export async function runDebate<T>(
  orchestrator: MultiAgentOrchestrator,
  config: DebateConfig<T>,
  input: string,
): Promise<DebateResult<T>> {
  return orchestrator.runDebate<T>(config.handlers, config.evaluator, input, {
    maxRounds: config.maxRounds,
    extract: config.extract,
    parseJudgement: config.parseJudgement,
    signal: config.signal,
    timeout: config.timeout,
  });
}

// ============================================================================
// Derivation-Triggered Constraints
// ============================================================================

/**
 * Create a constraint that fires when a cross-agent derivation meets a condition.
 *
 * @remarks
 * Wire this into the orchestrator's `derive` config and `constraints` config together.
 * The constraint's `when()` reads the derivation value from the orchestrator's derived snapshot.
 *
 * @param derivationId - The ID of the cross-agent derivation to watch.
 * @param condition - Predicate that receives the derivation value and returns `true` when the constraint should fire.
 * @param action - Agent ID, input builder, and optional priority/context for the emitted requirement.
 * @returns An {@link OrchestratorConstraint} that emits a `RUN_AGENT` requirement when the derivation condition is met.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { ... },
 *   derive: {
 *     totalCost: (snap) => snap.coordinator.globalTokens * 0.001,
 *   },
 *   constraints: {
 *     budgetAlert: derivedConstraint('totalCost', (cost) => cost > 5.0, {
 *       agent: 'budget-manager',
 *       input: (value) => `Budget exceeded: $${value}`,
 *     }),
 *   },
 * });
 * ```
 */
export function derivedConstraint(
  derivationId: string,
  condition: (value: unknown) => boolean,
  action: {
    agent: string;
    input: (value: unknown) => string;
    priority?: number;
    context?: Record<string, unknown>;
  },
): OrchestratorConstraint<Record<string, unknown>> {
  // Generation counter to guard against stale closure between when() and require()
  let lastValue: unknown = undefined;
  let whenGeneration = 0;
  let requireGeneration = -1;

  return {
    when: (facts) => {
      // Read derivation value from coordinator facts (injected by recomputeDerivations)
      const derived = facts.__derived as Record<string, unknown> | undefined;
      const value = derived?.[derivationId];
      lastValue = value;
      whenGeneration++;

      return condition(value);
    },
    require: (facts) => {
      // Re-read from facts if generation is stale (concurrent evaluation)
      const value =
        whenGeneration !== requireGeneration
          ? ((requireGeneration = whenGeneration), lastValue)
          : (facts.__derived as Record<string, unknown> | undefined)?.[
              derivationId
            ];

      return {
        type: "RUN_AGENT",
        agent: action.agent,
        input: action.input(value),
        context: action.context,
      } as RunAgentRequirement;
    },
    priority: action.priority,
  };
}

// ============================================================================
// Pool Auto-Scaling Constraint
// ============================================================================

/** Configuration for spawnPool constraint-driven auto-scaling */
export interface SpawnPoolConfig {
  /** Agent ID to spawn (must be registered in the orchestrator) */
  agent: string;
  /** Build the input for each spawned agent. Receives current facts and spawn index (0-based). */
  input: (facts: Record<string, unknown>, index: number) => string;
  /** How many agents to spawn. Number or function of facts for dynamic scaling. */
  count: number | ((facts: Record<string, unknown>) => number);
  /** Priority for the constraint. @default undefined */
  priority?: number;
  /** Additional context passed to each spawned agent */
  context?: Record<string, unknown>;
}

/**
 * Create a constraint that spawns a pool of agent instances when a condition is met.
 *
 * @remarks
 * Unlike {@link spawnOnCondition} (which spawns one agent), `spawnPool` can target N agents.
 * However, only one requirement is emitted per constraint evaluation cycle -- the constraint
 * re-fires on subsequent cycles as long as `when()` returns true, spawning one agent per cycle.
 *
 * @param when - Predicate that triggers the pool spawn.
 * @param config - Pool configuration with agent ID, input builder, count, and optional priority/context.
 * @returns An {@link OrchestratorConstraint} that emits `RUN_AGENT` requirements.
 * @see {@link spawnOnCondition} for spawning a single agent
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { worker: { agent: workerAgent } },
 *   constraints: {
 *     scaleWorkers: spawnPool(
 *       (facts) => (facts.pendingTasks as number) > 0,
 *       {
 *         agent: 'worker',
 *         count: (facts) => Math.min(facts.pendingTasks as number, 5),
 *         input: (facts, i) => `Process task ${i + 1}`,
 *       },
 *     ),
 *   },
 * });
 * ```
 */
export function spawnPool(
  when: (facts: Record<string, unknown>) => boolean,
  config: SpawnPoolConfig,
): OrchestratorConstraint<Record<string, unknown>> {
  const { agent, input, priority, context } = config;

  return {
    when,
    require: (facts) => {
      // Only the first requirement is used per constraint cycle.
      // For count > 1, the constraint re-fires on subsequent cycles as long as `when` is true.
      return {
        type: "RUN_AGENT",
        agent,
        input: input(facts, 0),
        context,
      } as RunAgentRequirement;
    },
    priority,
  };
}
