/**
 * Several presets, end to end, each reading what the last one concluded.
 *
 * A composition is not a bigger chain. Each step is its own harness with its
 * own system, its own budget, its own transcript, and its own synthesizer —
 * what crosses the boundary between two steps is a *finished document*, not a
 * running conversation. That is the whole design: a step cannot see the
 * previous step's bursts, only what its synthesizer decided they amounted to.
 * The narrowing is the point of composing rather than concatenating persona
 * lists, and it is why a four-preset chain does not end up with a thirty-burst
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

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HarnessEvent, HarnessEventSink } from "./events.js";
import type { PresetConfig } from "./preset-types.js";
import {
  type Harness,
  type HarnessOptions,
  type HarnessRunResult,
  createHarnessSystem,
} from "./system.js";
import { createRunId, defaultTranscriptDir } from "./transcript.js";

// ============================================================================
// Options and results
// ============================================================================

export interface RunChainOptions extends HarnessOptions {
  /**
   * Stops the composition.
   *
   * Aborting flips the running step's interrupt fact — so that step finishes
   * the burst in flight and still synthesizes — and no further step starts.
   * It is not passed to the provider call: tearing up a request mid-response
   * is the one thing the chain is built not to do.
   */
  signal?: AbortSignal;
}

/** One step's outcome, with its position in the composition. */
export interface ChainStepResult extends HarnessRunResult {
  /** One-based position. */
  step: number;
  presetId: string;
}

export interface ChainRunResult {
  /** Names the composition, and stems every step's run ID. */
  runId: string;
  /** Steps that ran, in order. Shorter than the preset list after an interrupt. */
  steps: ChainStepResult[];
  /** Every step's spend, summed. */
  spentUsd: number;
  /** The last step's closing document — the composition's answer. */
  synthesis: string;
  /** The file holding every step's synthesis, in order. */
  combinedPath: string;
  /** Whether an operator stopped the composition before its last step. */
  interrupted: boolean;
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
 */
function composeInput(original: string, prior: PriorSynthesis[]): string {
  if (prior.length === 0) {
    return original;
  }

  const sections = prior.map(
    (entry) =>
      `<step index="${entry.step}" preset="${entry.presetId}">\n${entry.text}\n</step>`,
  );

  return [
    original,
    "",
    "<prior-analysis>",
    "The following came out of earlier passes over this same subject. Build on it — do not repeat it.",
    "",
    ...sections,
    "</prior-analysis>",
  ].join("\n");
}

// ============================================================================
// Combined document
// ============================================================================

function renderCombined(
  runId: string,
  input: string,
  steps: ChainStepResult[],
): string {
  const sections = steps.map((step) => {
    const heading = `## ${step.step}. ${step.presetId}`;
    const note = `*${step.iterations} bursts · $${step.spentUsd.toFixed(4)} · stopped: ${step.stopReason || "settled"}*`;
    const body =
      step.synthesis === ""
        ? "_This step produced no closing document._"
        : step.synthesis;

    return `${heading}\n\n${note}\n\n${body}\n`;
  });

  return `# ${runId}\n\n**Input:** ${input}\n\n${sections.join("\n---\n\n")}`;
}

// ============================================================================
// runChain
// ============================================================================

/**
 * Run presets in order, each reading what the last one concluded.
 *
 * @example
 * ```typescript
 * const result = await runChain([codeReviewPreset, preMortemPreset], diff, {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   onEvent: (event) => {
 *     if (event.type === "composition:step:started") {
 *       console.log(`[${event.step}/${event.total}] ${event.presetId}`);
 *     }
 *   },
 * });
 * ```
 */
export async function runChain(
  presets: readonly PresetConfig[],
  input: string,
  options: RunChainOptions = {},
): Promise<ChainRunResult> {
  if (presets.length === 0) {
    throw new Error(
      "[ai-harness] runChain needs at least one preset — an empty composition has nothing to synthesize.",
    );
  }

  const { signal, onEvent, runId: providedRunId, outputDir, ...rest } = options;
  const now = options.now ?? Date.now;
  const runId = providedRunId ?? createRunId(now);
  const dir = outputDir ?? defaultTranscriptDir();
  const emit: HarnessEventSink = (event: HarnessEvent) => {
    onEvent?.(event);
  };

  emit({
    type: "composition:started",
    runId,
    presets: presets.map((preset) => preset.id),
    input,
    at: now(),
  });

  const steps: ChainStepResult[] = [];
  const prior: PriorSynthesis[] = [];
  let spentUsd = 0;
  let interrupted = signal?.aborted === true;

  for (const [index, preset] of presets.entries()) {
    if (interrupted) {
      break;
    }

    const step = index + 1;
    const stepRunId = `${runId}-${step}-${preset.id}`;
    const stepMeta = { step, total: presets.length, presetId: preset.id };

    emit({
      type: "composition:step:started",
      ...stepMeta,
      runId: stepRunId,
      at: now(),
    });

    const harness: Harness = createHarnessSystem(preset, {
      ...rest,
      outputDir: dir,
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
      result = await harness.run(composeInput(input, prior));
    } finally {
      signal?.removeEventListener("abort", onAbort);
      harness.system.destroy();
    }

    const stepResult: ChainStepResult = { ...result, ...stepMeta };
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

  const combinedPath = join(dir, `${runId}.md`);
  await mkdir(dirname(combinedPath), { recursive: true });
  await writeFile(combinedPath, renderCombined(runId, input, steps), "utf8");

  emit({
    type: "composition:complete",
    runId,
    steps: steps.length,
    spentUsd,
    combinedPath,
    interrupted,
    at: now(),
  });

  return {
    runId,
    steps,
    spentUsd,
    synthesis: steps.at(-1)?.synthesis ?? "",
    combinedPath,
    interrupted,
  };
}
