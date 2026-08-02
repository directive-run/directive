/**
 * P4: Constraint-Driven Provider Routing — Directive's unique differentiator.
 *
 * Uses user-supplied constraints to select providers based on runtime state:
 * cost, latency, error rates, and compliance regions.
 *
 * Tracks per-provider stats (call count, error count, cost, latency) and
 * exposes them as {@link RoutingFacts} for constraint evaluation.
 *
 * @module
 *
 * @example
 * ```typescript
 * import { createConstraintRouter } from '@directive-run/ai';
 * import type { ConstraintRouterRunner } from '@directive-run/ai';
 *
 * const router = createConstraintRouter({
 *   providers: [
 *     { name: "openai", runner: openaiRunner, pricing: { inputPerMillion: 5, outputPerMillion: 15 } },
 *     { name: "anthropic", runner: anthropicRunner, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
 *     { name: "ollama", runner: ollamaRunner },
 *   ],
 *   defaultProvider: "openai",
 *   constraints: [
 *     { when: (facts) => facts.totalCost > 100, provider: "ollama", priority: 10 },
 *     { when: (facts) => facts.providers["openai"]?.errorCount > 5, provider: "anthropic" },
 *   ],
 *   preferCheapest: true, // opt-in to cheapest-provider heuristic
 *   onProviderSelected: (name, reason) => console.log(`Using ${name} (${reason})`),
 * });
 *
 * // Access runtime stats
 * console.log(router.facts.totalCost, router.facts.callCount);
 * ```
 */

import {
  DEFAULT_CHARS_PER_TOKEN,
  DEFAULT_OUTPUT_MULTIPLIER,
  type ResolvedPricing,
  type TokenPricing,
  type UnpricedReason,
  type UsageSnapshot,
  describeUnpricedReason,
  estimateCallCost,
  estimateInputTokens,
  priceCall,
  snapshotCallUsage,
  snapshotTokenPricing,
} from "./pricing.js";
import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Provider definition for the constraint router.
 *
 * Each provider has its own runner, optional pricing (for cost tracking
 * and cheapest-provider heuristic), and optional region tag.
 */
export interface RoutingProvider {
  /** Unique name for this provider. */
  name: string;
  /** The runner to use for this provider. */
  runner: AgentRunner;
  /**
   * Token pricing (cost per million tokens).
   *
   * Any adapter `*_PRICING` entry can be passed directly — they are published
   * in {@link TokenPricing} shape. Rates are validated and copied at
   * construction, so mutating the object afterwards has no effect on routing
   * or on `facts.totalCost`.
   */
  pricing?: TokenPricing;
  /** Geographic region (for compliance routing). */
  region?: string;
}

/**
 * Runtime facts tracked by the router — exposed for user constraints.
 *
 * Access via the `facts` property on the returned {@link ConstraintRouterRunner}.
 */
export interface RoutingFacts {
  totalCost: number;
  callCount: number;
  errorCount: number;
  lastProvider: string | null;
  avgLatencyMs: number;
  /** Per-provider stats. */
  providers: Record<string, ProviderStats>;
}

export interface ProviderStats {
  callCount: number;
  errorCount: number;
  totalCost: number;
  avgLatencyMs: number;
  lastErrorAt: number | null;
}

/** User-supplied routing constraint. */
export interface RoutingConstraint {
  /** When this constraint is active. */
  when: (facts: RoutingFacts) => boolean;
  /** The provider to route to. */
  provider: string;
  /** Priority — higher wins when multiple constraints match. @default 0 */
  priority?: number;
}

export interface ConstraintRouterConfig {
  /** Available providers. */
  providers: RoutingProvider[];
  /** Default provider name. */
  defaultProvider: string;
  /** User-supplied routing constraints. */
  constraints?: RoutingConstraint[];
  /** Called when a provider is selected. */
  onProviderSelected?: (
    providerName: string,
    reason: "constraint" | "cheapest" | "default",
  ) => void;
  /** Error cooldown — skip a provider for this many ms after an error. @default 30000 */
  errorCooldownMs?: number;
  /**
   * When true, automatically prefer the cheapest available provider
   * (based on pricing) when no user constraint matches.
   * When false, the default provider is used unless a constraint overrides it.
   * @default false
   */
  preferCheapest?: boolean;
}

