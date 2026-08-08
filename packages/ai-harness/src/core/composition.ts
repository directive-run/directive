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
 * ## This is a module, for the same reasons the chain is
 *
 * It was a `for` loop with a `break`, two mutable flags, and a running total,
 * which is exactly the shape `./module.js` argues against — and it had the same
 * defects that shape always has. "Is the ceiling used up" was a `let` assigned
 * at one `break` site, so nothing outside the loop could read it and no second
 * reason to stop could be added without editing the body. "Was this
 * interrupted" was a flag written in three places: once from the signal's
 * initial state, once from its listener, once from a step's own stop reason.
 * And a step's spend reached the ceiling check only if the loop remembered to
 * add it.
 *
 * Here the same driver is facts for where the composition is, derivations for
 * what that means, one constraint for what must happen next, and one resolver
 * that runs a step. `budgetExhausted` is a derivation — steps remain and none
 * is affordable — rather than a flag somebody sets on the way out. A caller
 * holding the system can read `remainingUsd` mid-run. Adding a stop condition
 * is one clause of `compositionStopped`.
 *
 * The step *is* still a whole other Directive system, built and destroyed
 * inside the resolver. That is not a nesting problem, it is what a resolver is
 * for: the chain's turn resolver calls a provider, and this one calls a chain.
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

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { minimumStepBudgetUsd, resolvePresetPricing } from "./agents.js";
import { awaitCompletion } from "./completion.js";
import type { HarnessEventSink } from "./events.js";
import { createEventFanOut } from "./fan-out.js";
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
  /**
   * Every step's spend, summed.
   *
   * Not bounded by {@link CompositionResult.budgetUsd}, and it used to say it
   * was. The ceiling decides whether the *next* step may start, which is the
   * only decision a composition gets to make about money — a step already
   * running is governed by its own harness, and a harness is itself bounded by
   * a pre-call ledger check that can be crossed by the call it was checked
   * against. Two layers of "refuse the next one" cannot add up to "the total
   * never exceeds", and a caller who needs the total to hold should set
   * `totalBudgetUsd` with room for a step to overshoot rather than read this
   * figure as a guarantee.
   */
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
   * A step's failure message, or `""`.
   *
   * A step can fail outright — its harness could not be built, or its run was
   * torn down — and when one does the composition stops there. The steps in
   * {@link CompositionResult.steps} are whole; this is why there are no more of
   * them. It is on the result as well as on the event stream so a caller
   * holding only the promise is not the last to know.
   */
  failure: string;
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
// The module
// ============================================================================

/** Everything the composition computes about itself. */
interface CompositionDerived {
  /** Dollars left of the composition's ceiling, floored at zero. */
  remainingUsd: number;
  /** Whether every preset has had its turn. */
  stepsExhausted: boolean;
  /**
   * The least the next step needs to be worth starting: its closing document
   * plus one turn. Zero once there is no next step.
   *
   * Below this there is no step worth running — it could buy a turn or two but
   * not the closing document that makes them useful to the next step, and a
   * step whose synthesis is skipped contributes nothing downstream.
   */
  nextStepFloorUsd: number;
  /** Whether what is left can pay for the next step. */
  canAffordStep: boolean;
  /**
   * Whether the ceiling ran out with steps still to run.
   *
   * A derivation, not a flag. It used to be a `let` set at the one `break` that
   * noticed, which meant it was only ever true if that particular exit was
   * taken — and a second reason to stop would have had to remember to set it.
   */
  budgetExhausted: boolean;
  /** Whether the composition is done starting steps, for any reason. */
  compositionStopped: boolean;
  /**
   * Whether a step has been started and has not yet reported.
   *
   * The composition can be told to stop while a step is still running — that
   * is what an interrupt is — and the step still finishes and still
   * synthesizes. So "nothing further will start" and "nothing is running" are
   * two different questions, and closing the composition needs both.
   */
  stepInFlight: boolean;
  /** Whether a step failed outright, which ends the composition. */
  failed: boolean;
  /** Whether another step should start right now. */
  stepPending: boolean;
  /** Whether the composition is finished and can be written up. */
  compositionSettled: boolean;
}

/** Read one derivation. Pointed at the system between build and start. */
type ReadDerived = <K extends keyof CompositionDerived>(
  key: K,
) => CompositionDerived[K];

