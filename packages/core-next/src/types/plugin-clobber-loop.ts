/**
 * Copied from 1.35 (packages/core/src/plugins/clobber-loop.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { ModuleSchema, Plugin, PredicateOverlapProof } from "./index.js";

/** Configuration for the {@link clobberLoopPlugin}. */
export interface ClobberLoopPluginOptions {
  /**
   * Window over which clobber-rejection events are aggregated. A loop
   * fires when `threshold` distinct-requirement rejections involving
   * ≥2 distinct resolvers land on the same fact within `windowMs`.
   *
   * Default: 1000ms. Catches the canonical "5 clobbers in <500ms" case
   * while sitting well outside tick-boundary noise.
   */
  windowMs?: number;
  /**
   * Minimum distinct-requirement rejection count within `windowMs` to
   * trigger a loop event. Distinct by `requirement.id`, so a single
   * resolver's retry storm (which shares one requirement id) counts as
   * one rejection and never crosses the threshold alone — only true
   * multi-participant contention does.
   *
   * Default: 5.
   */
  threshold?: number;
  /**
   * After a loop fires on a `(fact, participantSet)`, suppress same-key
   * re-fire for this duration. Mirrors `clobberAlertPlugin`'s
   * cooldown precedent.
   *
   * Default: 5000ms.
   */
  cooldownMs?: number;
  /**
   * Quiet window after the last contributing clobber rejection before
   * the loop is considered closed and a `resolver.clobber.loop.resolved`
   * event fires. The resolver may have shipped a fix (priority added,
   * `when:` narrowed), or the surrounding state changed enough that
   * both participants no longer co-fire.
   *
   * Default: 30000ms.
   */
  resolvedAfterMs?: number;
  /**
   * Global LRU cap on the number of facts the detector tracks. A
   * hot-then-cold attacker fact key can churn the map, but LRU
   * eviction ensures the legitimate hot fact stays resident. Memory
   * bound: ~32 ring-buffer entries × `maxTrackedFacts` slim records.
   *
   * Default: 256.
   */
  maxTrackedFacts?: number;
  /**
   * Per-fact cap on participant resolver tracking. Above this, a single
   * "N-way contention on fact X" event fires once and detailed
   * participant tracking pauses for the cooldown window.
   *
   * Default: 16.
   */
  maxParticipantsPerFact?: number;
  /**
   * Global emission cap (loop-events per second across all facts). A
   * storm where every fact enters a loop simultaneously should not blow
   * up the observation bus or pager. Above-cap detections increment a
   * counter and surface in the next emitted event's
   * `suppressedSinceLastEmit` field.
   *
   * Default: 10.
   */
  maxEmissionsPerSec?: number;
  /**
   * Callback fired when a loop is detected. The payload is the
   * fully-constructed event including PII-redacted `predicateOverlap`
   * (when applicable).
   *
   * Default in dev mode: `console.warn` with the structured warning
   * text. Default in production: `console.error` to stderr — NOT noop,
   * so the signal still lands in CloudWatch/Loki/Datadog log pipelines
   * even when consumers haven't explicitly wired routing.
   */
  onLoop?: (event: ClobberLoopDetectedEvent) => void;
  /**
   * Callback fired when a previously-detected loop is considered
   * resolved (quiet window elapsed, participant unregistered, or
   * predicate narrowed).
   *
   * Default: no-op. Wire when monitoring needs "5 active loops" rather
   * than "47 historical loops."
   */
  onResolved?: (event: ClobberLoopResolvedEvent) => void;
  /**
   * Opt-out of PII redaction in the emitted event's `predicateOverlap`
   * clauses. The default (`false`) routes `whenSpec` operand pointers
   * through `redactWhenSpec` against `system.meta.byTag("pii")` BEFORE
   * the event is constructed, so downstream sinks see `[redacted]` in
   * place of the literal operand.
   *
   * Set to `true` only when the deployment has a data-processing
   * addendum that permits unredacted operand capture.
   *
   * Default: `false`.
   */
  capturePII?: boolean;
}

/**
 * Emitted payload for {@link ClobberLoopPluginOptions.onLoop}. Identical
 * shape to the `"resolver.clobber.loop.detected"` ObservationEvent so
 * consumers can route the same code path through either surface.
 *
 * @public
 */
export interface ClobberLoopDetectedEvent {
  readonly systemId: string;
  readonly fact: string;
  readonly participants: readonly string[];
  readonly participantModules: readonly string[];
  readonly count: number;
  readonly windowMs: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly predicateOverlap?: PredicateOverlapProof;
  readonly severity: "warn" | "error";
  readonly factTags: readonly string[];
  readonly suppressedSinceLastEmit: number;
  readonly rejectionSeqs: readonly number[];
}

/**
 * Emitted payload for {@link ClobberLoopPluginOptions.onResolved}.
 *
 * @public
 */
export interface ClobberLoopResolvedEvent {
  readonly systemId: string;
  readonly fact: string;
  readonly participants: readonly string[];
  readonly durationMs: number;
  readonly resolution:
    | "no-recurrence-in-window"
    | "participant-disabled"
    | "predicate-narrowed";
}

/**
 * Runtime kill-switch handle returned alongside the plugin. Lets an SRE
 * flip the detector off during incident response without redeploying.
 * `disable()` stops emission but preserves buffer state so `enable()`
 * resumes cleanly without warm-up drift.
 *
 * @public
 */
export interface ClobberLoopPluginHandle<M extends ModuleSchema> {
  readonly plugin: Plugin<M>;
  disable(): void;
  enable(): void;
  isEnabled(): boolean;
}
