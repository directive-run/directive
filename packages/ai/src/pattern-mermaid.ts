import { patternToJSON } from "./multi-agent-orchestrator.js";
import type { ExecutionPattern, SerializedPattern, SerializedDagNode } from "./multi-agent-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MermaidDirection = "LR" | "TD" | "TB" | "RL" | "BT";

export interface MermaidNodeShapes {
  /** Shape for agent nodes. @default "square" */
  agent?: "square" | "round" | "stadium" | "hexagon";
  /** Shape for virtual nodes (Input, Output, Merge). @default "circle" */
  virtual?: "circle" | "square" | "round" | "stadium";
}

export interface MermaidOptions {
  /** Graph flow direction. @default "LR" */
  direction?: MermaidDirection;
  /** Emits %%{init}%% preamble when set. */
  theme?: "default" | "dark" | "forest" | "neutral";
  /** Node shape overrides. */
  shapes?: MermaidNodeShapes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace non-alphanumeric chars with `_` for Mermaid-safe node IDs. */
function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Escape characters that have special meaning in Mermaid labels. */
function sanitizeLabel(name: string): string {
  return name
    .replace(/[\r\n]+/g, " ")
    .replace(/[[\](){}|<>"]/g, (ch) => `#${ch.charCodeAt(0)};`);
}

const SHAPE_WRAPPERS: Record<string, [string, string]> = {
  square: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  hexagon: ["{{", "}}"],
  circle: ["((", "))"],
};

/** Produce `id[label]` or `id((label))` etc. based on shape config. */
function wrapNode(
  id: string,
  label: string,
  type: "agent" | "virtual",
  shapes?: MermaidNodeShapes,
): string {
  const shape = type === "agent"
    ? (shapes?.agent ?? "square")
    : (shapes?.virtual ?? "circle");
  const [open, close] = SHAPE_WRAPPERS[shape]!;

  return `${id}${open}${sanitizeLabel(label)}${close}`;
}

/**
 * When the same agent appears multiple times (parallel/race), append `_1`, `_2`
 * suffixes to IDs and adjust labels to `agent #1`, etc.
 */
function deduplicateAgents(
  agents: string[],
): Array<{ id: string; label: string }> {
  const counts = new Map<string, number>();
  for (const a of agents) {
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }

  const indices = new Map<string, number>();
  const result: Array<{ id: string; label: string }> = [];

  for (const a of agents) {
    const sanitized = sanitizeId(a);
    if (counts.get(a)! > 1) {
      const idx = (indices.get(a) ?? 0) + 1;
      indices.set(a, idx);
      result.push({ id: `${sanitized}_${idx}`, label: `${a} #${idx}` });
    } else {
      result.push({ id: sanitized, label: a });
    }
  }

  return result;
}

/**
 * Kahn's algorithm with alphabetical tie-breaking for deterministic DAG ordering.
 * Returns node keys in topological order.
 */
function topoSort(nodes: Record<string, SerializedDagNode>): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const key of Object.keys(nodes)) {
    if (!inDegree.has(key)) {
      inDegree.set(key, 0);
    }
    if (!adjacency.has(key)) {
      adjacency.set(key, []);
    }
  }

  for (const [key, node] of Object.entries(nodes)) {
    for (const dep of node.deps ?? []) {
      adjacency.get(dep)!.push(key);
      inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
    }
  }

  // Seed queue with zero-indegree nodes, sorted alphabetically
  const queue: string[] = [];
  for (const [key, deg] of inDegree) {
    if (deg === 0) {
      queue.push(key);
    }
  }
  queue.sort();

  const ordered: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    const neighbors = adjacency.get(current) ?? [];
    // Sort to maintain determinism
    neighbors.sort();

    for (const neighbor of neighbors) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        // Insert in sorted position
        const insertIdx = queue.findIndex((q) => q > neighbor);
        if (insertIdx === -1) {
          queue.push(neighbor);
        } else {
          queue.splice(insertIdx, 0, neighbor);
        }
      }
    }
  }

  return ordered;
}

