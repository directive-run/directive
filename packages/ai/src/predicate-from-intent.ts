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
// Sync djb2 hash fallback (used when crypto.subtle is unavailable)
// ============================================================================

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }

  return (hash >>> 0).toString(16);
}

async function hashRawOutput(raw: string): Promise<string> {
  // Prefer crypto.subtle SHA-256 when available (browsers, Node 19+, workers).
  // Fall back to a sync djb2 — collision-prone, but adequate for telemetry
  // alongside the persisted predicate.
  try {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } })
      .crypto?.subtle;
    if (subtle && typeof subtle.digest === "function") {
      const enc = new TextEncoder();
      const buf = await subtle.digest("SHA-256", enc.encode(raw));
      const bytes = new Uint8Array(buf);
      let hex = "";
      for (const b of bytes) {
        hex += b.toString(16).padStart(2, "0");
      }

      return hex;
    }
  } catch {
    // fall through to djb2
  }

  return djb2Hash(raw);
}

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
  /**
   * Hard cap on the length of each `$in` / `$nin` array operand the LLM
   * may emit. Defaults to 1000. Forwarded to
   * `validatePredicateAgainstSchema`'s `maxArrayOperandLength`.
   */
  maxArrayOperandLength?: number;
  /**
   * Optional `AbortSignal` for cooperative cancellation. The retry loop
   * checks `signal.aborted` between attempts and throws `Error("aborted")`
   * when set. NOTE: `predicateFromIntent` does NOT limit in-flight calls —
   * callers MUST wrap with a concurrency limiter (e.g. `p-limit`) to bound
   * fan-out under load.
   */
  signal?: AbortSignal;
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

  // M16: When we have structured errors, scope the schema reminder to only
  // the offending fact paths instead of dumping the full schema. Falls back
  // to the full schema for non-structural failures (string errors).
  let pathsToShow: Set<string> | null = null;

  if (typeof errors === "string") {
    lines.push(`\nReason: ${errors}`);
  } else {
    lines.push("\nValidation errors (fix every one):");
    pathsToShow = new Set();
    for (const e of errors) {
      lines.push(`  - path "${e.path}", op "${e.op}": ${e.reason}`);
      if (e.allowedOps && e.allowedOps.length > 0) {
        lines.push(`    → allowed operators for this fact: ${e.allowedOps.join(", ")}`);
      }
      // Collect every path mentioned by an error. If a path isn't in the
      // kindMap (unknown fact), the offending key may be a dotted prefix of
      // a real fact — include the closest known ancestor too.
      pathsToShow.add(e.path);
    }
  }

  lines.push("\nSchema reminder:");
  if (pathsToShow && pathsToShow.size > 0) {
    let shown = 0;
    for (const path of pathsToShow) {
      const node = kindMap.get(path);
      if (node) {
        const ops = getOperatorsForKind(node);
        lines.push(`  ${path}: ${renderKindForPrompt(node)} — allowed: ${ops.join(", ")}`);
        shown++;
      } else {
        lines.push(
          `  ${path}: (not in schema — pick from the available facts below)`,
        );
      }
    }
    const remaining = kindMap.size - shown;
    if (remaining > 0) {
      lines.push(`  …and ${remaining} more fact(s) available — ask if you need the full list.`);
    }
  } else {
    for (const [path, node] of kindMap.entries()) {
      const ops = getOperatorsForKind(node);
      lines.push(`  ${path}: ${renderKindForPrompt(node)} — allowed: ${ops.join(", ")}`);
    }
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
  opts: {
    maxPredicateBytes: number;
    maxOperatorCount: number;
    maxArrayOperandLength: number;
  },
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

  // 4 + 5. Operator-count cap + array-operand cap + schema validation
  const schemaResult = validatePredicateAgainstSchema(parsed, kindMap, {
    maxOperatorCount: opts.maxOperatorCount,
    maxArrayOperandLength: opts.maxArrayOperandLength,
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
const DEFAULT_MAX_ARRAY_OPERAND_LENGTH = 1000;

/**
 * Ask an LLM to emit a FactPredicate matching the user's intent, then
 * validate it structurally + semantically before returning. On validation
 * failure, retries with structured error feedback in the next prompt.
 *
 * Throws {@link PredicateFromIntentError} on retry exhaustion. NEVER
 * returns a partial / unvalidated predicate.
 *
 * **Rate limiting:** this function does NOT limit in-flight calls. Wrap
 * with a concurrency limiter (e.g. `p-limit` / `Bottleneck`) before
 * exposing it to user-driven traffic. Pass an `AbortSignal` via `opts.signal`
 * for cooperative cancellation between retry attempts.
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
    maxArrayOperandLength = DEFAULT_MAX_ARRAY_OPERAND_LENGTH,
    redact,
    signal,
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
  const validateOpts = {
    maxPredicateBytes,
    maxOperatorCount,
    maxArrayOperandLength,
  };

  while (attempt < maxRetries + 1) {
    // M7: cooperative cancellation — bail between attempts when aborted.
    if (signal?.aborted) {
      throw new Error("aborted");
    }
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
// Tool-spec presets (OpenAI + Anthropic function-calling)
// ============================================================================

export interface PredicateToolSpecOptions {
  /** Tool name. Default `"emit_predicate"`. */
  name?: string;
  /** Tool description. Default: a one-liner describing predicate emission. */
  description?: string;
  /** Optional dotted-path namespace to restrict the tool's scope. */
  factPath?: string;
}

/**
 * Anthropic Messages API tool shape. Drop into the `tools: [...]` array.
 * Anthropic's API expects `input_schema` at the top level of the tool.
 */
export interface PredicateToolSpecAnthropic {
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
 * OpenAI Chat Completions / Responses API tool shape. Drop into the
 * `tools: [...]` array. OpenAI nests the function payload under
 * `function: { name, description, parameters }`.
 */
export interface PredicateToolSpecOpenAI {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: { predicate: { type: "object" } };
      required: ["predicate"];
    };
  };
  /** Human-readable schema description — embed in your tool's "description" if your provider concatenates them. */
  schemaSummary: string;
}

/**
 * @deprecated Use {@link PredicateToolSpecAnthropic} (or
 * {@link PredicateToolSpecOpenAI}) directly. Kept as an alias for the
 * pre-split shape that v1.12.x callers depend on; identical to
 * `PredicateToolSpecAnthropic`.
 */
export type PredicateToolSpec = PredicateToolSpecAnthropic;

function buildSchemaSummary(
  schema: unknown,
  factPath: string | undefined,
): string {
  const kindMap = getSchemaFieldKinds(schema);
  const lines: string[] = [];
  for (const [path, node] of kindMap.entries()) {
    if (factPath && !path.startsWith(factPath)) continue;
    const ops = getOperatorsForKind(node);
    lines.push(`${path}: ${renderKindForPrompt(node)} — ops: ${ops.join(", ")}`);
  }

  return lines.join("\n");
}

function buildDescription(summary: string, override?: string): string {
  return (
    override ??
    `Emit a Directive FactPredicate (JSON tree of facts and operators) matching the user's intent. Schema:\n${summary}`
  );
}

/**
 * OpenAI Chat Completions / Responses API tool spec for predicate
 * emission. Drop the result into your `tools: [...]` array; the model
 * will be told to emit a predicate matching this schema.
 *
 * @example
 * ```ts
 * const tool = predicateToolSpecOpenAI(myModule.schema, { name: "set_checkout_rule" });
 *
 * await openai.chat.completions.create({
 *   model: "gpt-4o-mini",
 *   tools: [tool],
 *   messages: [...],
 * });
 * ```
 */
export function predicateToolSpecOpenAI(
  schema: unknown,
  opts: PredicateToolSpecOptions = {},
): PredicateToolSpecOpenAI {
  const summary = buildSchemaSummary(schema, opts.factPath);
  const name = opts.name ?? "emit_predicate";
  const description = buildDescription(summary, opts.description);

  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: { predicate: { type: "object" } },
        required: ["predicate"],
      },
    },
    schemaSummary: summary,
  };
}

