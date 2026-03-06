/**
 * Intent-based story configuration for AI Architect.
 *
 * Translates user stories (plain strings or structured objects) into
 * architect configuration via LLM resolution. Stories are resolved
 * lazily on first analyze() or explicitly via ready().
 *
 * @module
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type { AIArchitectOptions } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** A structured story in user-story format. */
export interface StructuredStory {
  /** Role context — maps to safety configuration. */
  as?: string;
  /** Trigger condition — maps to constraints/triggers. */
  when: string;
  /** Desired action — maps to templates/tools. */
  iWant: string;
  /** Outcome goal — maps to context.goals. */
  soThat?: string;
}

/**
 * A story can be a plain string description or a structured object.
 *
 * @example
 * ```typescript
 * // Plain string
 * "Keep error count under 10"
 *
 * // Structured
 * { when: "errors spike", iWant: "add a rate limiter", soThat: "the system stays healthy" }
 * ```
 */
export type Story = string | StructuredStory;

/** Configuration for story resolution. */
export interface StoryResolutionOptions {
  /** Model override for the LLM runner used to resolve stories. */
  model?: string;
  /** Timeout for the LLM call in ms. Default: 30000. */
  timeout?: number;
}

/** Result of resolving stories into config. */
export interface StoryResolutionResult {
  /** The generated partial config. */
  config: Partial<AIArchitectOptions>;
  /** Raw LLM response for transparency. */
  rawResponse: string;
}

// ============================================================================
// Story formatting
// ============================================================================

function formatStories(stories: Story[]): string {
  return stories
    .map((story, i) => {
      if (typeof story === "string") {
        return `${i + 1}. ${story}`;
      }

      const parts: string[] = [];
      if (story.as) {
        parts.push(`As ${story.as}`);
      }

      parts.push(`When ${story.when}`);
      parts.push(`I want ${story.iWant}`);
      if (story.soThat) {
        parts.push(`So that ${story.soThat}`);
      }

      return `${i + 1}. ${parts.join(", ")}`;
    })
    .join("\n");
}

// ============================================================================
// Validation
// ============================================================================

const VALID_APPROVAL_LEVELS = new Set(["always", "first-time", "never"]);

const VALID_INTERVAL_RE = /^\d+[smh]$/;

function validateResolvedConfig(
  config: Record<string, unknown>,
): Partial<AIArchitectOptions> {
  const result: Record<string, unknown> = {};

  // Validate triggers
  if (config.triggers && typeof config.triggers === "object") {
    const triggers = config.triggers as Record<string, unknown>;
    const validTriggers: Record<string, unknown> = {};

    if (typeof triggers.onError === "boolean") {
      validTriggers.onError = triggers.onError;
    }

    if (typeof triggers.onUnmetRequirement === "boolean") {
      validTriggers.onUnmetRequirement = triggers.onUnmetRequirement;
    }

    if (Array.isArray(triggers.onFactChange)) {
      validTriggers.onFactChange = triggers.onFactChange.filter(
        (k: unknown) => typeof k === "string",
      );
    }

    if (
      typeof triggers.onSchedule === "string" &&
      VALID_INTERVAL_RE.test(triggers.onSchedule)
    ) {
      validTriggers.onSchedule = triggers.onSchedule;
    }

    if (typeof triggers.minInterval === "number" && triggers.minInterval > 0) {
      validTriggers.minInterval = triggers.minInterval;
    }

    if (Object.keys(validTriggers).length > 0) {
      result.triggers = validTriggers;
    }
  }

  // Validate context
  if (config.context && typeof config.context === "object") {
    const ctx = config.context as Record<string, unknown>;
    const validCtx: Record<string, unknown> = {};

    if (typeof ctx.description === "string") {
      validCtx.description = ctx.description;
    }

    if (Array.isArray(ctx.goals)) {
      validCtx.goals = ctx.goals.filter((g: unknown) => typeof g === "string");
    }

    if (Array.isArray(ctx.notes)) {
      validCtx.notes = ctx.notes.filter((n: unknown) => typeof n === "string");
    }

    if (Object.keys(validCtx).length > 0) {
      result.context = validCtx;
    }
  }

  // Validate safety.approval
  if (config.safety && typeof config.safety === "object") {
    const safety = config.safety as Record<string, unknown>;
    if (safety.approval && typeof safety.approval === "object") {
      const approval = safety.approval as Record<string, unknown>;
      const validApproval: Record<string, unknown> = {};

      for (const key of ["constraints", "resolvers", "effects", "derivations", "facts"]) {
        if (typeof approval[key] === "string" && VALID_APPROVAL_LEVELS.has(approval[key] as string)) {
          validApproval[key] = approval[key];
        }
      }

      if (Object.keys(validApproval).length > 0) {
        result.safety = { approval: validApproval };
      }
    }
  }

  // Validate capabilities
  if (config.capabilities && typeof config.capabilities === "object") {
    const caps = config.capabilities as Record<string, unknown>;
    const validCaps: Record<string, unknown> = {};

    for (const key of ["constraints", "resolvers", "effects", "derivations"]) {
      if (typeof caps[key] === "boolean") {
        validCaps[key] = caps[key];
      }
    }

    if (caps.facts === "read-only" || caps.facts === "read-write") {
      validCaps.facts = caps.facts;
    }

    if (Object.keys(validCaps).length > 0) {
      result.capabilities = validCaps;
    }
  }

  return result as Partial<AIArchitectOptions>;
}

