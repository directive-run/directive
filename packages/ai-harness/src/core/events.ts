/**
 * The one event union every surface renders from.
 *
 * The CLI, the SDK, and (later) MCP and HTTP all read this and nothing else.
 * That is the whole point of the file: a surface that needs a field the union
 * does not carry is a signal to widen the union, never to reach past it into
 * the module's facts. Facts are the chain's private state; these events are its
 * public account of itself.
 *
 * Nothing here is surface-specific. There are no ANSI codes, no HTML, no
 * `Response` objects, no formatting decisions of any kind — a phase name and a
 * dollar figure, not "◆ synthesizing… ($1.23)". Rendering belongs to whoever
 * consumes the event.
 *
 * @module
 */

// ============================================================================
// Chain vocabulary
// ============================================================================

/**
 * Where the chain currently is.
 *
 * Every value is *derived* from facts rather than assigned — see
 * `ChainDerived.phase` in `./module.js`. Nothing writes a phase, so no code
 * path can put the chain in a phase its facts do not justify.
 */
export type ChainPhase =
  /** Nothing has been asked of the chain yet. */
  | "idle"
  /** Personas are taking turns. */
  | "bursting"
  /** Bursting is over; the synthesizer is producing the closing document. */
  | "synthesizing"
  /** The chain finished — with or without a synthesis, depending on `stopReason`. */
  | "complete"
  /** The synthesizer itself failed, so there is no closing document. */
  | "failed";

/**
 * Why the chain stopped adding bursts.
 *
 * `""` while it has not stopped. The precedence when several apply at once is
 * fixed and documented on the `stopReason` derivation: a failure outranks an
 * interrupt, which outranks the budget, which outranks the iteration ceiling.
 */
export type StopReason =
  | ""
  /** A burst resolver threw and the chain cut over to synthesis early. */
  | "error"
  /** An operator called `abort()`. */
  | "interrupted"
  /** The next burst could not be paid for out of what was left. */
  | "budget"
  /** The configured iteration ceiling was reached. */
  | "max-iterations";

/** Which part of the chain an error came from. */
export type ErrorScope = "burst" | "synthesis";

/**
 * Which step of a composition is speaking.
 *
 * A composition runs several presets end to end, and every one of them emits
 * the ordinary chain events. A surface rendering a composition needs to know
 * which step a `burst:completed` belongs to — and it can, because the steps are
 * strictly sequential and each is bracketed by a `composition:step:started` and
 * a `composition:step:complete`. The bracket carries the attribution, so the
 * events inside it do not have to and stay identical to a single run's.
 */
export interface CompositionStep {
  /** One-based position in the composition. */
  step: number;
  /** How many steps the composition has in total. */
  total: number;
  /** The preset driving this step. */
  presetId: string;
  /** The run ID of this step's own chain, and the stem of its transcript files. */
  runId: string;
}

// ============================================================================
// Events
// ============================================================================

/** A burst that ran to completion and is now part of the transcript. */
export interface BurstSummary {
  /** Zero-based index of this burst in the chain. */
  iteration: number;
  /** The persona that produced it, by agent name. */
  persona: string;
  /** The burst's full text. */
  text: string;
  /** What this burst added to the running total, in dollars. */
  costUsd: number;
  /** Wall-clock ms at completion. */
  at: number;
}

/** Everything the chain spent and everything it has left, in one shape. */
export interface CostSnapshot {
  /** Dollars charged so far, straight from the budget runner's ledger. */
  spentUsd: number;
  /** The chain's ceiling, in dollars. */
  budgetUsd: number;
  /** `budgetUsd - spentUsd`, floored at zero. */
  remainingUsd: number;
  /** `spentUsd / budgetUsd`, in `[0, 1+]`. */
  fraction: number;
}

