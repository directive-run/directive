/**
 * Federation — export and import anonymized constraint patterns
 * across systems for cross-pollination of solutions.
 *
 * Export: anonymize an action into a shareable pattern with FNV-1a hash.
 * Import: adapt a pattern to local system schema via LLM.
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  ArchitectAction,
  FederationPattern,
  FederationExport,
  FederationImportResult,
} from "./types.js";
import { fnv1a } from "./hash.js";

// ============================================================================
// Export
// ============================================================================

export interface ExportPatternOptions {
  /** Tags for categorization. */
  tags?: string[];
  /** Initial effectiveness score 0-1. Default: 0.5 */
  effectiveness?: number;
}

/**
 * Export an architect action as a shareable, anonymized pattern.
 * Strips system-specific identifiers and creates a hash-addressed pattern.
 */
export function exportPattern(
  action: ArchitectAction,
  options?: ExportPatternOptions,
): FederationExport {
  const defType = action.definition?.type ?? inferDefType(action.tool);

  if (!defType) {
    return {
      pattern: emptyPattern(),
      success: false,
      error: `Cannot infer definition type from tool name "${action.tool}"`,
    };
  }

  const template = anonymizeTemplate(action);
  const description = anonymizeDescription(action);
  const hashInput = `${defType}::${template}`;

  const pattern: FederationPattern = {
    hash: fnv1a(hashInput),
    type: defType,
    description,
    template,
    effectiveness: options?.effectiveness ?? 0.5,
    useCount: 0,
    tags: options?.tags ?? [],
  };

  return { pattern, success: true };
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import a federated pattern by adapting it to the local system's schema
 * using an LLM runner.
 */
export async function importPattern(
  pattern: FederationPattern,
  system: System,
  runner: AgentRunner,
): Promise<FederationImportResult> {
  const facts = system.facts as Record<string, unknown>;
  const factKeys = Object.keys(facts);

  const prompt = [
    "## Federation Pattern Import",
    "",
    `Pattern type: ${pattern.type}`,
    `Description: ${pattern.description}`,
    `Template: ${pattern.template}`,
    `Effectiveness: ${pattern.effectiveness}`,
    "",
    "### Local System Facts",
    factKeys.length > 0 ? factKeys.join(", ") : "No facts available",
    "",
    "### Instructions",
    "Adapt this pattern template to work with the local system's fact keys.",
    `Respond with a single tool call to create_${pattern.type} using local fact names.`,
    "If the pattern cannot be adapted, respond with no tool calls.",
  ].join("\n");

  try {
    const result = await runner(
      {
        name: "directive-federation",
        instructions:
          "You adapt constraint patterns from other systems to work with the local system schema.",
      },
      prompt,
    );

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return {
        success: false,
        error: "Pattern could not be adapted to local schema",
      };
    }

    const tc = result.toolCalls[0]!;
    let args: Record<string, unknown>;

    try {
      args =
        typeof tc.arguments === "string"
          ? JSON.parse(tc.arguments)
          : (tc.arguments as Record<string, unknown>);
    } catch {
      return {
        success: false,
        error: "Failed to parse tool call arguments",
      };
    }

    const action: ArchitectAction = {
      id: `federated-${pattern.hash}-${Date.now()}`,
      tool: tc.name,
      arguments: args,
      reasoning: {
        trigger: "federation",
        observation: `Imported from pattern ${pattern.hash}`,
        justification: pattern.description,
        expectedOutcome: "",
        raw: typeof result.output === "string" ? result.output : "",
      },
      confidence: pattern.effectiveness,
      risk: "low",
      requiresApproval: true,
      approvalStatus: "pending",
      timestamp: Date.now(),
    };

    return { success: true, action };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function inferDefType(
  tool: string,
): "constraint" | "resolver" | "derivation" | "effect" | undefined {
  if (tool.includes("constraint")) {
    return "constraint";
  }

  if (tool.includes("resolver")) {
    return "resolver";
  }

  if (tool.includes("derivation")) {
    return "derivation";
  }

  if (tool.includes("effect")) {
    return "effect";
  }

  return undefined;
}

function anonymizeTemplate(action: ArchitectAction): string {
  const args = action.arguments;

  if (args.whenCode) {
    return `when: ${anonymizeCode(String(args.whenCode))}`;
  }

  if (args.resolveCode) {
    return `resolve: ${anonymizeCode(String(args.resolveCode))}`;
  }

  return `tool: ${action.tool}`;
}

function anonymizeCode(code: string): string {
  // Replace specific identifiers with generic placeholders
  return code
    .replace(/facts\.(\w+)/g, "facts.$FACT")
    .replace(/"[^"]+"/g, '"$VALUE"')
    .replace(/'[^']+'/g, "'$VALUE'")
    .replace(/\b\d+\b/g, "$NUM");
}

function anonymizeDescription(action: ArchitectAction): string {
  const reasoning = action.reasoning;

  if (reasoning.justification) {
    return reasoning.justification;
  }

  if (reasoning.observation) {
    return reasoning.observation;
  }

  return `${action.tool} action`;
}

function emptyPattern(): FederationPattern {
  return {
    hash: "00000000",
    type: "constraint",
    description: "",
    template: "",
    effectiveness: 0,
    useCount: 0,
    tags: [],
  };
}