// ============================================================================
// Deep merge
// ============================================================================

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

function deepMerge(
  story: Record<string, unknown>,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...story };

  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];

    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      // Base (explicit) takes precedence
      result[key] = value;
    }
  }

  return result;
}

/**
 * Deep merge story-derived config into base config.
 * Explicit (base) config always takes precedence over story-derived values.
 */
export function mergeStoryConfig(
  base: Partial<AIArchitectOptions>,
  storyDerived: Partial<AIArchitectOptions>,
): Partial<AIArchitectOptions> {
  return deepMerge(
    storyDerived as Record<string, unknown>,
    base as Record<string, unknown>,
  ) as Partial<AIArchitectOptions>;
}

// ============================================================================
// Resolution
// ============================================================================

const RESOLVE_PROMPT = `You are configuring an AI Architect that manages a Directive constraint-driven runtime system.

Given the user stories below, generate a JSON configuration object with these optional fields:
- triggers: { onError?: boolean, onUnmetRequirement?: boolean, onFactChange?: string[], onSchedule?: string (e.g. "5m"), minInterval?: number }
- context: { description?: string, goals?: string[], notes?: string[] }
- safety: { approval: { constraints?: "always"|"first-time"|"never", resolvers?: "always"|"first-time"|"never" } }
- capabilities: { constraints?: boolean, resolvers?: boolean, effects?: boolean, derivations?: boolean, facts?: "read-only"|"read-write" }

Only include fields that are clearly implied by the stories. Respond with ONLY valid JSON, no markdown fences.`;

/**
 * Resolve user stories into architect configuration via LLM.
 *
 * @param stories - Array of plain-string or structured stories.
 * @param system - The Directive system (used for schema context).
 * @param runner - The LLM runner.
 * @param options - Optional resolution configuration.
 * @returns The resolved configuration and raw LLM response.
 */
export async function resolveStories(
  stories: Story[],
  system: System,
  runner: AgentRunner,
  _options?: StoryResolutionOptions,
): Promise<StoryResolutionResult> {
  const systemSchema = Object.keys(system.facts);
  const storyText = formatStories(stories);

  const input = `${RESOLVE_PROMPT}

System schema keys: ${JSON.stringify(systemSchema)}

User stories:
${storyText}`;

  const agentDef = {
    name: "story-resolver",
    description: "Resolves user stories into architect configuration",
    instructions: "Output valid JSON only.",
    tools: [],
  };

  const result = await runner(agentDef, input);
  const rawResponse = typeof result.output === "string"
    ? result.output
    : JSON.stringify(result.output);

  // Parse JSON from response
  let parsed: Record<string, unknown>;
  try {
    // Try direct parse first
    parsed = JSON.parse(rawResponse);
  } catch {
    // Try extracting JSON from markdown fences
    const match = /```(?:json)?\s*([\s\S]*?)```/.exec(rawResponse);
    if (match?.[1]) {
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        return { config: {}, rawResponse };
      }
    } else {
      return { config: {}, rawResponse };
    }
  }

  const config = validateResolvedConfig(parsed);

  return { config, rawResponse };
}
