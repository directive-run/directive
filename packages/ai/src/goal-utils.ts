/**
 * Standalone utilities for goal planning and validation.
 *
 * These functions work with the same `produces` / `requires` agent
 * declarations used by the goal pattern, without requiring an
 * orchestrator instance.
 *
 * @example
 * ```typescript
 * import { validateGoal, planGoal, getDependencyGraph } from '@directive-run/ai';
 *
 * const agents = {
 *   fetcher: { produces: ['data'], requires: [] },
 *   analyzer: { produces: ['analysis'], requires: ['data'] },
 *   reporter: { produces: ['report'], requires: ['analysis'] },
 * };
 *
 * // Validate — cycle detection, missing deps, warnings
 * const validation = validateGoal(agents);
 *
 * // Plan — dry-run without executing agents
 * const plan = planGoal(agents, ['query']);
 *
 * // Graph — topological order, roots, leaves, edges
 * const graph = getDependencyGraph(agents);
 * ```
 *
 * @module
 */

import type { GoalResult, GoalStepMetrics, RelaxationRecord } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Minimal agent declaration for goal utilities (subset of GoalNode) */
export interface GoalAgentDeclaration {
  /** Fact keys this agent writes as output */
  produces: string[];
  /** Fact keys this agent reads as input */
  requires?: string[];
}

/** Edge in the inferred dependency graph */
export interface GoalDependencyEdge {
  from: string;
  to: string;
  /** Fact key that creates this dependency */
  factKey: string;
}

/** Inferred dependency graph from produces/requires analysis */
export interface GoalDependencyGraph {
  /** Agent IDs in topological order (roots first) */
  order: string[];
  /** Edges between agents */
  edges: GoalDependencyEdge[];
  /** Root agents (no unfulfilled requires from other agents) */
  roots: string[];
  /** Leaf agents (nothing depends on their produces) */
  leaves: string[];
  /** Map of fact key to agent ID that produces it */
  producers: Map<string, string>;
}

/** Validation result */
export interface GoalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** A single step in an execution plan */
export interface GoalPlanStep {
  /** Step number (1-based) */
  step: number;
  /** Agent IDs that would run in this step (parallel) */
  agents: string[];
  /** Fact keys available at the start of this step */
  availableFacts: string[];
  /** Fact keys produced after this step completes */
  producedFacts: string[];
}

/** Result of a planGoal() dry-run */
export interface GoalExecutionPlan {
  /** Ordered steps showing which agents run when */
  steps: GoalPlanStep[];
  /** Agents that can never run (requires never satisfiable) */
  unreachableAgents: string[];
  /** Required fact keys that no agent produces (must be in initial facts) */
  externalDeps: string[];
  /** Whether the plan can potentially reach all agents */
  feasible: boolean;
}

// ============================================================================
// Internal: Topological Sort (Kahn's Algorithm)
// ============================================================================

function buildGraph(
  agents: Record<string, GoalAgentDeclaration>,
): GoalDependencyGraph {
  const agentIds = Object.keys(agents);

  // Build a map: factKey → agentId that produces it
  const producerMap = new Map<string, string>();
  for (const [agentId, decl] of Object.entries(agents)) {
    for (const key of decl.produces) {
      if (producerMap.has(key)) {
        throw new Error(
          `[Directive Goal] Fact key "${key}" is produced by both "${producerMap.get(key)}" and "${agentId}". Each fact key must have exactly one producer.`,
        );
      }
      producerMap.set(key, agentId);
    }
  }

  // Build edges: agent B requires fact X → agent A produces fact X → edge A→B
  const edges: GoalDependencyEdge[] = [];
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of agentIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const [agentId, decl] of Object.entries(agents)) {
    for (const key of decl.requires ?? []) {
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
      `[Directive Goal] Circular dependency detected among agents: ${inCycle.join(", ")}. ` +
      `Review their produces/requires declarations.`,
    );
  }

  // Identify roots and leaves
  const roots = order.filter((id) => {
    const decl = agents[id]!;
    const requires = decl.requires ?? [];

    return requires.every((key) => !producerMap.has(key) || producerMap.get(key) === id);
  });

  const consumedBy = new Set<string>();
  for (const edge of edges) {
    consumedBy.add(edge.from);
  }
  const leaves = agentIds.filter((id) => !consumedBy.has(id));

  return { order, edges, roots, leaves, producers: producerMap };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the dependency graph for a set of agent declarations.
 *
 * Uses Kahn's algorithm (topological sort) to compute execution order
 * and detect circular dependencies.
 *
 * @throws If agents form a circular dependency or a fact key has multiple producers.
 *
 * @example
 * ```typescript
 * const graph = getDependencyGraph({
 *   fetcher: { produces: ['data'], requires: [] },
 *   analyzer: { produces: ['analysis'], requires: ['data'] },
 * });
 *
 * console.log(graph.order);  // ['fetcher', 'analyzer']
 * console.log(graph.roots);  // ['fetcher']
 * console.log(graph.leaves); // ['analyzer']
 * ```
 */
