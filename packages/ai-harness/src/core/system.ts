/**
 * Assembling a chain: preset in, running harness out.
 *
 * Everything here is wiring. The decisions all live in `./module.js`; this file
 * builds a transcript, a runner chain, an event fan-out, and a Directive system
 * over them, and hands back three things a surface can use.
 *
 * @module
 */

import type { AgentRunner, RetryConfig, TokenPricing } from "@directive-run/ai";
import { type Plugin, type System, createSystem } from "@directive-run/core";
import {
  type DevtoolsPluginOptions,
  type LoggingPluginOptions,
  devtoolsPlugin,
  loggingPlugin,
} from "@directive-run/core/plugins";
import { createHarnessAgents, minimumBudgetUsd } from "./agents.js";
import type {
  ChainPhase,
  HarnessEvent,
  HarnessEventSink,
  StopReason,
} from "./events.js";
import {
  type ChainDerived,
  type DerivedReader,
  createHarnessModule,
} from "./module.js";
import { assertPreset } from "./preset-registry.js";
import type { PresetConfig } from "./preset-types.js";
import {
  type Transcript,
  createRunId,
  createTranscript,
  defaultTranscriptDir,
} from "./transcript.js";

// ============================================================================
// Options
// ============================================================================

export interface HarnessOptions {
  /**
   * Stand in for the provider. Sits at the base of the runner chain, under the
   * retry policy and the ledger, so an offline run behaves like an online one.
   */
  runner?: AgentRunner;
  /** Required unless `runner` is supplied. */
  apiKey?: string;
  /** Rates for the preset's model. Defaults to the published Anthropic table. */
  pricing?: TokenPricing;
  /** Overrides the default retry policy on the runner chain. */
  retry?: RetryConfig;
  /** Alternate Anthropic base URL. Ignored when `runner` is supplied. */
  baseURL?: string;
  /** Where the transcript and its sidecar are written. @default `./.ai-harness` */
  outputDir?: string;
  /** Names this run and its two files. Generated when omitted. */
  runId?: string;
  /** Where the event stream goes. */
  onEvent?: HarnessEventSink;
  /**
   * Directive's logging plugin. `true` uses a quiet default that surfaces
   * resolver and constraint errors only. @default false
   */
  logging?: boolean | LoggingPluginOptions;
  /**
   * Directive's devtools plugin. `true` records the trace without opening a
   * panel, which is what you want outside a browser. @default false
   */
  devtools?: boolean | DevtoolsPluginOptions;
  /** Injectable clock. */
  now?: () => number;
}

/** What a finished run reports. */
export interface HarnessRunResult {
  runId: string;
  phase: Extract<ChainPhase, "complete" | "failed">;
  stopReason: StopReason;
  /** Bursts that completed. */
  iterations: number;
  spentUsd: number;
  budgetUsd: number;
  /** The closing document, or `""` when synthesis never ran or failed. */
  synthesis: string;
  /**
   * Whether `synthesis` is empty because the chain could not pay for it.
   *
   * Distinct from a synthesis that failed (`phase: "failed"`) and from one that
   * never came due (no bursts ran). A caller that treats an empty synthesis as
   * an error should check this first — this one is the budget working, not
   * breaking.
   */
  synthesisSkipped: boolean;
  transcriptPath: string;
  jsonlPath: string;
}

export interface Harness {
  /**
   * The Directive system running the chain.
   *
   * Exposed so a caller can `inspect()` it, attach an observer, or `destroy()`
   * it. Reading facts off it is fine; writing them is not — every fact has a
   * resolver or an event that owns it.
   */
  system: System<never>;
  /** The transcript, live. Readable mid-run. */
  transcript: Transcript;
  /** Run the chain to completion. One run per harness. */
  run(input: string): Promise<HarnessRunResult>;
  /**
   * Stop the chain after the burst in flight.
   *
   * Flips one fact. The chain still synthesizes — an interrupt asks for the
   * closing document early, it does not throw away the transcript.
   */
  abort(): void;
}

/** Quiet by default: a chain is not a debugging session unless asked. */
const DEFAULT_LOGGING: LoggingPluginOptions = {
  level: "error",
  prefix: "[ai-harness]",
};

const DEFAULT_DEVTOOLS: DevtoolsPluginOptions = {
  name: "ai-harness",
  trace: true,
  panel: false,
};

// ============================================================================
// Factory
// ============================================================================

