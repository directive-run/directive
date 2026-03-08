import type { ExecutionPattern } from "./multi-agent-orchestrator.js";

// ============================================================================
// Pattern Serialization
// ============================================================================

/** Serialized DAG node (functions stripped) */
export interface SerializedDagNode {
  handler: string;
  agent?: string;
  deps?: string[];
  timeout?: number;
  priority?: number;
}

/** JSON-safe representation of any execution pattern (all functions stripped) */
export type SerializedPattern =
  | {
      type: "parallel";
      handlers: string[];
      minSuccess?: number;
      timeout?: number;
    }
  | { type: "sequential"; handlers: string[]; continueOnError?: boolean }
  | {
      type: "supervisor";
      supervisor: string;
      workers: string[];
      maxRounds?: number;
    }
  | {
      type: "dag";
      nodes: Record<string, SerializedDagNode>;
      timeout?: number;
      maxConcurrent?: number;
      onNodeError?: "fail" | "skip-downstream" | "continue";
    }
  | {
      type: "reflect";
      handler: string;
      evaluator: string;
      maxIterations?: number;
      onExhausted?: "accept-last" | "accept-best" | "throw";
      timeout?: number;
      threshold?: number;
    }
  | { type: "race"; handlers: string[]; timeout?: number; minSuccess?: number }
  | {
      type: "debate";
      handlers: string[];
      evaluator: string;
      maxRounds?: number;
      timeout?: number;
    }
  | {
      type: "goal";
      nodes: Record<string, SerializedGoalNode>;
      maxSteps?: number;
      timeout?: number;
    };

/** Serialized goal node (functions stripped) */
export interface SerializedGoalNode {
  handler: string;
  agent?: string;
  produces: string[];
  requires?: string[];
  allowRerun?: boolean;
  priority?: number;
}

/**
 * Serialize an execution pattern to a JSON-safe object.
 *
 * @remarks
 * Strips all function callbacks and runtime objects (AbortSignal) while
 * preserving the topology -- which agents, in what structure, with what
 * numeric/string/boolean options.
 *
 * Use this for visual editors, LLM-generated plans, persistence, or
 * debugging. Restore with {@link patternFromJSON}.
 *
 * Function-form `threshold` on reflect patterns is not serializable and will be dropped.
 * Re-supply it via `overrides` when calling {@link patternFromJSON}.
 *
 * @param pattern - The execution pattern to serialize.
 * @returns A {@link SerializedPattern} safe for `JSON.stringify`.
 *
 * @example
 * ```typescript
 * const p = parallel(['a', 'b'], (r) => r);
 * const json = patternToJSON(p);
 * // { type: "parallel", handlers: ["a", "b"] }
 * localStorage.setItem("plan", JSON.stringify(json));
 * ```
 */
export function patternToJSON(
  pattern: ExecutionPattern<unknown>,
): SerializedPattern {
  switch (pattern.type) {
    case "parallel":
      return {
        type: "parallel",
        handlers: pattern.handlers,
        minSuccess: pattern.minSuccess,
        timeout: pattern.timeout,
      };
    case "sequential":
      return {
        type: "sequential",
        handlers: pattern.handlers,
        continueOnError: pattern.continueOnError,
      };
    case "supervisor":
      return {
        type: "supervisor",
        supervisor: pattern.supervisor,
        workers: pattern.workers,
        maxRounds: pattern.maxRounds,
      };
    case "dag": {
      const nodes: Record<string, SerializedDagNode> = Object.create(null);
      for (const [id, node] of Object.entries(pattern.nodes)) {
        nodes[id] = {
          handler: node.handler,
          deps: node.deps,
          timeout: node.timeout,
          priority: node.priority,
        };
      }

      return {
        type: "dag",
        nodes,
        timeout: pattern.timeout,
        maxConcurrent: pattern.maxConcurrent,
        onNodeError: pattern.onNodeError,
      };
    }
    case "reflect":
      return {
        type: "reflect",
        handler: pattern.handler,
        evaluator: pattern.evaluator,
        maxIterations: pattern.maxIterations,
        onExhausted: pattern.onExhausted,
        timeout: pattern.timeout,
        threshold:
          typeof pattern.threshold === "number" ? pattern.threshold : undefined,
      };
    case "race":
      return {
        type: "race",
        handlers: pattern.handlers,
        timeout: pattern.timeout,
        minSuccess: pattern.minSuccess,
      };
    case "debate":
      return {
        type: "debate",
        handlers: pattern.handlers,
        evaluator: pattern.evaluator,
        maxRounds: pattern.maxRounds,
        timeout: pattern.timeout,
      };
    case "goal": {
      const cnodes: Record<string, SerializedGoalNode> = Object.create(null);
      for (const [id, node] of Object.entries(pattern.nodes)) {
        cnodes[id] = {
          handler: node.handler,
          produces: node.produces,
          requires: node.requires,
          allowRerun: node.allowRerun,
          priority: node.priority,
        };
      }

      return {
        type: "goal",
        nodes: cnodes,
        maxSteps: pattern.maxSteps,
        timeout: pattern.timeout,
      };
    }
  }
}

