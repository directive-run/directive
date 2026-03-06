/**
 * 9 LLM tool definitions for the AI Architect.
 *
 * Read tools: observe_system, read_facts, list_definitions, explain
 * Mutate tools: create_constraint, create_resolver, set_fact, remove_definition, rollback
 */

import type { System } from "@directive-run/core";
import type {
  ArchitectCapabilities,
  ArchitectDefType,
  ArchitectToolDef,
} from "./types.js";
import type { SandboxCompileOptions } from "./types.js";
import { compileSandboxed, SandboxError } from "./sandbox.js";

// ============================================================================
// Item 7: ID validation
// ============================================================================

const ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/;

function validateId(id: string, context: string): string | null {
  if (!ID_REGEX.test(id)) {
    return `Invalid ${context} ID "${id}". Must start with a letter, contain only letters/numbers/underscores/hyphens, and be 1-100 characters.`;
  }

  return null;
}

// ============================================================================
// E11: Error sanitization utility
// ============================================================================

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}

// ============================================================================
// Tool Definitions (LLM-facing schema)
// ============================================================================

export const TOOL_DEFINITIONS: readonly ArchitectToolDef[] = [
  {
    name: "observe_system",
    description:
      "Inspect the current state of the Directive system. Returns facts, constraints, resolvers, derivations, pending requirements, and run history.",
    parameters: {},
    requiredCapability: null,
    mutates: false,
  },
  {
    name: "read_facts",
    description:
      "Read the current values of all facts (state) in the system.",
    parameters: {},
    requiredCapability: null,
    mutates: false,
  },
  {
    name: "list_definitions",
    description:
      "List all dynamically registered definitions, grouped by type (constraints, resolvers, effects, derivations). Shows which ones were created by the AI architect.",
    parameters: {},
    requiredCapability: null,
    mutates: false,
  },
  {
    name: "explain",
    description:
      "Explain how a specific requirement is being resolved. Returns the constraint that triggered it, the resolver handling it, and the current status.",
    parameters: {
      requirementId: {
        type: "string",
        description: "The ID of the requirement to explain.",
        required: true,
      },
    },
    requiredCapability: null,
    mutates: false,
  },
  {
    name: "create_constraint",
    description:
      "Register a new constraint in the system. A constraint watches facts and emits requirements when conditions are met. Provide a `when` function (returns boolean) and a `require` value (the requirement to emit when `when` returns true).",
    parameters: {
      id: {
        type: "string",
        description: "Unique ID for the constraint.",
        required: true,
      },
      whenCode: {
        type: "string",
        description:
          'JavaScript function body for the `when` predicate. Receives `facts` as parameter. Must return a boolean. Example: "return facts.errorCount > 3;"',
        required: true,
      },
      require: {
        type: "object",
        description:
          'The requirement object to emit when the constraint is met. Must include a `type` string. Example: { "type": "RETRY_FAILED", "maxAttempts": 3 }',
        required: true,
      },
      priority: {
        type: "number",
        description:
          "Priority number for conflict resolution. Higher = more important. Default: 0",
      },
    },
    requiredCapability: "constraints",
    mutates: true,
  },
  {
    name: "create_resolver",
    description:
      "Register a new resolver in the system. A resolver handles a specific requirement type by executing logic that mutates facts. Provide a `requirement` type string and a `resolve` function body.",
    parameters: {
      id: {
        type: "string",
        description: "Unique ID for the resolver.",
        required: true,
      },
      requirement: {
        type: "string",
        description:
          "The requirement type this resolver handles (e.g., 'RETRY_FAILED').",
        required: true,
      },
      resolveCode: {
        type: "string",
        description:
          'JavaScript function body for the resolve function. Receives `req` (the requirement) and `context` (with `context.facts` for state access). Example: "context.facts.retryCount = (context.facts.retryCount || 0) + 1;"',
        required: true,
      },
    },
    requiredCapability: "resolvers",
    mutates: true,
  },
  // Item 22: create_effect tool
  {
    name: "create_effect",
    description:
      "Register a new effect in the system. Effects are fire-and-forget side effects that run when facts change. Provide a `run` function body.",
    parameters: {
      id: {
        type: "string",
        description: "Unique ID for the effect.",
        required: true,
      },
      runCode: {
        type: "string",
        description:
          'JavaScript function body for the `run` function. Receives `facts` as parameter. Example: "console.log(facts.status);"',
        required: true,
      },
    },
    requiredCapability: "effects",
    mutates: true,
  },
  // Item 22: create_derivation tool
  {
    name: "create_derivation",
    description:
      "Register a new derivation (computed value) in the system. Derivations are pure functions that derive values from facts. Provide a `derive` expression.",
    parameters: {
      id: {
        type: "string",
        description: "Unique ID for the derivation.",
        required: true,
      },
      deriveCode: {
        type: "string",
        description:
          'JavaScript expression for the derivation. Receives `facts` as parameter. Must return a value. Example: "facts.count * 2"',
        required: true,
      },
    },
    requiredCapability: "derivations",
    mutates: true,
  },
  // M15: set_fact tool
  {
    name: "set_fact",
    description:
      "Set a fact value directly in the system. Only available when facts access level is 'read-write'.",
    parameters: {
      key: {
        type: "string",
        description: "The fact key to set.",
        required: true,
      },
      value: {
        type: "string",
        description: "The value to set (JSON-encoded). Example: '42', '\"hello\"', 'true'",
        required: true,
      },
    },
    requiredCapability: "facts",
    mutates: true,
  },
  {
    name: "remove_definition",
    description:
      "Remove a previously registered dynamic definition from the system.",
    parameters: {
      type: {
        type: "string",
        description: "The type of definition to remove.",
        required: true,
        enum: ["constraint", "resolver", "effect", "derivation"],
      },
      id: {
        type: "string",
        description: "The ID of the definition to remove.",
        required: true,
      },
    },
    requiredCapability: null,
    mutates: true,
  },
  {
    name: "rollback",
    description:
      "Roll back a previously applied action, restoring the system to its state before that action.",
    parameters: {
      actionId: {
        type: "string",
        description: "The ID of the action to roll back.",
        required: true,
      },
    },
    requiredCapability: null,
    mutates: true,
  },
] as const;

