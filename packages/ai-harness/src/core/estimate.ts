/**
 * What a preset is expected to do before it is asked to do it.
 *
 * A preset carries two ceilings — `budgetUsd` and `maxIterations` — and on
 * roughly half the library the second one binds first, so the run never
 * approaches the first. Printing the dollar figure on its own therefore says
 * almost nothing: it is a cap, it is often not reached, and nothing on screen
 * distinguishes a preset that spends its budget from one that stops at the turn
 * ceiling with most of it unspent.
 *
 * This replays the chain's own arithmetic offline to answer both questions at
 * once. It is a *replay*, not a second model: every line below has a counterpart
 * derivation in `./module.js` — the same projection, the same reserve, the same
 * affordability test — because two different answers to "when does this stop"
 * is exactly the failure the chain's single termination condition exists to
 * avoid.
 *
 * ## What it assumes, and therefore what it cannot know
 *
 * - **An empty input.** The subject is what a caller supplies at run time; a
 *   long diff makes every prompt longer and every turn dearer, so a real run is
 *   at or above this figure, never below.
 * - **Every turn using its full token allowance.** `tokensPerTurn` is a ceiling
 *   the model need not reach. A chatty preset lands near this; a terse one
 *   under it.
 *
 * Both assumptions push the same way, which is the useful direction: the figure
 * is a realistic upper bound on an ordinary run, not an average.
 *
 * @module
 */

import type { TokenPricing } from "@directive-run/ai";
import { CHARS_PER_TOKEN, harnessSystemPrompt } from "./agents.js";
import type { PresetConfig } from "./preset-types.js";

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

/** Tokens a prompt of this many characters bills as. Matches `withBudget`. */
function tokensFor(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

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
  const { personas, synthesizer, tokensPerTurn, budgetUsd } = preset;
  /** What one turn appends to the transcript the next one re-reads. */
  const turnChars = tokensPerTurn * CHARS_PER_TOKEN;
  const synthesisOverheadChars =
    synthesizer.promptTemplate.length +
    harnessSystemPrompt(synthesizer.systemPrompt).length;

  /** `synthesisReserveUsd`, for a transcript of a given length. */
  const reserveFor = (transcriptChars: number): number =>
    (tokensFor(transcriptChars + synthesisOverheadChars) / 1_000_000) *
      pricing.inputPerMillion +
    (synthesizer.maxTokens / 1_000_000) * pricing.outputPerMillion;

  let turns = 0;
  let spentUsd = 0;
  let transcriptChars = 0;
  let lastTurnUsd = 0;
  let previousTurnUsd = 0;

  while (turns < preset.maxIterations) {
    // `projectedTurnUsd`: the last turn plus the growth between the last two,
    // floored at the last turn's cost.
    const projectedTurnUsd =
      turns === 0
        ? 0
        : turns === 1
          ? lastTurnUsd
          : lastTurnUsd + Math.max(0, lastTurnUsd - previousTurnUsd);
    // `projectedReserveUsd`: the closing document priced against the transcript
    // the turn about to be authorized will leave behind.
    const projectedReserveUsd =
      reserveFor(transcriptChars) +
      (tokensPerTurn / 1_000_000) * pricing.inputPerMillion;
    const remainingUsd = budgetUsd - spentUsd;

    // `canAffordTurn`.
    if (
      remainingUsd <= 0 ||
      remainingUsd < projectedTurnUsd + projectedReserveUsd
    ) {
      break;
    }

    const persona = personas[turns % personas.length];
    const promptChars =
      preset.promptTemplate.length +
      transcriptChars +
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
  const reserveUsd = reserveFor(transcriptChars);
  const synthesis = turns > 0 && budgetUsd - spentUsd >= reserveUsd;
  if (synthesis) {
    spentUsd += reserveUsd;
  }

  return {
    turns,
    limit: turns >= preset.maxIterations ? "iterations" : "budget",
    expectedUsd: spentUsd,
    budgetUsd,
    synthesis,
  };
}
