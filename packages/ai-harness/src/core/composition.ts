/**
 * Several presets, end to end, each reading what the last one concluded.
 *
 * A composition is not a bigger chain. Each step is its own harness with its
 * own system, its own budget, its own transcript, and its own synthesizer —
 * what crosses the boundary between two steps is a *finished document*, not a
 * running conversation. That is the whole design: a step cannot see the
 * previous step's turns, only what its synthesizer decided they amounted to.
 * The narrowing is the point of composing rather than concatenating persona
 * lists, and it is why a four-preset chain does not end up with a thirty-turn
 * transcript no single persona can read.
 *
 * ## Sequential only
 *
 * There is no parallel form here, deliberately. Two presets running at once
 * cannot feed each other, so the interesting part — a step reading its
 * predecessor's conclusion — is exactly what parallelism gives up. It also
 * turns the one budget question the chain answers cleanly ("what has this cost
 * so far") into a race between two ledgers.
 *
 * ## What it emits
 *
 * Each step's chain events pass through untouched, bracketed by
 * `composition:step:started` and `composition:step:complete`. Steps are strictly
 * sequential, so the bracket is sufficient attribution and no chain event needs
 * a step field it would carry unused during a single run.
 *
 * @module
 */

import { minimumStepBudgetUsd, resolvePresetPricing } from "./agents.js";
import type { HarnessEvent, HarnessEventSink } from "./events.js";
import type { PresetConfig } from "./preset-types.js";
import {
  MAX_RUN_ID_LENGTH,
  assertSafeIdentifier,
  createFenceToken,
  fence,
} from "./safety.js";
import {
  type Harness,
  type HarnessOptions,
  type HarnessRunResult,
  createHarnessSystem,
} from "./system.js";
import { createMemoryTranscriptStore, createRunId } from "./transcript.js";

// ============================================================================
// Options and results
// ============================================================================

export interface RunCompositionOptions extends HarnessOptions {
  /**
   * Stops the composition.
   *
   * Aborting flips the running step's interrupt fact — so that step finishes
   * the turn in flight and still synthesizes — and no further step starts.
   * It is not passed to the provider call: tearing up a request mid-response
   * is the one thing the chain is built not to do.
   */
  signal?: AbortSignal;
  /**
   * The composition's ceiling in dollars, across every step.
   *
   * **`budgetUsd` is per step, and always was.** `RunCompositionOptions` extends
   * `HarnessOptions`, the options are handed to each step's harness in turn, and
   * a preset carries its own `budgetUsd` — so `runComposition([a, b, c], …)` with
   * `budgetUsd: 5` is $15 of exposure, not $5. Nothing compared accumulated
   * spend to anything, and no doc said which of the two readings was meant.
   *
   * This is the number that says it. Each step runs with the smaller of its own
   * `budgetUsd` and what is left of this, and the composition stops when what is
   * left cannot pay for the next step's closing document.
   *
   * Defaults to the sum of the presets' own budgets — so the figure is always
   * defined, always reported on {@link CompositionResult.budgetUsd}, and the
   * default changes nothing about what a composition costs. Setting it lower is
   * how a caller caps the whole run.
   *
   * **Why a separate number rather than dividing `budgetUsd` by the step
   * count.** A preset is plain JSON meant to be read off disk and reused, and
   * its `budgetUsd` is a statement about that preset — what a `code-review` pass
   * over one diff is worth. Dividing it would make the same file mean a
   * different thing depending on what it happened to be composed with, so a
   * preset tuned in isolation would quietly under-run in a chain and nobody
   * could tell by reading it. The step budget stays the step's; the composition
   * gets its own.
   */
  totalBudgetUsd?: number;
}

/** One step's outcome, with its position in the composition. */
export interface CompositionStepResult extends HarnessRunResult {
  /** One-based position. */
  step: number;
  presetId: string;
}

export interface CompositionResult {
  /** Names the composition, and stems every step's run ID. */
  runId: string;
  /**
   * Steps that ran, in order. Shorter than the preset list after an interrupt
   * or once the composition's ceiling is used up.
   */
  steps: CompositionStepResult[];
  /** Every step's spend, summed. Never above {@link CompositionResult.budgetUsd}. */
  spentUsd: number;
  /**
   * The ceiling this composition ran under, across every step.
   *
   * `totalBudgetUsd` when one was given, otherwise the sum of the presets' own
   * budgets. Reported either way, because the sum is the figure a caller is
   * exposed to and it was previously implicit.
   */
  budgetUsd: number;
  /** The last step's closing document — the composition's answer. */
  synthesis: string;
  /** The file holding every step's synthesis, in order. */
  combinedPath: string;
  /** Whether an operator stopped the composition before its last step. */
  interrupted: boolean;
  /**
   * Whether the composition stopped early because the ceiling was used up.
   *
   * The steps that ran are whole — each one synthesized — and the ones that did
   * not run were never started. A caller wanting all of them needs a bigger
   * `totalBudgetUsd`, not a retry.
   */
  budgetExhausted: boolean;
}