/** Check if input is already serialized (no function fields). */
function isSerializedPattern(
  p: ExecutionPattern<unknown> | SerializedPattern,
): p is SerializedPattern {
  // SerializedPattern never has function-valued fields.
  // Check a few known function fields to distinguish.
  const obj = p as Record<string, unknown>;
  if (obj.type === "parallel" && typeof obj.merge === "function") {
    return false;
  }
  if (obj.type === "sequential" && typeof obj.transform === "function") {
    return false;
  }
  if (obj.type === "supervisor" && typeof obj.extract === "function") {
    return false;
  }
  if (obj.type === "dag" && typeof obj.merge === "function") {
    return false;
  }
  if (obj.type === "reflect" && typeof obj.parseEvaluation === "function") {
    return false;
  }
  if (obj.type === "race" && typeof obj.extract === "function") {
    return false;
  }
  if (obj.type === "debate" && typeof obj.extract === "function") {
    return false;
  }

  // Also check: if a dag node has `when` or `transform` functions, not serialized
  if (obj.type === "dag" && obj.nodes) {
    for (const node of Object.values(obj.nodes as Record<string, unknown>)) {
      const n = node as Record<string, unknown>;
      if (typeof n.when === "function" || typeof n.transform === "function") {
        return false;
      }
    }
  }

  return true;
}

/** Build the preamble: optional %%{init}%% + graph directive. */
function buildPreamble(direction: MermaidDirection, theme?: string): string {
  const lines: string[] = [];
  if (theme) {
    lines.push(`%%{init: {'theme': '${theme}'}}%%`);
  }
  lines.push(`graph ${direction}`);

  return lines.join("\n");
}