export type HarnessEvent =
  /** The chain accepted an input and is about to run its first burst. */
  | {
      type: "chain:started";
      runId: string;
      input: string;
      personas: string[];
      budgetUsd: number;
      transcriptPath: string;
      jsonlPath: string;
      at: number;
    }
  /** A persona is about to speak. No text yet. */
  | {
      type: "burst:started";
      iteration: number;
      persona: string;
      at: number;
    }
  /**
   * One provider delta for the burst in flight.
   *
   * Not in the same category as the other events: it is the only one with no
   * fact behind it, because a half-arrived burst is not chain state. A surface
   * that only wants finished text can ignore it entirely and read
   * `burst:completed`.
   */
  | {
      type: "burst:delta";
      iteration: number;
      persona: string;
      text: string;
    }
  /**
   * The burst in flight is starting over — a retry, a fallback, or a schema
   * re-ask replayed it — so every `burst:delta` already delivered for this
   * iteration is void.
   *
   * Its only job is to keep a surface that renders deltas from showing two
   * attempts end to end as one run-on burst. It travels with `burst:delta`
   * because a consumer of one is always a consumer of the other.
   */
  | {
      type: "burst:restarted";
      iteration: number;
      persona: string;
      reason: string;
    }
  /** A burst finished and is now in the transcript. */
  | {
      type: "burst:completed";
      iteration: number;
      persona: string;
      text: string;
      costUsd: number;
      at: number;
    }
  /** The running total moved. */
  | ({ type: "cost:updated" } & CostSnapshot)
  /**
   * Spend crossed the configured warning fraction of the budget. Fires once
   * per run, on the crossing — not on every burst above the line.
   */
  | ({ type: "budget:warning"; threshold: number } & CostSnapshot)
  /** The synthesizer is about to read the transcript. */
  | {
      type: "synthesis:started";
      iteration: number;
      stopReason: StopReason;
      at: number;
    }
  /** One provider delta of the closing document. */
  | {
      type: "synthesis:chunk";
      text: string;
    }
  /**
   * The chain moved from one phase to the next.
   *
   * The chain's heartbeat at chain granularity, where `burst:completed` is the
   * heartbeat at burst granularity. Emitted on the transition only, so a
   * surface can drive a stepper from it without deduplicating.
   */
  | {
      type: "step:complete";
      from: ChainPhase;
      to: ChainPhase;
      iteration: number;
      spentUsd: number;
    }
  /** The chain reached a terminal phase. Always the last event of a run. */
  | {
      type: "chain:complete";
      runId: string;
      phase: Extract<ChainPhase, "complete" | "failed">;
      stopReason: StopReason;
      iterations: number;
      spentUsd: number;
      budgetUsd: number;
      /** The closing document, or `""` when synthesis never ran or failed. */
      synthesis: string;
      transcriptPath: string;
      jsonlPath: string;
      at: number;
    }
  /** A resolver threw after its retries were exhausted. */
  | {
      type: "error";
      scope: ErrorScope;
      message: string;
      /** The burst this happened on; absent for synthesis. */
      iteration?: number;
      at: number;
    }
  /**
   * Several presets are about to run end to end.
   *
   * Only a composition emits the four `composition:*` events. A single run
   * emits none of them, so a surface written against the chain events alone
   * renders a composition correctly — it just cannot say which step it is
   * looking at.
   */
  | {
      type: "composition:started";
      runId: string;
      /** The preset IDs, in the order they will run. */
      presets: string[];
      input: string;
      at: number;
    }
  /** One step is about to run. Every chain event until its pair belongs to it. */
  | ({ type: "composition:step:started"; at: number } & CompositionStep)
  /**
   * One step finished, and its synthesis is about to become context for the
   * next one.
   */
  | ({
      type: "composition:step:complete";
      stopReason: StopReason;
      iterations: number;
      spentUsd: number;
      /** This step's closing document — the next step's prior context. */
      synthesis: string;
      transcriptPath: string;
      jsonlPath: string;
      at: number;
    } & CompositionStep)
  /** Every step is done. Always the last event of a composition. */
  | {
      type: "composition:complete";
      runId: string;
      /** Steps that actually ran, which is fewer than planned after an interrupt. */
      steps: number;
      /** Every step's spend, summed. */
      spentUsd: number;
      /** The file holding every step's synthesis, in order. */
      combinedPath: string;
      /** Whether an operator stopped the composition before its last step. */
      interrupted: boolean;
      at: number;
    };

/** What a surface hands the harness to receive {@link HarnessEvent}s. */
export type HarnessEventSink = (event: HarnessEvent) => void;
