/**
 * What a preset is, and the one schema that decides whether a given object is
 * one.
 *
 * A preset is **plain JSON**. Not a module, not a factory, not a closure — a
 * value you can read off disk, post to an endpoint, or paste into a form. Every
 * knob the chain has is here, and nothing here is a function, so a preset can
 * cross a process boundary without losing anything.
 *
 * Validation lives in exactly one place: {@link presetSchema}. `loadPreset`,
 * `validatePreset`, and `createHarnessSystem` all route through it rather than
 * re-checking fields they happen to care about. The alternative — a light check
 * at the edge and a real one further in — is how two callers come to disagree
 * about whether the same file is valid.
 *
 * @module
 */

import type { DefinitionMeta } from "@directive-run/core";
import { z } from "zod";

// ============================================================================
// Meta
// ============================================================================

/**
 * Directive's own annotation shape, reused verbatim.
 *
 * Presets do not get a parallel `title` / `summary` / `labels` vocabulary. The
 * meta a preset carries is handed straight to the constraints, resolvers, and
 * derivations the preset drives, so `system.inspect()` and the devtools plugin
 * name the preset and the persona behind each requirement without anything
 * translating between two description formats.
 *
 * Deliberately permissive on the value side — `DefinitionMeta` is documented as
 * extensible, and a preset that carries an extra key for a plugin to read is
 * doing the intended thing.
 */
export const metaSchema: z.ZodType<DefinitionMeta> = z
  .object({
    label: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    color: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

// ============================================================================
// Personas
// ============================================================================

/** One voice in the chain. */
export interface PersonaConfig {
  /**
   * The agent name. Used as the orchestrator's agent ID, so it must be unique
   * within a preset and stable across runs — it is what a transcript line and
   * a `burst:completed` event identify the speaker by.
   */
  name: string;
  /** The persona's system prompt, verbatim. */
  systemPrompt: string;
  /** Annotations carried through to the definitions this persona drives. */
  meta?: DefinitionMeta;
}

export const personaSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  meta: metaSchema.optional(),
});

// ============================================================================
// Synthesizer
// ============================================================================

/** The voice that reads the finished transcript and writes the closing document. */
export interface SynthesizerConfig {
  name: string;
  systemPrompt: string;
  /**
   * Rendered with the same placeholders as {@link PresetConfig.promptTemplate},
   * plus `{{transcript}}`, `{{iterations}}`, and `{{spentUsd}}`.
   */
  promptTemplate: string;
  /** Token cap for the closing document specifically — usually well above a burst. */
  maxTokens: number;
  meta?: DefinitionMeta;
}

export const synthesizerSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  promptTemplate: z.string().min(1),
  maxTokens: z.number().int().positive(),
  meta: metaSchema.optional(),
});

// ============================================================================
// Preset
// ============================================================================

/**
 * A complete chain configuration.
 *
 * @example
 * ```typescript
 * const preset: PresetConfig = {
 *   id: "code-review",
 *   model: "claude-sonnet-4-5-20250929",
 *   personas: [{ name: "correctness", systemPrompt: "…" }],
 *   tokensPerBurst: 700,
 *   budgetUsd: 2,
 *   maxIterations: 12,
 *   promptTemplate: "{{transcript}}\n\nYour turn, {{persona}}.",
 *   synthesizer: { name: "synth", systemPrompt: "…", promptTemplate: "{{transcript}}", maxTokens: 4000 },
 * };
 * ```
 */
