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

import type { AgentRunner, AgentLike, RunResult, RunOptions, TokenUsage } from "./types.js";

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
  /** Token pricing (cost per million tokens). */
  pricing?: { inputPerMillion: number; outputPerMillion: number };
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
  onProviderSelected?: (providerName: string, reason: "constraint" | "cheapest" | "default") => void;
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

function createEmptyStats(): ProviderStats {
  return {
    callCount: 0,
    errorCount: 0,
    totalCost: 0,
    avgLatencyMs: 0,
    lastErrorAt: null,
  };
}

function calculateCost(usage: TokenUsage | undefined, pricing?: { inputPerMillion: number; outputPerMillion: number }): number {
  if (!usage || !pricing) {
    return 0;
  }

  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
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
export function createConstraintRouter(config: ConstraintRouterConfig): ConstraintRouterRunner {
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
    throw new Error("[Directive] createConstraintRouter: errorCooldownMs must be a non-negative finite number.");
  }

  // Validate
  const providerMap = new Map<string, RoutingProvider>();
  for (const provider of providers) {
    providerMap.set(provider.name, provider);
  }

  if (!providerMap.has(defaultProvider)) {
    throw new Error(`[Directive] Default provider "${defaultProvider}" not found in providers list.`);
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

  for (const provider of providers) {
    facts.providers[provider.name] = createEmptyStats();
  }

  // Total latency for averaging
  let totalLatencyMs = 0;

  // Pre-sort constraints at construction time (not per-call)
  const sortedConstraints = [...constraints].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  /** Select provider based on constraints and heuristics. */
  function selectProvider(): { provider: RoutingProvider; reason: "constraint" | "cheapest" | "default" } {
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
    const availableProviders = providers.filter((p) => {
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
    if (preferCheapest && availableProviders.length > 0) {
      const sorted = [...availableProviders].sort((a, b) => {
        const aCost = a.pricing ? a.pricing.inputPerMillion + a.pricing.outputPerMillion : Infinity;
        const bCost = b.pricing ? b.pricing.inputPerMillion + b.pricing.outputPerMillion : Infinity;
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
    if (availableProviders.length > 0 && !availableProviders.some((p) => p.name === defaultProvider)) {
      return { provider: availableProviders[0]!, reason: "default" };
    }

    // 5. Fallback to default
    return { provider: providerMap.get(defaultProvider)!, reason: "default" };
  }

  /** Update facts after a call. */
  function recordCall(providerName: string, latencyMs: number, usage: TokenUsage | undefined, pricing?: { inputPerMillion: number; outputPerMillion: number }, error?: Error): void {
    const stats = facts.providers[providerName] ?? createEmptyStats();

    stats.callCount++;
    facts.callCount++;

    if (error) {
      stats.errorCount++;
      facts.errorCount++;
      stats.lastErrorAt = Date.now();
    } else {
      const cost = calculateCost(usage, pricing);
      stats.totalCost += cost;
      facts.totalCost += cost;
    }

    // Update average latency
    totalLatencyMs += latencyMs;
    facts.avgLatencyMs = totalLatencyMs / facts.callCount;

    const statsTotal = stats.callCount > 0
      ? ((stats.avgLatencyMs * (stats.callCount - 1)) + latencyMs) / stats.callCount
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
    try { onProviderSelected?.(provider.name, reason); } catch { /* callback error must not disrupt routing flow */ }

    const startTime = Date.now();

    try {
      const result = await provider.runner<T>(agent, input, options);
      const latencyMs = Date.now() - startTime;

      recordCall(provider.name, latencyMs, result.tokenUsage, provider.pricing);

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));

      recordCall(provider.name, latencyMs, undefined, provider.pricing, error);

      throw error;
    }
  };

  /** Expose facts for external inspection (deep-cloned to prevent mutation). */
  Object.defineProperty(routerRunner, "facts", {
    get: () => {
      const clonedProviders: Record<string, ProviderStats> = Object.create(null) as Record<string, ProviderStats>;
      for (const key of Object.keys(facts.providers)) {
        clonedProviders[key] = { ...facts.providers[key]! };
      }

      return { ...facts, providers: clonedProviders };
    },
    enumerable: true,
  });

  return routerRunner as ConstraintRouterRunner;
}

/** Helper type for accessing router facts. */
export type ConstraintRouterRunner = AgentRunner & { readonly facts: RoutingFacts };