export function createHarnessSystem(
  preset: PresetConfig,
  options: HarnessOptions = {},
): Harness {
  const validated = assertPreset(preset, "createHarnessSystem(preset)");
  const now = options.now ?? Date.now;
  const runId = options.runId ?? createRunId(now);

  const transcript = createTranscript({
    dir: options.outputDir ?? defaultTranscriptDir(),
    runId,
    now,
  });

  // Every event goes through one fan-out. `run()` subscribes to it the same way
  // a surface does, rather than reaching for a second completion signal — one
  // channel means the promise cannot resolve on a different notion of "done"
  // than the one the caller is watching.
  const listeners = new Set<HarnessEventSink>();
  if (options.onEvent) {
    listeners.add(options.onEvent);
  }
  const emit: HarnessEventSink = (event) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A surface that throws while rendering is not the chain's problem,
        // and must not become the chain's failure.
        console.error("[ai-harness] event listener threw:", error);
      }
    }
  };

  const agents = createHarnessAgents({
    preset: validated,
    runner: options.runner,
    apiKey: options.apiKey,
    pricing: options.pricing,
    retry: options.retry,
    baseURL: options.baseURL,
  });

  // Refused here rather than discovered four bursts in.
  //
  // A budget that cannot cover the closing document buys bursts nobody will
  // ever read a summary of: the chain spends what it has, reaches synthesis,
  // finds it unaffordable, and stops with a transcript and no conclusion. That
  // is a correct outcome of the rules and a useless outcome for the operator,
  // and it is knowable before a single call — the synthesizer's `maxTokens` and
  // the model's output rate are both in hand right now.
  const floor = minimumBudgetUsd(validated, agents.pricing);
  if (validated.budgetUsd < floor) {
    throw new Error(
      `[ai-harness] budgetUsd of $${validated.budgetUsd.toFixed(4)} cannot pay for this preset's closing document, which prices at $${floor.toFixed(4)} (${validated.synthesizer.maxTokens} output tokens at $${agents.pricing.outputPerMillion}/M). The chain would spend the budget on bursts and then have nothing left to summarise them with. Raise the budget above $${floor.toFixed(4)}, or lower \`synthesizer.maxTokens\`.`,
    );
  }

  // Bound after `createSystem` and before `start()`. Constraints and effects
  // read derivations through this because the facts proxy they are handed does
  // not carry them; the read still goes through the derivation proxy, so it is
  // tracked exactly like a fact read.
  const binding: { derived?: ChainDerived } = {};
  const readDerived: DerivedReader = (key) => {
    const derived = binding.derived;
    if (derived === undefined) {
      throw new Error(
        "[ai-harness] a derivation was read before the system was bound — createHarnessSystem binds it between createSystem() and start().",
      );
    }

    return derived[key];
  };

  const module = createHarnessModule({
    preset: validated,
    runId,
    transcript,
    agents,
    emit,
    readDerived,
    now,
  });

  const system = createSystem({ module, plugins: buildPlugins(options) });
  binding.derived = system.derive;
  system.start();

  let consumed = false;

  function snapshot(): HarnessRunResult {
    const phase = system.derive.phase;

    return {
      runId,
      phase: phase === "failed" ? "failed" : "complete",
      stopReason: system.derive.stopReason,
      iterations: system.facts.iteration,
      spentUsd: system.facts.spentUsd,
      budgetUsd: system.derive.budgetUsd,
      synthesis: system.facts.synthesis,
      synthesisSkipped: system.derive.synthesisSkipped,
      transcriptPath: transcript.markdownPath,
      jsonlPath: transcript.jsonlPath,
    };
  }

  return {
    // The System's schema is inferred from the module and is not part of the
    // public surface — a caller holds it to inspect and destroy, not to type
    // against.
    system: system as unknown as System<never>,
    transcript,

    async run(input) {
      if (consumed) {
        throw new Error(
          "[ai-harness] this harness has already been run. A run writes one transcript under one run ID; build another harness for another run.",
        );
      }
      consumed = true;

      transcript.setInput(input);

      const finished = new Promise<void>((resolve) => {
        const onComplete: HarnessEventSink = (event: HarnessEvent) => {
          if (event.type === "chain:complete") {
            listeners.delete(onComplete);
            resolve();
          }
        };
        listeners.add(onComplete);
      });

      system.dispatch({ type: "start", input });
      await finished;

      return snapshot();
    },

    abort() {
      system.dispatch({ type: "interrupt" });
    },
  };
}

// ============================================================================
// Plugins
// ============================================================================

function buildPlugins(options: HarnessOptions): Plugin[] {
  const plugins: Plugin[] = [];

  if (options.logging) {
    plugins.push(
      loggingPlugin(
        typeof options.logging === "object" ? options.logging : DEFAULT_LOGGING,
      ),
    );
  }
  if (options.devtools) {
    plugins.push(
      devtoolsPlugin(
        typeof options.devtools === "object"
          ? options.devtools
          : DEFAULT_DEVTOOLS,
      ),
    );
  }

  return plugins;
}
