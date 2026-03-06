/**
 * Health Scoring + Graph Analysis for AI Architect systems.
 *
 * Item 28: computeHealthScore — 0-100 normalized score across 4 dimensions.
 * Item 29: analyzeGraph — cycle detection, orphan constraints, dead resolvers.
 */

import type { System } from "@directive-run/core";
import type { SystemGraph } from "./types.js";

// ============================================================================
// Item 28: Health Scoring
// ============================================================================

/** Health score breakdown. */
export interface HealthScore {
  /** Overall score 0-100. */
  score: number;
  /** Breakdown by dimension. */
  breakdown: {
    /** 25 if settled, 0 if not. */
    settled: number;
    /** 25 - 5 per unmet requirement, min 0. */
    unmetRequirements: number;
    /** Active/total ratio × 25. */
    constraintHealth: number;
    /** Success rate × 25. */
    resolverHealth: number;
  };
  /** Warnings about system health. */
  warnings: string[];
}

/**
 * Compute a health score for the system.
 * Returns a normalized 0-100 score across 4 dimensions (25pts each).
 */
export function computeHealthScore(system: System): HealthScore {
  const inspection = system.inspect() as unknown as Record<string, unknown>;
  const warnings: string[] = [];

  // Dimension 1: Settled state (25 points)
  const isSettled = inspection.settled !== false;
  const settledScore = isSettled ? 25 : 0;
  if (!isSettled) {
    warnings.push("System is not settled — there are pending requirements.");
  }

  // Dimension 2: Unmet requirements (25 - 5 per unmet, min 0)
  const pending = (inspection.pendingRequirements ?? inspection.unmet ?? []) as unknown[];
  const unmetCount = Array.isArray(pending) ? pending.length : 0;
  const unmetScore = Math.max(0, 25 - unmetCount * 5);
  if (unmetCount > 0) {
    warnings.push(`${unmetCount} unmet requirement(s).`);
  }

  // Dimension 3: Constraint health (active/total ratio × 25)
  const constraints = (inspection.constraints ?? []) as Array<Record<string, unknown>>;
  const totalConstraints = constraints.length;
  const activeConstraints = constraints.filter((c) => c.active !== false).length;
  const constraintScore = totalConstraints > 0
    ? Math.round((activeConstraints / totalConstraints) * 25)
    : 25; // No constraints = healthy (nothing to fail)
  if (totalConstraints > 0 && activeConstraints < totalConstraints) {
    warnings.push(`${totalConstraints - activeConstraints}/${totalConstraints} constraints inactive.`);
  }

  // Dimension 4: Resolver health (success rate × 25)
  const resolvers = (inspection.resolvers ?? []) as Array<Record<string, unknown>>;
  const totalResolvers = resolvers.length;
  const failedResolvers = resolvers.filter((r) => r.failed === true || r.error !== undefined).length;
  const successRate = totalResolvers > 0 ? (totalResolvers - failedResolvers) / totalResolvers : 1;
  const resolverScore = Math.round(successRate * 25);
  if (failedResolvers > 0) {
    warnings.push(`${failedResolvers}/${totalResolvers} resolvers in error state.`);
  }

  const score = settledScore + unmetScore + constraintScore + resolverScore;

  return {
    score,
    breakdown: {
      settled: settledScore,
      unmetRequirements: unmetScore,
      constraintHealth: constraintScore,
      resolverHealth: resolverScore,
    },
    warnings,
  };
}

// ============================================================================
// Item 29: Graph Analysis
// ============================================================================

/** Result of graph analysis. */
export interface GraphAnalysis {
  /** Strongly connected components (cycles). */
  cycles: string[][];
  /** Constraints with no resolver handling their requirement type. */
  orphanConstraints: string[];
  /** Resolvers with no constraint producing their requirement type. */
  deadResolvers: string[];
}

/**
 * Analyze a system graph for structural issues.
 * Uses Tarjan's SCC algorithm for cycle detection.
 */
export function analyzeGraph(graph: SystemGraph): GraphAnalysis {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const list = adj.get(edge.source);
    if (list) {
      list.push(edge.target);
    }
  }

  // Tarjan's SCC algorithm
  const cycles = tarjanSCC(adj);

  // Find orphan constraints (no resolver resolves them)
  const resolverTargets = new Set(
    graph.edges
      .filter((e) => e.type === "resolves")
      .map((e) => e.target),
  );
  const orphanConstraints = graph.nodes
    .filter((n) => n.type === "constraint" && !resolverTargets.has(n.id))
    .map((n) => n.id);

  // Find dead resolvers (no constraint is connected to them)
  const resolverSources = new Set(
    graph.edges
      .filter((e) => e.type === "resolves")
      .map((e) => e.source),
  );
  const deadResolvers = graph.nodes
    .filter((n) => n.type === "resolver" && !resolverSources.has(n.id))
    .map((n) => n.id);

  return { cycles, orphanConstraints, deadResolvers };
}

// ============================================================================
// Tarjan's SCC Algorithm
// ============================================================================

function tarjanSCC(adj: Map<string, string[]>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowLinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) ?? [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowLinks.set(v, Math.min(lowLinks.get(v)!, lowLinks.get(w)!));
      } else if (onStack.has(w)) {
        lowLinks.set(v, Math.min(lowLinks.get(v)!, indices.get(w)!));
      }
    }

    // If v is a root node, pop the SCC
    if (lowLinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      // Only report cycles (SCC with more than 1 node)
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) {
      strongConnect(v);
    }
  }

  return sccs;
}
