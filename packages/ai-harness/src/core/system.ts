/**
 * Assembling a chain: preset in, running harness out.
 *
 * Everything here is wiring. The decisions all live in `./module.js`; this file
 * opens a transcript on whatever store it was given, builds a runner chain and
 * an event fan-out, puts a Directive system over them, and hands back three
 * things a surface can use.
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
import { createHarnessAgents } from "./agents.js";
import type {
  ChainPhase,
  HarnessEvent,
  HarnessEventSink,
  StopReason,
} from "./events.js";
import { createHarnessChain } from "./module.js";
import { assertPreset } from "./preset-registry.js";
import type { PresetConfig } from "./preset-types.js";
import { MAX_RUN_ID_LENGTH, assertSafeIdentifier } from "./safety.js";
import {
  type Transcript,
  type TranscriptStore,
  createMemoryTranscriptStore,
  createRunId,
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
  /**
   * Where this run's artefacts go.
   *
   * Defaults to an in-memory store, so nothing here touches a disk unless the
   * caller says where. Files are one argument away —
   * `createFileTranscriptStore({ dir })`, which is what the command line
   * supplies for `--out-dir`. A server surface supplies its own and the chain is
   * none the wiser.
   */
  transcripts?: TranscriptStore;
  /**
   * Names this run and its two artefacts. Generated when omitted.
   *
   * Constrained to letters, digits, dot, dash, and underscore, because a store
   * may turn it into a filename. The filesystem store refuses a run ID whose
   * files already exist rather than half-overwriting them.
   */
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
  /** Turns that completed. */
  iterations: number;
  spentUsd: number;
  budgetUsd: number;
  /** The closing document, or `""` when synthesis never ran or failed. */
  synthesis: string;
  /**
   * Whether `synthesis` is empty because the chain could not pay for it.
   *
   * Distinct from a synthesis that failed (`phase: "failed"`) and from one that
   * never came due (no turns ran). A caller that treats an empty synthesis as
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
   * Stop the chain after the turn in flight.
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
  // A caller-supplied run ID may become a filename, so it is held to the same
  // rule the preset's own `id` is. The filesystem store asserts containment
  // again when it opens; this one is here so the refusal names the option that
  // caused it, whether or not the store in force writes anything.
  const runId =
    options.runId === undefined
      ? createRunId(now)
      : assertSafeIdentifier(options.runId, "runId", MAX_RUN_ID_LENGTH);

  const store = options.transcripts ?? createMemoryTranscriptStore();
  const transcript = store.open({ runId });

  // Every event goes through one fan-out. `run()` subscribes to it the same way
  // a surface does, rather than reaching for a second completion signal — one
  // channel means the promise cannot resolve on a different notion of "done"
  // than the one the caller is watching.
  const listeners = new Set<HarnessEventSink>();
  if (options.onEvent) {
    listeners.add(options.onEvent);
  }
  /**
   * Guards the one recursion this fan-out can produce.
   *
   * A listener that throws is reported on the same channel every other problem
   * is reported on — this file has no console of its own, because the event
   * stream is the whole point of the event stream and a surface that swapped
   * stdout for a socket would never see a `console.error`. Which means the
   * report is itself an event, delivered to the listener that just threw. One
   * level deep is a report; two is a loop, so the second level is dropped.
   */
  let reportingListenerFailure = false;
  const emit: HarnessEventSink = (event) => {
    const failures: string[] = [];

    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A surface that throws while rendering is not the chain's problem,
        // and must not become the chain's failure.
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (failures.length === 0 || reportingListenerFailure) {
      return;
    }

    reportingListenerFailure = true;
    try {
      for (const message of failures) {
        emit({ type: "error", scope: "listener", message, at: now() });
      }
    } finally {
      reportingListenerFailure = false;
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

  // The chain checks the budget floor itself — see `createHarnessChain`, which
  // is the door a composing caller comes through too.
  const chain = createHarnessChain({
    preset: validated,
    runId,
    transcript,
    agents,
    emit,
    now,
  });

  const system = createSystem({
    module: chain.module,
    plugins: buildPlugins(options),
  });
  // The single-module form, so no namespace. The multi-module form is the whole
  // reason `bind` takes one — see `HarnessChain.bind`.
  chain.bind(system);
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