export function getDependencyGraph(
  agents: Record<string, GoalAgentDeclaration>,
): GoalDependencyGraph {
  const graph = buildGraph(agents);

  return {
    order: [...graph.order],
    edges: [...graph.edges],
    roots: [...graph.roots],
    leaves: [...graph.leaves],
    producers: new Map(graph.producers),
  };
}

/**
 * Validate a set of agent declarations for goal execution.
 *
 * Checks for:
 * - Circular dependencies
 * - Duplicate producers (same fact key produced by multiple agents)
 * - Agents with no `produces` (will never contribute)
 * - Required fact keys that no agent produces (must be in initial facts)
 *
 * @example
 * ```typescript
 * const result = validateGoal({
 *   fetcher: { produces: ['data'] },
 *   analyzer: { produces: ['analysis'], requires: ['data'] },
 * });
 *
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateGoal(
  agents: Record<string, GoalAgentDeclaration>,
): GoalValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (Object.keys(agents).length === 0) {
    errors.push("No agents declared");
  }

  for (const [id, decl] of Object.entries(agents)) {
    if (decl.produces.length === 0) {
      warnings.push(`Agent "${id}" has no produces — it will never contribute`);
    }
  }

  const allProduced = new Set<string>();
  for (const decl of Object.values(agents)) {
    for (const key of decl.produces) {
      allProduced.add(key);
    }
  }

  for (const [id, decl] of Object.entries(agents)) {
    for (const key of decl.requires ?? []) {
      if (!allProduced.has(key)) {
        warnings.push(`Agent "${id}" requires "${key}" which no agent produces — must be in initial facts`);
      }
    }
  }

  try {
    buildGraph(agents);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Dry-run goal execution to preview the plan without running agents.
 *
 * Shows which agents would run in each step, which facts would be produced,
 * and whether any agents are unreachable.
 *
 * @param agents - Agent declarations with produces/requires
 * @param initialFactKeys - Fact keys available at the start (not values, just keys)
 * @param maxSteps - Maximum steps to simulate (default: 50)
 *
 * @example
 * ```typescript
 * const plan = planGoal(
 *   {
 *     fetcher: { produces: ['data'] },
 *     analyzer: { produces: ['analysis'], requires: ['data'] },
 *     reporter: { produces: ['report'], requires: ['analysis'] },
 *   },
 *   ['query'],
 * );
 *
 * console.log(plan.feasible);  // true
 * console.log(plan.steps);     // 3 steps: fetcher → analyzer → reporter
 * ```
 */
