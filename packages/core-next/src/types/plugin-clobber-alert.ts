/**
 * Copied from 1.35 (packages/core/src/plugins/clobber-alert.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

/** Configuration for the {@link clobberAlertPlugin}. */
export interface ClobberAlertPluginOptions {
  /**
   * Fact-meta tags that promote a clobber event from "noise" to
   * "high-severity alert." A clobber whose fact's schema meta carries
   * ANY of these tags fires `onAlert`.
   *
   * **Why tag the fact, not the resolver?** A clobber is detected at
   * fact-write time. The audit event payload (`fact`, `expected`,
   * `actual`) names the fact, not the side effect — the fact is the
   * trigger surface for any irreversible work the resolver is about
   * to do (a charge, a send, a delete). Tagging `payment.amount` with
   * `"money"` marks the fact whose race-loss should page someone.
   *
   * If your model puts the irreversibility on the resolver rather than
   * the fact, use `irreversibleResolvers` — both filters OR.
   *
   * Default: `["money", "pii", "irreversible"]`.
   */
  irreversibleTags?: readonly string[];
  /**
   * Resolver IDs whose clobbered writes should always alert, regardless
   * of fact tags. Use this when irreversibility is modeled on the
   * resolver (e.g. `stripeCharge`) rather than on the trigger fact.
   * Defaults to empty — the fact-tag path covers most cases.
   */
  irreversibleResolvers?: readonly string[];
  /**
   * Callback fired when a clobber lands on a fact whose tags overlap
   * `irreversibleTags`, or whose resolver is in `irreversibleResolvers`.
   * Default: `console.error(...)`.
   */
  onAlert?: (event: ClobberAlertEvent) => void;
  /**
   * Callback fired when the engine's per-resolver rate limit aggregates
   * multiple per-write clobber events into a single
   * `kind: "summary"` event (default cap: 10 per-resolver-instance).
   * The summary names the resolver + dropped count but loses per-fact
   * attribution — the engine has no way to enumerate every dropped
   * write inside the cap.
   *
   * Only fires when EITHER:
   * - the resolver is listed in `irreversibleResolvers`, OR
   * - this plugin has previously fired `onAlert` for the resolver
   *   (i.e. the resolver has touched an irreversible fact in this
   *   session, so a follow-on burst is operationally relevant)
   *
   * Default: undefined (no summary alerts). Set this to preserve
   * SIEM telemetry past the engine's rate-limit cap on a hot
   * resolver fighting an irreversible fact.
   */
  onSummary?: (event: ClobberSummaryEvent) => void;
  /**
   * Cooldown window keyed by `(fact, resolver)` pair. A second clobber
   * from the same resolver on the same fact within this window does not
   * re-fire `onAlert`. A clobber from a *different* resolver on the
   * same fact still fires — fighting writers are a different
   * operational incident than a single resolver retrying.
   *
   * The audit ledger records every clobber regardless of cooldown.
   *
   * Default: `0` (no cooldown — every event alerts).
   */
  cooldownMs?: number;
}

/** Payload passed to {@link ClobberAlertPluginOptions.onAlert}. */
export interface ClobberAlertEvent {
  readonly fact: string;
  /**
   * Fact-meta tags that matched `irreversibleTags`. Empty when the alert
   * fired only because the resolver matched `irreversibleResolvers`.
   * Use {@link matchedBy} to distinguish without checking length.
   */
  readonly tags: readonly string[];
  /**
   * Which filter triggered the alert:
   * - `"tag"` — fact-meta tags overlapped `irreversibleTags`
   * - `"resolver"` — resolver ID matched `irreversibleResolvers`
   * - `"both"` — both filters matched
   */
  readonly matchedBy: "tag" | "resolver" | "both";
  readonly resolver: string;
  readonly requirementId: string;
  readonly expected: unknown;
  readonly actual: unknown;
  /** `Date.now()` at the moment the alert fired. */
  readonly timestamp: number;
}

/**
 * Payload passed to {@link ClobberAlertPluginOptions.onSummary}.
 *
 * Fired when the engine's per-resolver clobber rate-limit aggregates
 * multiple per-write events into one summary. Per-fact attribution is
 * lost (the engine cannot enumerate every dropped write inside the
 * cap), but the resolver + dropped count are preserved so SIEM can
 * page on "this resolver is still fighting an irreversible fact
 * past the cap."
 */
export interface ClobberSummaryEvent {
  readonly resolver: string;
  readonly requirementId: string;
  /** Number of per-write clobber events the engine suppressed under the cap. */
  readonly dropped: number;
  /**
   * Why the summary surfaced from this plugin's filter:
   * - `"resolver-listed"` — the resolver was in `irreversibleResolvers`
   * - `"prior-irreversible-alert"` — the resolver had already fired
   *   `onAlert` on an irreversible fact in this session
   */
  readonly matchedBy: "resolver-listed" | "prior-irreversible-alert";
  /** `Date.now()` at the moment the summary fired. */
  readonly timestamp: number;
}
