/**
 * predicateFromIntent — let an LLM emit a typed FactPredicate as JSON,
 * structurally + semantically validated before it ever reaches your
 * constraint engine.
 *
 * Pipeline per call attempt:
 *
 *   1. Output-size check (reject before JSON.parse for DoS guard)
 *   2. JSON.parse via extractJsonFromOutput (handles surrounding prose)
 *   3. validatePredicate (structural: closed operator set, depth, JSON safety)
 *   4. Operator-count check
 *   5. validatePredicateAgainstSchema (semantic: operator-on-kind matrix)
 *
 * On any failure: a structured error message — including the offending
 * clause's path, the allowed operators for that fact's kind, and the
 * original schema kinds — is fed back to the LLM in the next attempt.
 *
 * Returns the validated FactPredicate. Throws PredicateFromIntentError
 * on retry exhaustion. NEVER returns a partial / unvalidated predicate.
 */

import {
  getOperatorsForKind,
  getSchemaFieldKinds,
  validatePredicate,
  validatePredicateAgainstSchema,
  type FactPredicate,
  type SchemaKindNode,
  type SchemaValidationError,
} from "@directive-run/core";

import { extractJsonFromOutput } from "./structured-output.js";
import type { AgentLike, AgentRunner } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface PredicateFromIntentOptions<_F = Record<string, unknown>> {
  /** Natural-language intent (untrusted user input — sanitize via `redact`). */
  intent: string;
  /**
   * Module schema (must expose builders with `_typeName` or `_kind`).
   * Pass either `{ facts: {...} }` or a bare `Record<string, builder>`.
   */
  schema: unknown;
  /** AgentRunner from `@directive-run/ai` adapters (createOpenAIRunner, etc.). */
  runner: AgentRunner;
  /**
   * Optional agent override. Default is `{ name: "predicate-emitter" }`
   * with our system prompt; pass `instructions` to append additional
   * context.
   */
  agent?: AgentLike;
  /**
   * Optional dotted-path namespace; useful for cross-module systems
   * where the LLM should emit a predicate over `auth.token` (default:
   * the schema's root facts).
   */
  factPath?: string;
  /** Max retries on validation failure. Default 3. */
  maxRetries?: number;
  /**
   * Hard byte cap on the LLM's raw output, BEFORE JSON.parse. Defaults
   * to 64 KiB. A larger predicate is rejected outright; protects
   * against multi-MB-payload DoS where the predicate is technically
   * structurally valid.
   */
  maxPredicateBytes?: number;
  /**
   * Hard cap on the number of operator clauses in the predicate.
   * Defaults to 256. Protects against `{ $any: [{ x: 1 }, … x100,000 ] }`
   * style operator-count exhaustion.
   */
  maxOperatorCount?: number;
  /**
   * Optional sanitizer applied to `intent` BEFORE it lands in the
   * system prompt. Useful for stripping or redacting user-controlled
   * content that looks like prompt-injection.
   */
  redact?: (intent: string) => string;
}

export interface PredicateFromIntentDiagnostics<F = Record<string, unknown>> {
  /** The validated predicate (`null` if all retries failed). */
  predicate: FactPredicate<F> | null;
  /** Number of LLM calls actually made. */
  attempts: number;
  /** Errors encountered across all attempts (most recent last). */
  errors: ReadonlyArray<{ attempt: number; reason: string; details?: readonly SchemaValidationError[] }>;
  /** The raw LLM output from the final attempt — useful for debugging. */
  lastRawOutput?: string;
}

/** Thrown by `predicateFromIntent` on retry exhaustion. `predicateFromIntentRaw` returns these as a diagnostics payload instead. */
export class PredicateFromIntentError extends Error {
  override readonly name = "PredicateFromIntentError";
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly errors: ReadonlyArray<{
      attempt: number;
      reason: string;
      details?: readonly SchemaValidationError[];
    }>,
    public readonly lastRawOutput: string | undefined,
  ) {
    super(message);
  }
}

// ============================================================================
// Prompt builder
// ============================================================================

