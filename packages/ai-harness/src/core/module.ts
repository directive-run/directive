/**
 * The chain, as a Directive module.
 *
 * This is the file to read. Everything else in the package is a detail in
 * service of it.
 *
 * ## There is no loop
 *
 * A persona chain is the shape most people write as a `while`: run a burst,
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
 * - **Derivations** — what the facts mean. `canAffordBurst`, `chainStopped`,
 *   `burstPending`, `synthesisPending`, `phase`, `stopReason`. Every question
 *   the loop body used to answer inline is one of these, computed in exactly
 *   one place and readable from outside.
 * - **Constraints** — what must happen next. `runBurst` fires while
 *   `burstPending`; `synthesize` fires while `synthesisPending`. Neither knows
 *   anything about budgets, interrupts, or turn order — they read a derivation
 *   and emit a requirement.
 * - **Resolvers** — how it happens. Call the agent, write what came back to
 *   facts. They do not decide whether they should have run.
 * - **Effects** — telling anyone about it. Mirroring the transcript to disk and
 *   emitting the event stream.
 *
 * ## How the chain terminates
 *
 * There is no exit condition anywhere, because there is nothing to exit. A
 * burst resolver writes `spentUsd` and `iteration`. Those invalidate
 * `remainingUsd` and `averageBurstUsd`, which invalidate `canAffordBurst`,
 * which invalidates `chainStopped`, which invalidates `burstPending` and
 * `synthesisPending`. The engine re-evaluates the two constraints against the
 * new values. While `burstPending` holds, `runBurst` emits again and the chain
 * takes another turn. When it stops holding, `runBurst` emits nothing —
 * `synthesisPending` has taken over, `synthesize` fires once, and its resolver
 * sets `synthesized`, which falsifies that too. No constraint has anything to
 * require, no requirement is unmet, and the system settles. The chain ends by
 * running out of things that must be true.
 *
 * An interrupt is the same cascade entered from a different door: `abort()`
 * sets `interrupted`, `chainStopped` goes true one derivation later, and the
 * chain lands in synthesis by the identical path the budget takes it down. That
 * is the reason it is a fact and not a branch — a branch would need its own
 * handling for "interrupted while a burst is in flight" and its own answer for
 * whether synthesis still runs. There is no such code here, and there is
 * nothing for it to get wrong.
 *
 * ## Requirement identity
 *
 * A burst requirement is keyed `burst-<iteration>`. Facts wobble — a resolver
 * writes four of them, a derivation recomputes more than once, a constraint is
 * re-evaluated. Typed identity means every one of those re-emissions is
 * recognized as the same requirement and the burst runs once.
 *
 * @module
 */

import {
  type DefinitionMeta,
  type ModuleSchema,
  createModule,
  t,
} from "@directive-run/core";
import type { HarnessAgents } from "./agents.js";
import type { ChainPhase, HarnessEventSink, StopReason } from "./events.js";
import {
  DEFAULT_BUDGET_WARNING_THRESHOLD,
  type PresetConfig,
  renderTemplate,
} from "./preset-types.js";
import type { BurstRecord, Transcript } from "./transcript.js";

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
   * What a burst has cost on average so far, and therefore what the next one
   * is expected to cost. Zero before the first burst, which is the honest
   * answer — nothing has been measured yet.
   */
  averageBurstUsd: number;
  /**
   * Whether there is room for another burst.
   *
   * Compares what is left against what a burst has actually cost rather than
   * against zero, so the chain stops while it can still pay for the closing
   * document instead of one burst after it can. Self-calibrating: it needs no
   * configured reserve, because the chain measures its own burn as it goes.
   */
  canAffordBurst: boolean;
  /** Whether the iteration backstop has been reached. */
  iterationsExhausted: boolean;
  /**
   * Whether the chain is done adding bursts, for any reason.
   *
   * **The single termination condition.** Every way the chain can stop is one
   * clause of this expression, and everything downstream — the constraints, the
   * phase, the stop reason — reads it rather than re-deriving its own version.
   */
  chainStopped: boolean;
  /**
   * Why, once `chainStopped` holds; `""` before then.
   *
   * Precedence when several apply at once: a failure outranks an interrupt,
   * which outranks the budget, which outranks the iteration ceiling. Ordered
   * most-specific first, so the reported reason is the one that would surprise
   * the operator most.
   */
  stopReason: StopReason;
  /** Whose turn it is. Turn order is round-robin over the preset's personas. */
  nextPersona: string;
  /** Whether another burst should run right now. */
  burstPending: boolean;
  /** Whether the closing document should be written right now. */
  synthesisPending: boolean;
  /** Where the chain is, computed from facts rather than assigned. */
  phase: ChainPhase;
}

