/**
 * Desired-State Agent Coordination — "Terraform for Agents"
 *
 * Declare what each agent produces and requires. The runtime automatically
 * infers the execution graph from dependency analysis and drives agents
 * to convergence using Directive's constraint → resolver engine.
 *
 * @example
 * ```typescript
 * const engine = createGoalEngine({
 *   runner,
 *   agents: {
 *     researcher: {
 *       agent: { name: "researcher" },
 *       produces: ["research.findings"],
 *       requires: ["research.topic"],
 *     },
 *     writer: {
 *       agent: { name: "writer" },
 *       produces: ["article.draft"],
 *       requires: ["research.findings"],
 *     },
 *   },
 *   goals: {
 *     articleReady: {
 *       when: (facts) => facts["article.draft"] != null,
 *     },
 *   },
 * });
 *
 * const result = await engine.converge("articleReady", {
 *   "research.topic": "AI Safety",
 * });
 * ```
 *
 * @module
 */

import type { RunResult, AgentRunner, AgentLike, RunOptions } from "./types.js";
import type { DebugTimeline } from "./debug-timeline.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_STEPS = 50;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_CONSECUTIVE_FAILURES = 3;

/** Keys that must never appear in facts (prototype pollution guard) */
const BLOCKED_FACT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

// ============================================================================
// Types
// ============================================================================

/** Agent declaration with produces/requires for goal-driven coordination */
export interface GoalAgentDeclaration {
  /** Agent instance */
  agent: AgentLike;
  /** Fact keys this agent writes as output */
  produces: string[];
  /** Fact keys this agent reads as input */
  requires: string[];
  /** Build agent input from available facts. Default: JSON.stringify(required facts) */
  buildInput?: (facts: Record<string, unknown>) => string;
  /** Extract produced facts from agent output. Default: parse JSON output */
  extractOutput?: (result: RunResult<unknown>, facts: Record<string, unknown>) => Record<string, unknown>;
  /** Per-agent timeout (ms) */
  timeout?: number;
  /** Maximum retries for this agent per step. @default 0 */
  maxRetries?: number;
  /** Allow re-running after completion if input facts changed. @default false */
  allowRerun?: boolean;
  /** Description for debugging and DevTools rendering */
  description?: string;
}

/** Goal definition — a desired end state */
export interface GoalDefinition {
  /** Predicate that returns true when the goal is met */
  when: (facts: Record<string, unknown>) => boolean;
  /** Optional description for debugging */
  description?: string;
  /** Maximum convergence steps before giving up. @default 50 */
  maxSteps?: number;
  /** Overall timeout (ms). @default 300000 */
  timeoutMs?: number;
}

/** Result of a convergence run */
export interface ConvergenceResult {
  /** Whether the goal was met */
  converged: boolean;
  /** Final facts state */
  facts: Record<string, unknown>;
  /** Agents that ran, in order */
  executionOrder: string[];
  /** Total tokens consumed */
  totalTokens: number;
  /** Total duration (ms) */
  durationMs: number;
  /** Number of convergence steps taken */
  steps: number;
  /** Per-agent results */
  agentResults: Record<string, RunResult<unknown>>;
  /** Error if convergence failed */
  error?: string;
}

/** Edge in the inferred dependency graph */
export interface DependencyEdge {
  from: string;
  to: string;
  /** Fact key that creates this dependency */
  factKey: string;
}

/** Inferred dependency graph from produces/requires analysis */
export interface DependencyGraph {
  /** Agent IDs in topological order (roots first) */
  order: string[];
  /** Edges between agents */
  edges: DependencyEdge[];
  /** Root agents (no unfulfilled requires from other agents) */
  roots: string[];
  /** Leaf agents (nothing depends on their produces) */
  leaves: string[];
  /** Map of fact key → agent ID that produces it */
  producers: Map<string, string>;
}