// ============================================================================
// Tool Filtering
// ============================================================================

/** Filter tools based on architect capabilities. */
export function getAvailableTools(
  capabilities: ArchitectCapabilities,
): ArchitectToolDef[] {
  return TOOL_DEFINITIONS.filter((tool) => {
    // C3: remove_definition and rollback require at least one mutation capability
    if (tool.name === "remove_definition" || tool.name === "rollback") {
      const hasMutation = capabilities.constraints !== false ||
        capabilities.resolvers !== false ||
        capabilities.effects !== false ||
        capabilities.derivations !== false;

      return hasMutation;
    }

    if (!tool.requiredCapability) {
      return true;
    }

    const cap = capabilities[tool.requiredCapability];

    // M15: set_fact only available when facts is 'read-write'
    if (tool.name === "set_fact") {
      return cap === "read-write";
    }

    // For 'facts', any access level enables read tools
    if (tool.requiredCapability === "facts") {
      return cap !== undefined;
    }

    return cap !== false;
  });
}

// ============================================================================
// Tool Execution
// ============================================================================

export interface ToolExecutionContext {
  system: System;
  sandboxOptions?: SandboxCompileOptions;
  /** Tracked AI-created definition IDs ("type::id"). */
  dynamicIds: Set<string>;
  /** Rollback function provided by the architect. */
  rollbackFn: (actionId: string) => { success: boolean; reason?: string };
  /** Current capabilities for capability-gated operations. */
  capabilities?: ArchitectCapabilities;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** If a mutation, the definition info. */
  definition?: {
    type: ArchitectDefType;
    id: string;
    code?: string;
  };
}