/**
 * Read one derivation.
 *
 * Constraints and effects receive a facts proxy that does not carry
 * derivations, so they reach them through this. It is bound to the system after
 * `createSystem` and before `start()` — see `createHarnessSystem`.
 *
 * Reads through it are still tracked: the binding hands back `system.derive`,
 * whose proxy registers the access with whatever tracking context is open. A
 * constraint reading `burstPending` this way records a dependency on it and is
 * re-evaluated when it changes, exactly as if it had read a fact.
 */
export type DerivedReader = <K extends keyof ChainDerived>(
  key: K,
) => ChainDerived[K];

// ============================================================================
// Module dependencies
// ============================================================================

export interface HarnessModuleDeps {
  preset: PresetConfig;
  runId: string;
  transcript: Transcript;
  agents: HarnessAgents;
  emit: HarnessEventSink;
  readDerived: DerivedReader;
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
    /** Bursts completed. Also the index of the burst about to run. */
    iteration: t.number().meta({ label: "Iteration", category: "chain" }),
    /** The previous burst's text, for presets whose template references it. */
    previousBurst: t
      .string()
      .meta({ label: "Previous burst", category: "chain" }),
    /** The most recently committed burst. The effects' change signal. */
    lastBurst: t
      .object<BurstRecord>()
      .meta({ label: "Last burst", category: "chain" })
      .nullable(),
    /**
     * Dollars charged so far.
     *
     * Copied from the budget runner's ledger, never computed here. A second
     * cost calculation would be a second answer to the question the budget is
     * enforced against.
     */
    spentUsd: t.number().meta({ label: "Spent (USD)", category: "cost" }),
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
    /** A burst resolver's error message, or `""`. */
    failure: t.string().meta({ label: "Failure", category: "lifecycle" }),
    transcriptPath: t.string().meta({ label: "Transcript", category: "io" }),
    jsonlPath: t.string().meta({ label: "Sidecar", category: "io" }),
  },

  derivations: {
    budgetUsd: t.number(),
    remainingUsd: t.number(),
    budgetFraction: t.number(),
    averageBurstUsd: t.number(),
    canAffordBurst: t.boolean(),
    iterationsExhausted: t.boolean(),
    chainStopped: t.boolean(),
    stopReason: t.string<StopReason>(),
    nextPersona: t.string(),
    burstPending: t.boolean(),
    synthesisPending: t.boolean(),
    phase: t.string<ChainPhase>(),
  },

  events: {
    start: { input: t.string() },
    interrupt: {},
  },

  requirements: {
    RUN_BURST: {
      iteration: t.number(),
      persona: t.string(),
      input: t.string(),
      previousBurst: t.string(),
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

// ============================================================================
// Module
// ============================================================================

export function createHarnessModule(deps: HarnessModuleDeps) {
  const { preset, runId, transcript, agents, emit, readDerived } = deps;
  const now = deps.now ?? Date.now;
  const { orchestrator, budgetRunner } = agents;
  const warningThreshold =
    preset.budgetWarningThreshold ?? DEFAULT_BUDGET_WARNING_THRESHOLD;

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
      facts.previousBurst = "";
      facts.lastBurst = null;
      facts.spentUsd = 0;
      facts.interrupted = false;
      facts.synthesis = "";
      facts.synthesized = false;
      facts.synthesisFailed = false;
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
       * One fact. The derivations do the rest, and a burst already in flight
       * finishes rather than being torn up — the chain interrupts between
       * turns, so the transcript the synthesizer reads is never half a burst.
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

      averageBurstUsd: (facts) =>
        facts.iteration > 0 ? facts.spentUsd / facts.iteration : 0,

      canAffordBurst: (_facts, derived) =>
        derived.remainingUsd > 0 &&
        derived.remainingUsd >= derived.averageBurstUsd,

      iterationsExhausted: (facts) =>
        facts.iteration >= facts.preset.maxIterations,

      chainStopped: (facts, derived) =>
        facts.failure !== "" ||
        facts.interrupted ||
        !derived.canAffordBurst ||
        derived.iterationsExhausted,

      stopReason: (facts, derived): StopReason => {
        if (!derived.chainStopped) {
          return "";
        }
        if (facts.failure !== "") {
          return "error";
        }
        if (facts.interrupted) {
          return "interrupted";
        }
        if (!derived.canAffordBurst) {
          return "budget";
        }

        return "max-iterations";
      },

      nextPersona: (facts) => {
        const { personas } = facts.preset;

        return personas[facts.iteration % personas.length]?.name ?? "";
      },

      burstPending: (facts, derived) => facts.running && !derived.chainStopped,

      synthesisPending: (facts, derived) =>
        facts.running &&
        derived.chainStopped &&
        facts.iteration > 0 &&
        !facts.synthesized &&
        !facts.synthesisFailed,

      phase: (facts, derived): ChainPhase => {
        if (!facts.running) {
          return "idle";
        }
        if (facts.synthesisFailed) {
          return "failed";
        }
        if (!derived.chainStopped) {
          return "bursting";
        }

        return derived.synthesisPending ? "synthesizing" : "complete";
      },
    },

    constraints: {
      /**
       * While another burst should run, one must.
       *
       * The whole decision is `burstPending`. Nothing about budgets, turn
       * order, or interrupts appears here — swapping any of those out is a
       * change to a derivation, and this constraint does not notice.
       */
      runBurst: {
        when: () => readDerived("burstPending"),
        require: (facts) => ({
          type: "RUN_BURST" as const,
          iteration: facts.iteration,
          persona: readDerived("nextPersona"),
          input: facts.input,
          previousBurst: facts.previousBurst,
        }),
        meta: withPresetMeta(preset, {
          label: "Next burst",
          description: "A persona owes the transcript a contribution.",
          category: "chain",
        }),
      },

      /** Once bursting is over and there is something to read, close it out. */
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
      runBurst: {
        requirement: "RUN_BURST",
        key: (req) => `burst-${req.iteration}`,
        resolve: async (req, context) => {
          emit({
            type: "burst:started",
            iteration: req.iteration,
            persona: req.persona,
            at: now(),
          });
          transcript.beginBurst();

          const spentBefore = budgetRunner.getSpent("total");
          const prompt = renderTemplate(context.facts.preset.promptTemplate, {
            input: req.input,
            persona: req.persona,
            iteration: req.iteration + 1,
            previousBurst: req.previousBurst,
            transcript: transcript.text(),
            tokensPerBurst: context.facts.preset.tokensPerBurst,
          });

          const result = await orchestrator.runAgent(req.persona, prompt, {
            signal: context.signal,
            onToken: (token) => {
              transcript.appendToken(token);
              emit({
                type: "burst:delta",
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
              transcript.beginBurst();
              emit({
                type: "burst:restarted",
                iteration: req.iteration,
                persona: req.persona,
                reason,
              });
            },
          });

          const text = readOutputText(result.output, transcript.pending());
          const spentAfter = budgetRunner.getSpent("total");
          const record = transcript.completeBurst({
            iteration: req.iteration,
            persona: req.persona,
            text,
            costUsd: spentAfter - spentBefore,
            at: now(),
          });

          context.facts.previousBurst = text;
          context.facts.lastBurst = record;
          context.facts.spentUsd = spentAfter;
          context.facts.iteration = req.iteration + 1;
        },
        meta: withPresetMeta(preset, {
          label: "Run persona burst",
          category: "chain",
        }),
      },

      /**
       * Read the whole transcript and write the closing document.
       *
       * Reads {@link Transcript.text}, not the file. The file is a mirror
       * written by an effect, and a synthesis that read the mirror would be one
       * unflushed burst behind whenever the two were out of step.
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
            input: context.facts.input,
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
       * Mirror the transcript to disk.
       *
       * Fire-and-forget on purpose: nothing reads these files during a run, so
       * a slow disk should not hold up the next turn. The one place the write
       * genuinely has to have landed — the end of the run — awaits it, in the
       * completion effect below.
       */
      mirrorTranscript: {
        deps: ["lastBurst", "synthesis"],
        run: () => {
          void transcript.flush();
        },
        meta: { label: "Mirror transcript to disk", category: "io" },
      },

      /** Announce a finished burst and what it did to the running total. */
      announceBurst: {
        deps: ["lastBurst"],
        run: (facts, prev) => {
          const record = facts.lastBurst;
          if (record === null || prev === null || prev.lastBurst === record) {
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
            type: "burst:completed",
            iteration: record.iteration,
            persona: record.persona,
            text: record.text,
            costUsd: record.costUsd,
            at: record.at,
          });
          emit({ type: "cost:updated", ...cost });

          // Fires on the crossing, not on every burst above the line. The
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
        meta: { label: "Announce burst", category: "events" },
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

          // The one place the mirror has to have landed. Flushes are
          // serialized, so this queues behind whatever the burst effects
          // started and resolves only once the files match memory.
          await transcript.flush();

          emit({
            type: "chain:complete",
            runId: facts.runId,
            phase,
            stopReason: readDerived("stopReason"),
            iterations: facts.iteration,
            spentUsd: facts.spentUsd,
            budgetUsd: readDerived("budgetUsd"),
            synthesis: facts.synthesis,
            transcriptPath: facts.transcriptPath,
            jsonlPath: facts.jsonlPath,
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
       * A failed burst is recoverable at chain level: the transcript keeps
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
          scope: "burst",
          message: error.message,
          iteration: readIteration(requirement),
          at: now(),
        });
      },
    },
  });
}

/** The module type, for callers that hold one. */
export type HarnessModule = ReturnType<typeof createHarnessModule>;
