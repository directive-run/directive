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
import { awaitCompletion } from "./completion.js";
import type {
  ChainPhase,
  HarnessEvent,
  HarnessEventSink,
  StopReason,
} from "./events.js";
import { createEventFanOut } from "./fan-out.js";
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
   * Wall-clock cap on one provider call, in milliseconds.
   *
   * Ignored when `runner` is supplied, since a stand-in decides its own
   * deadlines. @default {@link DEFAULT_CALL_TIMEOUT_MS}
   */
  timeoutMs?: number;
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
   * it. It is deliberately typed `System<never>`: the schema is the module's,
   * the module is an implementation detail, and a caller holds this to inspect
   * and destroy rather than to type against. So `system.facts.iteration` and
   * `system.derive.stopReason` do not compile through it — the chain's own
   * account of itself is the event stream and {@link Harness.run}'s result, and
   * a surface that wants a figure mid-run reads it from a `HarnessEvent`.
   *
   * Writing facts through it is not supported at all — every fact has a
   * resolver or an event handler that owns it.
   */
  system: System<never>;
  /** The transcript, live. Readable mid-run. */
  transcript: Transcript;
  /**
   * What this run has been billed so far, in dollars.
   *
   * Read straight off the runner's ledger rather than off the chain's
   * `spentUsd` fact. The two are the same number most of the time and they are
   * not the same number at the moment this accessor is most often reached for.
   * The fact is a *copy*, written on a resolver's way out; while a call is
   * still parked on the provider the copy holds what the previous exit left,
   * and a caller who tears the system down mid-turn reads it before the
   * resolver's `finally` has run. That reported `$0.0000` for a run that had
   * spent twenty-two cents.
   *
   * The fact still exists and is still written, because derivations have to be
   * able to go stale on spend and a ledger call is not something they can
   * depend on. This accessor has no such need, so it does not inherit the lag.
   *
   * A method rather than a property because it is live. Readable mid-run, and
   * readable after one; a composition reads it to charge a step whose `run()`
   * rejected before it could report anything.
   */
  spentUsd(): number;
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
  // than the one the caller is watching. The fan-out itself is shared with the
  // composition; see `./fan-out.js` for why a listener that throws is caught
  // rather than allowed out.
  const { listeners, emit } = createEventFanOut(now, options.onEvent);

  const agents = createHarnessAgents({
    preset: validated,
    runner: options.runner,
    apiKey: options.apiKey,
    pricing: options.pricing,
    retry: options.retry,
    baseURL: options.baseURL,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
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

  /**
   * Torn down while a run was still going.
   *
   * `destroy()` is the only handle a caller has on a chain that is spending
   * more than they meant it to, and core already makes it a real one — `stop()`
   * aborts every resolver's signal, and the turn resolver hands that signal to
   * the provider call. What it could not do is end the wait: `run()` resolves
   * off `chain:complete`, teardown means no further reconcile and therefore no
   * further event, and the caller who reached for the kill switch was left
   * holding a promise that would never settle. This is how the teardown reaches
   * them, wherever it was triggered from — the harness does not own the
   * `destroy()` call, so it listens for it rather than wrapping it.
   */
  let onTeardown: (() => void) | undefined;

  const system = createSystem({
    module: chain.module,
    plugins: [
      ...buildPlugins(options),
      {
        name: "ai-harness-teardown",
        onStop: () => {
          onTeardown?.();
        },
      },
    ],
  });
  system.start();

  let consumed = false;

  /**
   * The ledger, not the copy of it that lives in the facts.
   *
   * Everything a caller can reach outside a reconcile pass reports through
   * this — the accessor on the returned harness, and the teardown message
   * below. Both are read at moments the fact copy is stale by construction:
   * `destroy()` runs `stop()`, the plugin's `onStop`, and the teardown handler
   * synchronously, while the turn resolver is still parked on the provider
   * call and its `finally` is ticks away.
   */
  function spentUsd(): number {
    return agents.budgetRunner.getSpent("total");
  }

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

    spentUsd,

    async run(input) {
      if (consumed) {
        throw new Error(
          "[ai-harness] this harness has already been run. A run writes one transcript under one run ID; build another harness for another run.",
        );
      }
      consumed = true;

      const finished = new Promise<void>((resolve, reject) => {
        const onComplete: HarnessEventSink = (event: HarnessEvent) => {
          if (event.type === "chain:complete") {
            listeners.delete(onComplete);
            onTeardown = undefined;
            resolve();
          }
        };
        listeners.add(onComplete);

        onTeardown = () => {
          listeners.delete(onComplete);
          onTeardown = undefined;
          reject(
            new Error(
              `[ai-harness] run "${runId}" was torn down before it finished. The system was stopped or destroyed with the chain still going, so every resolver was aborted and no closing document was written. ${system.facts.iteration} turns and $${spentUsd().toFixed(4)} are on the transcript at ${transcript.markdownPath}.`,
            ),
          );
        };
      });

      system.dispatch({ type: "start", input });
      // Backed by the system's own settlement, so a cascade that stops short of
      // the completion event ends the wait with what the chain was doing rather
      // than with a hang. See `./completion.js`.
      await awaitCompletion(
        finished,
        system,
        // A turn is dispatched under a requirement that stays active for its
        // whole life, so the engine's own count is enough here — this is the
        // chain saying so rather than the caller assuming it.
        () => system.isSettled && !system.derive.turnInFlight,
        () =>
          `[ai-harness] run "${runId}" stopped without finishing. The system has nothing left to do — no resolver in flight, no reconcile pending — and no chain:complete was emitted. Phase ${JSON.stringify(system.derive.phase)}, ${system.facts.iteration} turns, $${spentUsd().toFixed(4)} of $${system.derive.budgetUsd.toFixed(4)} spent${system.facts.failure === "" ? "" : `, last failure: ${system.facts.failure}`}.`,
      );

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