export function planGoal(
  agents: Record<string, GoalAgentDeclaration>,
  initialFactKeys: string[] = [],
  maxSteps = 50,
): GoalExecutionPlan {
  const graph = buildGraph(agents);

  const allProduced = new Set<string>();
  for (const decl of Object.values(agents)) {
    for (const key of decl.produces) {
      allProduced.add(key);
    }
  }

  // External deps: fact keys required by agents that no agent produces
  const externalDeps: string[] = [];
  for (const decl of Object.values(agents)) {
    for (const key of decl.requires ?? []) {
      if (!allProduced.has(key)) {
        externalDeps.push(key);
      }
    }
  }

  const availableFacts = new Set(initialFactKeys);
  const completedAgents = new Set<string>();
  const steps: GoalPlanStep[] = [];

  for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
    const readyAgents = graph.order.filter((agentId) => {
      if (completedAgents.has(agentId)) {
        return false;
      }
      const decl = agents[agentId]!;
      const requires = decl.requires ?? [];

      return requires.every((key) => availableFacts.has(key));
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
}

// ============================================================================
// Explain Goal
// ============================================================================

/** A single line in a goal execution explanation */
export interface GoalExplanationStep {
  step: number;
  agents: string[];
  factsProduced: string[];
  satisfaction: number;
  satisfactionDelta: number;
  durationMs: number;
  tokensConsumed: number;
  /** Human-readable description of what happened */
  description: string;
}

/** Structured explanation of a goal execution */
export interface GoalExplanation {
  /** Whether the goal was achieved */
  achieved: boolean;
  /** Human-readable summary */
  summary: string;
  /** Per-step explanations */
  steps: GoalExplanationStep[];
  /** Relaxation events with descriptions */
  relaxations: Array<{
    step: number;
    label: string;
    strategy: string;
    description: string;
  }>;
  /** Total tokens consumed */
  totalTokens: number;
  /** Total duration (ms) */
  durationMs: number;
}

/**
 * Generate a human-readable explanation of a goal execution result.
 *
 * Takes a `GoalResult` and returns a structured explanation of why each
 * agent ran, how satisfaction progressed, and what relaxations were applied.
 *
 * @example
 * ```typescript
 * const result = await orchestrator.runGoal(nodes, input, when, options);
 * const explanation = explainGoal(result);
 *
 * console.log(explanation.summary);
 * // "Goal achieved in 3 steps (1,247 tokens, 892ms). Satisfaction: 0 → 1."
 *
 * for (const step of explanation.steps) {
 *   console.log(step.description);
 *   // "Step 1: Ran fetcher. Produced: data. Satisfaction: 0 → 0.3 (+0.3)."
 * }
 * ```
 */
export function explainGoal<T = unknown>(
  result: GoalResult<T>,
): GoalExplanation {
  const steps: GoalExplanationStep[] = result.stepMetrics.map(
    (metric: GoalStepMetrics) => {
      const agentList = metric.nodesRun.join(", ");
      const factList = metric.factsProduced.length > 0
        ? metric.factsProduced.join(", ")
        : "none";
      const prevSatisfaction = +(metric.satisfaction - metric.satisfactionDelta).toFixed(3);
      const delta = metric.satisfactionDelta >= 0
        ? `+${metric.satisfactionDelta.toFixed(3)}`
        : metric.satisfactionDelta.toFixed(3);

      const description =
        `Step ${metric.step}: Ran ${agentList}. ` +
        `Produced: ${factList}. ` +
        `Satisfaction: ${prevSatisfaction} → ${metric.satisfaction.toFixed(3)} (${delta}). ` +
        `${metric.tokensConsumed} tokens, ${metric.durationMs}ms.`;

      return {
        step: metric.step,
        agents: metric.nodesRun,
        factsProduced: metric.factsProduced,
        satisfaction: metric.satisfaction,
        satisfactionDelta: metric.satisfactionDelta,
        durationMs: metric.durationMs,
        tokensConsumed: metric.tokensConsumed,
        description,
      };
    },
  );

  const relaxations = result.relaxations.map((r: RelaxationRecord) => {
    let description: string;
    switch (r.strategy) {
      case "allow_rerun":
        description = `Step ${r.step}: Applied relaxation "${r.label}" — re-enabled completed nodes for another run.`;
        break;
      case "inject_facts":
        description = `Step ${r.step}: Applied relaxation "${r.label}" — injected fact values to unblock dependencies.`;
        break;
      case "accept_partial":
        description = `Step ${r.step}: Applied relaxation "${r.label}" — accepted current facts as partial result.`;
        break;
      case "alternative_nodes":
        description = `Step ${r.step}: Applied relaxation "${r.label}" — added alternative nodes to the graph.`;
        break;
      case "custom":
        description = `Step ${r.step}: Applied relaxation "${r.label}" — ran custom recovery logic.`;
        break;
      default:
        description = `Step ${r.step}: Applied relaxation "${r.label}" (${r.strategy}).`;
    }

    return {
      step: r.step,
      label: r.label,
      strategy: r.strategy,
      description,
    };
  });

  const firstSatisfaction = result.stepMetrics.length > 0
    ? (result.stepMetrics[0]!.satisfaction - result.stepMetrics[0]!.satisfactionDelta).toFixed(1)
    : "0";
  const lastSatisfaction = result.stepMetrics.length > 0
    ? result.stepMetrics[result.stepMetrics.length - 1]!.satisfaction.toFixed(1)
    : "0";

  const status = result.achieved ? "Goal achieved" : "Goal not achieved";
  const relaxationNote = result.relaxations.length > 0
    ? ` ${result.relaxations.length} relaxation(s) applied.`
    : "";
  const errorNote = result.error ? ` Error: ${result.error}` : "";

  const summary =
    `${status} in ${result.steps} step(s) (${result.totalTokens.toLocaleString()} tokens, ${result.durationMs}ms). ` +
    `Satisfaction: ${firstSatisfaction} → ${lastSatisfaction}.` +
    relaxationNote +
    errorNote;

  return {
    achieved: result.achieved,
    summary,
    steps,
    relaxations,
    totalTokens: result.totalTokens,
    durationMs: result.durationMs,
  };
}