// ============================================================================
// Input composition
// ============================================================================

/** One prior step's conclusion, as the next step sees it. */
interface PriorSynthesis {
  step: number;
  presetId: string;
  text: string;
}

/**
 * The input the next step is handed.
 *
 * Every prior synthesis rides along, not just the immediately preceding one. A
 * step that could only see its predecessor would lose the first step's
 * conclusion by the third, and the reason to run `pre-mortem` after
 * `code-review` is that the pre-mortem can see the review.
 *
 * Tagged rather than concatenated, because the personas' prompts embed
 * `{{input}}` inside their own markup and an untagged wall of prior text reads
 * to the model as more of the original subject.
 *
 * The tags carry the composition's marker, and the marker is stripped from each
 * synthesis before it is embedded. A synthesis is model output being fed to
 * another model, so without that a closing document could write its own `</step>`
 * and attribute a paragraph to a step that never said it. The marker here is the
 * composition's own — each step's transcript has a different one — so a step's
 * fences and the composition's cannot be confused for one another.
 */
function composeInput(
  original: string,
  prior: PriorSynthesis[],
  token: string,
): string {
  if (prior.length === 0) {
    return original;
  }

  const sections = prior.map((entry) =>
    fence(
      "step",
      token,
      { index: entry.step, preset: entry.presetId },
      entry.text,
    ),
  );

  // The outer wrapper is written out rather than fenced through the helper: the
  // helper strips the marker from whatever it is given, and what it would be
  // given here is the step fences, which are made of the marker.
  const wrapper = `prior-analysis-${token}`;

  return [
    original,
    "",
    `<${wrapper}>`,
    "The following came out of earlier passes over this same subject. Build on it — do not repeat it.",
    "",
    ...sections,
    `</${wrapper}>`,
  ].join("\n");
}

// ============================================================================
// Combined document
// ============================================================================

function renderCombined(
  runId: string,
  input: string,
  steps: CompositionStepResult[],
): string {
  const sections = steps.map((step) => {
    const heading = `## ${step.step}. ${step.presetId}`;
    const note = `*${step.iterations} turns · $${step.spentUsd.toFixed(4)} · stopped: ${step.stopReason || "settled"}*`;
    const body =
      step.synthesis === ""
        ? "_This step produced no closing document._"
        : step.synthesis;

    return `${heading}\n\n${note}\n\n${body}\n`;
  });

  return `# ${runId}\n\n**Input:** ${input}\n\n${sections.join("\n---\n\n")}`;
}

// ============================================================================
// runComposition
// ============================================================================

/**
 * Run presets in order, each reading what the last one concluded.
 *
 * @example
 * ```typescript
 * const result = await runComposition([codeReviewPreset, preMortemPreset], diff, {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   onEvent: (event) => {
 *     if (event.type === "composition:step:started") {
 *       console.log(`[${event.step}/${event.total}] ${event.presetId}`);
 *     }
 *   },
 * });
 * ```
 */
