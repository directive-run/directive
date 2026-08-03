/**
 * The chain's stopping arithmetic, as functions.
 *
 * Every expression here has exactly one definition and two callers: the
 * derivations in `./module.js`, which decide what a running chain does, and
 * `./estimate.js`, which answers the same questions offline for
 * `--list-presets`. They were written twice, and the two copies had already
 * come apart — the estimator checked the iteration ceiling before
 * affordability, while the chain checks affordability first, so a preset that
 * exhausts its budget on the turn that also reaches the ceiling was reported as
 * stopping "well under the cap". A preset's advertised behaviour and its actual
 * behaviour cannot be allowed to be two different pieces of arithmetic.
 *
 * Nothing here reads a fact, a preset field it was not handed, or a clock. Each
 * function takes the numbers it needs and returns one, which is what lets the
 * same expression serve a live chain and a replay of one.
 *
 * ## The four-characters-per-token measure
 *
 * Every input figure below is derived from a character count divided by
 * {@link CHARS_PER_TOKEN}, which is the same constant `withBudget` prices its
 * own estimates with — deliberately, so the reserve and the bill are one
 * arithmetic rather than two.
 *
 * It is a heuristic, and it is wrong in a direction worth naming. Four
 * characters per token is roughly right for English prose and **under-measures
 * code by 15–40%**: identifiers, punctuation runs, and indentation tokenize far
 * denser than prose. Three of the shipped presets — `code-review`, `decipher`,
 * `crypto-101` — exist to be pointed at code, so on exactly those runs the input
 * half of every figure here reads low. The output half does not have this
 * problem: `tokensPerTurn` and `synthesizer.maxTokens` are token counts the
 * provider enforces, so they are exact.
 *
 * What that costs in practice: the reserve is under-stated by a fraction of the
 * transcript's input price, which on a chain whose bill is dominated by output
 * tokens is small — but it is not zero, and it is why the hard ledger floor
 * under all of this is not redundant.
 *
 * @module
 */

import type { TokenPricing } from "@directive-run/ai";
import { CHARS_PER_TOKEN, harnessSystemPrompt } from "./agents.js";
import type { StopReason } from "./events.js";
import type { PresetConfig } from "./preset-types.js";

/**
 * Tokens a prompt of this many characters bills as.
 *
 * Matches `withBudget`'s own estimator. See the module note for what it
 * under-measures.
 */
