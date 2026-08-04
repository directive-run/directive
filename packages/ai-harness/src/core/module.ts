/**
 * The chain, as a Directive module.
 *
 * This is the file to read. Everything else in the package is a detail in
 * service of it.
 *
 * ## There is no loop
 *
 * A persona chain is the shape most people write as a `while`: run a turn,
 * add up the cost, check the budget, pick the next persona, go again, and drop
 * out to a synthesis step at the bottom. That version works, and it has one
 * property that makes it a bad foundation — every question the chain answers is
 * answered inside the loop body, so nothing outside can see the answer or
 * change it. "Are we out of budget" is a `break`. "Did the operator interrupt"
 * is a flag read at the top. Adding a stop condition means editing the loop.
 *
 * Here, the same chain is:
 *
 * - **Facts** — where the chain is. `iteration`, `spentUsd`, `interrupted`,
 *   `synthesized`, and the rest. Nothing but a resolver or an event handler
 *   writes them — `interrupted` is the event handler's, everything else is a
 *   resolver's — and no fact encodes a decision.
 * - **Derivations** — what the facts mean. `canAffordTurn`, `chainStopped`,
 *   `turnPending`, `synthesisPending`, `phase`, `stopReason`. Every question
 *   the loop body used to answer inline is one of these, computed in exactly
 *   one place and readable from outside.
 * - **Constraints** — what must happen next. `runTurn` fires while
 *   `turnPending`; `synthesize` fires while `synthesisPending`. Neither knows
 *   anything about budgets, interrupts, or turn order — they read a derivation
 *   and emit a requirement.
 * - **Resolvers** — how it happens. Call the agent, write what came back to
 *   facts. They do not decide whether they should have run.
 * - **Effects** — telling anyone about it. Mirroring the transcript to whatever
 *   store it was opened on, and emitting the event stream.
 *
 * ## How the chain terminates
 *
 * There is no exit condition anywhere, because there is nothing to exit. A
 * turn resolver writes `spentUsd`, `lastTurnUsd`, `transcriptChars`, and
 * `iteration`. Those invalidate `remainingUsd`, `projectedTurnUsd`, and
 * `synthesisReserveUsd`, which invalidate `canAffordTurn`, which invalidates
 * `chainStopped`, which invalidates `turnPending` and `synthesisPending`. The
 * engine re-evaluates the two constraints against the new values. While
 * `turnPending` holds, `runTurn` emits again and the chain takes another turn.
 * When it stops holding, `runTurn` emits nothing — `synthesisPending` has taken
 * over, `synthesize` fires once, and its resolver sets `synthesized`, which
 * falsifies that too. No constraint has anything to require, no requirement is
 * unmet, and the system settles. The chain ends by running out of things that
 * must be true.
 *
 * ## Three layers of budget, doing three different jobs
 *
 * - `canAffordTurn` is the **graceful** stop: it refuses to start a turn that
 *   would eat the closing document's money. Predictive, and the layer that
 *   normally ends the run.
 * - `canAffordSynthesis` is the **precise** stop: the synthesizer's `maxTokens`
 *   and the transcript's measured length are both known, so the one call the
 *   chain makes after it has already stopped is checked against what is left
 *   rather than assumed affordable.
 * - `maxTotalCost` on the budget runner is the **hard floor**: no call is
 *   dispatched once the ledger has reached `budgetUsd`, whatever the two
 *   predictions above believed. It cannot fire first — the others stop while
 *   money is left — and when it does fire it means one of them was wrong, which
 *   `budgetHalted` records and `stopReason` reports as `"budget"`.
 *
 * The three used to be one, and it was the wrong one: a reserve of a single
 * *average turn* against a synthesizer that costs five to thirty times a turn,
 * predicted with a trailing mean over a series that only grows, and nothing at
 * all guarding the synthesis call itself.
 *
 * An interrupt is the same cascade entered from a different door: `abort()`
 * sets `interrupted`, `chainStopped` goes true one derivation later, and the
 * chain lands in synthesis by the identical path the budget takes it down. That
 * is the reason it is a fact and not a branch — a branch would need its own
 * answer for whether synthesis still runs, and this has the one answer the rest
 * of the chain already has.
 *
 * ## The one thing that can move mid-turn
 *
 * `interrupted` is the only fact that flips while a turn resolver is in flight,
 * and it flips every derivation downstream of it in the same pass. Left alone,
 * that means the chain declares itself stopped and dispatches the synthesis
 * while the turn is still streaming — and three separate things then read a
 * chain that is in two states at once. The synthesis is authorized against a
 * ledger the in-flight call has not been billed to, so it is affordable when it
 * is not. `run()` resolves off `chain:complete` and reports a total the turn is
 * still adding to. And the synthesizer's prompt is assembled from a transcript
 * that does not have the turn in it, while the markdown artefact ends up with
 * the turn — so the closing document describes a conversation its own transcript
 * contradicts.
 *
 * So there is a second counter. `turnsStarted` moves when a turn is dispatched
 * and `turnsFinished` moves on the resolver's way out — by any door, which is
 * why it is a `finally` and not a line at the bottom of the happy path. The gap
 * between them is `turnInFlight`, and `synthesisPending` requires it closed.
 * Two counters rather than a flag for the reason the composition uses two: a
 * flag has to be cleared on every exit and a counter is written with the same
 * value from wherever it is written.
 *
 * ## Requirement identity
 *
 * A turn requirement is keyed `turn-<iteration>`. Facts wobble — a resolver
 * writes four of them, a derivation recomputes more than once, a constraint is
 * re-evaluated. Typed identity means every one of those re-emissions is
 * recognized as the same requirement and the turn runs once.
 *
 * @module
 */

import { BudgetExceededError, type TokenPricing } from "@directive-run/ai";
import {
  type DefinitionMeta,
  type ModuleSchema,
  createModule,
  t,
} from "@directive-run/core";
import { type HarnessAgents, assertBudgetCoversSynthesis } from "./agents.js";
import type { ChainPhase, HarnessEventSink, StopReason } from "./events.js";
import { assertPreset } from "./preset-registry.js";
import {
  DEFAULT_BUDGET_WARNING_THRESHOLD,
  type PresetConfig,
  renderTemplate,
} from "./preset-types.js";
import {
  canAffordTurn,
  chainStopped,
  projectTurnUsd,
  projectedReserveUsd,
  stopReasonFor,
  synthesisReserveUsd,
} from "./projection.js";
import { fence } from "./safety.js";
import type { Transcript, TurnRecord } from "./transcript.js";

// ============================================================================
// Derived surface
// ============================================================================

/**
 * Everything the chain computes about itself.
 *
 * Exported because it is the module's real interface. A constraint reads these,
 * an effect reads these, and a surface that wants to know why the chain stopped
 * reads `stopReason` rather than reconstructing it from facts.
 */
