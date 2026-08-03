/**
 * `@sizls/ai-harness` — a configurable persona-chain engine.
 *
 * A set of personas take turns on one growing transcript, each reading all of
 * it and adding a short burst, until a dollar budget runs out or an operator
 * interrupts. Then a synthesizer reads the whole thing and writes the closing
 * document.
 *
 * The chain's control flow is a Directive module — facts for where it is,
 * derivations for what that means, constraints for what must happen next,
 * resolvers for the provider calls. There is no loop. See `./core/module.js`,
 * which is the file worth reading.
 *
 * @example
 * ```typescript
 * import { codeReviewPreset, createHarness } from "@sizls/ai-harness";
 *
 * const harness = createHarness(codeReviewPreset, {
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   onEvent: (event) => {
 *     if (event.type === "burst:completed") {
 *       console.log(`${event.persona}: ${event.text}`);
 *     }
 *   },
 * });
 *
 * process.on("SIGINT", () => harness.abort());
 *
 * const result = await harness.run(diff);
 * console.log(result.stopReason, result.spentUsd, result.transcriptPath);
 * ```
 *
 * @module
 */

// ---------------------------------------------------------------------------
// The programmatic surface
// ---------------------------------------------------------------------------
export {
  createHarness,
  definePreset,
  runHarness,
  type CreateHarnessOptions,
  type SdkHarness,
} from "./adapters/sdk/index.js";

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------
export {
  createHarnessSystem,
  type Harness,
  type HarnessOptions,
  type HarnessRunResult,
} from "./core/system.js";

export {
  runChain,
  type ChainRunResult,
  type ChainStepResult,
  type RunChainOptions,
} from "./core/composition.js";

export {
  chainSchema,
  createHarnessModule,
  type ChainDerived,
  type DerivedReader,
  type HarnessModule,
  type HarnessModuleDeps,
} from "./core/module.js";

// ---------------------------------------------------------------------------
// Events — the one union every surface renders from
// ---------------------------------------------------------------------------
export type {
  BurstSummary,
  ChainPhase,
  CompositionStep,
  CostSnapshot,
  ErrorScope,
  HarnessEvent,
  HarnessEventSink,
  StopReason,
} from "./core/events.js";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
export {
  DEFAULT_BUDGET_WARNING_THRESHOLD,
  metaSchema,
  personaSchema,
  presetSchema,
  renderTemplate,
  synthesizerSchema,
  type PersonaConfig,
  type PresetConfig,
  type SynthesizerConfig,
} from "./core/preset-types.js";

export {
  assertPreset,
  listPresets,
  loadPreset,
  validatePreset,
  type PresetValidation,
} from "./core/preset-registry.js";

export {
  BUILTIN_PRESETS,
  PRESET_LIST,
  archaeologyPreset,
  brainstormPreset,
  codeReviewPreset,
  crypto101Preset,
  decipherPreset,
  moonshotPreset,
  preMortemPreset,
  researchPreset,
} from "./presets/index.js";

// ---------------------------------------------------------------------------
// Agents and transcript
// ---------------------------------------------------------------------------
export {
  createHarnessAgents,
  type HarnessAgents,
  type HarnessAgentsOptions,
} from "./core/agents.js";

export {
  createRunId,
  createTranscript,
  defaultTranscriptDir,
  type BurstRecord,
  type Transcript,
  type TranscriptOptions,
} from "./core/transcript.js";

export {
  createMockRunner,
  type MockFailure,
  type MockRunnerOptions,
} from "./core/mock-runner.js";