export async function runComposition(
  presets: readonly PresetConfig[],
  input: string,
  options: RunCompositionOptions = {},
): Promise<CompositionResult> {
  if (presets.length === 0) {
    throw new Error(
      "[ai-harness] runComposition needs at least one preset — an empty composition has nothing to synthesize.",
    );
  }

  const {
    signal,
    onEvent,
    runId: providedRunId,
    transcripts,
    totalBudgetUsd,
    ...rest
  } = options;
  const now = options.now ?? Date.now;
  const runId =
    providedRunId === undefined
      ? createRunId(now)
      : assertSafeIdentifier(providedRunId, "runId", MAX_RUN_ID_LENGTH);
  // One store for the whole composition: every step's transcript and the
  // combined document all go through it. The combined document used to be
  // written by a second, separate call to the filesystem sitting beside the
  // transcript's own and knowing nothing about it, which is one writer too many
  // for a package whose output side is meant to be substitutable.
  const store = transcripts ?? createMemoryTranscriptStore();
  /** This composition's fence marker. Distinct from any step's. */
  const fenceToken = createFenceToken();
  const emit: HarnessEventSink = (event: HarnessEvent) => {
    onEvent?.(event);
  };

  const budgetUsd =
    totalBudgetUsd ??
    presets.reduce((total, preset) => total + preset.budgetUsd, 0);

  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new Error(
      `[ai-harness] runComposition needs a positive totalBudgetUsd — got ${String(totalBudgetUsd)}.`,
    );
  }

  emit({
    type: "composition:started",
    runId,
    presets: presets.map((preset) => preset.id),
    input,
    at: now(),
  });

  const steps: CompositionStepResult[] = [];
  const prior: PriorSynthesis[] = [];
  let spentUsd = 0;
  let interrupted = signal?.aborted === true;
  let budgetExhausted = false;

  for (const [index, preset] of presets.entries()) {
    if (interrupted) {
      break;
    }

    const step = index + 1;
    const stepRunId = `${runId}-${step}-${preset.id}`;
    const stepMeta = { step, total: presets.length, presetId: preset.id };

    // What this step may spend: its own budget, or whatever is left of the
    // composition's, whichever is smaller. The clamp is a no-op on the default
    // ceiling — the sum of the steps' own budgets — and is the whole mechanism
    // when a caller sets one.
    const remainingUsd = budgetUsd - spentUsd;
    const pricing = resolvePresetPricing(preset, rest.pricing);
    const floorUsd = minimumStepBudgetUsd(preset, pricing);

    // Below the floor there is no step worth running: it could buy a turn or
    // two but not the closing document that makes them useful to the next step,
    // and a step whose synthesis is skipped contributes nothing downstream.
    // Stop, and say so, rather than start something that cannot finish.
    if (remainingUsd < floorUsd) {
      budgetExhausted = true;
      emit({
        type: "composition:budget-exhausted",
        runId,
        ...stepMeta,
        spentUsd,
        budgetUsd,
        requiredUsd: floorUsd,
        at: now(),
      });
      break;
    }

    const stepPreset: PresetConfig =
      remainingUsd < preset.budgetUsd
        ? { ...preset, budgetUsd: remainingUsd }
        : preset;

    emit({
      type: "composition:step:started",
      ...stepMeta,
      runId: stepRunId,
      at: now(),
    });

    const harness: Harness = createHarnessSystem(stepPreset, {
      ...rest,
      transcripts: store,
      runId: stepRunId,
      onEvent: emit,
    });

    const onAbort = () => {
      interrupted = true;
      harness.abort();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let result: HarnessRunResult;
    try {
      result = await harness.run(composeInput(input, prior, fenceToken));
    } finally {
      signal?.removeEventListener("abort", onAbort);
      harness.system.destroy();
    }

    const stepResult: CompositionStepResult = { ...result, ...stepMeta };
    steps.push(stepResult);
    spentUsd += result.spentUsd;
    if (result.synthesis !== "") {
      prior.push({ step, presetId: preset.id, text: result.synthesis });
    }

    emit({
      type: "composition:step:complete",
      ...stepMeta,
      runId: stepRunId,
      stopReason: result.stopReason,
      iterations: result.iterations,
      spentUsd: result.spentUsd,
      synthesis: result.synthesis,
      transcriptPath: result.transcriptPath,
      jsonlPath: result.jsonlPath,
      at: now(),
    });

    // An interrupt inside a step ends the composition, not just that step. The
    // operator asked the run to stop; carrying on into the next preset would
    // answer a question they had already withdrawn.
    if (result.stopReason === "interrupted") {
      interrupted = true;
    }
  }

  // Through the same store every step's transcript went through, so containment
  // — and whether there is a filesystem here at all — is decided in one place
  // rather than asserted again by a second writer that has to remember the rule.
  const combinedPath = await store.writeDocument(
    `${runId}.md`,
    renderCombined(runId, input, steps),
  );

  emit({
    type: "composition:complete",
    runId,
    steps: steps.length,
    spentUsd,
    budgetUsd,
    combinedPath,
    interrupted,
    budgetExhausted,
    at: now(),
  });

  return {
    runId,
    steps,
    spentUsd,
    budgetUsd,
    synthesis: steps.at(-1)?.synthesis ?? "",
    combinedPath,
    interrupted,
    budgetExhausted,
  };
}
