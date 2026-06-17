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
   * Default: `["money", "pii", "irreversible"]`.
   */
  irreversibleTags?: readonly string[];
  /**
   * Callback fired when a clobber lands on a fact whose tags overlap
   * `irreversibleTags`. Default: `console.error(...)`.
   */
  onAlert?: (event: ClobberAlertEvent) => void;
  /**
   * Per-fact cooldown window. A second clobber on the same fact within
   * this window does not re-fire `onAlert` (the audit ledger still
   * records it). Default: `0` (no cooldown — every event alerts).
   */
  cooldownMs?: number;
}

/** Payload passed to {@link ClobberAlertPluginOptions.onAlert}. */
export interface ClobberAlertEvent {
  readonly fact: string;
  readonly tags: readonly string[];
  readonly resolver: string;
  readonly requirementId: string;
  readonly expected: unknown;
  readonly actual: unknown;
  /** `Date.now()` at the moment the alert fired. */
  readonly timestamp: number;
}

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
      if (matched.length === 0) return;

      if (cooldownMs > 0) {
        const last = lastAlerted.get(event.fact) ?? 0;
        const now = Date.now();
        if (now - last < cooldownMs) return;
        lastAlerted.set(event.fact, now);
      }

      onAlert({
        fact: event.fact,
        tags: matched,
        resolver: event.resolver,
        requirementId: event.req.id,
        expected: event.expected,
        actual: event.actual,
        timestamp: Date.now(),
      });
    },
  };
}
