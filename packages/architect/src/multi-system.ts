/**
 * Cross-system orchestration for AI Architect.
 *
 * Wraps multiple Directive systems into a composite system proxy,
 * allowing a single architect instance to observe and manage facts
 * across system boundaries.
 *
 * @module
 */

import type { System } from "@directive-run/core";
import type {
  AIArchitect,
  AIArchitectOptions,
} from "./types.js";
import { createAIArchitect } from "./architect.js";
import { computeHealthScore, type HealthScore } from "./health.js";

// ============================================================================
// Types
// ============================================================================

/** Options for creating a multi-system architect. */
export interface MultiSystemArchitectOptions extends Omit<AIArchitectOptions, "system"> {
  /** Named systems to orchestrate. */
  systems: Record<string, System>;
  /** Weight per system for aggregate health score (0-1). Defaults to equal weights. */
  healthWeights?: Record<string, number>;
}

/** Extended architect interface for multi-system orchestration. */
export interface MultiSystemArchitect extends AIArchitect {
  /** Get health score for a specific system. */
  getSystemHealth(name: string): HealthScore;
  /** Get weighted aggregate health across all systems. */
  getAggregateHealth(): HealthScore & { perSystem: Record<string, HealthScore> };
  /** Get all managed system names. */
  getSystems(): string[];
}

// ============================================================================
// Separator
// ============================================================================

const SEPARATOR = "::";

// ============================================================================
// Composite System Proxy
// ============================================================================

