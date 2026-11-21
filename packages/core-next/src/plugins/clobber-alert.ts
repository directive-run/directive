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

import type { ModuleSchema, Plugin, System } from "../types/index.js";
import type {
  ClobberAlertEvent,
  ClobberAlertPluginOptions,
} from "../types/plugin-clobber-alert.js";

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
  const onSummary = options.onSummary;

  let systemRef: System<M> | null = null;
  const lastAlerted = new Map<string, number>();
  /**
   * Resolver IDs that have fired at least one `onAlert` in this session.
   * Used to surface summary alerts for resolvers that have proven they
   * touch irreversible state — even if the summary event itself lacks
   * the fact-tag information the per-event path uses.
   */
  const priorIrreversibleAlertResolvers = new Set<string>();

  return {
    name: "clobber-alert",
    onInit(system) {
      systemRef = system;
    },
    onDestroy() {
      systemRef = null;
      lastAlerted.clear();
      priorIrreversibleAlertResolvers.clear();
    },
    onResolverWriteRejected(event) {
      if (!systemRef) return;

      if (event.kind === "summary") {
        if (!onSummary) return;
        const resolverListed = irreversibleResolvers.has(event.resolver);
        const priorAlert = priorIrreversibleAlertResolvers.has(event.resolver);
        if (!resolverListed && !priorAlert) return;
        try {
          onSummary({
            resolver: event.resolver,
            requirementId: event.req.id,
            dropped: event.dropped,
            matchedBy: resolverListed
              ? "resolver-listed"
              : "prior-irreversible-alert",
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error(
            `[Directive] clobberAlertPlugin: onSummary callback threw for resolver '${event.resolver}'`,
            err,
          );
        }
        return;
      }

      // event.kind === "rejection"

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
        // Remember this resolver fired an irreversible alert so a
        // subsequent summary event (the engine's rate-limit aggregate)
        // can route to `onSummary` even though per-fact attribution
        // is lost in the summary payload.
        priorIrreversibleAlertResolvers.add(event.resolver);
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
