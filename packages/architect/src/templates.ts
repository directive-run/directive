/**
 * Constraint Templates — pre-built pattern library for common system patterns.
 *
 * The LLM can apply templates instead of writing constraint/resolver code
 * from scratch, producing more reliable and tested patterns.
 */

// ============================================================================
// Types
// ============================================================================

/** Parameter definition for a template. */
export interface TemplateParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  default?: unknown;
  required?: boolean;
}

/** A constraint template — pre-built pattern for common system behaviors. */
export interface ConstraintTemplate {
  id: string;
  name: string;
  description: string;
  category: "resilience" | "optimization" | "monitoring" | "safety" | "custom";
  type: "constraint" | "resolver" | "constraint+resolver";
  parameters: TemplateParameter[];
  /** Generate the `whenCode` for the constraint. */
  generateWhenCode?: (params: Record<string, unknown>) => string;
  /** Generate the `require` object for the constraint. */
  generateRequire?: (params: Record<string, unknown>) => Record<string, unknown>;
  /** Generate the `resolveCode` for the resolver. */
  generateResolveCode?: (params: Record<string, unknown>) => string;
  defaultPriority?: number;
}

/** Result of instantiating a template. */
export interface TemplateInstantiation {
  constraintArgs?: {
    id: string;
    whenCode: string;
    require: Record<string, unknown>;
    priority?: number;
  };
  resolverArgs?: {
    id: string;
    requirement: string;
    resolveCode: string;
  };
}

/** Registry for managing constraint templates. */
export interface TemplateRegistry {
  /** List all registered templates. */
  list(): ConstraintTemplate[];
  /** Get a template by ID. */
  get(id: string): ConstraintTemplate | undefined;
  /** Register a custom template. */
  register(template: ConstraintTemplate): void;
  /** Format all templates for LLM prompt context. */
  formatForPrompt(): string;
  /** Instantiate a template with parameters. Returns null if template not found. */
  instantiate(
    templateId: string,
    params: Record<string, unknown>,
  ): TemplateInstantiation | null;
}

// ============================================================================
// Built-in Templates
// ============================================================================

export const BUILT_IN_TEMPLATES: ConstraintTemplate[] = [
  {
    id: "rate-limit",
    name: "Rate Limiter",
    description:
      "Fires when a counter exceeds a threshold within a time window. Use for rate limiting API calls, login attempts, etc.",
    category: "resilience",
    type: "constraint",
    parameters: [
      { name: "factKey", type: "string", description: "Fact key holding the counter value", required: true },
      { name: "threshold", type: "number", description: "Max count before triggering", required: true },
      { name: "requirementType", type: "string", description: "Requirement type to emit", default: "RATE_LIMIT_EXCEEDED" },
    ],
    generateWhenCode: (params) =>
      `return facts["${params.factKey}"] > ${params.threshold};`,
    generateRequire: (params) => ({
      type: (params.requirementType as string) || "RATE_LIMIT_EXCEEDED",
      factKey: params.factKey,
      threshold: params.threshold,
    }),
    defaultPriority: 80,
  },
  {
    id: "error-threshold",
    name: "Error Threshold",
    description:
      "Fires when an error count exceeds a limit. Use for monitoring error rates and triggering alerts or recovery.",
    category: "monitoring",
    type: "constraint",
    parameters: [
      { name: "factKey", type: "string", description: "Fact key holding the error count", required: true },
      { name: "maxErrors", type: "number", description: "Maximum errors before triggering", required: true },
      { name: "requirementType", type: "string", description: "Requirement type to emit", default: "ERROR_THRESHOLD_EXCEEDED" },
    ],
    generateWhenCode: (params) =>
      `return facts["${params.factKey}"] > ${params.maxErrors};`,
    generateRequire: (params) => ({
      type: (params.requirementType as string) || "ERROR_THRESHOLD_EXCEEDED",
      factKey: params.factKey,
      maxErrors: params.maxErrors,
    }),
    defaultPriority: 90,
  },
  {
    id: "circuit-breaker",
    name: "Circuit Breaker",
    description:
      "Opens after N consecutive failures, auto-resets after a cooldown. Creates both a constraint (to detect failures) and a resolver (to reset the circuit).",
    category: "resilience",
    type: "constraint+resolver",
    parameters: [
      { name: "failureFactKey", type: "string", description: "Fact key holding consecutive failure count", required: true },
      { name: "stateFactKey", type: "string", description: "Fact key holding circuit state ('closed'|'open'|'half-open')", required: true },
      { name: "maxFailures", type: "number", description: "Failures before opening", default: 5 },
      { name: "requirementType", type: "string", description: "Requirement type", default: "CIRCUIT_OPEN" },
    ],
    generateWhenCode: (params) => {
      const maxFailures = params.maxFailures ?? 5;

      return `return facts["${params.failureFactKey}"] >= ${maxFailures} && facts["${params.stateFactKey}"] === "closed";`;
    },
    generateRequire: (params) => ({
      type: (params.requirementType as string) || "CIRCUIT_OPEN",
      stateFactKey: params.stateFactKey,
      failureFactKey: params.failureFactKey,
    }),
    generateResolveCode: (params) =>
      `context.facts["${params.stateFactKey}"] = "open"; context.facts["${params.failureFactKey}"] = 0;`,
    defaultPriority: 100,
  },
  {
    id: "health-monitor",
    name: "Health Monitor",
    description:
      "Fires when a numeric fact drops below a threshold. Use for monitoring health scores, resource levels, etc.",
    category: "monitoring",
    type: "constraint",
    parameters: [
      { name: "factKey", type: "string", description: "Fact key holding a numeric health value", required: true },
      { name: "minValue", type: "number", description: "Minimum acceptable value", required: true },
      { name: "requirementType", type: "string", description: "Requirement type to emit", default: "HEALTH_LOW" },
    ],
    generateWhenCode: (params) =>
      `return typeof facts["${params.factKey}"] === "number" && facts["${params.factKey}"] < ${params.minValue};`,
    generateRequire: (params) => ({
      type: (params.requirementType as string) || "HEALTH_LOW",
      factKey: params.factKey,
      minValue: params.minValue,
    }),
    defaultPriority: 70,
  },
  {
    id: "idle-timeout",
    name: "Idle Timeout",
    description:
      "Fires when a timestamp fact is stale beyond a timeout. Use for detecting idle sessions, stale data, etc.",
    category: "optimization",
    type: "constraint",
    parameters: [
      { name: "factKey", type: "string", description: "Fact key holding a timestamp (ms since epoch)", required: true },
      { name: "timeoutMs", type: "number", description: "Timeout in milliseconds", required: true },
      { name: "requirementType", type: "string", description: "Requirement type to emit", default: "IDLE_TIMEOUT" },
    ],
    generateWhenCode: (params) =>
      `return typeof facts["${params.factKey}"] === "number" && (Date.now() - facts["${params.factKey}"]) > ${params.timeoutMs};`,
    generateRequire: (params) => ({
      type: (params.requirementType as string) || "IDLE_TIMEOUT",
      factKey: params.factKey,
      timeoutMs: params.timeoutMs,
    }),
    defaultPriority: 30,
  },
];