const SYSTEM_PROMPT_HEADER = `You emit ONLY a JSON object describing a Directive FactPredicate — no prose, no markdown fences, no explanation.

A FactPredicate is a JSON tree of fact paths and operators:
- Object form (preferred): { "factName": { "$op": operand }, "otherFact": { "$op": operand } }
- Combinators: { "$all": [predicateA, predicateB] }, { "$any": [...] }, { "$not": predicate }
- Bare value (equality shortcut): { "factName": value }

Operator set (CLOSED — only these are valid):
  $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $between,
  $matches, $startsWith, $endsWith, $contains, $changed
Combinators: $all, $any, $not

Each operator is only valid for certain kinds (see below). Emit ONLY operators valid for the fact's kind.
`;

function renderKindForPrompt(node: SchemaKindNode): string {
  const nullableTag = node.nullable ? " (nullable)" : "";
  switch (node.kind) {
    case "literal":
      return `literal ${JSON.stringify(node.value)} (${node.primitive})${nullableTag}`;
    case "enum":
      return `enum ${JSON.stringify(node.values)} (${node.primitive})${nullableTag}`;
    case "array":
      return `array of ${renderKindForPrompt(node.element)}${nullableTag}`;
    case "tuple":
      return `tuple [${node.elements.map(renderKindForPrompt).join(", ")}]${nullableTag}`;
    case "object":
      return `object { ${Object.entries(node.shape)
        .map(([k, v]) => `${k}: ${renderKindForPrompt(v)}`)
        .join(", ")} }${nullableTag}`;
    case "record":
      return `record<string, ${renderKindForPrompt(node.value)}>${nullableTag}`;
    case "union":
      return `union (${node.members.map(renderKindForPrompt).join(" | ")})${nullableTag}`;
    case "branded":
      return `branded(${renderKindForPrompt(node.inner)})${nullableTag}`;
    default:
      return `${node.kind}${nullableTag}`;
  }
}

function buildSystemPrompt(
  kindMap: Map<string, SchemaKindNode>,
  factPath?: string,
): string {
  const lines: string[] = [SYSTEM_PROMPT_HEADER];

  lines.push("\nFacts in this schema (path → kind → allowed operators):");
  for (const [path, node] of kindMap.entries()) {
    if (factPath && !path.startsWith(factPath)) continue;
    const ops = getOperatorsForKind(node);
    lines.push(
      `  ${path}: ${renderKindForPrompt(node)} — allowed: ${ops.join(", ")}`,
    );
  }
  if (factPath) {
    lines.push(
      `\nThe user intent will be over the namespace "${factPath}". Use only facts at or below that path.`,
    );
  }

  lines.push(
    "\nRespond with ONLY the JSON predicate object. No prose. No markdown fences. No \"Here is...\".",
  );

  return lines.join("\n");
}

function buildErrorFeedback(
  intent: string,
  kindMap: Map<string, SchemaKindNode>,
  errors: readonly SchemaValidationError[] | string,
): string {
  const lines: string[] = [];
  lines.push("Your previous response was rejected. Original intent (still applies):");
  lines.push(`  ${intent}`);

  if (typeof errors === "string") {
    lines.push(`\nReason: ${errors}`);
  } else {
    lines.push("\nValidation errors (fix every one):");
    for (const e of errors) {
      lines.push(`  - path "${e.path}", op "${e.op}": ${e.reason}`);
      if (e.allowedOps && e.allowedOps.length > 0) {
        lines.push(`    → allowed operators for this fact: ${e.allowedOps.join(", ")}`);
      }
    }
  }

  lines.push("\nSchema reminder:");
  for (const [path, node] of kindMap.entries()) {
    const ops = getOperatorsForKind(node);
    lines.push(`  ${path}: ${renderKindForPrompt(node)} — allowed: ${ops.join(", ")}`);
  }

  lines.push("\nEmit ONLY a corrected JSON FactPredicate object. No prose.");

  return lines.join("\n");
}

// ============================================================================
// Validation pipeline (one attempt)
// ============================================================================