export interface ChainDerived {
  /** The preset's ceiling, lifted out of the preset fact. */
  budgetUsd: number;
  /** Dollars left, floored at zero. */
  remainingUsd: number;
  /** `spentUsd / budgetUsd`. */
  budgetFraction: number;
  /**
   * What a turn has cost on average so far.
   *
   * Reported, never predicted from. Every turn re-sends the whole transcript,
   * so per-turn cost climbs monotonically and a trailing mean is *always* below
   * the next turn — structurally, not on average. Predicting from this is what
   * let a `$0.10` budget finish at `$0.1094`. See
   * {@link ChainDerived.projectedTurnUsd} for the figure the chain actually
   * stops on.
   *
   * Zero before the first turn, which is the honest answer — nothing has been
   * measured yet.
   */
  averageTurnUsd: number;
  /**
   * What the *next* turn is expected to cost.
   *
   * See `projectTurnUsd` in `./projection.js`, which is where this and every
   * other figure on this interface are computed. The offline replay behind
   * `--list-presets` calls the same functions, so a preset's advertised
   * behaviour and its actual behaviour cannot be two different pieces of
   * arithmetic — which is what they had already become.
   *
   * Before the first turn this is an a-priori figure rather than zero. Zero was
   * the claim that the first turn is free, and the chain authorizes that turn
   * against a reserve computed on it.
   */
  projectedTurnUsd: number;
  /**
   * What the closing document will cost, in dollars.
   *
   * Not estimated from history — computed. The synthesizer's `maxTokens` is a
   * hard ceiling on its output, and the transcript it will read has a length
   * that can be measured right now, so both halves of the bill are known before
   * the call is made. That is the whole reason the reserve was wrong before: it
   * held back one *average turn*, while a synthesizer running at 2500–4000
   * tokens against a `tokensPerTurn` of 450–700, reading the entire transcript,
   * costs five to thirty times that.
   *
   * "Both halves are known" is exact for the output half and a heuristic for
   * the input half — see the note on the four-characters-per-token measure in
   * `./projection.js`, which under-measures code and therefore under-measures
   * the three presets aimed at it.
   *
   * **It prices one attempt, not the retry envelope.** The runner may dispatch
   * the call up to three times and bills each, so a run can finish above its
   * ceiling. That is bounded by the ledger floor rather than by this figure —
   * `./projection.js` sets out why reserving the envelope instead costs far
   * more than it saves — and a run that ends above its ceiling now says so on
   * the event stream.
   */
  synthesisReserveUsd: number;
  /**
   * What the closing document will cost **after one more turn**.
   *
   * {@link ChainDerived.synthesisReserveUsd} prices the transcript that exists
   * right now, which is the correct figure for a synthesis about to run and the
   * wrong one for deciding whether to add a turn first. A turn appends about
   * `tokensPerTurn` to the transcript, and the synthesizer then reads all of it
   * — so authorizing a turn against today's reserve reserves for a document the
   * chain is in the act of making more expensive.
   *
   * The gap is one turn's worth of input on every decision, which is small
   * until the last one, where it is the difference between stopping with the
   * closing document paid for and stopping a few hundredths of a cent short of
   * it. That is not a hypothetical: a preset whose budget is tuned to the run it
   * produces lands exactly there, because the chain is built to spend down to
   * the last affordable turn.
   */
  projectedReserveUsd: number;
  /**
   * Whether there is room for another turn.
   *
   * True while what is left covers the next turn **and** the closing document
   * that turn will leave the chain owing. Both figures are computed rather than
   * averaged — see {@link ChainDerived.projectedTurnUsd} and
   * {@link ChainDerived.projectedReserveUsd} — so the chain stops with the
   * synthesis genuinely paid for rather than with one turn's worth of change in
   * its pocket and a synthesis bill five times that.
   *
   * This is the *graceful* stop. It is a prediction, and a prediction can be
   * wrong; the hard floor underneath it is `maxTotalCost` on the budget runner,
   * which refuses to dispatch anything once the ledger has reached the budget.
   */
  canAffordTurn: boolean;
  /**
   * Whether the closing document can still be paid for.
   *
   * Checked separately from {@link ChainDerived.canAffordTurn} because
   * synthesis runs *after* the chain has already stopped, and the constraint
   * that fires it used to be gated on nothing but "the turns are over". A
   * synthesis that cannot be afforded is not run: a chain that stops without a
   * closing document and says why is better than one that quietly spends past
   * the number it was given.
   */
  canAffordSynthesis: boolean;
  /** Whether the closing document was given up on for want of budget. */
  synthesisSkipped: boolean;
  /** Whether the iteration backstop has been reached. */
  iterationsExhausted: boolean;
  /**
   * Whether a turn has been dispatched and its resolver has not yet exited.
   *
   * The chain can be told to stop while a turn is still streaming — that is
   * what an interrupt is — so "nothing further will start" and "nothing is
   * running" are two different questions, and everything that reads the chain
   * as finished needs both. See the module note.
   */
  turnInFlight: boolean;
  /**
   * Whether the chain is done adding turns, for any reason.
   *
   * **The single termination condition.** Every way the chain can stop is one
   * clause of this expression, and everything downstream — the constraints, the
   * phase, the stop reason — reads it rather than re-deriving its own version.
   */
  chainStopped: boolean;
  /**
   * Why, once `chainStopped` holds; `""` before then.
   *
   * Precedence when several apply at once: the hard budget floor outranks a
   * failure, which outranks an interrupt, which outranks the predicted budget
   * stop, which outranks the iteration ceiling. Ordered most-specific first, so
   * the reported reason is the one that would surprise the operator most.
   *
   * The floor sits at the top because it surfaces as a thrown error, and
   * reporting a run that hit its ceiling as `"error"` is how the two ceilings
   * would come to give different accounts of the same money. It is a budget
   * stop; it says so.
   */
  stopReason: StopReason;
  /** Whose turn it is. Turn order is round-robin over the preset's personas. */
  nextPersona: string;
  /** Whether another turn should run right now. */
  turnPending: boolean;
  /** Whether the closing document should be written right now. */
  synthesisPending: boolean;
  /** Where the chain is, computed from facts rather than assigned. */
  phase: ChainPhase;
}

/**
 * Read one derivation.
 *
 * Constraints and effects receive a facts proxy that does not carry
 * derivations, so they reach them through this. It is pointed at the system
 * running the chain by {@link HarnessChain.bind}, between `createSystem()` and
 * `start()`.
 *
 * Reads through it are still tracked: the binding hands back the system's derive
 * proxy, which registers the access with whatever tracking context is open. A
 * constraint reading `turnPending` this way records a dependency on it and is
 * re-evaluated when it changes, exactly as if it had read a fact.
 */
export type DerivedReader = <K extends keyof ChainDerived>(
  key: K,
) => ChainDerived[K];