const compositionSchema = {
  facts: {
    runId: t.string().meta({ label: "Run ID", category: "config" }),
    input: t.string().meta({ label: "Input", category: "config" }),
    /** Flipped by the `start` event. Nothing happens until it is true. */
    running: t.boolean().meta({ label: "Running", category: "lifecycle" }),
    /** Steps completed. Also the index of the step about to run. */
    step: t.number().meta({ label: "Step", category: "chain" }),
    /**
     * Steps dispatched, and steps whose resolver has exited.
     *
     * Two counters rather than a boolean, so the gap between them is the
     * answer to "is a step in flight" rather than a flag somebody has to
     * remember to clear on every way out of the resolver.
     *
     * `stepsSettled` rather than {@link step} as the second half, because a
     * step that threw exits without completing. Read against `step`, a step
     * whose harness could not even be built — a transcript already at the
     * file it was going to write, a derived run ID one character too long —
     * left the gap open forever, and a composition that believes a step is
     * still running never writes itself up. The counter is moved from a
     * `finally`, so every way out of the resolver closes it.
     */
    stepsStarted: t
      .number()
      .meta({ label: "Steps started", category: "chain" }),
    stepsSettled: t
      .number()
      .meta({ label: "Steps settled", category: "chain" }),
    /**
     * A step resolver's error message, or `""`.
     *
     * A step that failed ends the composition rather than being retried or
     * skipped: the next step's whole reason to exist is reading this one's
     * conclusion, and there is no conclusion. Recorded as a fact for the same
     * reason the chain records its own — without it the constraint that
     * produced the requirement would still hold, the requirement would still
     * be keyed the same, and the composition would sit with an unmet
     * requirement forever.
     */
    failure: t.string().meta({ label: "Failure", category: "lifecycle" }),
    /** The composition's ceiling, across every step. */
    budgetUsd: t.number().meta({ label: "Budget (USD)", category: "cost" }),
    /** Every finished step's spend, summed. */
    spentUsd: t.number().meta({ label: "Spent (USD)", category: "cost" }),
    /**
     * Set by `abort()` and by a step that reported an interrupt of its own.
     *
     * One fact rather than three assignments. An interrupt inside a step ends
     * the composition, not just that step — the operator asked the run to stop,
     * and carrying on into the next preset would answer a question they had
     * already withdrawn.
     */
    interrupted: t
      .boolean()
      .meta({ label: "Interrupted", category: "lifecycle" }),
    /** The most recently finished step. The effects' change signal. */
    lastStep: t
      .object<CompositionStepResult>()
      .meta({ label: "Last step", category: "chain" })
      .nullable(),
    /** Where the combined document landed. Written once, at the end. */
    combinedPath: t.string().meta({ label: "Combined", category: "io" }),
    /** Set once the combined document has been written and announced. */
    closed: t.boolean().meta({ label: "Closed", category: "lifecycle" }),
  },

  derivations: {
    remainingUsd: t.number(),
    stepsExhausted: t.boolean(),
    stepInFlight: t.boolean(),
    failed: t.boolean(),
    compositionSettled: t.boolean(),
    nextStepFloorUsd: t.number(),
    canAffordStep: t.boolean(),
    budgetExhausted: t.boolean(),
    compositionStopped: t.boolean(),
    stepPending: t.boolean(),
  },

  events: {
    start: { input: t.string() },
    interrupt: {},
  },

  requirements: {
    RUN_STEP: {
      step: t.number(),
      presetId: t.string(),
    },
  },
} satisfies ModuleSchema;

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
  // One fan-out, subscribed to the same way a surface subscribes. The promise
  // this function returns resolves off the event stream rather than off a
  // second completion signal, so it cannot resolve on a different notion of
  // "done" than the caller is watching. Shared with the chain, which is what
  // keeps a listener that throws from stranding the step counter — see
  // `./fan-out.js`.
  const { listeners, emit } = createEventFanOut(now, onEvent);

  const budgetUsd =
    totalBudgetUsd ??
    presets.reduce((total, preset) => total + preset.budgetUsd, 0);

  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new Error(
      `[ai-harness] runComposition needs a positive totalBudgetUsd — got ${String(totalBudgetUsd)}.`,
    );
  }

  // The two growing records, held beside the facts rather than in them — the
  // same arrangement the chain uses for its transcript. A fact is where the
  // composition *is*; these are what it has produced, and `lastStep` is the
  // fact that says one of them moved.
  const steps: CompositionStepResult[] = [];
  const prior: PriorSynthesis[] = [];

  /** The step in flight, for an abort that arrives while one is running. */
  let running: Harness | undefined;

  const binding: { derived?: CompositionDerived } = {};
  const readDerived: ReadDerived = (key) => {
    const derived = binding.derived;
    if (derived === undefined) {
      throw new Error(
        "[ai-harness] a composition derivation was read before the system was built.",
      );
    }

    return derived[key];
  };

  /** The floor for a step, or zero when there is no next step. */
  const floorFor = (index: number): number => {
    const preset = presets[index];
    if (preset === undefined) {
      return 0;
    }

    return minimumStepBudgetUsd(
      preset,
      resolvePresetPricing(preset, rest.pricing),
    );
  };

  const module = createModule("ai-harness-composition", {
    schema: compositionSchema,

    meta: {
      label: "Composition",
      description:
        "Several presets run end to end, each reading what the last one concluded.",
      category: "harness",
    },

    init: (facts) => {
      facts.runId = runId;
      facts.input = "";
      facts.running = false;
      facts.step = 0;
      facts.stepsStarted = 0;
      facts.stepsSettled = 0;
      facts.failure = "";
      facts.budgetUsd = budgetUsd;
      facts.spentUsd = 0;
      // An already-aborted signal is the same fact as one aborted mid-run,
      // recorded at the only moment it can be: before anything starts.
      facts.interrupted = signal?.aborted === true;
      facts.lastStep = null;
      facts.combinedPath = "";
      facts.closed = false;
    },

    events: {
      start: (facts, event) => {
        facts.input = event.input;
        facts.running = true;
      },
      interrupt: (facts) => {
        facts.interrupted = true;
      },
    },

    derive: {
      remainingUsd: (facts) => Math.max(0, facts.budgetUsd - facts.spentUsd),

      stepsExhausted: (facts) => facts.step >= presets.length,

      nextStepFloorUsd: (facts) => floorFor(facts.step),

      canAffordStep: (_facts, derived) =>
        !derived.stepsExhausted &&
        derived.remainingUsd >= derived.nextStepFloorUsd,

      budgetExhausted: (_facts, derived) =>
        !derived.stepsExhausted && !derived.canAffordStep,

      failed: (facts) => facts.failure !== "",

      compositionStopped: (facts, derived) =>
        derived.failed ||
        facts.interrupted ||
        derived.stepsExhausted ||
        !derived.canAffordStep,

      stepInFlight: (facts) => facts.stepsStarted > facts.stepsSettled,

      stepPending: (facts, derived) =>
        facts.running && !derived.compositionStopped && !derived.stepInFlight,

      compositionSettled: (facts, derived) =>
        facts.running && derived.compositionStopped && !derived.stepInFlight,
    },

    constraints: {
      /**
       * While another step should start, one must.
       *
       * The whole decision is `stepPending`. Nothing about budgets, interrupts,
       * or step order appears here.
       */
      runStep: {
        when: () => readDerived("stepPending"),
        require: (facts) => ({
          type: "RUN_STEP" as const,
          step: facts.step,
          presetId: presets[facts.step]?.id ?? "",
        }),
        meta: { label: "Next step", category: "chain" },
      },
    },

    resolvers: {
      /**
       * Run one preset, end to end, and report what it cost.
       *
       * Keyed by index, so every re-emission of the same step collapses into
       * one requirement however many times the facts underneath it move.
       */
      runStep: {
        requirement: "RUN_STEP",
        key: (req) => `step-${req.step}`,
        resolve: async (req, context) => {
          const preset = presets[req.step];
          if (preset === undefined) {
            return;
          }

          const step = req.step + 1;
          const stepRunId = `${context.facts.runId}-${step}-${preset.id}`;
          const stepMeta = { step, total: presets.length, presetId: preset.id };
          /**
           * What this step has been billed, whatever happens next.
           *
           * Accumulated in the `finally` rather than after the `await`, for
           * the reason the chain settles its own ledger in one: a step that
           * streamed and then threw has been charged for what it delivered,
           * and the composition's ceiling is enforced against the sum of these.
           * Adding it on the success path alone let a failing step spend and
           * then hand the next one a ceiling that had not moved.
           */
          let stepSpentUsd = 0;

          // What this step may spend: its own budget, or whatever is left of
          // the composition's, whichever is smaller. The clamp is a no-op on
          // the default ceiling — the sum of the steps' own budgets — and is
          // the whole mechanism when a caller sets one.
          const remainingUsd = readDerived("remainingUsd");
          const stepPreset: PresetConfig =
            remainingUsd < preset.budgetUsd
              ? { ...preset, budgetUsd: remainingUsd }
              : preset;

          let harness: Harness | undefined;

          // Dispatched, with nothing between the counter and the `try` that
          // closes it. `stepInFlight` holds from here until the `finally`,
          // which is what keeps the composition from writing itself up while a
          // step it interrupted is still synthesizing — and what keeps it from
          // waiting forever on a step that never got as far as running. Every
          // statement that can throw therefore sits inside, including the
          // announcement: an event fan-out that let a listener's throw out used
          // to strand this counter open, and a stranded counter is the one
          // failure the completion watchdog cannot see, because its own quiet
          // test reads it.
          context.facts.stepsStarted = req.step + 1;

          try {
            emit({
              type: "composition:step:started",
              ...stepMeta,
              runId: stepRunId,
              at: now(),
            });

            // Building a harness is one of the things that can fail — an
            // output directory already holding this step's transcript, a
            // derived run ID over the identifier limit — and the counter above
            // is already open by the time it does.
            harness = createHarnessSystem(stepPreset, {
              ...rest,
              transcripts: store,
              runId: stepRunId,
              onEvent: emit,
            });
            running = harness;

            const result = await harness.run(
              composeInput(context.facts.input, prior, fenceToken),
            );
            const stepResult: CompositionStepResult = {
              ...result,
              ...stepMeta,
            };
            steps.push(stepResult);
            if (result.synthesis !== "") {
              prior.push({ step, presetId: preset.id, text: result.synthesis });
            }

            context.facts.lastStep = stepResult;
            context.facts.step = req.step + 1;
            // The step said an operator stopped it, which stops the
            // composition too — written as the same fact `abort()` writes, not
            // as a second way of saying it.
            if (result.stopReason === "interrupted") {
              context.facts.interrupted = true;
            }
          } finally {
            running = undefined;
            if (harness !== undefined) {
              stepSpentUsd = harness.spentUsd();
            }
            // Both counters written before the step is torn down, because
            // `destroy()` is the one call left in this block that can throw and
            // the composition cannot survive losing them: an unwritten
            // `stepsSettled` leaves `stepInFlight` true for good, which stops
            // the composition settling and blinds the watchdog to it. Tearing
            // the step down after they land costs nothing — the ledger read
            // above is the only thing that needed the harness alive.
            context.facts.spentUsd = context.facts.spentUsd + stepSpentUsd;
            context.facts.stepsSettled = req.step + 1;
            harness?.system.destroy();
          }
        },
        meta: { label: "Run composition step", category: "chain" },
      },
    },

    hooks: {
      /**
       * A step that could not run, in one place.
       *
       * Without this the failure is invisible and terminal at once. Core's
       * default recovery for a resolver that threw is to skip it, and it
       * surfaces the error to plugins — of which this system deliberately has
       * none — so a step whose harness could not be built, or whose run
       * rejected, left a composition that had emitted a `composition:step:started`
       * and would emit nothing further. The fact recorded here is what ends
       * the composition and what the combined document reports; the event is
       * what a surface renders.
       *
       * A failed step ends the composition rather than being skipped, because
       * every later step's input is the earlier steps' conclusions and there is
       * no conclusion to pass on.
       */
      onResolverError: (error, _requirement, context) => {
        context.facts.failure = error.message;
        emit({
          type: "error",
          scope: "step",
          message: error.message,
          at: now(),
        });
      },
    },

    effects: {
      /** Announce a finished step. */
      announceStep: {
        deps: ["lastStep"],
        run: (facts, previous) => {
          const finished = facts.lastStep;
          if (
            finished === null ||
            previous === null ||
            previous.lastStep === finished
          ) {
            return;
          }

          emit({
            type: "composition:step:complete",
            step: finished.step,
            total: presets.length,
            presetId: finished.presetId,
            runId: finished.runId,
            stopReason: finished.stopReason,
            iterations: finished.iterations,
            spentUsd: finished.spentUsd,
            synthesis: finished.synthesis,
            transcriptPath: finished.transcriptPath,
            jsonlPath: finished.jsonlPath,
            at: now(),
          });
        },
        meta: { label: "Announce step", category: "events" },
      },

      /**
       * Close the composition out once nothing further will start.
       *
       * Deliberately has no `deps` — it reads `compositionStopped`, which is
       * derived from most of the fact set, and repeating that list here would
       * be a second copy of the derivation's dependencies. Every read happens
       * before the one `await`, because auto-tracking closes when the body
       * returns its promise.
       */
      close: {
        run: async (facts) => {
          if (facts.closed || !readDerived("compositionSettled")) {
            return;
          }
          facts.closed = true;

          const budgetExhausted = readDerived("budgetExhausted");
          const composedRunId = facts.runId;
          const composedInput = facts.input;
          const spentUsd = facts.spentUsd;

          // Said before the composition closes: the step that did *not* start,
          // and what it would have needed. What ran before it is whole — this
          // is not a partial step, it is a step declined.
          if (budgetExhausted) {
            emit({
              type: "composition:budget-exhausted",
              runId: composedRunId,
              step: facts.step + 1,
              total: presets.length,
              presetId: presets[facts.step]?.id ?? "",
              spentUsd,
              budgetUsd: facts.budgetUsd,
              requiredUsd: readDerived("nextStepFloorUsd"),
              at: now(),
            });
          }

          // Through the same store every step's transcript went through, so
          // containment — and whether there is a filesystem here at all — is
          // decided in one place rather than asserted again by a second writer
          // that has to remember the rule.
          //
          // Caught, because this is the last thing between the composition and
          // the event that ends it. `runComposition` resolves off
          // `composition:complete`, and `closed` above means this effect will
          // not be entered a second time — so a store that rejected here used
          // to leave a settled system, a correct ledger, every step's own
          // transcript already on disk, and a caller waiting forever for the
          // index of them.
          let combinedPath = "";
          try {
            combinedPath = await store.writeDocument(
              `${composedRunId}.md`,
              renderCombined(composedRunId, composedInput, steps),
            );
          } catch (error) {
            emit({
              type: "error",
              scope: "transcript",
              message: error instanceof Error ? error.message : String(error),
              at: now(),
            });
          }
          facts.combinedPath = combinedPath;

          emit({
            type: "composition:complete",
            runId: composedRunId,
            steps: steps.length,
            spentUsd,
            budgetUsd: facts.budgetUsd,
            combinedPath,
            interrupted: facts.interrupted,
            budgetExhausted,
            at: now(),
          });
        },
        meta: { label: "Close the composition", category: "events" },
      },
    },
  });

  const system = createSystem({ module });
  binding.derived = system.derive as unknown as CompositionDerived;
  system.start();

  const onAbort = () => {
    system.dispatch({ type: "interrupt" });
    running?.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const finished = new Promise<void>((resolve) => {
    const onComplete: HarnessEventSink = (event) => {
      if (event.type === "composition:complete") {
        listeners.delete(onComplete);
        resolve();
      }
    };
    listeners.add(onComplete);
  });

  try {
    // Emitted here rather than from an effect, because it reports what the
    // composition was *asked* to do — which is known before a fact moves, and
    // is the one thing about the run that no state describes.
    emit({
      type: "composition:started",
      runId,
      presets: presets.map((preset) => preset.id),
      input,
      at: now(),
    });
    system.dispatch({ type: "start", input });
    // Backed by the system's own settlement, so a cascade that stops short of
    // the completion event ends the wait with what the composition was doing
    // rather than with a hang. See `./completion.js`.
    await awaitCompletion(
      finished,
      system,
      // The step constraint stops holding the moment a step is dispatched, so
      // the engine lets go of a resolver that is still running. `stepInFlight`
      // is the composition's own answer, and it is the one that counts.
      () => system.isSettled && !readDerived("stepInFlight"),
      () =>
        `[ai-harness] composition "${runId}" stopped without finishing. The system has nothing left to do — no step in flight, no reconcile pending — and no composition:complete was emitted. ${steps.length} of ${presets.length} steps ran, $${system.facts.spentUsd.toFixed(4)} of $${budgetUsd.toFixed(4)} spent${system.facts.failure === "" ? "" : `, last failure: ${system.facts.failure}`}.`,
    );

    // Read while the system is still alive, and read from the derivation
    // rather than reconstructed: `budgetExhausted` is one expression, and this
    // is a report of it rather than a second opinion about it.
    return {
      runId,
      steps,
      spentUsd: system.facts.spentUsd,
      budgetUsd,
      synthesis: steps.at(-1)?.synthesis ?? "",
      combinedPath: system.facts.combinedPath,
      interrupted: system.facts.interrupted,
      failure: system.facts.failure,
      budgetExhausted: readDerived("budgetExhausted"),
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    system.destroy();
  }
}