function validateOneAttempt(
  rawOutput: string,
  kindMap: Map<string, SchemaKindNode>,
  opts: { maxPredicateBytes: number; maxOperatorCount: number },
):
  | { ok: true; predicate: unknown }
  | { ok: false; reason: string; details?: readonly SchemaValidationError[] } {
  // 1. Byte cap (pre-parse — kills 10MB-payload DoS)
  if (rawOutput.length > opts.maxPredicateBytes) {
    return {
      ok: false,
      reason: `Output exceeded maxPredicateBytes=${opts.maxPredicateBytes} (got ${rawOutput.length}). Emit a smaller predicate.`,
    };
  }

  // 2. JSON parse (handles surrounding prose)
  let parsed: unknown;
  try {
    parsed = extractJsonFromOutput(rawOutput);
  } catch (err) {
    return {
      ok: false,
      reason: `Could not extract JSON from output: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // 3. Structural validation (closed operator set, depth, JSON-safety)
  try {
    validatePredicate(parsed);
  } catch (err) {
    return {
      ok: false,
      reason: `Structural validation failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // 4 + 5. Operator-count cap + schema validation
  const schemaResult = validatePredicateAgainstSchema(parsed, kindMap, {
    maxOperatorCount: opts.maxOperatorCount,
  });

  if (!schemaResult.ok) {
    return {
      ok: false,
      reason: `Predicate has ${schemaResult.errors.length} schema-validation error(s).`,
      details: schemaResult.errors,
    };
  }

  return { ok: true, predicate: parsed };
}

// ============================================================================
// Public API
// ============================================================================

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PREDICATE_BYTES = 65_536; // 64 KiB
const DEFAULT_MAX_OPERATOR_COUNT = 256;

/**
 * Ask an LLM to emit a FactPredicate matching the user's intent, then
 * validate it structurally + semantically before returning. On validation
 * failure, retries with structured error feedback in the next prompt.
 *
 * Throws {@link PredicateFromIntentError} on retry exhaustion. NEVER
 * returns a partial / unvalidated predicate.
 *
 * @example
 * ```ts
 * import { createOpenAIRunner } from "@directive-run/ai/openai";
 * import { predicateFromIntent } from "@directive-run/ai";
 *
 * const runner = createOpenAIRunner({ apiKey, model: "gpt-4o-mini" });
 *
 * const predicate = await predicateFromIntent({
 *   intent: "checkout is unblocked when the cart total is at least 50",
 *   schema: myModule.schema,
 *   runner,
 * });
 * // → { cartTotal: { $gte: 50 } }
 * ```
 */
export async function predicateFromIntent<F = Record<string, unknown>>(
  opts: PredicateFromIntentOptions<F>,
): Promise<FactPredicate<F>> {
  const result = await predicateFromIntentRaw(opts);
  if (result.predicate === null) {
    throw new PredicateFromIntentError(
      `[Directive] predicateFromIntent: failed after ${result.attempts} attempt(s). Last error: ${
        result.errors[result.errors.length - 1]?.reason ?? "unknown"
      }`,
      result.attempts,
      result.errors,
      result.lastRawOutput,
    );
  }

  return result.predicate;
}

/**
 * Lower-level variant — returns the validated predicate (or null) plus
 * full diagnostics. Use when you want to surface validation telemetry,
 * preview the LLM's last raw output, or display per-attempt errors in
 * a UI.
 */
export async function predicateFromIntentRaw<F = Record<string, unknown>>(
  opts: PredicateFromIntentOptions<F>,
): Promise<PredicateFromIntentDiagnostics<F>> {
  const {
    intent: rawIntent,
    schema,
    runner,
    agent,
    factPath,
    maxRetries = DEFAULT_MAX_RETRIES,
    maxPredicateBytes = DEFAULT_MAX_PREDICATE_BYTES,
    maxOperatorCount = DEFAULT_MAX_OPERATOR_COUNT,
    redact,
  } = opts;

  if (typeof rawIntent !== "string" || rawIntent.length === 0) {
    throw new Error(
      "[Directive] predicateFromIntent: `intent` must be a non-empty string.",
    );
  }

  const intent = redact ? redact(rawIntent) : rawIntent;
  const kindMap = getSchemaFieldKinds(schema);

  if (kindMap.size === 0) {
    throw new Error(
      "[Directive] predicateFromIntent: schema has no introspectable facts. Pass a module schema or a bare facts record.",
    );
  }

  const systemPrompt = buildSystemPrompt(kindMap, factPath);
  const baseAgent: AgentLike = agent ?? { name: "predicate-emitter" };
  const promptAgent: AgentLike = {
    ...baseAgent,
    instructions: `${baseAgent.instructions ?? ""}\n\n${systemPrompt}`.trim(),
  };

  const errors: Array<{
    attempt: number;
    reason: string;
    details?: readonly SchemaValidationError[];
  }> = [];

  let lastRawOutput: string | undefined;
  let attempt = 0;
  const validateOpts = { maxPredicateBytes, maxOperatorCount };

  while (attempt < maxRetries + 1) {
    attempt++;
    const input =
      attempt === 1
        ? `Intent: ${intent}\n\nEmit the predicate now.`
        : buildErrorFeedback(intent, kindMap, errors[errors.length - 1]!.details ?? errors[errors.length - 1]!.reason);

    let runResult;
    try {
      runResult = await runner(promptAgent, input);
    } catch (err) {
      errors.push({
        attempt,
        reason: `LLM runner threw: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const rawOutput =
      typeof runResult.output === "string"
        ? runResult.output
        : JSON.stringify(runResult.output);
    lastRawOutput = rawOutput;

    const validated = validateOneAttempt(rawOutput, kindMap, validateOpts);

    if (validated.ok) {
      return {
        predicate: validated.predicate as FactPredicate<F>,
        attempts: attempt,
        errors,
        lastRawOutput,
      };
    }

    errors.push({
      attempt,
      reason: validated.reason,
      details: validated.details,
    });
  }

  return {
    predicate: null,
    attempts: attempt,
    errors,
    lastRawOutput,
  };
}

// ============================================================================
// Tool-spec preset (OpenAI / Anthropic function-calling)
// ============================================================================

export interface PredicateToolSpecOptions {
  /** Tool name. Default `"emit_predicate"`. */
  name?: string;
  /** Tool description. Default: a one-liner describing predicate emission. */
  description?: string;
  /** Optional dotted-path namespace to restrict the tool's scope. */
  factPath?: string;
}

export interface PredicateToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: { predicate: { type: "object" } };
    required: ["predicate"];
  };
  /** Human-readable schema description — embed in your tool's "description" if your provider concatenates them. */
  schemaSummary: string;
}

/**
 * Produce a function-calling tool spec for OpenAI / Anthropic / similar
 * APIs. Drop the result into your `tools: [...]` array; the model will
 * be told to emit a predicate matching this schema, and the resulting
 * tool call payload can be passed to `predicateFromIntent` /
 * `validatePredicateAgainstSchema` for safety.
 *
 * @example
 * ```ts
 * const tool = predicateToolSpec(myModule.schema, { name: "set_checkout_rule" });
 *
 * await openai.messages.create({
 *   model: "gpt-4o-mini",
 *   tools: [tool],
 *   messages: [...],
 * });
 * ```
 */
export function predicateToolSpec(
  schema: unknown,
  opts: PredicateToolSpecOptions = {},
): PredicateToolSpec {
  const kindMap = getSchemaFieldKinds(schema);
  const lines: string[] = [];
  for (const [path, node] of kindMap.entries()) {
    if (opts.factPath && !path.startsWith(opts.factPath)) continue;
    const ops = getOperatorsForKind(node);
    lines.push(`${path}: ${renderKindForPrompt(node)} — ops: ${ops.join(", ")}`);
  }

  const summary = lines.join("\n");
  const name = opts.name ?? "emit_predicate";
  const description =
    opts.description ??
    `Emit a Directive FactPredicate (JSON tree of facts and operators) matching the user's intent. Schema:\n${summary}`;

  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties: { predicate: { type: "object" } },
      required: ["predicate"],
    },
    schemaSummary: summary,
  };
}
