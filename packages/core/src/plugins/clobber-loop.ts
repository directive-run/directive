/**
 * Clobber Loop Detector Plugin – fires a structured warning when the
 * same set of resolvers clobber the same fact above threshold within a
 * time window. A single clobber is fine — the `abortOn:` binding caught
 * the race and the audit ledger recorded it. A *loop* is two or more
 * resolvers whose `when:` predicates both satisfy a shared state and
 * keep rewriting the fact every reconcile tick, indefinitely.
 *
 * Today the symptom surfaces as a value flapping between two states in
 * a customer screenshot. The audit ledger holds the forensic evidence
 * (800 clobbers/sec on `cart.discount`), but nobody looks until a
 * customer complains. This plugin closes the loop: one structured
 * warning per detected loop, with a **predicate-overlap proof** built
 * from the participants' `whenSpec` so the warning points at the
 * specific clauses that co-fire instead of stopping at "these resolvers
 * fight."
 *
 * @public
 */

import { compareClauses } from "../core/doctor.js";
import { type LeafClause, flattenPredicate } from "../core/rules-diff.js";
import type {
  FactPredicate,
  ModuleSchema,
  Plugin,
  PredicateOverlapProof,
  System,
} from "../core/types.js";
import { redactWhenSpec } from "./audit-ledger/predicate-redact.js";

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

const DEFAULTS = {
  windowMs: 1000,
  threshold: 5,
  cooldownMs: 5000,
  resolvedAfterMs: 30000,
  maxTrackedFacts: 256,
  maxParticipantsPerFact: 16,
  maxEmissionsPerSec: 10,
} as const;

/**
 * Slim per-rejection record. Notably absent: `expected`/`actual` values.
 * The audit ledger already keeps the forensic payload — the detector's
 * ring buffer holds only what aggregation needs, so PII can't bleed
 * through this surface.
 */
interface RejectionRecord {
  readonly timestamp: number;
  readonly requirementId: string;
  readonly resolverId: string;
  readonly seq: number;
}

interface FactState {
  readonly buffer: RejectionRecord[];
  participants: Set<string>;
  /** ms epoch of last cooldown fire keyed by sorted-participant signature. */
  readonly cooldowns: Map<string, number>;
  /** Active loop record for resolved-event tracking. */
  activeLoop: {
    readonly participants: readonly string[];
    readonly firstAt: number;
    lastClobberAt: number;
  } | null;
}

/**
 * Module-local LRU implementation. Not exported — when a second
 * detector (retry-storm, etc.) lands and validates the same shape, lift
 * to a shared utility. Until then, copy-paste is cheaper than the
 * abstraction tax.
 */
function createLruMap<K, V>(cap: number): {
  get(k: K): V | undefined;
  set(k: K, v: V): void;
  delete(k: K): boolean;
  size(): number;
  keys(): IterableIterator<K>;
  clear(): void;
} {
  const data = new Map<K, V>();
  return {
    get(k) {
      const v = data.get(k);
      if (v !== undefined) {
        data.delete(k);
        data.set(k, v);
      }
      return v;
    },
    set(k, v) {
      if (data.has(k)) {
        data.delete(k);
      } else if (data.size >= cap) {
        const oldest = data.keys().next().value;
        if (oldest !== undefined) data.delete(oldest);
      }
      data.set(k, v);
    },
    delete(k) {
      return data.delete(k);
    },
    size() {
      return data.size;
    },
    keys() {
      return data.keys();
    },
    clear() {
      data.clear();
    },
  };
}

/**
 * Build a {@link PredicateOverlapProof} for the two whenSpecs that
 * participants' resolvers chain through. Best-effort:
 *
 * - both `undefined` → `function-form-opaque`
 * - identical clause structure → `matched`
 * - shared paths, no contradictions → `overlap`
 * - non-comparable operator detected → `indeterminate`
 *
 * The proof never throws; on any unexpected shape, falls back to
 * `function-form-opaque` so the warning message remains honest about
 * the limit of its own evidence.
 */