/**
 * Anthropic Messages API tool spec for predicate emission. Drop the
 * result into your `tools: [...]` array; the model will be told to emit
 * a predicate matching this schema.
 *
 * @example
 * ```ts
 * const tool = predicateToolSpecAnthropic(myModule.schema, { name: "set_checkout_rule" });
 *
 * await anthropic.messages.create({
 *   model: "claude-3-5-sonnet-latest",
 *   tools: [tool],
 *   messages: [...],
 * });
 * ```
 */
export function predicateToolSpecAnthropic(
  schema: unknown,
  opts: PredicateToolSpecOptions = {},
): PredicateToolSpecAnthropic {
  const summary = buildSchemaSummary(schema, opts.factPath);
  const name = opts.name ?? "emit_predicate";
  const description = buildDescription(summary, opts.description);

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

/**
 * @deprecated Use {@link predicateToolSpecAnthropic} (or
 * {@link predicateToolSpecOpenAI}) directly. Back-compat alias for
 * v1.12.x callers — emits the Anthropic shape, unchanged.
 */
export function predicateToolSpec(
  schema: unknown,
  opts: PredicateToolSpecOptions = {},
): PredicateToolSpec {
  return predicateToolSpecAnthropic(schema, opts);
}

// ============================================================================
// Provenance (M24)
// ============================================================================

export interface PredicateFromIntentProvenance {
  /** Resolved model name when the runner exposes one — otherwise "unknown". */
  readonly model: string;
  /** Sanitized intent string actually sent to the LLM (post-redact). */
  readonly intent: string;
  /** Number of LLM calls that ran before the final predicate was accepted. */
  readonly attemptCount: number;
  /** ISO timestamp when the predicate was returned. */
  readonly emittedAt: string;
  /**
   * Hash of the final raw LLM output. SHA-256 hex when crypto.subtle is
   * available, djb2 hex otherwise — sufficient as a tamper-evident pointer
   * alongside the persisted predicate.
   */
  readonly rawOutputHash: string;
}

export interface PredicateFromIntentWithProvenanceResult<F = Record<string, unknown>> {
  readonly predicate: FactPredicate<F>;
  readonly provenance: PredicateFromIntentProvenance;
}

/**
 * Like {@link predicateFromIntent} but additionally returns a structured
 * provenance record — the model name, sanitized intent, attempt count,
 * timestamp, and a hash of the raw LLM output.
 *
 * **Production deployments MUST persist the provenance record alongside
 * the predicate.** Without it, auditing "where did this rule come from?"
 * becomes guesswork.
 *
 * Throws {@link PredicateFromIntentError} on retry exhaustion — same
 * semantics as the un-provenanced variant.
 *
 * @example
 * ```ts
 * const { predicate, provenance } = await predicateFromIntentWithProvenance({ ... });
 *
 * await db.predicates.insert({
 *   predicate,
 *   model: provenance.model,
 *   intent: provenance.intent,
 *   emittedAt: provenance.emittedAt,
 *   rawOutputHash: provenance.rawOutputHash,
 *   attempts: provenance.attemptCount,
 * });
 * ```
 */
export async function predicateFromIntentWithProvenance<
  F = Record<string, unknown>,
>(
  opts: PredicateFromIntentOptions<F>,
): Promise<PredicateFromIntentWithProvenanceResult<F>> {
  const raw = await predicateFromIntentRaw(opts);
  if (raw.predicate === null) {
    throw new PredicateFromIntentError(
      `[Directive] predicateFromIntentWithProvenance: failed after ${raw.attempts} attempt(s). Last error: ${
        raw.errors[raw.errors.length - 1]?.reason ?? "unknown"
      }`,
      raw.attempts,
      raw.errors,
      raw.lastRawOutput,
    );
  }

  const sanitizedIntent = opts.redact ? opts.redact(opts.intent) : opts.intent;
  const model = opts.agent?.model ?? "unknown";
  const rawOutputHash = await hashRawOutput(raw.lastRawOutput ?? "");

  return {
    predicate: raw.predicate,
    provenance: {
      model,
      intent: sanitizedIntent,
      attemptCount: raw.attempts,
      emittedAt: new Date().toISOString(),
      rawOutputHash,
    },
  };
}
