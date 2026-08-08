/**
 * What a preset is expected to do before it is asked to do it.
 *
 * A preset carries two ceilings — `budgetUsd` and `maxIterations` — and which
 * one binds is not visible from either number. Printing the dollar figure on
 * its own therefore says almost nothing: it is a cap, and nothing on screen
 * distinguishes a preset that spends it from one that stops at the turn ceiling
 * with most of it unspent.
 *
 * This replays the chain against its own stopping rules offline to answer both
 * questions at once. It is a *replay*, not a second model: every figure below
 * comes out of `./projection.js`, which is also where the chain's derivations
 * get theirs. That file exists because this one used to carry its own copy of
 * the arithmetic, and the copies had already diverged — the ceiling was tested
 * before affordability here and after it there, so a preset that spent its last
 * dollar on the turn that reached its ceiling was advertised as stopping "well
 * under the cap".
 *
 * ## What it assumes, and therefore what it cannot know
 *
 * - **An empty input.** The subject is what a caller supplies at run time, and
 *   a long diff makes every prompt longer and every turn dearer. This pushes
 *   the figure **low**.
 * - **Every turn using its full token allowance.** `tokensPerTurn` is a ceiling
 *   the model need not reach; a terse preset lands under it. This pushes the
 *   figure **high**.
 * - **No retries.** A retried call is billed per attempt and this counts one,
 *   which pushes the figure low again on a flaky provider.
 *
 * The two main assumptions push in **opposite** directions, so this is a
 * middle estimate rather than a bound in either direction — a realistic figure
 * for an ordinary run on a short subject, which a long subject or a chatty
 * model will move either side of. What is not an estimate is the ceiling
 * beside it: `budgetUsd` is enforced, whatever this says.
 *
 * @module
 */

import type { TokenPricing } from "@directive-run/ai";
import { CHARS_PER_TOKEN, harnessSystemPrompt } from "./agents.js";
import type { PresetConfig } from "./preset-types.js";
import {
  canAffordTurn,
  projectTurnUsd,
  projectedReserveUsd,
  stopReasonFor,
  synthesisReserveUsd,
  tokensFor,
} from "./projection.js";

/** What is expected to stop a preset first. */
export type RunLimit = "budget" | "iterations";

export interface RunEstimate {
  /** Turns the chain is expected to take. */
  turns: number;
  /** Which of the preset's two ceilings is expected to stop it. */
  limit: RunLimit;
  /** Expected total spend, closing document included. */
  expectedUsd: number;
  /** The ceiling that spend runs under — the preset's own `budgetUsd`. */
  budgetUsd: number;
  /** Whether the closing document is expected to be affordable at the end. */
  synthesis: boolean;
}

/** The estimator's stated assumption: nothing was pasted in. */
const ASSUMED_INPUT_CHARS = 0;

/**
 * Replay a preset's run against its own stopping rules.
 *
 * @param preset - A validated preset.
 * @param pricing - The rates the ledger would bill at, from `resolvePresetPricing`.
 */
export function estimateRun(
  preset: PresetConfig,
  pricing: TokenPricing,
): RunEstimate {
  const { personas, tokensPerTurn, budgetUsd } = preset;
  /** What one turn appends to the transcript the next one re-reads. */
  const turnChars = tokensPerTurn * CHARS_PER_TOKEN;

  let turns = 0;
  let spentUsd = 0;
  let transcriptChars = 0;
  let lastTurnUsd = 0;
  let previousTurnUsd = 0;
  let limit: RunLimit = "iterations";

  for (;;) {
    const size = {
      transcriptChars,
      inputChars: ASSUMED_INPUT_CHARS,
    };
    const state = {
      iteration: turns,
      lastTurnUsd,
      previousTurnUsd,
      ...size,
    };
    const affordable = canAffordTurn({
      remainingUsd: budgetUsd - spentUsd,
      projectedTurnUsd: projectTurnUsd(preset, pricing, state),
      projectedReserveUsd: projectedReserveUsd(preset, pricing, size),
    });
    // Asked in one place and answered by the same precedence a running chain
    // reports itself with, rather than by whichever of the two ceilings this
    // loop happened to test first.
    const stopReason = stopReasonFor({
      budgetHalted: false,
      failed: false,
      interrupted: false,
      canAffordTurn: affordable,
      iterationsExhausted: turns >= preset.maxIterations,
    });

    if (stopReason !== "") {
      limit = stopReason === "max-iterations" ? "iterations" : "budget";
      break;
    }

    const persona = personas[turns % personas.length];
    const promptChars =
      preset.promptTemplate.length +
      transcriptChars +
      ASSUMED_INPUT_CHARS +
      harnessSystemPrompt(persona?.systemPrompt ?? "").length;

    const turnUsd =
      (tokensFor(promptChars) / 1_000_000) * pricing.inputPerMillion +
      (tokensPerTurn / 1_000_000) * pricing.outputPerMillion;

    spentUsd += turnUsd;
    previousTurnUsd = lastTurnUsd;
    lastTurnUsd = turnUsd;
    transcriptChars += turnChars;
    turns += 1;
  }

  // `canAffordSynthesis`, and the bill if it can.
  const reserveUsd = synthesisReserveUsd(preset, pricing, {
    transcriptChars,
    inputChars: ASSUMED_INPUT_CHARS,
  });
  const synthesis = turns > 0 && budgetUsd - spentUsd >= reserveUsd;
  if (synthesis) {
    spentUsd += reserveUsd;
  }

  return { turns, limit, expectedUsd: spentUsd, budgetUsd, synthesis };
}