const ALLOWED_PATTERN_TYPES = new Set([
  "parallel",
  "sequential",
  "supervisor",
  "dag",
  "reflect",
  "race",
  "debate",
  "goal",
]);

/**
 * Restore an execution pattern from its serialized JSON form.
 *
 * @remarks
 * Returns the data structure with all function fields set to `undefined`.
 * Supply callbacks via the optional `overrides` parameter to re-attach
 * runtime behavior. Handles legacy field migrations (`agent` to `handler`,
 * `agents` to `handlers`, `converge` to `goal`).
 *
 * @param json - The serialized pattern from {@link patternToJSON} or persisted storage.
 * @param overrides - Optional partial pattern to re-attach function callbacks (e.g. `merge`, `extract`).
 * @returns A fully typed {@link ExecutionPattern} ready for use with the imperative API.
 * @throws If the pattern type is invalid or unknown.
 *
 * @example
 * ```typescript
 * const json = JSON.parse(localStorage.getItem("plan")!);
 * const pattern = patternFromJSON<string[]>(json, {
 *   merge: (results) => results.map(r => r.output as string),
 * });
 * if (pattern.type === "parallel") {
 *   const result = await orchestrator.runParallel(pattern.handlers, input, pattern.merge);
 * }
 * ```
 */
export function patternFromJSON<T = unknown>(
  json: SerializedPattern,
  overrides?: Partial<ExecutionPattern<T>>,
): ExecutionPattern<T> {
  // Migration shim: accept legacy "converge" serialized patterns (shallow copy to avoid mutating input)
  const normalized =
    json &&
    typeof json === "object" &&
    (json as Record<string, unknown>).type === "converge"
      ? ({ ...json, type: "goal" as const } as SerializedPattern)
      : json;
  if (
    !normalized ||
    typeof normalized !== "object" ||
    !ALLOWED_PATTERN_TYPES.has((normalized as SerializedPattern).type)
  ) {
    throw new Error(
      `[Directive] patternFromJSON: invalid or unknown pattern type "${(json as Record<string, unknown>)?.type}"`,
    );
  }
  const safe: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(normalized)) {
    if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
      safe[k] = v;
    }
  }

  // Migration shim: accept legacy `agent`/`agents` fields from persisted patterns
  const raw = safe as Record<string, unknown>;
  if (!raw.handler && raw.agent && typeof raw.agent === "string") {
    raw.handler = raw.agent;
    delete raw.agent;
  }
  if (!raw.handlers && raw.agents && Array.isArray(raw.agents)) {
    raw.handlers = raw.agents;
    delete raw.agents;
  }
  // Migrate DAG/goal node `agent` → `handler`
  if (raw.nodes && typeof raw.nodes === "object") {
    for (const node of Object.values(
      raw.nodes as Record<string, Record<string, unknown>>,
    )) {
      if (!node.handler && node.agent && typeof node.agent === "string") {
        node.handler = node.agent;
        delete node.agent;
      }
    }
  }

  return { ...safe, ...overrides } as ExecutionPattern<T>;
}