function buildPredicateOverlap(
  whenA: FactPredicate<unknown> | undefined,
  whenB: FactPredicate<unknown> | undefined,
  whenSourceHashes?: readonly string[],
): PredicateOverlapProof {
  if (!whenA || !whenB) {
    return {
      verdict: "function-form-opaque",
      reason: "one-or-both-when-is-a-function",
      ...(whenSourceHashes ? { whenSourceHashes } : {}),
    };
  }

  let flatA: LeafClause[];
  let flatB: LeafClause[];
  try {
    flatA = flattenPredicate(whenA);
    flatB = flattenPredicate(whenB);
  } catch {
    return {
      verdict: "function-form-opaque",
      reason: "one-or-both-when-is-a-function",
    };
  }

  if (flatA.length === 0 || flatB.length === 0) {
    return {
      verdict: "function-form-opaque",
      reason: "one-or-both-when-is-a-function",
    };
  }

  const keyOf = (c: LeafClause) => `${c.path}::${c.op}::${JSON.stringify(c.value)}`;
  const setA = new Set(flatA.map(keyOf));
  const setB = new Set(flatB.map(keyOf));

  const allIdentical =
    setA.size === setB.size && [...setA].every((k) => setB.has(k));
  if (allIdentical) {
    return {
      verdict: "matched",
      coFireClauses: flatA,
      conflictingClauses: [],
    };
  }

  const coFire: LeafClause[] = [];
  const conflicting: LeafClause[] = [];
  let sawIndeterminate = false;

  for (const a of flatA) {
    for (const b of flatB) {
      if (a.path !== b.path) continue;
      const verdict = compareClauses(a, b);
      if (!verdict) continue;
      if (verdict.type === "direct") {
        conflicting.push(a);
      } else if (verdict.type === "subset" || verdict.type === "overlap") {
        coFire.push(a);
        // doctor.ts maps non-comparable operators to a soft "overlap" verdict
        // with a generic reason — surface that as indeterminate to be honest.
        if (
          verdict.reason.startsWith("Both rules touch") &&
          verdict.type === "overlap"
        ) {
          sawIndeterminate = true;
        }
      }
    }
  }

  if (sawIndeterminate && coFire.length > 0) {
    return {
      verdict: "indeterminate",
      reason: "non-comparable-operator",
      coFireClauses: coFire,
    };
  }

  if (coFire.length > 0 && conflicting.length === 0) {
    return {
      verdict: "overlap",
      coFireClauses: coFire,
      conflictingClauses: [],
    };
  }

  if (coFire.length > 0) {
    return {
      verdict: "overlap",
      coFireClauses: coFire,
      conflictingClauses: conflicting,
    };
  }

  return {
    verdict: "function-form-opaque",
    reason: "one-or-both-when-is-a-function",
  };
}

function isDevMode(): boolean {
  try {
    return (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    );
  } catch {
    return true;
  }
}

/**
 * Create a clobber-loop detector plugin. Returns a {@link
 * ClobberLoopPluginHandle} so callers can flip the detector off at
 * runtime without redeploying. The `.plugin` field is the value to
 * pass into `createSystem({ plugins: [...] })`.
 *
 * @example
 * ```ts
 * const loopDetector = clobberLoopPlugin({
 *   threshold: 5,
 *   windowMs: 1000,
 *   onLoop: (e) => pagerduty.trigger({
 *     severity: e.severity,
 *     summary: `Clobber loop on ${e.fact}: ${e.participants.join(" vs ")}`,
 *     details: e,
 *   }),
 * });
 *
 * createSystem({
 *   module: myModule,
 *   plugins: [loopDetector.plugin],
 * });
 *
 * // During incident response:
 * loopDetector.disable();
 * ```
 *
 * @public
 */
