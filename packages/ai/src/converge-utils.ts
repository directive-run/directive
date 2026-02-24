/**
 * Standalone utilities for convergence planning and validation.
 *
 * These functions work with the same `produces` / `requires` agent
 * declarations used by the converge pattern, without requiring an
 * orchestrator instance.
 *
 * @example
 * ```typescript
 * import { validateConvergence, planConvergence, getDependencyGraph } from '@directive-run/ai';
 *
 * const agents = {
 *   fetcher: { produces: ['data'], requires: [] },
 *   analyzer: { produces: ['analysis'], requires: ['data'] },
 *   reporter: { produces: ['report'], requires: ['analysis'] },
 * };
 *
 * // Validate — cycle detection, missing deps, warnings
 * const validation = validateConvergence(agents);
 *
 * // Plan — dry-run without executing agents
 * const plan = planConvergence(agents, ['query']);
 *
 * // Graph — topological order, roots, leaves, edges
 * const graph = getDependencyGraph(agents);
 * ```
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/** Minimal agent declaration for convergence utilities (subset of ConvergeNode) */
export interface ConvergeAgentDeclaration {
  /** Fact keys this agent writes as output */
  produces: string[];
  /** Fact keys this agent reads as input */
  requires?: string[];
}

/** Edge in the inferred dependency graph */
export interface ConvergeDependencyEdge {
  from: string;
  to: string;
  /** Fact key that creates this dependency */
  factKey: string;
}

/** Inferred dependency graph from produces/requires analysis */
export interface ConvergeDependencyGraph {
  /** Agent IDs in topological order (roots first) */
  order: string[];
  /** Edges between agents */
  edges: ConvergeDependencyEdge[];
  /** Root agents (no unfulfilled requires from other agents) */
  roots: string[];
  /** Leaf agents (nothing depends on their produces) */
  leaves: string[];
  /** Map of fact key to agent ID that produces it */
  producers: Map<string, string>;
}

/** Validation result */
export interface ConvergeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** A single step in an execution plan */
export interface ConvergePlanStep {
  /** Step number (1-based) */
  step: number;
  /** Agent IDs that would run in this step (parallel) */
  agents: string[];
  /** Fact keys available at the start of this step */
  availableFacts: string[];
  /** Fact keys produced after this step completes */
  producedFacts: string[];
}

/** Result of a planConvergence() dry-run */
export interface ConvergenceExecutionPlan {
  /** Ordered steps showing which agents run when */
  steps: ConvergePlanStep[];
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
  agents: Record<string, ConvergeAgentDeclaration>,
): ConvergeDependencyGraph {
  const agentIds = Object.keys(agents);

  // Build a map: factKey → agentId that produces it
  const producerMap = new Map<string, string>();
  for (const [agentId, decl] of Object.entries(agents)) {
    for (const key of decl.produces) {
      if (producerMap.has(key)) {
        throw new Error(
          `[Directive Converge] Fact key "${key}" is produced by both "${producerMap.get(key)}" and "${agentId}". Each fact key must have exactly one producer.`,
        );
      }
      producerMap.set(key, agentId);
    }
  }

  // Build edges: agent B requires fact X → agent A produces fact X → edge A→B
  const edges: ConvergeDependencyEdge[] = [];
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
      `[Directive Converge] Circular dependency detected among agents: ${inCycle.join(", ")}. ` +
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
  agents: Record<string, ConvergeAgentDeclaration>,
): ConvergeDependencyGraph {
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
 * Validate a set of agent declarations for convergence.
 *
 * Checks for:
 * - Circular dependencies
 * - Duplicate producers (same fact key produced by multiple agents)
 * - Agents with no `produces` (will never contribute)
 * - Required fact keys that no agent produces (must be in initial facts)
 *
 * @example
 * ```typescript
 * const result = validateConvergence({
 *   fetcher: { produces: ['data'] },
 *   analyzer: { produces: ['analysis'], requires: ['data'] },
 * });
 *
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export function validateConvergence(
  agents: Record<string, ConvergeAgentDeclaration>,
): ConvergeValidationResult {
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
 * Dry-run convergence to preview the execution plan without running agents.
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
 * const plan = planConvergence(
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
export function planConvergence(
  agents: Record<string, ConvergeAgentDeclaration>,
  initialFactKeys: string[] = [],
  maxSteps = 50,
): ConvergenceExecutionPlan {
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
  const steps: ConvergePlanStep[] = [];

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
