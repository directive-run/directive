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
 *   `synthesized`, and the rest. Nothing but a resolver writes them, and no
 *   fact encodes a decision.
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
 * handling for "interrupted while a turn is in flight" and its own answer for
 * whether synthesis still runs. There is no such code here, and there is
 * nothing for it to get wrong.
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
import {
  CHARS_PER_TOKEN,
  type HarnessAgents,
  assertBudgetCoversSynthesis,
  harnessSystemPrompt,
} from "./agents.js";
import type { ChainPhase, HarnessEventSink, StopReason } from "./events.js";
import { assertPreset } from "./preset-registry.js";
import {
  DEFAULT_BUDGET_WARNING_THRESHOLD,
  type PresetConfig,
  renderTemplate,
} from "./preset-types.js";
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
   * The last turn plus the growth between the last two, floored at the last
   * turn's cost. Prompt growth per turn is roughly constant — each turn
   * appends about `tokensPerTurn` to a transcript every later turn re-sends —
   * so cost grows roughly linearly, and extrapolating the last observed step
   * tracks that. Unlike a mean it can never sit below the last measurement,
   * which is the property that matters: a predictor that under-shoots on a
   * monotone series stops the chain one turn too late, every time.
   *
   * One data point (the first turn) degrades to that turn's cost; zero data
   * points is zero.
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

      projectedTurnUsd: (facts) => {
        if (facts.iteration === 0) {
          return 0;
        }
        if (facts.iteration === 1) {
          return facts.lastTurnUsd;
        }

        // Linear extrapolation of the last observed step, floored at the last
        // turn. Growth is clamped at zero so a turn that happened to come in
        // cheaper than its predecessor does not predict a cheaper one still on
        // a transcript that only ever gets longer.
        const growth = Math.max(0, facts.lastTurnUsd - facts.previousTurnUsd);

        return facts.lastTurnUsd + growth;
      },

      synthesisReserveUsd: (facts) => {
        const { synthesizer } = facts.preset;
        // Everything the synthesizer will be sent: the transcript, the template
        // around it, the original input the template interpolates, and the
        // system prompt — the one that actually goes out, which is the preset's
        // plus the standing notice the harness appends to every voice. Measuring
        // the preset's alone would under-reserve by the length of that notice on
        // every run, which is the difference between affording the closing
        // document and stopping one turn short of it on a budget the chain is
        // designed to spend to the last cent.
        const promptChars =
          facts.transcriptChars +
          synthesizer.promptTemplate.length +
          facts.input.length +
          harnessSystemPrompt(synthesizer.systemPrompt).length;
        const inputTokens = Math.ceil(promptChars / CHARS_PER_TOKEN);

        return (
          (inputTokens / 1_000_000) * pricing.inputPerMillion +
          (synthesizer.maxTokens / 1_000_000) * pricing.outputPerMillion
        );
      },

      // A turn appends about `tokensPerTurn` to the transcript, and the
      // synthesizer reads the transcript — so the turn about to be authorized
      // is also the turn that raises the closing document's bill. Priced at the
      // input rate, which is what re-reading it costs.
      projectedReserveUsd: (facts, derived) =>
        derived.synthesisReserveUsd +
        (facts.preset.tokensPerTurn / 1_000_000) * pricing.inputPerMillion,

      canAffordTurn: (_facts, derived) =>
        derived.remainingUsd > 0 &&
        derived.remainingUsd >=
          derived.projectedTurnUsd + derived.projectedReserveUsd,

      canAffordSynthesis: (_facts, derived) =>
        derived.remainingUsd >= derived.synthesisReserveUsd,

      iterationsExhausted: (facts) =>
        facts.iteration >= facts.preset.maxIterations,

      chainStopped: (facts, derived) =>
        facts.budgetHalted ||
        facts.failure !== "" ||
        facts.interrupted ||
        !derived.canAffordTurn ||
        derived.iterationsExhausted,

      synthesisSkipped: (facts, derived) =>
        facts.running &&
        derived.chainStopped &&
        facts.iteration > 0 &&
        !facts.synthesized &&
        !facts.synthesisFailed &&
        (facts.synthesisRefused || !derived.canAffordSynthesis),

      stopReason: (facts, derived): StopReason => {
        if (!derived.chainStopped) {
          return "";
        }
        if (facts.budgetHalted) {
          return "budget";
        }
        if (facts.failure !== "") {
          return "error";
        }
        if (facts.interrupted) {
          return "interrupted";
        }
        if (!derived.canAffordTurn) {
          return "budget";
        }

        return "max-iterations";
      },

      nextPersona: (facts) => {
        const { personas } = facts.preset;

        return personas[facts.iteration % personas.length]?.name ?? "";
      },

      turnPending: (facts, derived) => facts.running && !derived.chainStopped,

      synthesisPending: (facts, derived) =>
        facts.running &&
        derived.chainStopped &&
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
        if (!derived.chainStopped) {
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
        resolve: async (req, context) => {
          emit({
            type: "turn:started",
            iteration: req.iteration,
            persona: req.persona,
            at: now(),
          });
          transcript.beginTurn();

          const spentBefore = budgetRunner.getSpent("total");
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
          context.facts.spentUsd = spentAfter;
          // The two figures the next-turn projection extrapolates from, and
          // the measured half of the synthesis reserve. All three are what this
          // turn actually cost and actually wrote, read off the ledger and the
          // transcript rather than recomputed.
          context.facts.previousTurnUsd = context.facts.lastTurnUsd;
          context.facts.lastTurnUsd = spentAfter - spentBefore;
          context.facts.transcriptChars = transcript.text().length;
          context.facts.iteration = req.iteration + 1;
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
        resolve: async (req, context) => {
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

          const result = await orchestrator.runAgent(synthesizer.name, prompt, {
            signal: context.signal,
            onToken: (token) => {
              emit({ type: "synthesis:chunk", text: token });
            },
          });

          const text = readOutputText(result.output, "");
          transcript.setSynthesis(text);

          context.facts.synthesis = text;
          context.facts.spentUsd = budgetRunner.getSpent("total");
          context.facts.synthesized = true;
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
       */
      mirrorTranscript: {
        deps: ["input", "lastTurn", "synthesis"],
        run: (facts) => {
          transcript.setInput(facts.input);
          void transcript.flush();
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
          await transcript.flush();

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
       * Every terminal resolver failure, in one place.
       *
       * A failed turn is recoverable at chain level: the transcript keeps
       * whatever was already written, `failure` makes `chainStopped` true, and
       * the chain cuts over to synthesis on what it has. A failed synthesis is
       * not — there is nothing further to try — so it sets its own fact and the
       * chain lands in `"failed"`.
       *
       * Both also matter for a reason that has nothing to do with reporting:
       * without a fact recording the failure, the constraint that produced the
       * requirement would still hold, the requirement would still be keyed the
       * same, and the chain would sit with an unmet requirement forever.
       */
      onResolverError: (error, requirement, context) => {
        // The lifetime floor refused the call. Nothing is broken — the run
        // reached the number it was given — so this is recorded as a budget
        // stop rather than a failure, and the chain lands in `"complete"` with
        // `stopReason: "budget"` however far in it happened.
        if (isBudgetExhausted(error)) {
          context.facts.budgetHalted = true;
          if (requirement.type === "SYNTHESIZE") {
            context.facts.synthesisRefused = true;
          }
          emit({
            type: "error",
            scope: requirement.type === "SYNTHESIZE" ? "synthesis" : "turn",
            message: error.message,
            iteration: readIteration(requirement),
            at: now(),
          });

          return;
        }

        if (requirement.type === "SYNTHESIZE") {
          context.facts.synthesisFailed = true;
          emit({
            type: "error",
            scope: "synthesis",
            message: error.message,
            at: now(),
          });

          return;
        }

        context.facts.failure = error.message;
        emit({
          type: "error",
          scope: "turn",
          message: error.message,
          iteration: readIteration(requirement),
          at: now(),
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