export interface PresetConfig {
  /** Stable identifier — the name `loadPreset` resolves and the registry keys on. */
  id: string;
  /** Annotations for the module, and the default for definitions without their own. */
  meta?: DefinitionMeta;
  /** Provider model ID, exactly as the provider spells it. */
  model: string;
  /** Sampling temperature, `0`–`1`. Omitted means the provider's default. */
  temperature?: number;
  /** The personas, in the order they take turns. Turn order wraps. */
  personas: PersonaConfig[];
  /** Token cap on a single burst. Kept small — a burst is a contribution, not an essay. */
  tokensPerBurst: number;
  /**
   * This chain's ceiling in dollars.
   *
   * Enforced in three layers, because one of them has to be a prediction and a
   * prediction is the part that can be wrong:
   *
   * 1. The chain stops adding bursts while what is left still covers the next
   *    burst *and* the closing document. Both figures are computed rather than
   *    averaged — the synthesizer's `maxTokens` is a hard output ceiling and the
   *    transcript has a measured length — so the reserve is the real bill rather
   *    than a guess derived from burst history.
   * 2. The closing document is checked against what remains before it runs. A
   *    synthesis that cannot be paid for is skipped and reported, not run.
   * 3. Underneath both, the cost ledger refuses to dispatch anything once
   *    recorded spend reaches this number. Final spend can exceed it only by the
   *    cost of the single call that crossed it, and only when layer 1
   *    mispredicted — which is then reported as `stopReason: "budget"` rather
   *    than as an error.
   *
   * **Per chain, not per composition.** `runChain` runs several presets end to
   * end, and each carries its own `budgetUsd`, so a three-preset composition is
   * exposed to the sum of the three. Cap the whole thing with
   * `RunChainOptions.totalBudgetUsd`.
   *
   * Must be at least the price of `synthesizer.maxTokens` at the model's output
   * rate. Below that the chain can buy bursts and never the document that
   * summarises them, which `createHarnessSystem` refuses at construction rather
   * than discovering four calls in.
   */
  budgetUsd: number;
  /**
   * Hard ceiling on burst count, independent of spend.
   *
   * The budget is the primary stop; this is the backstop for the case the
   * budget cannot catch — a provider that reports no usage prices every call at
   * an estimate, and an estimate that runs under the real bill would otherwise
   * let the chain run indefinitely on a budget that never appears to deplete.
   */
  maxIterations: number;
  /**
   * The per-burst prompt.
   *
   * Placeholders are `{{input}}`, `{{persona}}`, `{{iteration}}`,
   * `{{previousBurst}}`, `{{transcript}}`, and `{{tokensPerBurst}}`. Anything
   * else is left exactly as written, so a prompt containing literal braces
   * survives rendering.
   */
  promptTemplate: string;
  /** The closing document's author. */
  synthesizer: SynthesizerConfig;
  /**
   * Fraction of the budget at which a `budget:warning` fires, in `(0, 1]`.
   * @default 0.8
   */
  budgetWarningThreshold?: number;
}

/**
 * The only definition of "is this a valid preset".
 *
 * Two constraints here are worth their strictness. `personas` must be non-empty
 * because turn order is `iteration % personas.length`, and an empty list makes
 * that a division by zero that surfaces as an undefined persona name three
 * layers down. `budgetUsd` must be positive because a budget of zero produces a
 * chain that stops before its first burst and reports `"budget"` — technically
 * correct, and indistinguishable from a misconfiguration.
 */
export const presetSchema = z
  .object({
    id: z.string().min(1),
    meta: metaSchema.optional(),
    model: z.string().min(1),
    temperature: z.number().min(0).max(1).optional(),
    personas: z.array(personaSchema).min(1),
    tokensPerBurst: z.number().int().positive(),
    budgetUsd: z.number().positive(),
    maxIterations: z.number().int().positive(),
    promptTemplate: z.string().min(1),
    synthesizer: synthesizerSchema,
    budgetWarningThreshold: z.number().gt(0).lte(1).optional(),
  })
  /**
   * Every voice in a preset needs its own name.
   *
   * A name is not a label here — it is the orchestrator's agent ID, and the
   * registry is keyed by it. Two personas sharing a name silently collapse into
   * one registration, so the second one's system prompt is discarded while turn
   * order keeps calling on it and the transcript keeps attributing bursts to
   * it. A persona sharing the synthesizer's name is worse: the token cap is
   * chosen by comparing the agent name against the synthesizer's, so that
   * persona would run with the closing document's much larger cap and quietly
   * cost several times what the preset budgeted for a burst.
   *
   * Neither failure raises anything at runtime, which is exactly why it belongs
   * in the schema.
   */
  .superRefine((preset, context) => {
    const seen = new Set<string>();

    for (const [index, persona] of preset.personas.entries()) {
      if (seen.has(persona.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["personas", index, "name"],
          message: `duplicate agent name "${persona.name}" — every persona needs its own, because the name is the orchestrator's agent ID`,
        });
      }
      seen.add(persona.name);
    }

    if (seen.has(preset.synthesizer.name)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["synthesizer", "name"],
        message: `"${preset.synthesizer.name}" is already a persona name — the synthesizer needs its own, or that persona runs with the closing document's token cap`,
      });
    }
  });

/** Default fraction of the budget at which `budget:warning` fires. */
export const DEFAULT_BUDGET_WARNING_THRESHOLD = 0.8;

/**
 * Render a preset template.
 *
 * Shared by the burst prompt and the synthesizer prompt so the two cannot come
 * to disagree about what `{{transcript}}` means. Unknown placeholders are left
 * untouched rather than blanked: a prompt that mentions `{{TODO}}` should reach
 * the model saying so, not silently lose it.
 */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!Object.hasOwn(values, key)) {
      return whole;
    }

    return String(values[key]);
  });
}