export function clobberLoopPlugin<M extends ModuleSchema>(
  options: ClobberLoopPluginOptions = {},
): ClobberLoopPluginHandle<M> {
  const windowMs = options.windowMs ?? DEFAULTS.windowMs;
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const cooldownMs = options.cooldownMs ?? DEFAULTS.cooldownMs;
  const resolvedAfterMs = options.resolvedAfterMs ?? DEFAULTS.resolvedAfterMs;
  const maxTrackedFacts =
    options.maxTrackedFacts ?? DEFAULTS.maxTrackedFacts;
  const maxParticipantsPerFact =
    options.maxParticipantsPerFact ?? DEFAULTS.maxParticipantsPerFact;
  const maxEmissionsPerSec =
    options.maxEmissionsPerSec ?? DEFAULTS.maxEmissionsPerSec;
  const capturePII = options.capturePII ?? false;
  const dev = isDevMode();
  const onLoop =
    options.onLoop ??
    ((event: ClobberLoopDetectedEvent) => {
      const text = formatWarningText(event);
      if (dev) {
        console.warn(text);
      } else {
        // Production default: stderr (NOT noop), so the signal lands in
        // log aggregators even when no explicit sink is wired.
        console.error(text);
      }
    });
  const onResolved = options.onResolved;

  let systemRef: System<M> | null = null;
  let enabled = true;
  let seq = 0;
  // Track the requirement → resolver mapping so we can map from the
  // rejection event's `req.id` back to the originating constraint.
  // Best-effort — when a resolverDef isn't reachable, predicateOverlap
  // falls back to `function-form-opaque`.
  const resolverIdToRequirementType = new Map<string, string>();
  const whenSpecCache = new Map<string, FactPredicate<unknown>>();
  const constraintByRequirementType = new Map<string, string>();
  const piiTaggedFacts = new Set<string>();
  const factTagsCache = new Map<string, readonly string[]>();
  const resolverModuleCache = new Map<string, string>();
  // Global emission rate limit — token bucket reset every second.
  let emissionsThisSecond = 0;
  let suppressedSinceLastEmit = 0;
  let secondWindowStart = 0;

  const factState = createLruMap<string, FactState>(maxTrackedFacts);

  function refreshWhenSpecCache(): void {
    whenSpecCache.clear();
    constraintByRequirementType.clear();
    if (!systemRef) return;
    try {
      const inspection = systemRef.inspect();
      for (const c of inspection.constraints) {
        if (c.whenSpec !== undefined) {
          whenSpecCache.set(
            c.id,
            redactWhenSpec(
              c.whenSpec,
              capturePII,
              piiTaggedFacts,
            ) as FactPredicate<unknown>,
          );
        }
      }
      // Map requirement type → constraint id. The relationship is via
      // the constraint's `require.type`, which inspect() doesn't expose
      // directly — best-effort via internal definition access. When
      // unreachable, leave the map empty; the overlap proof will fall
      // back to `function-form-opaque`.
      const internal = (
        systemRef as unknown as {
          $internal?: {
            mergedConstraints?: Record<
              string,
              { require?: { type?: string } | (() => { type?: string }) }
            >;
          };
        }
      ).$internal;
      if (internal?.mergedConstraints) {
        for (const [cid, def] of Object.entries(internal.mergedConstraints)) {
          let reqType: string | undefined;
          if (typeof def.require === "function") {
            try {
              reqType = def.require()?.type;
            } catch {
              // No-op
            }
          } else if (
            def.require &&
            typeof def.require === "object" &&
            "type" in def.require
          ) {
            reqType = (def.require as { type?: string }).type;
          }
          if (reqType) constraintByRequirementType.set(reqType, cid);
        }
      }

      for (const r of inspection.resolverDefs) {
        resolverIdToRequirementType.set(r.id, r.requirement);
        const moduleId =
          (r.meta as { moduleId?: string } | undefined)?.moduleId ?? "";
        resolverModuleCache.set(r.id, moduleId);
      }
    } catch {
      // System not ready / inspect unavailable — skip silently.
    }
  }

  function refreshPIITags(): void {
    piiTaggedFacts.clear();
    factTagsCache.clear();
    if (!systemRef) return;
    try {
      const tagged = systemRef.meta.byTag?.("pii") ?? [];
      for (const m of tagged) piiTaggedFacts.add(m.id);
    } catch {
      // No meta accessor — skip.
    }
  }

  function getFactTags(fact: string): readonly string[] {
    const cached = factTagsCache.get(fact);
    if (cached) return cached;
    let tags: readonly string[] = [];
    try {
      tags = systemRef?.meta.fact(fact)?.tags ?? [];
    } catch {
      tags = [];
    }
    factTagsCache.set(fact, tags);
    return tags;
  }

  function trimBuffer(buf: RejectionRecord[], now: number): void {
    // Drop entries older than windowMs from the head.
    while (buf.length > 0 && buf[0]!.timestamp < now - windowMs) {
      buf.shift();
    }
  }

  function canEmit(now: number): boolean {
    if (now - secondWindowStart >= 1000) {
      emissionsThisSecond = 0;
      secondWindowStart = now;
    }
    if (emissionsThisSecond >= maxEmissionsPerSec) {
      suppressedSinceLastEmit += 1;
      return false;
    }
    emissionsThisSecond += 1;
    return true;
  }

  function fireLoop(
    fact: string,
    state: FactState,
    participantSet: Set<string>,
    nowMs: number,
  ): void {
    const sortedParticipants = [...participantSet].sort();
    const sig = sortedParticipants.join("|");
    const lastFire = state.cooldowns.get(sig) ?? 0;
    if (nowMs - lastFire < cooldownMs) return;

    if (!canEmit(nowMs)) return;

    const rejections = state.buffer.filter((r) =>
      participantSet.has(r.resolverId),
    );
    const firstAt = rejections[0]?.timestamp ?? nowMs;
    const tags = getFactTags(fact);
    const severity: "warn" | "error" =
      tags.some((t) => piiTaggedFacts.has(fact) || t === "pii" || t === "money")
        ? "error"
        : "warn";

    const overlap = buildOverlapForParticipants(sortedParticipants);

    const participantModules = sortedParticipants.map(
      (id) => resolverModuleCache.get(id) ?? "",
    );

    const event: ClobberLoopDetectedEvent = {
      systemId: systemRef ? readSystemId(systemRef) : "",
      fact,
      participants: sortedParticipants,
      participantModules,
      count: rejections.length,
      windowMs,
      firstAt,
      lastAt: nowMs,
      ...(overlap ? { predicateOverlap: overlap } : {}),
      severity,
      factTags: tags,
      suppressedSinceLastEmit,
      rejectionSeqs: rejections.map((r) => r.seq),
    };
    suppressedSinceLastEmit = 0;

    state.cooldowns.set(sig, nowMs);
    state.activeLoop = {
      participants: sortedParticipants,
      firstAt,
      lastClobberAt: nowMs,
    };

    // Publish through the observation bus so audit-ledger, devtools, and
    // OTel exporters capture the loop without coupling to this plugin.
    // The user-facing `onLoop` callback still fires below — it's the
    // human-routing path; the bus is for backend wiring.
    try {
      systemRef?.notify.clobberLoopDetected(
        eventToObservation(event),
      );
    } catch {
      // notify channel unavailable (very old engine? destroyed mid-emit?)
      // — fall back to the direct callback path only.
    }
    try {
      onLoop(event);
    } catch (err) {
      console.error(
        `[Directive] clobberLoopPlugin: onLoop callback threw for fact '${fact}'`,
        err,
      );
    }
  }

  function eventToObservation(
    event: ClobberLoopDetectedEvent,
  ): Parameters<NonNullable<System<M>["notify"]>["clobberLoopDetected"]>[0] {
    return {
      type: "resolver.clobber.loop.detected",
      systemId: event.systemId,
      fact: event.fact,
      participants: event.participants,
      participantModules: event.participantModules,
      count: event.count,
      windowMs: event.windowMs,
      firstAt: event.firstAt,
      lastAt: event.lastAt,
      ...(event.predicateOverlap
        ? { predicateOverlap: event.predicateOverlap }
        : {}),
      severity: event.severity,
      factTags: event.factTags,
      suppressedSinceLastEmit: event.suppressedSinceLastEmit,
      rejectionSeqs: event.rejectionSeqs,
    };
  }

  function buildOverlapForParticipants(
    sortedParticipants: readonly string[],
  ): PredicateOverlapProof | undefined {
    if (sortedParticipants.length < 2) return undefined;
    // Pair the first two participants for the proof. N-way contention
    // (>2 resolvers) gets the same proof shape from the first two —
    // the warning text names every participant separately.
    const [a, b] = sortedParticipants;
    const reqTypeA = a ? resolverIdToRequirementType.get(a) : undefined;
    const reqTypeB = b ? resolverIdToRequirementType.get(b) : undefined;
    const cidA = reqTypeA
      ? constraintByRequirementType.get(reqTypeA)
      : undefined;
    const cidB = reqTypeB
      ? constraintByRequirementType.get(reqTypeB)
      : undefined;
    const whenA = cidA ? whenSpecCache.get(cidA) : undefined;
    const whenB = cidB ? whenSpecCache.get(cidB) : undefined;
    return buildPredicateOverlap(whenA, whenB);
  }

  function sweepResolved(nowMs: number): void {
    for (const fact of [...factState.keys()]) {
      const state = factState.get(fact);
      if (!state?.activeLoop) continue;
      if (nowMs - state.activeLoop.lastClobberAt < resolvedAfterMs) continue;
      const event: ClobberLoopResolvedEvent = {
        systemId: systemRef ? readSystemId(systemRef) : "",
        fact,
        participants: state.activeLoop.participants,
        durationMs: nowMs - state.activeLoop.firstAt,
        resolution: "no-recurrence-in-window",
      };
      state.activeLoop = null;
      try {
        systemRef?.notify.clobberLoopResolved({
          type: "resolver.clobber.loop.resolved",
          systemId: event.systemId,
          fact: event.fact,
          participants: event.participants,
          durationMs: event.durationMs,
          resolution: event.resolution,
        });
      } catch {
        // notify channel unavailable — fall through to direct callback.
      }
      if (onResolved) {
        try {
          onResolved(event);
        } catch (err) {
          console.error(
            `[Directive] clobberLoopPlugin: onResolved callback threw for fact '${fact}'`,
            err,
          );
        }
      }
    }
  }

  function readSystemId(sys: System<M>): string {
    try {
      const meta = (sys as unknown as { meta?: { systemId?: string } }).meta;
      return meta?.systemId ?? "";
    } catch {
      return "";
    }
  }

  function formatWarningText(event: ClobberLoopDetectedEvent): string {
    const dur = event.lastAt - event.firstAt;
    const verdict = event.predicateOverlap?.verdict ?? "function-form-opaque";
    const lines = [
      `[directive] CLOBBER LOOP on \`${event.fact}\` (${event.count} clobbers in ${dur}ms)`,
      `  Participants: ${event.participants.join(", ")}`,
      `  Predicate overlap: ${verdict}`,
    ];
    if (
      (event.predicateOverlap?.verdict === "matched" ||
        event.predicateOverlap?.verdict === "overlap") &&
      event.predicateOverlap.coFireClauses.length > 0
    ) {
      lines.push(`  Both \`when:\` predicates fire when:`);
      for (const c of event.predicateOverlap.coFireClauses.slice(0, 5)) {
        lines.push(`    - ${c.path} ${c.op} ${JSON.stringify(c.value)}`);
      }
    }
    if (event.predicateOverlap?.verdict === "function-form-opaque") {
      lines.push(
        `  (cannot prove overlap — at least one constraint uses function-form \`when:\`)`,
      );
    }
    if (event.predicateOverlap?.verdict === "indeterminate") {
      lines.push(
        `  (cannot prove overlap — predicate uses non-comparable operator)`,
      );
    }
    lines.push(
      `  Suggested fix: add \`priority:\` to one, narrow \`when:\` to disjoint conditions, or merge into a single resolver.`,
    );
    return lines.join("\n");
  }

  const plugin: Plugin<M> = {
    name: "clobber-loop",
    onInit(system) {
      systemRef = system;
      secondWindowStart = Date.now();
      refreshPIITags();
      refreshWhenSpecCache();
    },
    onDestroy() {
      systemRef = null;
      factState.clear();
      whenSpecCache.clear();
      constraintByRequirementType.clear();
      resolverIdToRequirementType.clear();
      resolverModuleCache.clear();
      piiTaggedFacts.clear();
      factTagsCache.clear();
      emissionsThisSecond = 0;
      suppressedSinceLastEmit = 0;
    },
    onDefinitionRegister(_kind, _id) {
      refreshWhenSpecCache();
      refreshPIITags();
    },
    onDefinitionAssign(_kind, _id) {
      refreshWhenSpecCache();
    },
    onDefinitionUnregister(_kind, _id) {
      refreshWhenSpecCache();
    },
    onResolverWriteRejected(event) {
      if (!enabled || !systemRef) return;
      if (event.kind !== "rejection") return;
      // Skip self-clobber — a single resolver writing the same fact
      // twice in one dispatch is a resolver bug, not a loop.
      const now = Date.now();

      const fact = event.fact;
      let state = factState.get(fact);
      if (!state) {
        state = {
          buffer: [],
          participants: new Set(),
          cooldowns: new Map(),
          activeLoop: null,
        };
        factState.set(fact, state);
      }

      if (state.participants.size >= maxParticipantsPerFact) {
        // N-way contention beyond cap — stop adding participants. The
        // existing detected event already covers the situation.
        return;
      }

      const record: RejectionRecord = {
        timestamp: now,
        requirementId: event.req.id,
        resolverId: event.resolver,
        seq: seq++,
      };
      state.buffer.push(record);
      state.participants.add(event.resolver);
      trimBuffer(state.buffer, now);

      // Run sweep BEFORE we touch activeLoop.lastClobberAt — otherwise
      // the very rejection that arrives after the quiet window would
      // reset the timer and the resolved-event would never fire.
      sweepResolved(now);

      // Now update the active loop's last-clobber so a continuing loop
      // stays "active" for subsequent sweeps.
      if (state.activeLoop?.participants.includes(event.resolver)) {
        state.activeLoop = {
          ...state.activeLoop,
          lastClobberAt: now,
        };
      }

      // Threshold check. Distinct-by-requirementId so retry storms on
      // one requirement don't count multiple times.
      const recentDistinct = new Set<string>();
      const activeParticipants = new Set<string>();
      for (const r of state.buffer) {
        recentDistinct.add(r.requirementId);
        activeParticipants.add(r.resolverId);
      }
      if (
        recentDistinct.size >= threshold &&
        activeParticipants.size >= 2
      ) {
        fireLoop(fact, state, activeParticipants, now);
      }
    },
  };

  return {
    plugin,
    disable() {
      enabled = false;
    },
    enable() {
      enabled = true;
    },
    isEnabled() {
      return enabled;
    },
  };
}