// ============================================================================
// Internal
// ============================================================================

/** The public function name used in this module's error messages. */
const API = "createConstraintRouter";

/**
 * A provider read once at construction: its name, runner, region, and
 * validated rate snapshot. The hot path never reads the caller's provider
 * objects again.
 */
interface ResolvedProvider {
  name: string;
  runner: AgentRunner;
  pricing?: ResolvedPricing;
  region?: string;
}

function createEmptyStats(): ProviderStats {
  return {
    callCount: 0,
    errorCount: 0,
    totalCost: 0,
    avgLatencyMs: 0,
    lastErrorAt: null,
  };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a constraint-driven provider router.
 *
 * @example
 * ```typescript
 * const runner = createConstraintRouter({
 *   providers: [
 *     { name: "openai", runner: openaiRunner, pricing: { inputPerMillion: 5, outputPerMillion: 15 } },
 *     { name: "anthropic", runner: anthropicRunner, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
 *     { name: "ollama", runner: ollamaRunner },
 *   ],
 *   defaultProvider: "openai",
 *   constraints: [
 *     { when: (facts) => facts.totalCost > 100, provider: "ollama", priority: 10 },
 *     { when: (facts) => facts.providers["openai"]?.errorCount > 5, provider: "anthropic" },
 *   ],
 * });
 * ```
 */
export function createConstraintRouter(
  config: ConstraintRouterConfig,
): ConstraintRouterRunner {
  const {
    providers,
    defaultProvider,
    constraints = [],
    onProviderSelected,
    errorCooldownMs = 30000,
    preferCheapest = false,
  } = config;

  // Validate config
  if (!Number.isFinite(errorCooldownMs) || errorCooldownMs < 0) {
    throw new Error(
      "[Directive] createConstraintRouter: errorCooldownMs must be a non-negative finite number.",
    );
  }

  // Flatten every provider into an owned record at construction. Each field is
  // read exactly once and each rate is validated, for the same reason a budget
  // snapshots its pricing: reading `provider.pricing` live on the hot path is a
  // check-then-use gap. A negative rate would win the cheapest-provider
  // heuristic on every call and drive `facts.totalCost` downwards, and a rate
  // mutated to NaN after construction would poison `facts.totalCost`
  // permanently, so a cost-based failover constraint would never fire again.
  const resolvedProviders: ResolvedProvider[] = Array.from(
    providers,
    (provider) => {
      const name = provider.name;
      const providerRunner = provider.runner;
      const providerPricing = provider.pricing;
      const region = provider.region;

      return {
        name,
        runner: providerRunner,
        ...(providerPricing
          ? {
              pricing: snapshotTokenPricing(
                providerPricing,
                `providers[${name}].pricing`,
                API,
              ),
            }
          : {}),
        ...(region !== undefined ? { region } : {}),
      };
    },
  );

  // Validate
  const providerMap = new Map<string, ResolvedProvider>();
  for (const provider of resolvedProviders) {
    providerMap.set(provider.name, provider);
  }

  if (!providerMap.has(defaultProvider)) {
    throw new Error(
      `[Directive] Default provider "${defaultProvider}" not found in providers list.`,
    );
  }

  // Initialize facts
  const facts: RoutingFacts = {
    totalCost: 0,
    callCount: 0,
    errorCount: 0,
    lastProvider: null,
    avgLatencyMs: 0,
    providers: Object.create(null) as Record<string, ProviderStats>,
  };

  for (const provider of resolvedProviders) {
    facts.providers[provider.name] = createEmptyStats();
  }

  // Total latency for averaging
  let totalLatencyMs = 0;

  let unpricedCalls = 0;
  const warnedReasons = new Set<UnpricedReason>();

  /**
   * Price one call for the routing facts, and count the ones the provider gave
   * no usable number for.
   *
   * `facts.totalCost` is what user constraints test against, so what happens to
   * an unpriceable call decides whether a cost-based failover ever fires. This
   * used to return `0` — no cost, no count, no warning — which reads as "that
   * call was free" and is indistinguishable from a provider that genuinely
   * bills nothing. A runner that never populates `tokenUsage` therefore held
   * `facts.totalCost` at exactly zero for the life of the router, and a
   * `facts.totalCost > 10` failover never fired once. The pre-call estimate is
   * a poor number and a far better one than that.
   *
   * A provider with no pricing configured still contributes nothing and is not
   * counted: that is the caller declining to price it, not a provider failing
   * to report.
   */
  function chargeCall(
    snapshot: UsageSnapshot,
    pricing: ResolvedPricing,
    estimate: number,
  ): number {
    const priced = priceCall(snapshot, pricing, estimate);

    if (priced.basis === "estimated") {
      unpricedCalls++;
      if (!warnedReasons.has(priced.reason)) {
        warnedReasons.add(priced.reason);
        console.warn(
          `[Directive] ${API}: ${describeUnpricedReason(priced.reason)}. The pre-call estimate is being charged to facts.totalCost instead — see getUnpricedCallCount() for how many calls this covers. Logged once per condition.`,
        );
      }
    }

    return priced.cost;
  }

  // Pre-sort constraints at construction time (not per-call)
  const sortedConstraints = [...constraints].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  /** Select provider based on constraints and heuristics. */
  function selectProvider(): {
    provider: ResolvedProvider;
    reason: "constraint" | "cheapest" | "default";
  } {
    const now = Date.now();

    for (const constraint of sortedConstraints) {
      try {
        if (constraint.when(facts)) {
          const provider = providerMap.get(constraint.provider);
          if (provider) {
            return { provider, reason: "constraint" };
          }
        }
      } catch {
        // Throwing constraint is skipped — do not crash the router
      }
    }

    // 2. Filter out providers in error cooldown
    const availableProviders = resolvedProviders.filter((p) => {
      const stats = facts.providers[p.name];
      if (!stats) {
        return true;
      }
      if (stats.lastErrorAt && now - stats.lastErrorAt < errorCooldownMs) {
        return false;
      }

      return true;
    });

    // 3. Cheapest-provider heuristic (opt-in via preferCheapest)
    //
    // Compared on input + output only: those are the rates every provider
    // charges on every call, so they are the comparable part. Cache rates
    // depend on a caching strategy the router knows nothing about.
    if (preferCheapest && availableProviders.length > 0) {
      const sorted = [...availableProviders].sort((a, b) => {
        const aCost = a.pricing
          ? a.pricing.inputPerMillion + a.pricing.outputPerMillion
          : Number.POSITIVE_INFINITY;
        const bCost = b.pricing
          ? b.pricing.inputPerMillion + b.pricing.outputPerMillion
          : Number.POSITIVE_INFINITY;
        if (aCost !== bCost) {
          return aCost - bCost;
        }
        // Tie-break: prefer default provider
        if (a.name === defaultProvider) {
          return -1;
        }
        if (b.name === defaultProvider) {
          return 1;
        }

        return 0;
      });

      if (sorted[0] !== providerMap.get(defaultProvider)) {
        return { provider: sorted[0]!, reason: "cheapest" };
      }
    }

    // 4. If default is in cooldown, pick the first available
    if (
      availableProviders.length > 0 &&
      !availableProviders.some((p) => p.name === defaultProvider)
    ) {
      return { provider: availableProviders[0]!, reason: "default" };
    }

    // 5. Fallback to default
    return { provider: providerMap.get(defaultProvider)!, reason: "default" };
  }

  /** Update facts after a call. */
  function recordCall(
    providerName: string,
    latencyMs: number,
    snapshot: UsageSnapshot,
    estimate: number,
    pricing?: ResolvedPricing,
    error?: Error,
  ): void {
    const stats = facts.providers[providerName] ?? createEmptyStats();

    stats.callCount++;
    facts.callCount++;

    if (error) {
      stats.errorCount++;
      facts.errorCount++;
      stats.lastErrorAt = Date.now();
    }

    // A failed call is still charged. A throw is not a refund: a runner that
    // rejects a completion after the provider generated it — a structured-
    // output parse failure, an output guardrail, post-stream validation — has
    // already spent the money. Recording nothing meant every retry burned real
    // spend that `facts.totalCost` never saw, so a cost-threshold failover
    // constraint stayed unreachable exactly when calls were failing hardest.
    // `snapshot` carries `failed-call` on that path, so the estimate is charged
    // and counted through the same door as every other unpriceable call.
    const cost = pricing ? chargeCall(snapshot, pricing, estimate) : 0;
    stats.totalCost += cost;
    facts.totalCost += cost;

    // Update average latency
    totalLatencyMs += latencyMs;
    facts.avgLatencyMs = totalLatencyMs / facts.callCount;

    const statsTotal =
      stats.callCount > 0
        ? (stats.avgLatencyMs * (stats.callCount - 1) + latencyMs) /
          stats.callCount
        : latencyMs;
    stats.avgLatencyMs = statsTotal;

    facts.providers[providerName] = stats;
    facts.lastProvider = providerName;
  }

  const routerRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const { provider, reason } = selectProvider();
    try {
      onProviderSelected?.(provider.name, reason);
    } catch {
      /* callback error must not disrupt routing flow */
    }

    // What this call is charged when the provider reports nothing usable. The
    // estimate reads the input string alone — no instructions, no history, no
    // tools — so it runs under the real bill, and the shared per-token defaults
    // are approximations of an approximation. It exists so that a cost fact
    // moves at all: a `totalCost` pinned at zero is not a smaller error than a
    // low one, it is a different kind of error, and it is the kind that makes a
    // failover constraint unreachable.
    const estimate = provider.pricing
      ? estimateCallCost(
          estimateInputTokens(input, DEFAULT_CHARS_PER_TOKEN),
          provider.pricing,
          DEFAULT_OUTPUT_MULTIPLIER,
        )
      : 0;

    const startTime = Date.now();

    try {
      const result = await provider.runner<T>(agent, input, options);
      const latencyMs = Date.now() - startTime;

      // Read the provider's usage exactly once, here, and pass the value on.
      // Nothing downstream holds the provider's object, so nothing downstream
      // can be answered differently on a second read.
      recordCall(
        provider.name,
        latencyMs,
        snapshotCallUsage(result),
        estimate,
        provider.pricing,
      );

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));

      recordCall(
        provider.name,
        latencyMs,
        { kind: "unusable", reason: "failed-call" },
        estimate,
        provider.pricing,
        error,
      );

      throw error;
    }
  };

  /** Expose facts for external inspection (deep-cloned to prevent mutation). */
  Object.defineProperty(routerRunner, "facts", {
    get: () => {
      const clonedProviders: Record<string, ProviderStats> = Object.create(
        null,
      ) as Record<string, ProviderStats>;
      for (const key of Object.keys(facts.providers)) {
        clonedProviders[key] = { ...facts.providers[key]! };
      }

      return { ...facts, providers: clonedProviders };
    },
    enumerable: true,
  });

  /**
   * How many calls were charged at the pre-call estimate rather than at what
   * the provider billed.
   *
   * The peer of `withBudget`'s accessor of the same name, and here for the same
   * reason: a `facts.totalCost` built partly from estimates is not wrong, but a
   * caller reading it for a failover threshold should be able to find out. A
   * count that tracks the call count means the runner never reports usable
   * usage and `totalCost` is entirely estimated.
   */
  function getUnpricedCallCount(): number {
    return unpricedCalls;
  }

  const accessors = routerRunner as unknown as Record<string, unknown>;
  accessors.getUnpricedCallCount = getUnpricedCallCount;

  return routerRunner as ConstraintRouterRunner;
}

/** Helper type for accessing router facts and pricing coverage. */
export type ConstraintRouterRunner = AgentRunner & {
  readonly facts: RoutingFacts;
  /**
   * Get the number of calls whose cost was charged at the pre-call estimate
   * rather than at what the provider billed — no `tokenUsage`, an unusable
   * token count, or a cost that priced out non-finite.
   */
  getUnpricedCallCount(): number;
};