const ALLOWED_TYPES = new Set([
  "parallel",
  "sequential",
  "supervisor",
  "dag",
  "reflect",
  "race",
  "debate",
]);

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderParallel(
  p: Extract<SerializedPattern, { type: "parallel" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const agents = deduplicateAgents(p.agents);
  const inputNode = wrapNode("__input", "Input", "virtual", shapes);
  const mergeNode = wrapNode("__merge", "Merge", "virtual", shapes);
  const lines: string[] = [];

  for (const agent of agents) {
    const agentNode = wrapNode(agent.id, agent.label, "agent", shapes);
    lines.push(`  ${inputNode} --> ${agentNode}`);
    lines.push(`  ${agentNode} --> ${mergeNode}`);
  }

  return lines;
}

function renderSequential(
  p: Extract<SerializedPattern, { type: "sequential" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  if (p.agents.length === 0) {
    return [];
  }

  const agents = p.agents.map((a) => ({
    id: sanitizeId(a),
    label: a,
  }));

  const nodes = agents.map((a) => wrapNode(a.id, a.label, "agent", shapes));

  return [`  ${nodes.join(" --> ")}`];
}

function renderSupervisor(
  p: Extract<SerializedPattern, { type: "supervisor" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const supId = sanitizeId(p.supervisor);
  const supNode = wrapNode(supId, p.supervisor, "agent", shapes);
  const lines: string[] = [];

  for (const worker of p.workers) {
    const wId = sanitizeId(worker);
    const wNode = wrapNode(wId, worker, "agent", shapes);
    lines.push(`  ${supNode} -->|delegate| ${wNode}`);
    lines.push(`  ${wNode} -->|result| ${supNode}`);
  }

  return lines;
}

function renderDag(
  p: Extract<SerializedPattern, { type: "dag" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const sorted = topoSort(p.nodes);
  const lines: string[] = [];
  const rendered = new Set<string>();

  for (const key of sorted) {
    const node = p.nodes[key]!;
    const nodeId = sanitizeId(key);
    const nodeLabel = node.agent;

    if (!node.deps || node.deps.length === 0) {
      // Ensure isolated nodes appear in the graph
      if (!rendered.has(nodeId)) {
        lines.push(`  ${wrapNode(nodeId, nodeLabel, "agent", shapes)}`);
        rendered.add(nodeId);
      }
    }

    // Sort deps for determinism
    const deps = [...(node.deps ?? [])].sort();
    for (const dep of deps) {
      const depId = sanitizeId(dep);
      const depNode = p.nodes[dep]!;
      const depLabel = depNode.agent;
      const from = wrapNode(depId, depLabel, "agent", shapes);
      const to = wrapNode(nodeId, nodeLabel, "agent", shapes);
      lines.push(`  ${from} --> ${to}`);
      rendered.add(depId);
      rendered.add(nodeId);
    }
  }

  return lines;
}

function renderRace(
  p: Extract<SerializedPattern, { type: "race" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const agents = deduplicateAgents(p.agents);
  const inputNode = wrapNode("__input", "Input", "virtual", shapes);
  const outputNode = wrapNode("__output", "Output", "virtual", shapes);
  const lines: string[] = [];

  for (const agent of agents) {
    const agentNode = wrapNode(agent.id, agent.label, "agent", shapes);
    lines.push(`  ${inputNode} --> ${agentNode}`);
    lines.push(`  ${agentNode} -.-> ${outputNode}`);
  }

  return lines;
}

function renderReflect(
  p: Extract<SerializedPattern, { type: "reflect" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const producerId = sanitizeId(p.agent);
  const evalId = sanitizeId(p.evaluator);
  const producerNode = wrapNode(producerId, p.agent, "agent", shapes);
  const evalNode = wrapNode(evalId, p.evaluator, "agent", shapes);
  const outputNode = wrapNode("__output", "Output", "virtual", shapes);

  return [
    `  ${producerNode} --> ${evalNode}`,
    `  ${evalNode} -->|feedback| ${producerNode}`,
    `  ${evalNode} -->|pass| ${outputNode}`,
  ];
}

function renderDebate(
  p: Extract<SerializedPattern, { type: "debate" }>,
  shapes?: MermaidNodeShapes,
): string[] {
  const agents = deduplicateAgents(p.agents);
  const judgeId = sanitizeId(p.evaluator);
  const judgeNode = wrapNode(judgeId, p.evaluator, "agent", shapes);
  const outputNode = wrapNode("__output", "Output", "virtual", shapes);
  const lines: string[] = [];

  for (const agent of agents) {
    const agentNode = wrapNode(agent.id, agent.label, "agent", shapes);
    lines.push(`  ${agentNode} --> ${judgeNode}`);
    lines.push(`  ${judgeNode} -->|next round| ${agentNode}`);
  }

  lines.push(`  ${judgeNode} --> ${outputNode}`);

  return lines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Convert an execution pattern to a Mermaid diagram string.
 *
 * Accepts both runtime `ExecutionPattern` (with function callbacks) and
 * pre-serialized `SerializedPattern`. Normalizes internally via `patternToJSON()`
 * when it detects function-valued fields.
 *
 * @example
 * ```typescript
 * const p = dag({ fetch: { agent: "fetcher" }, report: { agent: "reporter", deps: ["fetch"] } });
 * console.log(patternToMermaid(p, { direction: "TD" }));
 * // graph TD
 * //   fetch[fetcher]
 * //   fetch[fetcher] --> report[reporter]
 * ```
 *
 * @throws {Error} If pattern type is not one of the 7 known types.
 */
export function patternToMermaid(
  pattern: ExecutionPattern<unknown> | SerializedPattern,
  options?: MermaidOptions,
): string {
  const direction = options?.direction ?? "LR";
  const shapes = options?.shapes;

  // Normalize to SerializedPattern
  const serialized: SerializedPattern = isSerializedPattern(pattern)
    ? pattern
    : patternToJSON(pattern as ExecutionPattern<unknown>);

  if (!ALLOWED_TYPES.has(serialized.type)) {
    throw new Error(
      `[Directive] patternToMermaid: unknown pattern type "${serialized.type}"`,
    );
  }

  const preamble = buildPreamble(direction, options?.theme);
  let body: string[];

  switch (serialized.type) {
    case "parallel":
      body = renderParallel(serialized, shapes);
      break;
    case "sequential":
      body = renderSequential(serialized, shapes);
      break;
    case "supervisor":
      body = renderSupervisor(serialized, shapes);
      break;
    case "dag":
      body = renderDag(serialized, shapes);
      break;
    case "race":
      body = renderRace(serialized, shapes);
      break;
    case "reflect":
      body = renderReflect(serialized, shapes);
      break;
    case "debate":
      body = renderDebate(serialized, shapes);
      break;
  }

  return preamble + "\n" + body.join("\n") + "\n";
}
