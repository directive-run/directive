/**
 * The programmatic surface — and the one the other surfaces are built on.
 *
 * The CLI does not know anything the caller of this file cannot find out. It
 * builds a harness, subscribes to the event stream, and renders. So does
 * `runHarness`, so does `runComposition`, and so will MCP and HTTP. A surface that
 * needed a private channel into the system would be a second path from engine
 * to screen, and two paths diverge — the CLI would start reporting something
 * the SDK could not.
 *
 * ## The escape hatch
 *
 * {@link createHarnessChain} is re-exported here on purpose. A caller who wants
 * the chain running inside *their* Directive system, next to their own modules,
 * sharing their plugins and their devtools session, composes the module directly
 * and never calls {@link createHarness} at all. That is the most
 * Directive-idiomatic thing this package can offer and it costs three lines;
 * `createHarness` is the convenience, not the boundary.
 *
 * @example
 * ```typescript
 * import { createHarness, codeReviewPreset } from "@sizls/ai-harness";
 *
 * const harness = createHarness(codeReviewPreset, {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   onEvent: (event) => {
 *     if (event.type === "turn:completed") {
 *       console.log(`${event.persona}: ${event.text}`);
 *     }
 *   },
 * });
 *
 * const result = await harness.run(diff);
 * harness.system.destroy();
 * ```
 *
 * @module
 */

import {
  type CompositionResult,
  type CompositionStepResult,
  type RunCompositionOptions,
  runComposition,
} from "../../core/composition.js";
import { assertPreset } from "../../core/preset-registry.js";
import type { PresetConfig } from "../../core/preset-types.js";
import {
  type Harness,
  type HarnessOptions,
  type HarnessRunResult,
  createHarnessSystem,
} from "../../core/system.js";

// ============================================================================
// Options
// ============================================================================

export interface CreateHarnessOptions extends HarnessOptions {
  /**
   * Stops the chain from outside.
   *
   * Sugar over {@link Harness.abort}, for callers already holding a signal.
   * Like `abort()`, it flips the interrupt fact — the turn in flight finishes
   * and the chain still synthesizes. It is not forwarded to the provider call.
   */
  signal?: AbortSignal;
}

/**
 * A running chain, plus the preset that configured it.
 *
 * `system` is on here deliberately. It is what makes `inspect()`, the devtools
 * plugin, and time-travel available to a consumer — the chain is an ordinary
 * Directive system and there is no reason to hide it behind a façade that would
 * only ever re-expose the same things under worse names.
 */
export interface SdkHarness extends Harness {
  /** The validated preset this harness is running. */
  preset: PresetConfig;
}

// ============================================================================
// createHarness
// ============================================================================

/**
 * Build a harness for one run.
 *
 * The preset is validated here rather than at first use, so a typo in a budget
 * is an error before any money is spent.
 */
export function createHarness(
  preset: PresetConfig,
  options: CreateHarnessOptions = {},
): SdkHarness {
  const { signal, ...harnessOptions } = options;
  const validated = assertPreset(preset, "createHarness(preset)");
  const harness = createHarnessSystem(validated, harnessOptions);

  if (signal !== undefined) {
    if (signal.aborted) {
      harness.abort();
    } else {
      signal.addEventListener("abort", () => harness.abort(), { once: true });
    }
  }

  return { ...harness, preset: validated };
}

/**
 * Run one preset to completion and clean up after it.
 *
 * The one-shot form. It destroys the system on the way out, which is the only
 * reason to prefer it over {@link createHarness} — a caller who wants to
 * `inspect()` the system afterwards wants the other one.
 */
export async function runHarness(
  preset: PresetConfig,
  input: string,
  options: CreateHarnessOptions = {},
): Promise<HarnessRunResult> {
  const harness = createHarness(preset, options);

  try {
    return await harness.run(input);
  } finally {
    harness.system.destroy();
  }
}

// ============================================================================
// definePreset
// ============================================================================

/**
 * Identity, with the types and the validation attached.
 *
 * `defineConfig`-style: it returns exactly what it was given. What it adds is
 * that the object literal is checked against {@link PresetConfig} while you are
 * writing it, and against the schema when the module loads — so a preset in a
 * user's config file fails at import rather than three turns into a run.
 *
 * @example
 * ```typescript
 * export default definePreset({
 *   id: "my-chain",
 *   model: "claude-sonnet-4-5-20250929",
 *   personas: [{ name: "first", systemPrompt: "…" }],
 *   tokensPerTurn: 500,
 *   budgetUsd: 0.5,
 *   maxIterations: 8,
 *   promptTemplate: "{{transcript}}\n\nYour turn, {{persona}}.",
 *   synthesizer: { name: "close", systemPrompt: "…", promptTemplate: "{{transcript}}", maxTokens: 2000 },
 * });
 * ```
 */
export function definePreset(config: PresetConfig): PresetConfig {
  const label =
    typeof config?.id === "string" && config.id !== ""
      ? `definePreset("${config.id}")`
      : "definePreset(config)";

  return assertPreset(config, label);
}

// ============================================================================
// Re-exports — the surface a consumer imports
// ============================================================================

export {
  runComposition,
  type CompositionResult,
  type CompositionStepResult,
  type RunCompositionOptions,
};

export {
  loadPreset,
  listPresets,
  validatePreset,
  assertPreset,
  type PresetValidation,
} from "../../core/preset-registry.js";

export { BUILTIN_PRESETS, PRESET_LIST } from "../../presets/index.js";

export type {
  Harness,
  HarnessOptions,
  HarnessRunResult,
} from "../../core/system.js";

/**
 * The chain itself, for composing it into a system you own.
 *
 * `createHarnessChain` is a factory rather than a value because a chain needs a
 * transcript, an orchestrator, and an event sink handed to it — but what comes
 * back is an ordinary Directive module plus the one call that connects it to the
 * system running it, and `createSystem({ modules: { chain: chain.module, …} })`
 * is a supported thing to do with it. See {@link HarnessChain} for the shape of
 * that, end to end.
 */
export {
  chainSchema,
  createHarnessChain,
  type ChainDerived,
  type HarnessChain,
  type HarnessChainDeps,
  type HarnessModule,
} from "../../core/module.js";
