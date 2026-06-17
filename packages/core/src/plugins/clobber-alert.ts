/**
 * Clobber Alert Plugin – default high-severity alerting for
 * `resolver.write.rejected { reason: "clobbered" }` events landing on
 * facts tagged irreversible.
 *
 * The audit ledger already records every clobber event with full
 * forensic detail (fact, expected, actual, resolver, requirementId).
 * But a clobber on a fact tagged `"money"` / `"pii"` / `"irreversible"`
 * is operationally far more urgent than a clobber on a UI status fact.
 * Without this plugin, a consumer has to write their own SIEM rule to
 * separate "noise" from "page an engineer NOW."
 *
 * Default behaviour: fire `console.error` on every clobber whose fact's
 * schema meta carries any tag in `irreversibleTags`. Replace the
 * `onAlert` callback to route to PagerDuty / Slack / Sentry / your SIEM
 * of choice.
 *
 * @public
 */

import type { ModuleSchema, Plugin, System } from "../core/types.js";

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
 * Cap the per-(fact, resolver) cooldown map at this size with FIFO
 * eviction so a long-running system with high resolver churn (e.g.
 * dynamically-registered resolvers) cannot grow the map unboundedly.
 * Matches the cap precedent set for `retryAttempts` in the engine.
 */
const COOLDOWN_MAP_CAP = 1000;

/**
 * Create a plugin that fires high-severity alerts for clobber events
 * landing on irreversible-tagged facts.
 *
 * @example
 * ```ts
 * createSystem({
 *   module: myModule,
 *   plugins: [
 *     clobberAlertPlugin({
 *       irreversibleTags: ["money", "pii"],
 *       onAlert: (e) => pagerduty.trigger({
 *         severity: "critical",
 *         summary: `Clobber on ${e.fact} (${e.tags.join(", ")})`,
 *         details: e,
 *       }),
 *     }),
 *   ],
 * });
 * ```
 */
export function clobberAlertPlugin<M extends ModuleSchema>(
  options: ClobberAlertPluginOptions = {},
): Plugin<M> {
  const irreversibleTags = new Set(
    options.irreversibleTags ?? ["money", "pii", "irreversible"],
  );
  const irreversibleResolvers = new Set(options.irreversibleResolvers ?? []);
  const cooldownMs = options.cooldownMs ?? 0;
  const onAlert =
    options.onAlert ??
    ((event: ClobberAlertEvent) => {
      console.error(
        `[Directive] CLOBBER on irreversible fact '${event.fact}' (tags: ${event.tags.join(", ")}) by resolver '${event.resolver}'`,
        { expected: event.expected, actual: event.actual },
      );
    });

  let systemRef: System<M> | null = null;
  const lastAlerted = new Map<string, number>();

  return {
    name: "clobber-alert",
    onInit(system) {
      systemRef = system;
    },
    onDestroy() {
      systemRef = null;
      lastAlerted.clear();
    },
    onResolverWriteRejected(event) {
      if (event.kind !== "rejection") return;
      if (!systemRef) return;

      const factMeta = systemRef.meta.fact(event.fact);
      const tags = factMeta?.tags ?? [];
      const matched = tags.filter((t) => irreversibleTags.has(t));
      const tagMatched = matched.length > 0;
      const resolverMatched = irreversibleResolvers.has(event.resolver);
      if (!tagMatched && !resolverMatched) return;

      const matchedBy: "tag" | "resolver" | "both" =
        tagMatched && resolverMatched
          ? "both"
          : tagMatched
            ? "tag"
            : "resolver";

      const cooldownKey = `${event.fact}::${event.resolver}`;
      if (cooldownMs > 0) {
        // Key by (fact, resolver) so two different resolvers fighting
        // on the same fact (a real incident) both alert, while a single
        // resolver retrying the same fact (noise) is suppressed.
        const last = lastAlerted.get(cooldownKey) ?? 0;
        const now = Date.now();
        if (now - last < cooldownMs) return;
      }

      try {
        onAlert({
          fact: event.fact,
          tags: matched,
          matchedBy,
          resolver: event.resolver,
          requirementId: event.req.id,
          expected: event.expected,
          actual: event.actual,
          timestamp: Date.now(),
        });
        // Stamp the cooldown only AFTER a successful alert. If the
        // callback throws (PagerDuty 503, etc.), don't burn the cooldown
        // slot — the next genuine alert can still fire.
        if (cooldownMs > 0) {
          // FIFO eviction at cap so the map can't grow without bound
          // under high resolver churn (e.g. dynamically registered
          // resolvers in a long-running system).
          if (lastAlerted.size >= COOLDOWN_MAP_CAP) {
            const oldestKey = lastAlerted.keys().next().value;
            if (oldestKey !== undefined) lastAlerted.delete(oldestKey);
          }
          lastAlerted.set(cooldownKey, Date.now());
        }
      } catch (err) {
        // The consumer's `onAlert` threw (PagerDuty 503, Slack rate
        // limit, etc.). Surface it without breaking the dispatch path.
        // The audit ledger already recorded the clobber; this is
        // purely the alerting side.
        console.error(
          `[Directive] clobberAlertPlugin: onAlert callback threw for fact '${event.fact}'`,
          err,
        );
      }
    },
  };
}