function createCompositeSystem(
  systems: Record<string, System>,
): System {
  const systemEntries = Object.entries(systems);

  // Build composite facts proxy
  const factsHandler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }

      const sepIdx = prop.indexOf(SEPARATOR);
      if (sepIdx === -1) {
        // Try first system as default
        const [, firstSystem] = systemEntries[0] ?? [];

        return firstSystem
          ? (firstSystem.facts as Record<string, unknown>)[prop]
          : undefined;
      }

      const sysName = prop.slice(0, sepIdx);
      const factKey = prop.slice(sepIdx + SEPARATOR.length);
      const sys = systems[sysName];

      return sys ? (sys.facts as Record<string, unknown>)[factKey] : undefined;
    },

    set(_target, prop, value) {
      if (typeof prop !== "string") {
        return false;
      }

      const sepIdx = prop.indexOf(SEPARATOR);
      if (sepIdx === -1) {
        const [, firstSystem] = systemEntries[0] ?? [];
        if (firstSystem) {
          (firstSystem.facts as Record<string, unknown>)[prop] = value;

          return true;
        }

        return false;
      }

      const sysName = prop.slice(0, sepIdx);
      const factKey = prop.slice(sepIdx + SEPARATOR.length);
      const sys = systems[sysName];
      if (sys) {
        (sys.facts as Record<string, unknown>)[factKey] = value;

        return true;
      }

      return false;
    },

    ownKeys() {
      const keys: string[] = [];
      for (const [name, sys] of systemEntries) {
        for (const key of Object.keys(sys.facts as Record<string, unknown>)) {
          keys.push(`${name}${SEPARATOR}${key}`);
        }
      }

      return keys;
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }

      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: factsHandler.get!({} as Record<string, unknown>, prop, undefined),
      };
    },

    has(_target, prop) {
      if (typeof prop !== "string") {
        return false;
      }

      const sepIdx = prop.indexOf(SEPARATOR);
      if (sepIdx === -1) {
        return false;
      }

      const sysName = prop.slice(0, sepIdx);

      return sysName in systems;
    },
  };

  const compositeFacts = new Proxy({} as Record<string, unknown>, factsHandler);

  // Composite inspect merges all system inspections
  function inspect() {
    const result: Record<string, unknown> = {
      facts: { ...compositeFacts },
      constraints: [] as unknown[],
      resolvers: [] as unknown[],
      derivations: [] as unknown[],
      effects: [] as unknown[],
      pendingRequirements: [] as unknown[],
    };

    for (const [name, sys] of systemEntries) {
      const inspection = sys.inspect() as unknown as Record<string, unknown>;

      // Namespace constraint/resolver IDs
      if (Array.isArray(inspection.constraints)) {
        (result.constraints as unknown[]).push(
          ...inspection.constraints.map((c: { id?: string }) => ({
            ...c,
            id: c.id ? `${name}${SEPARATOR}${c.id}` : c.id,
          })),
        );
      }

      if (Array.isArray(inspection.pendingRequirements)) {
        (result.pendingRequirements as unknown[]).push(...inspection.pendingRequirements);
      }
    }

    return result;
  }

  // Subscribe delegates to all systems with key routing
  function subscribe(keys: string[], listener: () => void): () => void {
    const unsubs: Array<() => void> = [];
    const keysBySystem = new Map<string, string[]>();

    for (const key of keys) {
      const sepIdx = key.indexOf(SEPARATOR);
      if (sepIdx === -1) {
        continue;
      }

      const sysName = key.slice(0, sepIdx);
      const factKey = key.slice(sepIdx + SEPARATOR.length);
      const existing = keysBySystem.get(sysName);
      if (existing) {
        existing.push(factKey);
      } else {
        keysBySystem.set(sysName, [factKey]);
      }
    }

    for (const [sysName, sysKeys] of keysBySystem) {
      const sys = systems[sysName];
      if (sys) {
        unsubs.push(sys.subscribe(sysKeys as string[], listener));
      }
    }

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }

  // Settled change fires when any system settles
  function onSettledChange(listener: () => void): () => void {
    const unsubs = systemEntries.map(([, sys]) =>
      sys.onSettledChange(listener),
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }

  // Batch delegates to all systems
  function batch(fn: () => void): void {
    // Use first system's batch — mutations route through proxy
    const [, firstSystem] = systemEntries[0] ?? [];
    if (firstSystem) {
      firstSystem.batch(fn);
    } else {
      fn();
    }
  }

  function explain(id: string): unknown {
    const sepIdx = id.indexOf(SEPARATOR);
    if (sepIdx === -1) {
      return null;
    }

    const sysName = id.slice(0, sepIdx);
    const localId = id.slice(sepIdx + SEPARATOR.length);
    const sys = systems[sysName];

    return sys ? sys.explain(localId) : null;
  }

  // Route dynamic registration to appropriate system
  function createRegistryProxy(
    type: "constraints" | "resolvers" | "effects" | "derivations",
  ) {
    type Registry = { register: (id: string, def: unknown) => void; unregister: (id: string) => void; listDynamic: () => string[]; isDynamic: (id: string) => boolean };
    function getRegistry(sys: System): Registry {
      return (sys as unknown as Record<string, Registry>)[type]!;
    }

    function resolveSystem(id: string): { sys: System; localId: string } | null {
      const sepIdx = id.indexOf(SEPARATOR);
      const sysName = sepIdx >= 0 ? id.slice(0, sepIdx) : systemEntries[0]?.[0];
      const localId = sepIdx >= 0 ? id.slice(sepIdx + SEPARATOR.length) : id;
      const sys = sysName ? systems[sysName] : undefined;

      return sys ? { sys, localId } : null;
    }

    return {
      register(id: string, def: unknown) {
        const resolved = resolveSystem(id);
        if (resolved) {
          getRegistry(resolved.sys).register(resolved.localId, def);
        }
      },

      unregister(id: string) {
        const resolved = resolveSystem(id);
        if (resolved) {
          getRegistry(resolved.sys).unregister(resolved.localId);
        }
      },

      listDynamic(): string[] {
        const results: string[] = [];
        for (const [name, sys] of systemEntries) {
          const registry = getRegistry(sys);
          if (registry) {
            for (const id of registry.listDynamic()) {
              results.push(`${name}${SEPARATOR}${id}`);
            }
          }
        }

        return results;
      },

      isDynamic(id: string): boolean {
        const resolved = resolveSystem(id);

        return resolved ? getRegistry(resolved.sys).isDynamic(resolved.localId) : false;
      },
    };
  }

  return {
    facts: compositeFacts,
    inspect,
    subscribe,
    onSettledChange,
    batch,
    explain,
    constraints: createRegistryProxy("constraints"),
    resolvers: createRegistryProxy("resolvers"),
    effects: createRegistryProxy("effects"),
    derivations: createRegistryProxy("derivations"),
  } as unknown as System;
}

