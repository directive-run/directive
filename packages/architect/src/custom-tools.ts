/**
 * Custom Tool Registration — extend the AI's toolkit with user-defined tools.
 *
 * Custom tools participate in the full pipeline: LLM prompt, approval,
 * audit, rollback. Mutating custom tools go through policy checks.
 */

import type { ArchitectToolDef, ArchitectToolParam } from "./types.js";

/** Context provided to custom tool handlers (read-only access). */
export interface CustomToolContext {
  readonly facts: Readonly<Record<string, unknown>>;
  inspect(): Record<string, unknown>;
}

/** Result from a custom tool handler. */
export interface CustomToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Custom tool definition provided by the user. */
export interface CustomToolDef {
  /** Unique tool name. Must not conflict with built-in tools. */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** Parameter schema for the LLM. */
  parameters: Record<string, ArchitectToolParam>;
  /** Whether this tool mutates system state. Default: false. */
  mutates?: boolean;
  /** Handler function executed when the LLM calls this tool. */
  handler: (
    args: Record<string, unknown>,
    context: CustomToolContext,
  ) => CustomToolResult | Promise<CustomToolResult>;
}

/** Registry for managing custom tools. */
export interface CustomToolRegistry {
  /** Register a custom tool. Throws if name conflicts with built-in tools. */
  register(def: CustomToolDef): void;
  /** Unregister a custom tool by name. Returns true if found. */
  unregister(name: string): boolean;
  /** Get all registered custom tools as ArchitectToolDef[]. */
  getToolDefs(): ArchitectToolDef[];
  /** Execute a custom tool by name. Returns null if not found. */
  execute(
    name: string,
    args: Record<string, unknown>,
    context: CustomToolContext,
  ): Promise<CustomToolResult> | null;
  /** Number of registered custom tools. */
  size(): number;
}

/** Built-in tool names that cannot be overridden. */
const BUILT_IN_TOOLS = new Set([
  "observe_system",
  "read_facts",
  "list_definitions",
  "explain",
  "create_constraint",
  "create_resolver",
  "create_effect",
  "create_derivation",
  "set_fact",
  "remove_definition",
  "rollback",
]);

const DEFAULT_MAX_TOOLS = 20;
const DEFAULT_HANDLER_TIMEOUT = 10_000;

/**
 * Create a custom tool registry for extending the AI's toolkit.
 *
 * @param maxTools - Maximum number of custom tools. Default: 20.
 * @param handlerTimeout - Timeout for handler execution in ms. Default: 10000.
 * @returns A CustomToolRegistry with register, unregister, execute, and getToolDefs methods.
 *
 * @example
 * ```typescript
 * const registry = createCustomToolRegistry();
 * registry.register({
 *   name: "check_metrics",
 *   description: "Check system metrics",
 *   parameters: {},
 *   handler: (args, context) => ({ success: true, data: context.inspect() }),
 * });
 * ```
 */
export function createCustomToolRegistry(
  maxTools = DEFAULT_MAX_TOOLS,
  handlerTimeout = DEFAULT_HANDLER_TIMEOUT,
): CustomToolRegistry {
  const tools = new Map<string, CustomToolDef>();

  function register(def: CustomToolDef): void {
    if (BUILT_IN_TOOLS.has(def.name)) {
      throw new Error(
        `Cannot register custom tool "${def.name}" — conflicts with built-in tool.`,
      );
    }

    if (tools.size >= maxTools && !tools.has(def.name)) {
      throw new Error(
        `Cannot register custom tool "${def.name}" — max tools limit (${maxTools}) reached.`,
      );
    }

    tools.set(def.name, def);
  }

  function unregister(name: string): boolean {
    return tools.delete(name);
  }

  function getToolDefs(): ArchitectToolDef[] {
    const defs: ArchitectToolDef[] = [];

    for (const tool of tools.values()) {
      defs.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        requiredCapability: null,
        mutates: tool.mutates ?? false,
      });
    }

    return defs;
  }

  function execute(
    name: string,
    args: Record<string, unknown>,
    context: CustomToolContext,
  ): Promise<CustomToolResult> | null {
    const tool = tools.get(name);
    if (!tool) {
      return null;
    }

    // Wrap handler execution with timeout and error handling
    const resultOrPromise = (() => {
      try {
        return tool.handler(args, context);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })();

    // If sync result, wrap in promise
    if (!(resultOrPromise instanceof Promise)) {
      return Promise.resolve(resultOrPromise);
    }

    // Async: race with timeout
    const timeout = new Promise<CustomToolResult>((resolve) => {
      setTimeout(() => {
        resolve({
          success: false,
          error: `Custom tool "${name}" timed out after ${handlerTimeout}ms`,
        });
      }, handlerTimeout);
    });

    return Promise.race([resultOrPromise, timeout]).catch((err) => ({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  function size(): number {
    return tools.size;
  }

  return {
    register,
    unregister,
    getToolDefs,
    execute,
    size,
  };
}