// ============================================================================
// Registry
// ============================================================================

/**
 * Create a template registry with built-in and optional custom templates.
 */
export function createTemplateRegistry(
  customTemplates?: ConstraintTemplate[],
): TemplateRegistry {
  const templates = new Map<string, ConstraintTemplate>();

  // Load built-ins
  for (const t of BUILT_IN_TEMPLATES) {
    templates.set(t.id, t);
  }

  // Load custom templates
  if (customTemplates) {
    for (const t of customTemplates) {
      templates.set(t.id, t);
    }
  }

  function list(): ConstraintTemplate[] {
    return [...templates.values()];
  }

  function get(id: string): ConstraintTemplate | undefined {
    return templates.get(id);
  }

  function register(template: ConstraintTemplate): void {
    templates.set(template.id, template);
  }

  function formatForPrompt(): string {
    const lines: string[] = ["## Constraint Templates"];
    lines.push("Use `apply_template` to instantiate these pre-built patterns.");
    lines.push("");

    for (const t of templates.values()) {
      lines.push(`### ${t.name} (${t.id})`);
      lines.push(t.description);
      lines.push(`Type: ${t.type} | Category: ${t.category}`);

      if (t.parameters.length > 0) {
        lines.push("Parameters:");
        for (const p of t.parameters) {
          const req = p.required ? " (required)" : ` (default: ${JSON.stringify(p.default)})`;
          lines.push(`  - ${p.name}: ${p.type}${req} — ${p.description}`);
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  function instantiate(
    templateId: string,
    params: Record<string, unknown>,
  ): TemplateInstantiation | null {
    const template = templates.get(templateId);
    if (!template) {
      return null;
    }

    // Fill defaults and validate required params
    const resolved: Record<string, unknown> = {};
    for (const p of template.parameters) {
      if (params[p.name] !== undefined) {
        resolved[p.name] = params[p.name];
      } else if (p.default !== undefined) {
        resolved[p.name] = p.default;
      } else if (p.required) {
        return null; // Missing required param
      }
    }

    const result: TemplateInstantiation = {};

    // Generate constraint if applicable
    if (template.type === "constraint" || template.type === "constraint+resolver") {
      if (template.generateWhenCode && template.generateRequire) {
        result.constraintArgs = {
          id: `${templateId}-${Date.now()}`,
          whenCode: template.generateWhenCode(resolved),
          require: template.generateRequire(resolved),
          priority: template.defaultPriority,
        };
      }
    }

    // Generate resolver if applicable
    if (template.type === "resolver" || template.type === "constraint+resolver") {
      if (template.generateResolveCode && template.generateRequire) {
        const requireObj = template.generateRequire(resolved);
        result.resolverArgs = {
          id: `${templateId}-resolver-${Date.now()}`,
          requirement: requireObj.type as string,
          resolveCode: template.generateResolveCode(resolved),
        };
      }
    }

    return result;
  }

  return {
    list,
    get,
    register,
    formatForPrompt,
    instantiate,
  };
}