/** Execute a tool by name with arguments. */
export function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  // E5: renamed from `context` to `toolCtx` to avoid conflict with resolver context
  toolCtx: ToolExecutionContext,
): ToolResult {
  switch (toolName) {
    case "observe_system":
      return executeObserveSystem(toolCtx);

    case "read_facts":
      return executeReadFacts(toolCtx);

    case "list_definitions":
      return executeListDefinitions(toolCtx);

    case "explain":
      return executeExplain(args, toolCtx);

    case "create_constraint":
      return executeCreateConstraint(args, toolCtx);

    case "create_resolver":
      return executeCreateResolver(args, toolCtx);

    case "create_effect":
      return executeCreateEffect(args, toolCtx);

    case "create_derivation":
      return executeCreateDerivation(args, toolCtx);

    case "set_fact":
      return executeSetFact(args, toolCtx);

    case "remove_definition":
      return executeRemoveDefinition(args, toolCtx);

    case "rollback":
      return executeRollback(args, toolCtx);

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ============================================================================
// Read Tools
// ============================================================================

function executeObserveSystem(toolCtx: ToolExecutionContext): ToolResult {
  try {
    const inspection = toolCtx.system.inspect();

    return { success: true, data: inspection };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

function executeReadFacts(toolCtx: ToolExecutionContext): ToolResult {
  try {
    const facts = { ...toolCtx.system.facts };

    return { success: true, data: facts };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

function executeListDefinitions(toolCtx: ToolExecutionContext): ToolResult {
  try {
    const result = {
      constraints: toolCtx.system.constraints.listDynamic(),
      resolvers: toolCtx.system.resolvers.listDynamic(),
      effects: toolCtx.system.effects.listDynamic(),
      aiCreated: [...toolCtx.dynamicIds],
    };

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

function executeExplain(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const requirementId = args.requirementId as string | undefined;

  if (!requirementId) {
    return { success: false, error: "requirementId is required" };
  }

  try {
    const explanation = toolCtx.system.explain(requirementId);

    return { success: true, data: explanation };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

// ============================================================================
// Mutate Tools
// ============================================================================

function executeCreateConstraint(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const id = args.id as string | undefined;
  const whenCode = args.whenCode as string | undefined;
  const require = args.require as Record<string, unknown> | undefined;
  const priority = args.priority as number | undefined;

  if (!id || !whenCode || !require) {
    return { success: false, error: "id, whenCode, and require are required" };
  }

  const idError = validateId(id, "constraint");
  if (idError) {
    return { success: false, error: idError };
  }

  try {
    // Compile the when function in sandbox
    const compiled = compileSandboxed(
      `return (${whenCode})`,
      toolCtx.sandboxOptions,
    );

    // Build the constraint definition
    const constraintDef = {
      when: (facts: Record<string, unknown>) => {
        const result = compiled.execute(facts);

        return Boolean(result);
      },
      require: () => require,
      ...(priority !== undefined ? { priority } : {}),
    };

    toolCtx.system.constraints.register(id, constraintDef as never);
    toolCtx.dynamicIds.add(`constraint::${id}`);

    return {
      success: true,
      data: { registered: true },
      definition: { type: "constraint", id, code: whenCode },
    };
  } catch (err) {
    if (err instanceof SandboxError) {
      return { success: false, error: `Sandbox: ${err.message}` };
    }

    return { success: false, error: sanitizeError(err) };
  }
}

// C4: resolver mutations via diff + system.batch()
function executeCreateResolver(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const id = args.id as string | undefined;
  const requirement = args.requirement as string | undefined;
  const resolveCode = args.resolveCode as string | undefined;

  if (!id || !requirement || !resolveCode) {
    return {
      success: false,
      error: "id, requirement, and resolveCode are required",
    };
  }

  const idError = validateId(id, "resolver");
  if (idError) {
    return { success: false, error: idError };
  }

  try {
    // Compile the resolve function in sandbox
    const compiled = compileSandboxed(resolveCode, {
      ...toolCtx.sandboxOptions,
      factWriteAccess: true,
    });

    // Build the resolver definition
    const resolverDef = {
      requirement,
      resolve: async (
        req: Record<string, unknown>,
        resolverContext: { facts: Record<string, unknown> },
      ) => {
        // C4: take a copy of facts, run sandbox, diff & write back via batch
        const factsCopy = JSON.parse(JSON.stringify(resolverContext.facts));
        compiled.execute({ ...factsCopy, __req: req });

        // Diff and write back changed facts via system.batch() if available
        const sys = toolCtx.system as unknown as Record<string, unknown>;
        const batchFn = typeof sys.batch === "function" ? sys.batch.bind(sys) : null;

        const writeBack = () => {
          const sysFactsObj = toolCtx.system.facts as Record<string, unknown>;
          for (const key of Object.keys(factsCopy)) {
            if (key === "__req") {
              continue;
            }

            if (JSON.stringify(factsCopy[key]) !== JSON.stringify(sysFactsObj[key])) {
              sysFactsObj[key] = factsCopy[key];
            }
          }
        };

        if (batchFn) {
          batchFn(writeBack);
        } else {
          writeBack();
        }
      },
    };

    toolCtx.system.resolvers.register(id, resolverDef as never);
    toolCtx.dynamicIds.add(`resolver::${id}`);

    return {
      success: true,
      data: { registered: true },
      definition: { type: "resolver", id, code: resolveCode },
    };
  } catch (err) {
    if (err instanceof SandboxError) {
      return { success: false, error: `Sandbox: ${err.message}` };
    }

    return { success: false, error: sanitizeError(err) };
  }
}

// Item 22: create_effect tool execution
function executeCreateEffect(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const id = args.id as string | undefined;
  const runCode = args.runCode as string | undefined;

  if (!id || !runCode) {
    return { success: false, error: "id and runCode are required" };
  }

  const idError = validateId(id, "effect");
  if (idError) {
    return { success: false, error: idError };
  }

  try {
    const compiled = compileSandboxed(runCode, toolCtx.sandboxOptions);

    const effectDef = {
      run: (facts: Record<string, unknown>) => {
        compiled.execute(facts);
      },
    };

    toolCtx.system.effects.register(id, effectDef as never);
    toolCtx.dynamicIds.add(`effect::${id}`);

    return {
      success: true,
      data: { registered: true },
      definition: { type: "effect" as const, id, code: runCode },
    };
  } catch (err) {
    if (err instanceof SandboxError) {
      return { success: false, error: `Sandbox: ${err.message}` };
    }

    return { success: false, error: sanitizeError(err) };
  }
}

// Item 22: create_derivation tool execution
function executeCreateDerivation(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const id = args.id as string | undefined;
  const deriveCode = args.deriveCode as string | undefined;

  if (!id || !deriveCode) {
    return { success: false, error: "id and deriveCode are required" };
  }

  const idError = validateId(id, "derivation");
  if (idError) {
    return { success: false, error: idError };
  }

  try {
    // M7: check system.derivations availability before proceeding
    const sys = toolCtx.system as unknown as Record<string, unknown>;
    if (
      !("derivations" in toolCtx.system) ||
      typeof sys.derivations !== "object" ||
      sys.derivations === null
    ) {
      return { success: false, error: "system.derivations API unavailable" };
    }

    const compiled = compileSandboxed(
      `return (${deriveCode})`,
      toolCtx.sandboxOptions,
    );

    const derivations = sys.derivations as { register: (id: string, def: unknown) => void };
    derivations.register(id, {
      derive: (facts: Record<string, unknown>) => compiled.execute(facts),
    });

    toolCtx.dynamicIds.add(`derivation::${id}`);

    return {
      success: true,
      data: { registered: true },
      definition: { type: "derivation" as const, id, code: deriveCode },
    };
  } catch (err) {
    if (err instanceof SandboxError) {
      return { success: false, error: `Sandbox: ${err.message}` };
    }

    return { success: false, error: sanitizeError(err) };
  }
}

// M15: set_fact tool execution
function executeSetFact(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const key = args.key as string | undefined;
  const valueStr = args.value as string | undefined;

  if (!key || valueStr === undefined) {
    return { success: false, error: "key and value are required" };
  }

  // M13: block prototype pollution keys
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  if (BLOCKED_KEYS.has(key)) {
    return { success: false, error: `Blocked fact key: "${key}"` };
  }

  try {
    let value: unknown;
    try {
      value = JSON.parse(valueStr);
    } catch {
      value = valueStr;
    }

    // Write via batch if available
    const sys = toolCtx.system as unknown as Record<string, unknown>;
    const batchFn = typeof sys.batch === "function" ? sys.batch.bind(sys) : null;

    const writeBack = () => {
      (toolCtx.system.facts as Record<string, unknown>)[key] = value;
    };

    if (batchFn) {
      batchFn(writeBack);
    } else {
      writeBack();
    }

    return {
      success: true,
      data: { key, value },
    };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

// C6: check dynamicIds before removing
function executeRemoveDefinition(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const type = args.type as ArchitectDefType | undefined;
  const id = args.id as string | undefined;

  if (!type || !id) {
    return { success: false, error: "type and id are required" };
  }

  // M2: gate by definition type's capability
  if (toolCtx.capabilities) {
    const capKey = `${type}s` as keyof ArchitectCapabilities;
    if (toolCtx.capabilities[capKey] === false) {
      return {
        success: false,
        error: `Cannot remove ${type} — ${capKey} capability is disabled.`,
      };
    }
  }

  // C6: only allow removing AI-created definitions
  const dynamicKey = `${type}::${id}`;
  if (!toolCtx.dynamicIds.has(dynamicKey)) {
    return {
      success: false,
      error: `Cannot remove "${id}" — not an AI-created ${type}. Only AI-created definitions can be removed.`,
    };
  }

  try {
    switch (type) {
      case "constraint":
        toolCtx.system.constraints.unregister(id);
        break;
      case "resolver":
        toolCtx.system.resolvers.unregister(id);
        break;
      case "effect":
        toolCtx.system.effects.unregister(id);
        break;
      case "derivation":
        if (
          "derivations" in toolCtx.system &&
          typeof (toolCtx.system as Record<string, unknown>).derivations === "object"
        ) {
          const derivations = (
            toolCtx.system as Record<string, { unregister: (id: string) => void } | undefined>
          ).derivations;
          derivations?.unregister(id);
        }
        break;
      default:
        return { success: false, error: `Unknown definition type: ${type}` };
    }

    toolCtx.dynamicIds.delete(dynamicKey);

    return {
      success: true,
      data: { unregistered: true },
      definition: { type, id },
    };
  } catch (err) {
    return { success: false, error: sanitizeError(err) };
  }
}

function executeRollback(
  args: Record<string, unknown>,
  toolCtx: ToolExecutionContext,
): ToolResult {
  const actionId = args.actionId as string | undefined;

  if (!actionId) {
    return { success: false, error: "actionId is required" };
  }

  const result = toolCtx.rollbackFn(actionId);

  return {
    success: result.success,
    data: { rolledBack: result.success },
    error: result.success ? undefined : (result.reason ?? `Failed to rollback action ${actionId}`),
  };
}

// ============================================================================
// LLM System Prompt Builder
// ============================================================================

/** Build the system prompt for the LLM describing available tools and system context. */
export function buildSystemPrompt(
  tools: ArchitectToolDef[],
  systemDescription?: string,
  goals?: string[],
  notes?: string[],
): string {
  const parts: string[] = [];

  parts.push(
    "You are an AI Architect managing a Directive constraint-driven runtime system.",
  );
  parts.push(
    "Your role is to observe the system state and create constraints/resolvers to keep it healthy.",
  );
  parts.push("");

  if (systemDescription) {
    parts.push(`## System Description\n${systemDescription}`);
    parts.push("");
  }

  if (goals && goals.length > 0) {
    parts.push("## Goals");
    for (const goal of goals) {
      parts.push(`- ${goal}`);
    }
    parts.push("");
  }

  if (notes && notes.length > 0) {
    parts.push("## Notes");
    for (const note of notes) {
      parts.push(`- ${note}`);
    }
    parts.push("");
  }

  parts.push("## Available Tools");
  for (const tool of tools) {
    parts.push(`### ${tool.name}`);
    parts.push(tool.description);
    if (Object.keys(tool.parameters).length > 0) {
      parts.push("Parameters:");
      for (const [name, param] of Object.entries(tool.parameters)) {
        const req = param.required ? " (required)" : "";
        parts.push(`  - ${name}: ${param.type}${req} — ${param.description}`);
      }
    }
    parts.push("");
  }

  parts.push("## Response Format");
  parts.push(
    "For each action, provide structured reasoning with: trigger, observation, justification, expectedOutcome.",
  );
  parts.push(
    "Rate your confidence (0-1) and risk level (low/medium/high) for each action.",
  );

  return parts.join("\n");
}
