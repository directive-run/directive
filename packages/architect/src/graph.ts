/**
 * Visual Constraint Graph — extract a data-only graph representation
 * of the system's constraints, resolvers, facts, and their relationships.
 *
 * Output is data-only — consumers render with D3, React Flow, etc.
 */

import type { System } from "@directive-run/core";
import type {
  SystemGraph,
  GraphNode,
  GraphEdge,
  GraphMetadata,
} from "./types.js";

// ============================================================================
// Options
// ============================================================================

export interface ExtractGraphOptions {
  /** Set of AI-created definition IDs ("type::id"). */
  dynamicIds?: Set<string>;
  /** Include fact nodes. Default: true */
  includeFacts?: boolean;
  /** Include derivation nodes. Default: true */
  includeDerivations?: boolean;
}

// ============================================================================
// Graph Extraction
// ============================================================================

/**
 * Extract a graph representation of the system's structure.
 * Returns data-only nodes and edges — no rendering logic.
 */
export function extractSystemGraph(
  system: System,
  options?: ExtractGraphOptions,
): SystemGraph {
  const dynamicIds = options?.dynamicIds ?? new Set<string>();
  const includeFacts = options?.includeFacts ?? true;
  const includeDerivations = options?.includeDerivations ?? true;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  function addNode(node: GraphNode): void {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // Get inspection data from system
  const inspection = system.inspect() as unknown as Record<string, unknown>;

  // ---- Fact nodes ----
  if (includeFacts) {
    const facts = (system.facts ?? {}) as Record<string, unknown>;

    for (const key of Object.keys(facts)) {
      addNode({
        id: `fact::${key}`,
        type: "fact",
        label: key,
        aiCreated: false,
        metadata: { value: facts[key] },
      });
    }
  }

  // ---- Constraint nodes ----
  const constraints = (inspection.constraints ?? []) as Array<Record<string, unknown>>;

  for (const constraint of constraints) {
    const id = String(constraint.id ?? constraint.name ?? "");
    if (!id) {
      continue;
    }

    const nodeId = `constraint::${id}`;
    addNode({
      id: nodeId,
      type: "constraint",
      label: id,
      aiCreated: dynamicIds.has(nodeId),
      metadata: {
        priority: constraint.priority,
        active: constraint.active,
      },
    });

    // Edges: constraints depend on facts they read
    if (Array.isArray(constraint.deps)) {
      for (const dep of constraint.deps) {
        const factNodeId = `fact::${dep}`;
        if (includeFacts) {
          addNode({
            id: factNodeId,
            type: "fact",
            label: String(dep),
            aiCreated: false,
          });
        }

        edges.push({
          source: nodeId,
          target: factNodeId,
          type: "depends-on",
          label: "reads",
        });
      }
    }
  }

  // ---- Resolver nodes ----
  const resolvers = (inspection.resolvers ?? []) as Array<Record<string, unknown>>;

  for (const resolver of resolvers) {
    const id = String(resolver.id ?? resolver.name ?? "");
    if (!id) {
      continue;
    }

    const nodeId = `resolver::${id}`;
    addNode({
      id: nodeId,
      type: "resolver",
      label: id,
      aiCreated: dynamicIds.has(nodeId),
      metadata: {
        requirement: resolver.requirement,
      },
    });

    // Item 6: match resolver.requirement against constraint requirement types
    const reqType = String(resolver.requirement ?? "");
    if (reqType) {
      for (const constraint of constraints) {
        const cId = String(constraint.id ?? constraint.name ?? "");
        if (!cId) {
          continue;
        }

        // Check if constraint has an explicit requirement type
        const constraintReqType = constraint.requirementType ?? constraint.requirement;

        if (constraintReqType !== undefined) {
          // Only create edge when requirement types match
          if (String(constraintReqType) === reqType) {
            edges.push({
              source: nodeId,
              target: `constraint::${cId}`,
              type: "resolves",
              label: reqType,
            });
          }
        } else {
          // No requirement type info available — create edge (backwards-compatible)
          edges.push({
            source: nodeId,
            target: `constraint::${cId}`,
            type: "resolves",
            label: reqType,
          });
        }
      }
    }
  }

  // ---- Derivation nodes ----
  if (includeDerivations) {
    const derivations = (inspection.derivations ?? []) as Array<Record<string, unknown>>;

    for (const derivation of derivations) {
      const id = String(derivation.id ?? derivation.name ?? "");
      if (!id) {
        continue;
      }

      const nodeId = `derivation::${id}`;
      addNode({
        id: nodeId,
        type: "derivation",
        label: id,
        aiCreated: dynamicIds.has(nodeId),
      });

      // Edges: derivations depend on facts
      if (Array.isArray(derivation.deps)) {
        for (const dep of derivation.deps) {
          edges.push({
            source: nodeId,
            target: `fact::${dep}`,
            type: "depends-on",
            label: "reads",
          });
        }
      }
    }
  }

  // ---- Effect nodes ----
  const effects = (inspection.effects ?? []) as Array<Record<string, unknown>>;

  for (const effect of effects) {
    const id = String(effect.id ?? effect.name ?? "");
    if (!id) {
      continue;
    }

    const nodeId = `effect::${id}`;
    addNode({
      id: nodeId,
      type: "effect",
      label: id,
      aiCreated: dynamicIds.has(nodeId),
    });
  }

  // ---- Metadata ----
  const aiNodeCount = nodes.filter((n) => n.aiCreated).length;

  const metadata: GraphMetadata = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    aiNodeCount,
    extractedAt: Date.now(),
  };

  return { nodes, edges, metadata };
}