/** Configuration for createGoalEngine */
export interface GoalEngineConfig {
  /** Agent declarations with produces/requires */
  agents: Record<string, GoalAgentDeclaration>;
  /** Goal definitions */
  goals: Record<string, GoalDefinition>;
  /** Base runner function */
  runner: AgentRunner;
  /** Default run options */
  runOptions?: Omit<RunOptions, "signal">;
  /** Optional debug timeline for recording convergence events */
  timeline?: DebugTimeline;
  /** Callback fired when an agent starts */
  onAgentStart?: (agentId: string, input: string) => void;
  /** Callback fired when an agent completes */
  onAgentComplete?: (agentId: string, result: RunResult<unknown>) => void;
  /** Callback fired when an agent errors */
  onAgentError?: (agentId: string, error: Error) => void;
  /** Callback fired on each convergence step */
  onStep?: (step: number, facts: Record<string, unknown>, readyAgents: string[]) => void;
}

/** Goal engine instance */
export interface GoalEngine {
  /** Get the inferred dependency graph */
  getDependencyGraph(): DependencyGraph;
  /** Run agents until a goal is met or convergence fails */
  converge(goalId: string, initialFacts: Record<string, unknown>, signal?: AbortSignal): Promise<ConvergenceResult>;
  /** Validate the configuration (cycle detection, missing deps, etc.) */
  validate(): GoalValidationResult;
  /** Dry-run: simulate convergence to preview the execution plan without running agents */
  plan(goalId: string, initialFactKeys: string[]): ExecutionPlan;
}

/** Validation result */
export interface GoalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** A single step in a plan (dry-run output) */
export interface PlanStep {
  /** Step number (1-based) */
  step: number;
  /** Agent IDs that would run in this step (parallel) */
  agents: string[];
  /** Fact keys available at the start of this step */
  availableFacts: string[];
  /** Fact keys produced after this step completes */
  producedFacts: string[];
}

/** Result of a plan() dry-run */
export interface ExecutionPlan {
  /** Ordered steps showing which agents run when */
  steps: PlanStep[];
  /** Agents that can never run (requires never satisfiable) */
  unreachableAgents: string[];
  /** Required fact keys that no agent produces (must be in initial facts) */
  externalDeps: string[];
  /** Whether the plan can potentially reach all agents */
  feasible: boolean;
}

// ============================================================================
// Safe Fact Merge
// ============================================================================

/**
 * Safely merge output facts, guarding against prototype pollution.
 * Only copies own-property keys that are not in the blocked list.
 */
function safeMergeFacts(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (!BLOCKED_FACT_KEYS.has(key)) {
      target[key] = source[key];
    }
  }
}

// ============================================================================
// Abort-aware delay
// ============================================================================

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// ============================================================================
// Dependency Graph
// ============================================================================

/**
 * Build a dependency graph from agent produces/requires declarations.
 *
 * Uses topological sort (Kahn's algorithm) to detect cycles and compute
 * execution order.
 */
export function buildDependencyGraph(
  agents: Record<string, GoalAgentDeclaration>,
): DependencyGraph {
  const agentIds = Object.keys(agents);

  // Build a map: factKey → agentId that produces it
  const producerMap = new Map<string, string>();
  for (const [agentId, decl] of Object.entries(agents)) {
    for (const key of decl.produces) {
      if (producerMap.has(key)) {
        throw new Error(
          `[Directive Goals] Fact key "${key}" is produced by both "${producerMap.get(key)}" and "${agentId}". Each fact key must have exactly one producer.`,
        );
      }
      producerMap.set(key, agentId);
    }
  }

  // Build edges: agent B requires fact X → agent A produces fact X → edge A→B
  const edges: DependencyEdge[] = [];
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of agentIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const [agentId, decl] of Object.entries(agents)) {
    for (const key of decl.requires) {
      const producer = producerMap.get(key);
      if (producer && producer !== agentId) {
        edges.push({ from: producer, to: agentId, factKey: key });
        adjacency.get(producer)!.push(agentId);
        inDegree.set(agentId, (inDegree.get(agentId) ?? 0) + 1);
      }
    }
  }

  // Topological sort (Kahn's algorithm)
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
    }
  }

  const order: string[] = [];
  let queueIdx = 0;
  while (queueIdx < queue.length) {
    const current = queue[queueIdx++]!;
    order.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (order.length !== agentIds.length) {
    const orderSet = new Set(order);
    const inCycle = agentIds.filter((id) => !orderSet.has(id));

    throw new Error(
      `[Directive Goals] Circular dependency detected among agents: ${inCycle.join(", ")}. ` +
      `Review their produces/requires declarations.`,
    );
  }

  // Identify roots and leaves
  const roots = order.filter((id) => {
    const decl = agents[id]!;

    return decl.requires.every((key) => !producerMap.has(key) || producerMap.get(key) === id);
  });

  const consumedBy = new Set<string>();
  for (const edge of edges) {
    consumedBy.add(edge.from);
  }
  const leaves = agentIds.filter((id) => !consumedBy.has(id));

  return { order, edges, roots, leaves, producers: producerMap };
}

