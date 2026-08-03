/**
 * `@sizls/ai-harness` — a configurable persona-chain engine.
 *
 * A set of personas take turns on one growing transcript, each reading all of
 * it and adding a short turn, until a dollar budget runs out or an operator
 * interrupts. Then a synthesizer reads the whole thing and writes the closing
 * document.
 *
 * The chain's control flow is a Directive module — facts for where it is,
 * derivations for what that means, constraints for what must happen next,
 * resolvers for the provider calls. There is no loop. See `./core/module.js`,
 * which is the file worth reading.
 *
 * Nothing here touches a disk unless you say where. A run writes through a
 * `TranscriptStore` and defaults to the in-memory one; `createFileTranscriptStore`
 * is the filesystem, opted into.
 *
 * @example
 * ```typescript
 * import {
 *   codeReviewPreset,
 *   createFileTranscriptStore,
 *   createHarness,
 * } from "@sizls/ai-harness";
 *
 * const harness = createHarness(codeReviewPreset, {
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   transcripts: createFileTranscriptStore({ dir: "./runs" }),
 *   onEvent: (event) => {
 *     if (event.type === "turn:completed") {
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
  runComposition,
  type CompositionResult,
  type CompositionStepResult,
  type RunCompositionOptions,
} from "./core/composition.js";

export {
  chainSchema,
  createHarnessChain,
  type ChainDerived,
  type ChainHost,
  type DerivedReader,
  type HarnessChain,
  type HarnessChainDeps,
  type HarnessModule,
} from "./core/module.js";

// ---------------------------------------------------------------------------
// Events — the one union every surface renders from
// ---------------------------------------------------------------------------
export type {
  TurnSummary,
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

// The output side. A chain writes through a `TranscriptStore` and defaults to
// the in-memory one, so nothing touches a disk unless the caller says where.
export {
  createMemoryTranscriptStore,
  createRunId,
  createTranscript,
  type MemoryTranscriptStore,
  type OpenTranscriptOptions,
  type Transcript,
  type TranscriptSink,
  type TranscriptStore,
  type TurnRecord,
} from "./core/transcript.js";

export {
  createFileTranscriptStore,
  defaultTranscriptDir,
  type FileTranscriptStoreOptions,
} from "./adapters/node/transcript.js";

export {
  createMockRunner,
  type MockFailure,
  type MockRunnerOptions,
} from "./core/mock-runner.js";

// ---------------------------------------------------------------------------
// The untrusted-input boundary
// ---------------------------------------------------------------------------
//
// Exported because a surface built on the event stream inherits the problem.
// `turn:completed` and `synthesis:chunk` carry model output verbatim, and a
// consumer that writes either to a terminal is writing whatever the model chose
// to write — including escape sequences that clear the screen, hide text, or ask
// the terminal to set the clipboard. The bundled command line runs its output
// through these; anything else printing the same events needs to as well.
export {
  QUOTED_MATERIAL_NOTICE,
  createTerminalSanitizer,
  isSafeIdentifier,
  resolveWithin,
  sanitizeForTerminal,
  type TerminalSanitizer,
} from "./core/safety.js";