// ============================================================================
// Module dependencies
// ============================================================================

export interface HarnessChainDeps {
  preset: PresetConfig;
  runId: string;
  transcript: Transcript;
  agents: HarnessAgents;
  emit: HarnessEventSink;
  now?: () => number;
}

// ============================================================================
// Schema
// ============================================================================

export const chainSchema = {
  facts: {
    /**
     * The whole configuration, as a fact.
     *
     * A fact rather than a closure variable so `system.inspect()` shows which
     * preset drove a run, and so the derivations that read it are invalidated
     * if it is ever replaced.
     */
    preset: t.object<PresetConfig>().meta({
      label: "Preset",
      description: "The JSON configuration driving this chain.",
      category: "config",
    }),
    runId: t.string().meta({ label: "Run ID", category: "config" }),
    input: t.string().meta({ label: "Input", category: "config" }),
    /** Flipped by the `start` event. Nothing happens until it is true. */
    running: t.boolean().meta({ label: "Running", category: "lifecycle" }),
    /** Turns completed. Also the index of the turn about to run. */
    iteration: t.number().meta({ label: "Iteration", category: "chain" }),
    /**
     * Turns dispatched, and turns whose resolver has exited.
     *
     * Two counters rather than a boolean, so the gap between them answers "is a
     * turn in flight" without anyone having to remember to clear a flag on
     * every way out of the resolver — including the ways out that throw.
     * `turnsFinished` rather than `iteration` as the second half, because a
     * failed turn exits without completing, and a chain that read the gap
     * against `iteration` would believe that turn was still running forever.
     */
    turnsStarted: t
      .number()
      .meta({ label: "Turns started", category: "chain" }),
    turnsFinished: t
      .number()
      .meta({ label: "Turns finished", category: "chain" }),
    /** The previous turn's text, for presets whose template references it. */
    previousTurn: t
      .string()
      .meta({ label: "Previous turn", category: "chain" }),
    /** The most recently committed turn. The effects' change signal. */
    lastTurn: t
      .object<TurnRecord>()
      .meta({ label: "Last turn", category: "chain" })
      .nullable(),
    /**
     * Dollars charged so far.
     *
     * Copied from the budget runner's ledger, never computed here. A second
     * cost calculation would be a second answer to the question the budget is
     * enforced against.
     */
    spentUsd: t.number().meta({ label: "Spent (USD)", category: "cost" }),
    /**
     * What the most recent turn cost, and what the one before it cost.
     *
     * Two facts rather than a history array, because the projection only ever
     * looks at the last step: `last + (last - previous)`. Keeping the whole
     * series would be keeping it for a predictor that does not read it.
     */
    lastTurnUsd: t
      .number()
      .meta({ label: "Last turn (USD)", category: "cost" }),
    previousTurnUsd: t
      .number()
      .meta({ label: "Previous turn (USD)", category: "cost" }),
    /**
     * How long the transcript is, in characters, as of the last turn.
     *
     * The measured half of the synthesis reserve. A fact rather than a call to
     * `transcript.text()` from inside a derivation: a derivation reading a
     * mutable object outside the fact store is a value nothing can invalidate
     * it on.
     */
    transcriptChars: t
      .number()
      .meta({ label: "Transcript (chars)", category: "cost" }),
    /**
     * Set when the budget runner's lifetime floor refused a call.
     *
     * The hard ceiling firing means the graceful one mispredicted, so this is
     * worth recording distinctly rather than folding into `failure` — a run
     * that hit its ceiling is a budget stop, and reporting it as an error would
     * be the two ceilings disagreeing about the same money.
     */
    budgetHalted: t
      .boolean()
      .meta({ label: "Budget halted", category: "lifecycle" }),
    /** Set by `abort()`. Read by `chainStopped`, branched on by nothing. */
    interrupted: t
      .boolean()
      .meta({ label: "Interrupted", category: "lifecycle" }),
    synthesis: t.string().meta({ label: "Synthesis", category: "chain" }),
    synthesized: t.boolean().meta({ label: "Synthesized", category: "chain" }),
    /** Set when the synthesizer itself failed — the one unrecoverable outcome. */
    synthesisFailed: t.boolean().meta({
      label: "Synthesis failed",
      category: "lifecycle",
    }),
    /**
     * Set when the budget floor refused the synthesis call itself.
     *
     * Distinct from `synthesisFailed`: nothing went wrong, there was no money.
     * A run that ends this way is `"complete"`, not `"failed"`.
     */
    synthesisRefused: t.boolean().meta({
      label: "Synthesis refused",
      category: "lifecycle",
    }),
    /** A turn resolver's error message, or `""`. */
    failure: t.string().meta({ label: "Failure", category: "lifecycle" }),
    transcriptPath: t.string().meta({ label: "Transcript", category: "io" }),
    jsonlPath: t.string().meta({ label: "Sidecar", category: "io" }),
  },

  derivations: {
    budgetUsd: t.number(),
    remainingUsd: t.number(),
    budgetFraction: t.number(),
    averageTurnUsd: t.number(),
    projectedTurnUsd: t.number(),
    synthesisReserveUsd: t.number(),
    projectedReserveUsd: t.number(),
    canAffordTurn: t.boolean(),
    canAffordSynthesis: t.boolean(),
    synthesisSkipped: t.boolean(),
    iterationsExhausted: t.boolean(),
    turnInFlight: t.boolean(),
    chainStopped: t.boolean(),
    stopReason: t.string<StopReason>(),
    nextPersona: t.string(),
    turnPending: t.boolean(),
    synthesisPending: t.boolean(),
    phase: t.string<ChainPhase>(),
  },

  events: {
    start: { input: t.string() },
    interrupt: {},
  },

  requirements: {
    RUN_TURN: {
      iteration: t.number(),
      persona: t.string(),
      input: t.string(),
      previousTurn: t.string(),
    },
    SYNTHESIZE: {
      iteration: t.number(),
      stopReason: t.string<StopReason>(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

/**
 * The text a run produced.
 *
 * `RunResult.output` is `unknown` — a structured-output agent puts an object
 * there. A chain of prose personas gets a string, and the streamed buffer
 * stands in for a runner that delivered deltas but returned nothing.
 */
function readOutputText(output: unknown, streamed: string): string {
  if (typeof output === "string" && output !== "") {
    return output;
  }
  if (streamed !== "") {
    return streamed;
  }

  return typeof output === "string" ? output : "";
}

/** Merge preset annotations into a definition's own, without losing either. */
function withPresetMeta(
  preset: PresetConfig,
  meta: DefinitionMeta,
): DefinitionMeta {
  const presetTags = preset.meta?.tags ?? [];
  const ownTags = meta.tags ?? [];

  return {
    ...preset.meta,
    ...meta,
    tags: [`preset:${preset.id}`, ...presetTags, ...ownTags],
  };
}

/** Whatever a rejected promise carried, as a sentence. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read a number off an untyped requirement, for the error hook. */
function readIteration(
  requirement: Record<string, unknown>,
): number | undefined {
  const value = requirement.iteration;

  return typeof value === "number" ? value : undefined;
}

/**
 * Whether an error is the budget runner's lifetime floor refusing a call.
 *
 * Checked by name as well as by `instanceof`, and down the `cause` chain,
 * because the error crosses the orchestrator between where it is thrown and
 * where this reads it — and a mis-identified budget stop would be reported as a
 * chain failure, which is the one outcome this distinction exists to prevent.
 * `window === "total"` narrows it to the lifetime floor: a per-call or
 * rolling-window cap tripping is a configuration the chain did not ask for and
 * should still surface as an error.
 */
function isBudgetExhausted(error: unknown): boolean {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth++
  ) {
    const candidate = current as {
      name?: unknown;
      window?: unknown;
      cause?: unknown;
    };
    const isBudgetError =
      current instanceof BudgetExceededError ||
      candidate.name === "BudgetExceededError";

    if (isBudgetError && candidate.window === "total") {
      return true;
    }

    current = candidate.cause;
  }

  return false;
}

// ============================================================================
// Module
// ============================================================================

function buildModule(deps: HarnessChainDeps & { readDerived: DerivedReader }) {
  const { preset, runId, transcript, agents, emit, readDerived } = deps;
  const now = deps.now ?? Date.now;
  const { orchestrator, budgetRunner } = agents;
  // The rates the ledger will bill at, so the reserve and the bill are the same
  // arithmetic. Closed over rather than a fact: they are fixed for the life of
  // the harness, and a derivation reading them cannot go stale on them.
  const pricing: TokenPricing = agents.pricing;
  const warningThreshold =
    preset.budgetWarningThreshold ?? DEFAULT_BUDGET_WARNING_THRESHOLD;

  /**
   * Quoted material, fenced on the way into a prompt.
   *
   * A preset writes its own markup around `{{input}}` — `<change>`, `<artifact>`
   * — and interpolating a value straight into it lets the value close the tag
   * and keep writing as though it were the preset. Fencing rather than escaping:
   * the marker is unguessable and stripped from the body, so the fence holds,
   * and the material arrives byte for byte. Escaping would have rewritten the
   * angle brackets in every artefact this package is pointed at, which for a
   * preset whose job is reading code is a change to the thing under analysis.
   */
  const quote = (tag: string, body: string) =>
    body === "" ? "" : fence(tag, transcript.fenceToken, {}, body);

  /**
   * The last phase announced.
   *
   * An edge detector, not a state machine: it never decides anything, it only
   * keeps the announcement from repeating. The phase itself is derived, and
   * this is a record of what has already been said about it.
   */
  let announcedPhase: ChainPhase = "idle";

  /**
   * Failures already recorded, by identity.
   *
   * {@link recordFailure} has two callers on purpose — the resolver that had
   * the failure, and the hook behind it — and they are handed the same thrown
   * value. Weak, so nothing here keeps an error alive.
   */
  const recordedFailures = new WeakSet<object>();

  /**
   * Copy the ledger into the facts. The `finally` of every resolver that can
   * reach a provider, and the only place `spentUsd` is written.
   *
   * A resolver used to do this itself, inline, at the point it wrote the rest
   * of the turn's facts. That works exactly as long as the call returns. A
   * provider that streams and then throws — a rate limit mid-response, a
   * gateway 502, a truncated body, which is the ordinary failure of a streaming
   * provider — has already been billed for what it delivered, and `withBudget`
   * records that charge. The resolver never reached its fact writes, the error
   * hook wrote `failure` and nothing else, and `spentUsd` stayed at whatever
   * the last *successful* turn left it. A composition then computed the next
   * step's allowance from a run that appeared to have spent nothing, and handed
   * every later step a full budget.
   *
   * The direct fix is one line in the error hook. This is the general one: the
   * copy is attached to the resolver's *exit*, not to any of its outcomes, so
   * no way out of a resolver can skip it — return, throw, or abort.
   *
   * **Why a `finally` written into each resolver rather than a wrapper around
   * them.** A wrapper has to `await` the body, and an `await` is a microtask
   * boundary: the turn's facts would land in one tick and its spend in the
   * next. The module is built on those moving together — the constraints
   * re-evaluate between the two ticks and would authorize the synthesis before
   * the last turn had been announced, and the budget-warning edge detector
   * compares against a snapshot taken between them. A `finally` on the body
   * itself runs in the same synchronous block as the writes above it, which is
   * the property that has to hold. Two lines of duplication buys an invariant
   * the module cannot function without.
   */
  function settleSpend(facts: { spentUsd: number }): void {
    facts.spentUsd = budgetRunner.getSpent("total");
  }

  /**
   * Close a turn out: the ledger, and the counter that says it is no longer
   * running. The `finally` of the turn resolver, for both the reason above and
   * one of its own — a turn that threw has stopped running just as surely as
   * one that returned, and a chain that only learned about the returning kind
   * would wait for it forever.
   */
  function settleTurn(
    facts: { spentUsd: number; turnsFinished: number },
    iteration: number,
  ): void {
    settleSpend(facts);
    facts.turnsFinished = iteration + 1;
  }

  /**
   * Record a resolver failure, in the resolver that had it.
   *
   * A failed turn is recoverable at chain level: the transcript keeps whatever
   * was already written, `failure` makes `chainStopped` true, and the chain cuts
   * over to synthesis on what it has. A failed synthesis is not — there is
   * nothing further to try — so it sets its own fact and the chain lands in
   * `"failed"`. The lifetime budget floor refusing a call is neither: nothing is
   * broken, the run reached the number it was given, and it is recorded as a
   * budget stop so the two ceilings do not give different accounts of the same
   * money.
   *
   * All three also matter for a reason that has nothing to do with reporting:
   * without a fact recording the outcome, the constraint that produced the
   * requirement would still hold, the requirement would still be keyed the same,
   * and the chain would sit with an unmet requirement forever.
   *
   * **Why here and not in a resolver-error hook.** Core offers one, and it is
   * the obvious home for this — one place, both resolvers, no duplication. It
   * runs a tick later, though, and this module is built on the rule stated
   * above {@link settleSpend}: everything a resolver's exit says about the chain
   * has to land in one synchronous block. Split across two ticks, the ledger
   * copy opens a reconcile pass and the failure lands inside it, so the two
   * halves of one exit are read by the chain as two separate events — and the
   * phase they jointly imply is computed from the first half alone.
   *
   * Nothing here reads the ledger, deliberately: a call that streamed and then
   * threw has already been billed for what it delivered, and the `finally`
   * above has already carried that forward.
   */
  function recordFailure(
    facts: {
      budgetHalted: boolean;
      synthesisRefused: boolean;
      synthesisFailed: boolean;
      failure: string;
    },
    error: unknown,
    requirement: { type: "RUN_TURN" | "SYNTHESIZE"; iteration: number },
  ): void {
    // Once per failure, whichever of the two callers gets there first. Writing
    // the same facts twice is free — a fact set to what it already is is not a
    // change — but announcing the same failure twice is a surface showing an
    // operator two errors where one thing went wrong.
    if (typeof error === "object" && error !== null) {
      if (recordedFailures.has(error)) {
        return;
      }
      recordedFailures.add(error);
    }

    const message = describeError(error);
    const scope = requirement.type === "SYNTHESIZE" ? "synthesis" : "turn";
    const report = () => {
      emit({
        type: "error",
        scope,
        message,
        ...(requirement.type === "SYNTHESIZE"
          ? {}
          : { iteration: requirement.iteration }),
        at: now(),
      });
    };

    if (isBudgetExhausted(error)) {
      facts.budgetHalted = true;
      if (requirement.type === "SYNTHESIZE") {
        facts.synthesisRefused = true;
      }
      report();

      return;
    }

    if (requirement.type === "SYNTHESIZE") {
      facts.synthesisFailed = true;
      report();

      return;
    }

    facts.failure = message;
    report();
  }

  return createModule("ai-harness-chain", {
    schema: chainSchema,

    meta: withPresetMeta(preset, {
      label: preset.meta?.label ?? `Chain: ${preset.id}`,
      description:
        preset.meta?.description ??
        "Persona chain over a shared transcript, closed out by a synthesizer.",
      category: "harness",
    }),

    init: (facts) => {
      facts.preset = preset;
      facts.runId = runId;
      facts.input = "";
      facts.running = false;
      facts.iteration = 0;
      facts.turnsStarted = 0;
      facts.turnsFinished = 0;
      facts.previousTurn = "";
      facts.lastTurn = null;
      facts.spentUsd = 0;
      facts.lastTurnUsd = 0;
      facts.previousTurnUsd = 0;
      facts.transcriptChars = 0;
      facts.budgetHalted = false;
      facts.interrupted = false;
      facts.synthesis = "";
      facts.synthesized = false;
      facts.synthesisFailed = false;
      facts.synthesisRefused = false;
      facts.failure = "";
      facts.transcriptPath = transcript.markdownPath;
      facts.jsonlPath = transcript.jsonlPath;
    },

    events: {
      start: (facts, { input }) => {
        facts.input = input;
        facts.running = true;
      },
      /**
       * The entire interrupt implementation.
       *
       * One fact. The derivations do the rest, and a turn already in flight
       * finishes rather than being torn up — the chain interrupts between
       * turns, so the transcript the synthesizer reads is never half a turn.
       */
      interrupt: (facts) => {
        facts.interrupted = true;
      },
    },

    derive: {
      budgetUsd: (facts) => facts.preset.budgetUsd,

      remainingUsd: (facts, derived) =>
        Math.max(0, derived.budgetUsd - facts.spentUsd),

      budgetFraction: (facts, derived) =>
        derived.budgetUsd > 0 ? facts.spentUsd / derived.budgetUsd : 0,

      // Reported, not predicted from. See the field doc on ChainDerived.
      averageTurnUsd: (facts) =>
        facts.iteration > 0 ? facts.spentUsd / facts.iteration : 0,

      // Every figure below comes out of `./projection.js`. Nothing about the
      // chain's stopping arithmetic is written here, because it is also written
      // in the offline replay behind `--list-presets`, and two copies of a
      // stopping rule is two answers to when a preset stops.
      projectedTurnUsd: (facts) =>
        projectTurnUsd(facts.preset, pricing, {
          iteration: facts.iteration,
          lastTurnUsd: facts.lastTurnUsd,
          previousTurnUsd: facts.previousTurnUsd,
          transcriptChars: facts.transcriptChars,
          inputChars: facts.input.length,
        }),

      synthesisReserveUsd: (facts) =>
        synthesisReserveUsd(facts.preset, pricing, {
          transcriptChars: facts.transcriptChars,
          inputChars: facts.input.length,
        }),

      projectedReserveUsd: (facts) =>
        projectedReserveUsd(facts.preset, pricing, {
          transcriptChars: facts.transcriptChars,
          inputChars: facts.input.length,
        }),

      canAffordTurn: (_facts, derived) =>
        canAffordTurn({
          remainingUsd: derived.remainingUsd,
          projectedTurnUsd: derived.projectedTurnUsd,
          projectedReserveUsd: derived.projectedReserveUsd,
        }),

      canAffordSynthesis: (_facts, derived) =>
        derived.remainingUsd >= derived.synthesisReserveUsd,

      iterationsExhausted: (facts) =>
        facts.iteration >= facts.preset.maxIterations,

      turnInFlight: (facts) => facts.turnsStarted > facts.turnsFinished,

      chainStopped: (facts, derived) =>
        chainStopped({
          budgetHalted: facts.budgetHalted,
          failed: facts.failure !== "",
          interrupted: facts.interrupted,
          canAffordTurn: derived.canAffordTurn,
          iterationsExhausted: derived.iterationsExhausted,
        }),

      synthesisSkipped: (facts, derived) =>
        facts.running &&
        derived.chainStopped &&
        !derived.turnInFlight &&
        facts.iteration > 0 &&
        !facts.synthesized &&
        !facts.synthesisFailed &&
        (facts.synthesisRefused || !derived.canAffordSynthesis),

      stopReason: (facts, derived): StopReason =>
        stopReasonFor({
          budgetHalted: facts.budgetHalted,
          failed: facts.failure !== "",
          interrupted: facts.interrupted,
          canAffordTurn: derived.canAffordTurn,
          iterationsExhausted: derived.iterationsExhausted,
        }),

      nextPersona: (facts) => {
        const { personas } = facts.preset;

        return personas[facts.iteration % personas.length]?.name ?? "";
      },

      turnPending: (facts, derived) => facts.running && !derived.chainStopped,

      // The turn in flight is the whole of the interrupt handling. An
      // interrupt flips `chainStopped` while a turn is streaming, and without
      // this clause the synthesis would be authorized against a ledger that
      // call has not been billed to yet and prompted with a transcript that
      // does not contain it. See the module note.
      synthesisPending: (facts, derived) =>
        facts.running &&
        derived.chainStopped &&
        !derived.turnInFlight &&
        facts.iteration > 0 &&
        !facts.synthesized &&
        !facts.synthesisFailed &&
        !derived.synthesisSkipped,

      phase: (facts, derived): ChainPhase => {
        if (!facts.running) {
          return "idle";
        }
        if (facts.synthesisFailed) {
          return "failed";
        }
        // A turn still running is still turn-taking, whatever the stop
        // condition says. Without this an interrupted chain reports itself
        // complete — and closes the run out — while the turn it interrupted is
        // still billing.
        if (!derived.chainStopped || derived.turnInFlight) {
          return "taking-turns";
        }

        return derived.synthesisPending ? "synthesizing" : "complete";
      },
    },

    constraints: {
      /**
       * While another turn should run, one must.
       *
       * The whole decision is `turnPending`. Nothing about budgets, turn
       * order, or interrupts appears here — swapping any of those out is a
       * change to a derivation, and this constraint does not notice.
       */
      runTurn: {
        when: () => readDerived("turnPending"),
        require: (facts) => ({
          type: "RUN_TURN" as const,
          iteration: facts.iteration,
          persona: readDerived("nextPersona"),
          input: facts.input,
          previousTurn: facts.previousTurn,
        }),
        meta: withPresetMeta(preset, {
          label: "Next turn",
          description: "A persona owes the transcript a contribution.",
          category: "chain",
        }),
      },

      /** Once the turns are over and there is something to read, close it out. */
      synthesize: {
        when: () => readDerived("synthesisPending"),
        require: (facts) => ({
          type: "SYNTHESIZE" as const,
          iteration: facts.iteration,
          stopReason: readDerived("stopReason"),
        }),
        meta: withPresetMeta(preset, {
          label: "Closing document",
          description: "The transcript is final and wants a synthesis.",
          category: "chain",
        }),
      },
    },

    resolvers: {
      /**
       * Run one persona's turn.
       *
       * Keyed by iteration, so the engine's typed identity collapses every
       * re-emission of the same turn into one requirement no matter how many
       * times the facts underneath it move.
       *
       * No `retry` here on purpose. Retry is a property of the provider call,
       * and it lives on the runner — one policy, wrapping every agent. A
       * resolver-level retry would re-run the whole turn including the prompt
       * assembly and the transcript bookkeeping, and the two policies would
       * multiply.
       */
      runTurn: {
        requirement: "RUN_TURN",
        key: (req) => `turn-${req.iteration}`,
        // The `finally` is the whole of the failed-turn accounting — see
        // `settleTurn`. A turn that streamed and then threw has been billed
        // for what it delivered, and this is what carries that forward, along
        // with the fact that the turn is no longer running.
        resolve: async (req, context) => {
          const spentBefore = budgetRunner.getSpent("total");
          // Dispatched. `turnInFlight` holds from here until the `finally`
          // below, which is what keeps an interrupt arriving mid-turn from
          // dispatching the synthesis alongside it.
          context.facts.turnsStarted = req.iteration + 1;

          try {
            emit({
              type: "turn:started",
              iteration: req.iteration,
              persona: req.persona,
              at: now(),
            });
            transcript.beginTurn();

            const prompt = renderTemplate(context.facts.preset.promptTemplate, {
              input: quote("subject", req.input),
              persona: req.persona,
              iteration: req.iteration + 1,
              previousTurn: quote("previous-turn", req.previousTurn),
              // Already fenced, one turn at a time — see `Transcript.text`.
              transcript: transcript.text(),
              tokensPerTurn: context.facts.preset.tokensPerTurn,
            });

            const result = await orchestrator.runAgent(req.persona, prompt, {
              signal: context.signal,
              onToken: (token) => {
                transcript.appendToken(token);
                emit({
                  type: "turn:delta",
                  iteration: req.iteration,
                  persona: req.persona,
                  text: token,
                });
              },
              // The runner is about to replay this response from the beginning.
              // Clearing the buffer is what keeps the abandoned attempt out of
              // the transcript; the event is what keeps it off a surface that
              // rendered the deltas.
              onStreamRestart: (reason) => {
                transcript.beginTurn();
                emit({
                  type: "turn:restarted",
                  iteration: req.iteration,
                  persona: req.persona,
                  reason,
                });
              },
            });

            const text = readOutputText(result.output, transcript.pending());
            const spentAfter = budgetRunner.getSpent("total");
            const record = transcript.completeTurn({
              iteration: req.iteration,
              persona: req.persona,
              text,
              costUsd: spentAfter - spentBefore,
              at: now(),
            });

            context.facts.previousTurn = text;
            context.facts.lastTurn = record;
            // The two figures the next-turn projection extrapolates from, and
            // the measured half of the synthesis reserve. All three are what
            // this turn actually cost and actually wrote, read off the ledger
            // and the transcript rather than recomputed.
            context.facts.previousTurnUsd = context.facts.lastTurnUsd;
            context.facts.lastTurnUsd = spentAfter - spentBefore;
            context.facts.transcriptChars = transcript.text().length;
            context.facts.iteration = req.iteration + 1;
          } catch (error) {
            recordFailure(context.facts, error, req);

            throw error;
          } finally {
            settleTurn(context.facts, req.iteration);
          }
        },
        meta: withPresetMeta(preset, {
          label: "Run persona turn",
          category: "chain",
        }),
      },

      /**
       * Read the whole transcript and write the closing document.
       *
       * Reads {@link Transcript.text}, not the file. The file is a mirror
       * written by an effect, and a synthesis that read the mirror would be one
       * unflushed turn behind whenever the two were out of step.
       */
      synthesize: {
        requirement: "SYNTHESIZE",
        key: () => "synthesis",
        // Same `finally`, same reason. A synthesis that streamed half a
        // document and then failed has been billed for it, and a composition
        // reads this step's spend to decide what the next one may have.
        resolve: async (req, context) => {
          try {
            emit({
              type: "synthesis:started",
              iteration: req.iteration,
              stopReason: req.stopReason,
              at: now(),
            });

            const { synthesizer } = context.facts.preset;
            const prompt = renderTemplate(synthesizer.promptTemplate, {
              input: quote("subject", context.facts.input),
              transcript: transcript.text(),
              iterations: req.iteration,
              spentUsd: context.facts.spentUsd.toFixed(4),
              stopReason: req.stopReason,
            });

            const result = await orchestrator.runAgent(
              synthesizer.name,
              prompt,
              {
                signal: context.signal,
                onToken: (token) => {
                  emit({ type: "synthesis:chunk", text: token });
                },
                // The same announcement the turn path makes, for the same
                // reason: the runner is about to replay this response from the
                // beginning, and a surface rendering chunks would otherwise
                // show the abandoned attempt and the real document as one
                // run-on paragraph. Nothing to clear on this side — the
                // synthesis is not buffered into the transcript until it
                // returns — so the event is the whole of it.
                onStreamRestart: (reason) => {
                  emit({ type: "synthesis:restarted", reason });
                },
              },
            );

            const text = readOutputText(result.output, "");
            transcript.setSynthesis(text);

            context.facts.synthesis = text;
            context.facts.synthesized = true;
          } catch (error) {
            recordFailure(context.facts, error, req);

            throw error;
          } finally {
            settleSpend(context.facts);
          }
        },
        meta: withPresetMeta(preset, {
          label: "Synthesize transcript",
          category: "chain",
        }),
      },
    },

    effects: {
      /**
       * Keep the transcript's mirror level with the facts.
       *
       * The input is carried across here rather than set by whoever called
       * `run()`, so a chain driven by dispatching `start` — which is what
       * composing this module into a system you own looks like — gets a
       * transcript header without having to know that a second call was
       * expected of it. The fact is the source; the transcript is the mirror.
       *
       * The flush is fire-and-forget on purpose: nothing reads the artefacts
       * during a run, so a slow sink should not hold up the next turn. The one
       * place the write genuinely has to have landed — the end of the run —
       * awaits it, in the completion effect below.
       *
       * Fire-and-forget is not the same as unwatched. A store is a seam and a
       * seam can reject — a disk that filled, a directory removed under the
       * run — and a rejected promise nobody is holding is an unhandled
       * rejection, which on Node's default settings takes the process down. So
       * the rejection is caught and reported on the one channel this package
       * reports on. The run carries on: the artefacts are a mirror, and a
       * mirror that cannot be written is not a reason to stop the thing it is
       * mirroring.
       */
      mirrorTranscript: {
        deps: ["input", "lastTurn", "synthesis"],
        run: (facts) => {
          transcript.setInput(facts.input);
          void transcript.flush().catch((error: unknown) => {
            emit({
              type: "error",
              scope: "transcript",
              message: describeError(error),
              at: now(),
            });
          });
        },
        meta: { label: "Mirror the transcript", category: "io" },
      },

      /** Announce a finished turn and what it did to the running total. */
      announceTurn: {
        deps: ["lastTurn"],
        run: (facts, prev) => {
          const record = facts.lastTurn;
          if (record === null || prev === null || prev.lastTurn === record) {
            return;
          }

          const budgetUsd = readDerived("budgetUsd");
          const spentUsd = facts.spentUsd;
          const cost = {
            spentUsd,
            budgetUsd,
            remainingUsd: readDerived("remainingUsd"),
            fraction: readDerived("budgetFraction"),
          };

          emit({
            type: "turn:completed",
            iteration: record.iteration,
            persona: record.persona,
            text: record.text,
            costUsd: record.costUsd,
            at: record.at,
          });
          emit({ type: "cost:updated", ...cost });

          // Fires on the crossing, not on every turn above the line. The
          // previous snapshot is what makes that a property of this one read
          // rather than a flag someone has to remember to reset.
          const previousFraction =
            budgetUsd > 0 ? prev.spentUsd / budgetUsd : 0;
          if (
            previousFraction < warningThreshold &&
            cost.fraction >= warningThreshold
          ) {
            emit({
              type: "budget:warning",
              threshold: warningThreshold,
              ...cost,
            });
          }
        },
        meta: { label: "Announce turn", category: "events" },
      },

      /**
       * Announce every phase transition, and close the run out on the last one.
       *
       * Deliberately has no `deps`. The phase is derived from most of the fact
       * set, and repeating that list here would be a second copy of the
       * derivation's dependencies — the kind that stays correct exactly until
       * someone adds a clause to `phase` and not to the list.
       *
       * Nothing is lost by leaving it off. Directive auto-tracks what an
       * effect's body reads, and this body reads `phase`, so the effect ends up
       * depending on the derivation itself and re-runs precisely when it goes
       * stale. One dependency, declared by reading the thing.
       *
       * Which is exactly why every read below happens **before** the one
       * `await`. Auto-tracking is a synchronous stack: it closes when the body
       * returns its promise, and anything the continuation reads afterwards is
       * recorded as a dependency of nothing. Core warns about this now; the
       * shape that keeps the warning honest is to hoist the reads, not to hand
       * back the dependency list this effect exists to avoid keeping.
       */
      announcePhase: {
        run: async (facts) => {
          const phase = readDerived("phase");
          if (phase === announcedPhase) {
            return;
          }

          const from = announcedPhase;
          announcedPhase = phase;

          if (from === "idle") {
            emit({
              type: "chain:started",
              runId: facts.runId,
              input: facts.input,
              personas: facts.preset.personas.map((persona) => persona.name),
              budgetUsd: readDerived("budgetUsd"),
              transcriptPath: facts.transcriptPath,
              jsonlPath: facts.jsonlPath,
              at: now(),
            });
          }

          emit({
            type: "step:complete",
            from,
            to: phase,
            iteration: facts.iteration,
            spentUsd: facts.spentUsd,
          });

          if (phase !== "complete" && phase !== "failed") {
            return;
          }

          // Everything the completion event reports, read before the flush
          // below. Auto-tracking closes at the first `await`, so a read after
          // it registers no dependency — and this effect is deliberately
          // dependency-declared by reading rather than by a `deps` list.
          const stopReason = readDerived("stopReason");
          const synthesisSkipped = readDerived("synthesisSkipped");
          const completion = {
            runId: facts.runId,
            iterations: facts.iteration,
            spentUsd: facts.spentUsd,
            budgetUsd: readDerived("budgetUsd"),
            remainingUsd: readDerived("remainingUsd"),
            fraction: readDerived("budgetFraction"),
            reserveUsd: readDerived("synthesisReserveUsd"),
            synthesis: facts.synthesis,
            transcriptPath: facts.transcriptPath,
            jsonlPath: facts.jsonlPath,
          };

          // Said before the run closes, because a run that went over its
          // ceiling is the one outcome a caller cannot discover for themselves
          // — the phase is `"complete"`, no ceiling reports having fired, and
          // the fraction that knows was computed and thrown away. The overshoot
          // is possible by construction: every ceiling here is a pre-call
          // check, and a pre-call check can only refuse the call after the one
          // that crossed the line.
          if (completion.fraction > 1) {
            emit({
              type: "budget:overrun",
              overshootUsd: completion.spentUsd - completion.budgetUsd,
              spentUsd: completion.spentUsd,
              budgetUsd: completion.budgetUsd,
              remainingUsd: completion.remainingUsd,
              fraction: completion.fraction,
            });
          }

          // Said before the run closes, and said plainly. A missing closing
          // document is the most visible thing about such a run, and without
          // this it is also the least explained.
          if (synthesisSkipped) {
            emit({
              type: "budget:synthesis-skipped",
              reserveUsd: completion.reserveUsd,
              iterations: completion.iterations,
              spentUsd: completion.spentUsd,
              budgetUsd: completion.budgetUsd,
              remainingUsd: completion.remainingUsd,
              fraction: completion.fraction,
            });
          }

          // The one place the mirror has to have landed. Flushes are
          // serialized, so this queues behind whatever the turn effects
          // started and resolves only once the files match memory.
          //
          // And it is the last thing standing between the run and the event
          // that ends it, which is why the failure is caught rather than
          // allowed to propagate. `run()` resolves off `chain:complete`; an
          // effect that threw on its way there would leave a settled chain,
          // a correct ledger, and a caller waiting forever. A store that
          // cannot write is worth reporting and is not worth hanging over.
          try {
            await transcript.flush();
          } catch (error) {
            emit({
              type: "error",
              scope: "transcript",
              message: describeError(error),
              at: now(),
            });
          }

          emit({
            type: "chain:complete",
            runId: completion.runId,
            phase,
            stopReason,
            iterations: completion.iterations,
            spentUsd: completion.spentUsd,
            budgetUsd: completion.budgetUsd,
            synthesis: completion.synthesis,
            synthesisSkipped,
            transcriptPath: completion.transcriptPath,
            jsonlPath: completion.jsonlPath,
            at: now(),
          });
        },
        meta: { label: "Announce phase", category: "events" },
      },
    },

    hooks: {
      /**
       * The backstop, for a throw the resolvers' own `catch` did not see.
       *
       * {@link recordFailure} runs inside each resolver, which is where it has
       * to run — see its note. A resolver that failed somewhere the body cannot
       * reach, or one added later that forgets, would otherwise leave the
       * constraint holding, the requirement keyed the same, and the chain
       * waiting on it forever. Writing the same facts a second time is free:
       * they already hold the values this would give them, and a fact set to
       * what it already is is not a change.
       */
      onResolverError: (error, requirement, context) => {
        recordFailure(context.facts, error, {
          type: requirement.type === "SYNTHESIZE" ? "SYNTHESIZE" : "RUN_TURN",
          iteration: readIteration(requirement) ?? 0,
        });
      },
    },
  });
}

/** The module type, for callers that hold one. */
export type HarnessModule = ReturnType<typeof buildModule>;

// ============================================================================
// The chain, and the one thing it needs from its system
// ============================================================================

/**
 * What {@link HarnessChain.bind} reads off a Directive system.
 *
 * Deliberately structural and deliberately tiny. Every `System` satisfies it,
 * and naming the two members it touches says plainly that binding is a read of
 * the derive proxy and nothing more.
 */
export interface ChainHost {
  /** Directive's system-mode discriminator: `module:` versus `modules:`. */
  readonly _mode: "single" | "namespaced";
  readonly derive: unknown;
}

/**
 * A chain module and the binding that connects it to the system running it.
 *
 * Two things rather than one because of an ordering that cannot be avoided: the
 * module's constraints and effects read derivations, derivations belong to a
 * system, and the system cannot exist until the module does. So the module is
 * built with a reader that is not pointed anywhere yet, and `bind` points it —
 * after `createSystem()`, before `start()`.
 *
 * @example Composed into a system you own
 * ```typescript
 * const chain = createHarnessChain({ preset, runId, transcript, agents, emit });
 *
 * const system = createSystem({
 *   modules: { chain: chain.module, billing: billingModule },
 * });
 *
 * chain.bind(system, "chain");
 * system.start();
 * system.events.chain.start({ input: diff });
 * ```
 */
export interface HarnessChain {
  /** The Directive module. Hand it to `createSystem`. */
  module: HarnessModule;
  /**
   * Point the chain's constraints and effects at the system running them.
   *
   * @param system - The system the module was registered with.
   * @param namespace - The key it was registered under, in the `modules:` form.
   *   Omitted in the `module:` form, where there is no namespace to name.
   *
   * @throws If the system is namespaced and no namespace is given, or if the
   *   namespace names no module. Both are refused loudly here because the
   *   failure they would otherwise cause is silent: a namespaced derive proxy
   *   resolves module names, not derivations, so an unnamespaced read returns
   *   `undefined`, the gating derivation reads falsy, the constraint never
   *   fires, and the chain sits idle with nothing to say about why.
   */
  bind(system: ChainHost, namespace?: string): void;
}

/**
 * Build the chain.
 *
 * Everything the chain needs from the outside world arrives here: the preset,
 * the transcript to write into, the agents to call, and the sink to report on.
 * None of it is constructed in this file, which is what lets the same module run
 * against a provider or a script, and against a filesystem or nothing.
 */
export function createHarnessChain(deps: HarnessChainDeps): HarnessChain {
  // Both checks live here rather than in `createHarnessSystem`, because this is
  // the door every arrangement comes through. A caller composing the module
  // into a system of their own never calls that function, and would otherwise
  // get neither the schema check nor the budget floor.
  const preset = assertPreset(deps.preset, "createHarnessChain(preset)");
  assertBudgetCoversSynthesis(preset, deps.agents.pricing);

  // Bound by `bind` below. Constraints and effects read derivations through
  // this because the facts proxy they are handed does not carry them; the read
  // still goes through the derive proxy, so it is tracked exactly like a fact
  // read.
  const binding: { derived?: ChainDerived } = {};
  const readDerived: DerivedReader = (key) => {
    const derived = binding.derived;
    if (derived === undefined) {
      throw new Error(
        "[ai-harness] a derivation was read before the chain was bound. Call chain.bind(system) — or chain.bind(system, namespace) in the multi-module form — between createSystem() and start().",
      );
    }

    return derived[key];
  };

  return {
    module: buildModule({ ...deps, preset, readDerived }),

    bind(system, namespace) {
      binding.derived = resolveChainDerived(system, namespace);
    },
  };
}

/**
 * The chain's derivations, from either shape of system.
 *
 * `createSystem({ module })` puts them on `system.derive` directly.
 * `createSystem({ modules })` puts a *module name* there and the derivations one
 * level down, so the same read that works in the first shape silently returns
 * `undefined` in the second. Which shape it is, is on the system; which
 * namespace, is not — so it is asked for, checked against the modules the system
 * actually has, and refused by name when it is wrong.
 */
function resolveChainDerived(
  system: ChainHost,
  namespace: string | undefined,
): ChainDerived {
  if (system._mode !== "namespaced") {
    if (namespace !== undefined) {
      throw new Error(
        `[ai-harness] bind() was given the namespace "${namespace}", but this system was built with createSystem({ module }) and has none. Drop the second argument, or build the system with createSystem({ modules: { ${namespace}: chain.module } }).`,
      );
    }

    return system.derive as ChainDerived;
  }

  const derive = system.derive as Record<string, ChainDerived | undefined>;
  const available = Object.keys(derive);

  if (namespace === undefined) {
    throw new Error(
      `[ai-harness] bind() needs the name the chain module was registered under, because this system has more than one module and its derivations are namespaced. Pass chain.bind(system, "<name>") — this system's modules are: ${available.join(", ")}.`,
    );
  }

  const derived = derive[namespace];
  if (derived === undefined) {
    throw new Error(
      `[ai-harness] bind() was given the namespace "${namespace}", which names no module in this system. Its modules are: ${available.join(", ")}.`,
    );
  }

  return derived;
}