// ============================================================================
// Validation
// ============================================================================

function validateConfig(config: GoalEngineConfig): GoalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (Object.keys(config.agents).length === 0) {
    errors.push("No agents declared");
  }

  if (Object.keys(config.goals).length === 0) {
    errors.push("No goals declared");
  }

  for (const [id, decl] of Object.entries(config.agents)) {
    if (decl.produces.length === 0) {
      warnings.push(`Agent "${id}" has no produces — it will never contribute to a goal`);
    }
  }

  const allProduced = new Set<string>();
  for (const decl of Object.values(config.agents)) {
    for (const key of decl.produces) {
      allProduced.add(key);
    }
  }

  for (const [id, decl] of Object.entries(config.agents)) {
    for (const key of decl.requires) {
      if (!allProduced.has(key)) {
        warnings.push(`Agent "${id}" requires "${key}" which no agent produces — must be in initial facts`);
      }
    }
  }

  try {
    buildDependencyGraph(config.agents);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Goal Engine
// ============================================================================

/**
 * Create a goal-driven agent coordination engine.
 *
 * Agents declare what facts they produce and require. The engine infers
 * the execution graph and drives agents toward a declared goal state.
 *
 * Each step, all agents whose requires are satisfied run in parallel.
 * By default, agents run once and are marked completed. Set `allowRerun: true`
 * on an agent declaration to let it re-run when its input facts change.
 * Agents that fail consecutively are excluded after 3 failures to prevent
 * retry storms.
 *
 * @example
 * ```typescript
 * const engine = createGoalEngine({
 *   runner: myRunner,
 *   agents: {
 *     researcher: {
 *       agent: { name: "researcher" },
 *       produces: ["research.findings"],
 *       requires: ["research.topic"],
 *     },
 *     writer: {
 *       agent: { name: "writer" },
 *       produces: ["article.draft"],
 *       requires: ["research.findings"],
 *     },
 *   },
 *   goals: {
 *     articleReady: {
 *       when: (facts) => facts["article.draft"] != null,
 *     },
 *   },
 * });
 *
 * const result = await engine.converge("articleReady", {
 *   "research.topic": "AI Safety",
 * });
 * ```
 */
export function createGoalEngine(config: GoalEngineConfig): GoalEngine {
  const { agents, goals, runner, runOptions, timeline, onAgentStart, onAgentComplete, onAgentError, onStep } = config;

  // Validate at creation time
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`[Directive Goals] Invalid configuration:\n${validation.errors.join("\n")}`);
  }

  const graph = buildDependencyGraph(agents);

  return {
    getDependencyGraph(): DependencyGraph {
      return {
        order: [...graph.order],
        edges: [...graph.edges],
        roots: [...graph.roots],
        leaves: [...graph.leaves],
        producers: new Map(graph.producers),
      };
    },

    validate(): GoalValidationResult {
      return validateConfig(config);
    },

    plan(goalId: string, initialFactKeys: string[]): ExecutionPlan {
      if (!goals[goalId]) {
        throw new Error(`[Directive Goals] Unknown goal: "${goalId}"`);
      }

      const allProduced = new Set<string>();
      for (const decl of Object.values(agents)) {
        for (const key of decl.produces) {
          allProduced.add(key);
        }
      }

      // External deps: fact keys required by agents that no agent produces
      const externalDeps: string[] = [];
      for (const decl of Object.values(agents)) {
        for (const key of decl.requires) {
          if (!allProduced.has(key)) {
            externalDeps.push(key);
          }
        }
      }

      const availableFacts = new Set(initialFactKeys);
      const completedAgents = new Set<string>();
      const steps: PlanStep[] = [];
      const maxSteps = (goals[goalId]?.maxSteps ?? DEFAULT_MAX_STEPS);

      for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
        const readyAgents = graph.order.filter((agentId) => {
          if (completedAgents.has(agentId)) {
            return false;
          }
          const decl = agents[agentId]!;

          return decl.requires.every((key) => availableFacts.has(key));
        });

        if (readyAgents.length === 0) {
          break;
        }

        const producedFacts: string[] = [];
        for (const agentId of readyAgents) {
          completedAgents.add(agentId);
          for (const key of agents[agentId]!.produces) {
            if (!availableFacts.has(key)) {
              producedFacts.push(key);
              availableFacts.add(key);
            }
          }
        }

        steps.push({
          step: stepNum,
          agents: readyAgents,
          availableFacts: [...availableFacts],
          producedFacts,
        });
      }

      const unreachableAgents = Object.keys(agents).filter(
        (id) => !completedAgents.has(id),
      );

      return {
        steps,
        unreachableAgents,
        externalDeps: [...new Set(externalDeps)],
        feasible: unreachableAgents.length === 0,
      };
    },

    async converge(
      goalId: string,
      initialFacts: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<ConvergenceResult> {
      const goal = goals[goalId];
      if (!goal) {
        throw new Error(`[Directive Goals] Unknown goal: "${goalId}"`);
      }

      const maxSteps = goal.maxSteps ?? DEFAULT_MAX_STEPS;
      const timeoutMs = goal.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      const facts: Record<string, unknown> = Object.create(null);
      safeMergeFacts(facts, initialFacts);

      const executionOrder: string[] = [];
      const agentResults: Record<string, RunResult<unknown>> = {};
      const completedAgents = new Set<string>();
      const failedAgents = new Map<string, number>(); // agentId → consecutive failure count
      // Track which fact versions each agent consumed (for allowRerun)
      const agentInputVersions = new Map<string, string>(); // agentId → hash of input facts
      let totalTokens = 0;
      const startTime = Date.now();

      // Timeout via AbortController
      const timeoutController = new AbortController();
      const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      try {
        for (let step = 0; step < maxSteps; step++) {
          // Check if goal is met
          if (goal.when(facts)) {
            return {
              converged: true,
              facts: { ...facts },
              executionOrder,
              totalTokens,
              durationMs: Date.now() - startTime,
              steps: step,
              agentResults,
            };
          }

          // Check for abort
          if (combinedSignal.aborted) {
            return {
              converged: false,
              facts: { ...facts },
              executionOrder,
              totalTokens,
              durationMs: Date.now() - startTime,
              steps: step,
              agentResults,
              error: "Aborted",
            };
          }

          // Find ready agents: all requires are satisfied, not permanently failed
          const readyAgents = graph.order.filter((agentId) => {
            // Skip agents that failed too many times
            if ((failedAgents.get(agentId) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
              return false;
            }

            const decl = agents[agentId]!;

            // Check if agent's requires are all met
            if (!decl.requires.every((key) => facts[key] !== undefined)) {
              return false;
            }

            // If completed, only re-run if allowRerun and input facts changed
            if (completedAgents.has(agentId)) {
              if (!decl.allowRerun) {
                return false;
              }
              // Check if input facts changed since last run
              const currentInputHash = JSON.stringify(decl.requires.map((k) => facts[k]));
              if (agentInputVersions.get(agentId) === currentInputHash) {
                return false;
              }
            }

            return true;
          });

          onStep?.(step, { ...facts }, readyAgents);

          if (readyAgents.length === 0) {
            const missingFacts: string[] = [];
            for (const [agentId, decl] of Object.entries(agents)) {
              if (completedAgents.has(agentId) && !decl.allowRerun) {
                continue;
              }
              if ((failedAgents.get(agentId) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
                continue;
              }
              for (const key of decl.requires) {
                if (facts[key] === undefined) {
                  missingFacts.push(`${agentId} needs "${key}"`);
                }
              }
            }

            return {
              converged: false,
              facts: { ...facts },
              executionOrder,
              totalTokens,
              durationMs: Date.now() - startTime,
              steps: step,
              agentResults,
              error: `No agents ready to run. Missing facts: ${missingFacts.join(", ")}`,
            };
          }

          // Run all ready agents in parallel
          const results = await Promise.allSettled(
            readyAgents.map(async (agentId) => {
              const decl = agents[agentId]!;

              const input = decl.buildInput
                ? decl.buildInput(facts)
                : JSON.stringify(
                  Object.fromEntries(decl.requires.map((k) => [k, facts[k]])),
                );

              onAgentStart?.(agentId, input);

              // Emit timeline event
              timeline?.record({
                type: "agent_start" as const,
                timestamp: Date.now(),
                agentId,
                inputLength: input.length,
                snapshotId: null,
              });

              let lastError: Error | null = null;
              const maxRetries = decl.maxRetries ?? 0;

              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                  const result = await runner(
                    decl.agent,
                    input,
                    { ...runOptions, signal: combinedSignal },
                  );

                  onAgentComplete?.(agentId, result);

                  timeline?.record({
                    type: "agent_complete" as const,
                    timestamp: Date.now(),
                    agentId,
                    outputLength: String(result.output).length,
                    totalTokens: result.totalTokens,
                    durationMs: Date.now() - startTime,
                    snapshotId: null,
                  });

                  return { agentId, result };
                } catch (err) {
                  lastError = err instanceof Error ? err : new Error(String(err));
                  if (attempt < maxRetries && !combinedSignal.aborted) {
                    await abortableDelay(
                      Math.min(1000 * 2 ** attempt, 10000),
                      combinedSignal,
                    );
                  }
                }
              }

              onAgentError?.(agentId, lastError!);

              timeline?.record({
                type: "agent_error" as const,
                timestamp: Date.now(),
                agentId,
                errorMessage: lastError!.message,
                durationMs: Date.now() - startTime,
                snapshotId: null,
              });

              throw lastError;
            }),
          );

          // Process results
          for (const result of results) {
            if (result.status === "fulfilled") {
              const { agentId, result: runResult } = result.value;
              const decl = agents[agentId]!;

              // Extract output facts
              let outputFacts: Record<string, unknown>;
              if (decl.extractOutput) {
                outputFacts = decl.extractOutput(runResult, facts);
              } else {
                outputFacts = {};
                try {
                  const output = typeof runResult.output === "string"
                    ? JSON.parse(runResult.output) as Record<string, unknown>
                    : runResult.output as Record<string, unknown>;

                  if (output && typeof output === "object") {
                    for (const key of decl.produces) {
                      if (Object.hasOwn(output, key)) {
                        outputFacts[key] = output[key];
                      }
                    }
                  }
                } catch {
                  if (decl.produces.length === 1) {
                    outputFacts[decl.produces[0]!] = runResult.output;
                  }
                }
              }

              // Safe merge (prototype pollution guard)
              safeMergeFacts(facts, outputFacts);
              completedAgents.add(agentId);
              // Track input version for allowRerun
              agentInputVersions.set(
                agentId,
                JSON.stringify(decl.requires.map((k) => facts[k])),
              );
              failedAgents.delete(agentId); // Reset failure count on success
              executionOrder.push(agentId);
              agentResults[agentId] = runResult;
              totalTokens += runResult.totalTokens;
            }
          }

          // Track failed agents from Promise.allSettled via readyAgents correlation
          for (let i = 0; i < results.length; i++) {
            if (results[i]!.status === "rejected") {
              const agentId = readyAgents[i]!;
              failedAgents.set(agentId, (failedAgents.get(agentId) ?? 0) + 1);
            }
          }
        }

        // Exhausted max steps
        return {
          converged: goal.when(facts),
          facts: { ...facts },
          executionOrder,
          totalTokens,
          durationMs: Date.now() - startTime,
          steps: maxSteps,
          agentResults,
          error: goal.when(facts) ? undefined : `Max convergence steps (${maxSteps}) exceeded`,
        };
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
  };
}