// ============================================================================
// Multi-System Architect
// ============================================================================

/**
 * Create an AI Architect that manages multiple Directive systems.
 *
 * Facts are namespaced as `"systemName::factKey"`. The architect observes
 * and modifies all systems through a single composite system proxy.
 *
 * @param options - Multi-system architect configuration.
 * @returns A MultiSystemArchitect instance.
 *
 * @example
 * ```typescript
 * const multi = createMultiSystemArchitect({
 *   systems: { api: apiSystem, worker: workerSystem },
 *   runner,
 *   budget: { tokens: 50_000, dollars: 5 },
 * });
 *
 * const analysis = await multi.analyze("Why is the API slow?");
 * const apiHealth = multi.getSystemHealth("api");
 * ```
 */
export function createMultiSystemArchitect(
  options: MultiSystemArchitectOptions,
): MultiSystemArchitect {
  const { systems, healthWeights, ...architectOptions } = options;
  const systemNames = Object.keys(systems);

  if (systemNames.length === 0) {
    throw new Error("createMultiSystemArchitect requires at least one system");
  }

  // Build composite system
  const compositeSystem = createCompositeSystem(systems);

  // Augment context with system descriptions
  const systemDescription = systemNames
    .map((name) => {
      const sys = systems[name];
      const factKeys = sys ? Object.keys(sys.facts as Record<string, unknown>) : [];

      return `- ${name}: ${factKeys.join(", ")}`;
    })
    .join("\n");

  const enrichedContext = {
    ...architectOptions.context,
    description: `Multi-system orchestrator managing: ${systemNames.join(", ")}`,
    notes: [
      ...(architectOptions.context?.notes ?? []),
      `Systems and their facts:\n${systemDescription}`,
      `Facts are namespaced as "systemName::factKey"`,
    ],
  };

  // Create the underlying architect
  const architect = createAIArchitect({
    ...architectOptions,
    system: compositeSystem,
    context: enrichedContext,
  });

  // Health scoring
  function getSystemHealth(name: string): HealthScore {
    const sys = systems[name];
    if (!sys) {
      throw new Error(`Unknown system: ${name}`);
    }

    return computeHealthScore(sys);
  }

  function getAggregateHealth(): HealthScore & { perSystem: Record<string, HealthScore> } {
    const perSystem: Record<string, HealthScore> = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const allWarnings: string[] = [];
    let aggregateBreakdown = { settled: 0, unmetRequirements: 0, constraintHealth: 0, resolverHealth: 0 };

    for (const name of systemNames) {
      const sys = systems[name];
      if (!sys) {
        continue;
      }

      const health = computeHealthScore(sys);
      perSystem[name] = health;

      const weight = healthWeights?.[name] ?? 1;
      totalWeightedScore += health.score * weight;
      totalWeight += weight;
      allWarnings.push(...health.warnings.map((w: string) => `[${name}] ${w}`));

      // Sum breakdowns (will be averaged below)
      aggregateBreakdown.settled += health.breakdown.settled * weight;
      aggregateBreakdown.unmetRequirements += health.breakdown.unmetRequirements * weight;
      aggregateBreakdown.constraintHealth += health.breakdown.constraintHealth * weight;
      aggregateBreakdown.resolverHealth += health.breakdown.resolverHealth * weight;
    }

    const aggregateScore = totalWeight > 0
      ? Math.round(totalWeightedScore / totalWeight)
      : 100;

    if (totalWeight > 0) {
      aggregateBreakdown = {
        settled: Math.round(aggregateBreakdown.settled / totalWeight),
        unmetRequirements: Math.round(aggregateBreakdown.unmetRequirements / totalWeight),
        constraintHealth: Math.round(aggregateBreakdown.constraintHealth / totalWeight),
        resolverHealth: Math.round(aggregateBreakdown.resolverHealth / totalWeight),
      };
    }

    return {
      score: aggregateScore,
      breakdown: aggregateBreakdown,
      warnings: allWarnings,
      perSystem,
    };
  }

  function getSystems(): string[] {
    return [...systemNames];
  }

  // Extend the architect with multi-system methods
  return Object.assign(architect, {
    getSystemHealth,
    getAggregateHealth,
    getSystems,
  }) as MultiSystemArchitect;
}