export function tokensFor(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The measurable inputs to every figure below.
 *
 * `transcriptChars` and `inputChars` are lengths, not predictions — a running
 * chain reads them off its facts and a replay supplies its own assumptions for
 * them. Keeping them as arguments rather than deriving them inside is what
 * makes the estimator's assumptions visible at its call site instead of buried
 * as a term that quietly went missing.
 */
export interface PromptSize {
  /** Length of the fenced transcript the next call will re-read. */
  transcriptChars: number;
  /** Length of the operator's subject, which every prompt interpolates. */
  inputChars: number;
}

/** Everything the next-turn projection reads. */
export interface TurnCostState extends PromptSize {
  /** Turns completed. Also the index of the turn being considered. */
  iteration: number;
  lastTurnUsd: number;
  previousTurnUsd: number;
}

/**
 * What the closing document will cost, in dollars.
 *
 * Not estimated from history — computed. The synthesizer's `maxTokens` is a
 * hard ceiling on its output, and the transcript it will read has a length that
 * can be measured, so both halves of the bill are known before the call is
 * made. The output half is exact; the input half is a character count divided
 * by four, which the module note says more about.
 *
 * The system prompt measured here is the one that actually goes out — the
 * preset's plus the standing notice the harness appends to every voice.
 * Measuring the preset's alone under-reserves by the length of that notice on
 * every run, which on a budget the chain spends down to the last cent is the
 * difference between affording the closing document and stopping just short.
 */
export function synthesisReserveUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
  size: PromptSize,
): number {
  const { synthesizer } = preset;
  const promptChars =
    size.transcriptChars +
    size.inputChars +
    synthesizer.promptTemplate.length +
    harnessSystemPrompt(synthesizer.systemPrompt).length;

  return (
    (tokensFor(promptChars) / 1_000_000) * pricing.inputPerMillion +
    (synthesizer.maxTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * What the closing document will cost **after one more turn**.
 *
 * {@link synthesisReserveUsd} prices the transcript that exists right now,
 * which is the correct figure for a synthesis about to run and the wrong one
 * for deciding whether to add a turn first. A turn appends about
 * `tokensPerTurn` to the transcript and the synthesizer then reads all of it,
 * so authorizing a turn against today's reserve reserves for a document the
 * chain is in the act of making more expensive.
 */
export function projectedReserveUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
  size: PromptSize,
): number {
  return (
    synthesisReserveUsd(preset, pricing, size) +
    (preset.tokensPerTurn / 1_000_000) * pricing.inputPerMillion
  );
}

/**
 * What the first turn will cost, before any turn has been measured.
 *
 * The projection used to answer zero here, on the reasoning that nothing has
 * been measured yet. Zero is not the honest answer — it is the claim that the
 * first turn is free, and the chain authorizes that turn against a reserve
 * computed on it. A budget just over the synthesis floor could therefore start
 * a turn it could not pay for alongside the document it still owed, and finish
 * with a transcript and no closing document.
 *
 * Nothing about the first turn needs measuring. Its output is capped at
 * `tokensPerTurn`, which the provider enforces, and its prompt is the template,
 * the subject, the (empty) transcript, and a persona's system prompt — all of
 * them in hand. The longest persona prompt is used rather than the one whose
 * turn it is, so the figure cannot come in under the turn that actually runs.
 */
export function aPrioriTurnUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
  size: PromptSize,
): number {
  const longestSystemPrompt = preset.personas.reduce(
    (longest, persona) =>
      Math.max(longest, harnessSystemPrompt(persona.systemPrompt).length),
    0,
  );
  const promptChars =
    size.transcriptChars +
    size.inputChars +
    preset.promptTemplate.length +
    longestSystemPrompt;

  return (
    (tokensFor(promptChars) / 1_000_000) * pricing.inputPerMillion +
    (preset.tokensPerTurn / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * What the *next* turn is expected to cost.
 *
 * The last turn plus the growth between the last two, floored at the last
 * turn's cost. Prompt growth per turn is roughly constant — each turn appends
 * about `tokensPerTurn` to a transcript every later turn re-sends — so cost
 * grows roughly linearly, and extrapolating the last observed step tracks that.
 * Unlike a mean it can never sit below the last measurement, which is the
 * property that matters: a predictor that under-shoots on a monotone series
 * stops the chain one turn too late, every time.
 *
 * One data point degrades to that turn's cost; none falls back to
 * {@link aPrioriTurnUsd}, which is arithmetic rather than a guess.
 */
export function projectTurnUsd(
  preset: PresetConfig,
  pricing: TokenPricing,
  state: TurnCostState,
): number {
  if (state.iteration === 0) {
    return aPrioriTurnUsd(preset, pricing, state);
  }
  if (state.iteration === 1) {
    return state.lastTurnUsd;
  }

  // Growth is clamped at zero so a turn that happened to come in cheaper than
  // its predecessor does not predict a cheaper one still, on a transcript that
  // only ever gets longer.
  const growth = Math.max(0, state.lastTurnUsd - state.previousTurnUsd);

  return state.lastTurnUsd + growth;
}

/**
 * Whether there is room for another turn.
 *
 * True while what is left covers the next turn **and** the closing document
 * that turn will leave the chain owing. This is the *graceful* stop, and it is
 * a prediction; the hard floor underneath it is `maxTotalCost` on the budget
 * runner.
 */
export function canAffordTurn(figures: {
  remainingUsd: number;
  projectedTurnUsd: number;
  projectedReserveUsd: number;
}): boolean {
  return (
    figures.remainingUsd > 0 &&
    figures.remainingUsd >=
      figures.projectedTurnUsd + figures.projectedReserveUsd
  );
}

/** Every way the chain can stop, as one shape. */
export interface StopState {
  /** The runner's lifetime ledger floor refused a call. */
  budgetHalted: boolean;
  /** A turn resolver threw. */
  failed: boolean;
  /** An operator called `abort()`. */
  interrupted: boolean;
  canAffordTurn: boolean;
  iterationsExhausted: boolean;
}

/**
 * Whether the chain is done adding turns, for any reason.
 *
 * **The single termination condition.** Every way the chain can stop is one
 * clause of this expression, and everything downstream — the constraints, the
 * phase, the stop reason — reads it rather than re-deriving its own version.
 */
export function chainStopped(state: StopState): boolean {
  return (
    state.budgetHalted ||
    state.failed ||
    state.interrupted ||
    !state.canAffordTurn ||
    state.iterationsExhausted
  );
}

/**
 * Why the chain stopped; `""` while it has not.
 *
 * Precedence when several apply at once: the hard budget floor outranks a
 * failure, which outranks an interrupt, which outranks the predicted budget
 * stop, which outranks the iteration ceiling. Ordered most-specific first, so
 * the reported reason is the one that would surprise the operator most.
 *
 * The floor sits at the top because it surfaces as a thrown error, and
 * reporting a run that hit its ceiling as `"error"` is how the two ceilings
 * would come to give different accounts of the same money. It is a budget stop;
 * it says so.
 *
 * **Affordability outranks the ceiling**, which is the clause the offline
 * replay used to get backwards. A run whose last affordable turn is also its
 * last permitted turn ran out of money, and reporting it as a turn-count stop
 * tells an operator the budget was never the constraint.
 */
export function stopReasonFor(state: StopState): StopReason {
  if (!chainStopped(state)) {
    return "";
  }
  if (state.budgetHalted) {
    return "budget";
  }
  if (state.failed) {
    return "error";
  }
  if (state.interrupted) {
    return "interrupted";
  }
  if (!state.canAffordTurn) {
    return "budget";
  }

  return "max-iterations";
}
