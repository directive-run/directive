/**
 * What-If Analysis — predict the effects of an action without applying it.
 *
 * Phase 1: Static evaluation for single-step analysis.
 * Phase 2: Multi-step cascade simulation when cascadeSteps > 1.
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  ArchitectAction,
  WhatIfOptions,
  WhatIfResult,
  WhatIfStep,
  WhatIfCascade,
  WhatIfCascadeRound,
} from "./types.js";
import { compileSandboxed, SandboxError } from "./sandbox.js";

/**
 * Analyze what would happen if an action were applied,
 * without actually modifying the system.
 */
export async function createWhatIfAnalysis(
  system: System,
  action: ArchitectAction,
  runner?: AgentRunner,
  options?: WhatIfOptions,
  onTokens?: (tokens: number) => void,
): Promise<WhatIfResult> {
  const steps: WhatIfStep[] = [];
  let riskScore = 0;

  const facts = { ...system.facts } as Record<string, unknown>;

  switch (action.tool) {
    case "create_constraint": {
      const step = analyzeCreateConstraint(action, facts);
      steps.push(step);
      riskScore += step.factChanges.length * 2 + step.constraintsFiring.length * 3;
      break;
    }

    case "create_resolver": {
      const step = analyzeCreateResolver(action, facts);
      steps.push(step);
      riskScore += step.factChanges.length * 2 + step.resolversActivating.length;
      break;
    }

    case "set_fact": {
      const step = analyzeSetFact(action, facts);
      steps.push(step);
      riskScore += step.factChanges.length * 2;
      break;
    }

    case "remove_definition": {
      const step = analyzeRemoveDefinition(action);
      steps.push(step);
      riskScore += 3; // Removing definitions is moderately risky
      break;
    }

    default: {
      steps.push({
        description: `Execute ${action.tool} — effects cannot be predicted statically`,
        factChanges: [],
        constraintsFiring: [],
        resolversActivating: [],
      });
      riskScore += 1;
    }
  }

  // Cascade simulation (Phase 2)
  let cascade: WhatIfCascade | undefined;
  const cascadeSteps = options?.cascadeSteps ?? 1;
  if (cascadeSteps > 1) {
    cascade = simulateCascade(system, facts, steps, cascadeSteps, options?.simulationTimeout ?? 10_000);
    riskScore += cascade.rounds.length * 5;
    riskScore += cascade.totalConstraintsFired * 3;
    if (!cascade.settled) {
      riskScore += 10;
    }
  }

  // Optional LLM summary
  let summary: string | undefined;
  if (options?.includeSummary && runner) {
    summary = await getLLMSummary(runner, action, steps, facts, onTokens);
  }

  return {
    action,
    steps,
    riskScore,
    summary,
    cascade,
  };
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeCreateConstraint(
  action: ArchitectAction,
  facts: Record<string, unknown>,
): WhatIfStep {
  const args = action.arguments;
  const whenCode = args.whenCode as string | undefined;
  const require = args.require as Record<string, unknown> | undefined;

  const constraintsFiring: string[] = [];
  let description = `Create constraint "${args.id}" — `;

  if (whenCode) {
    // Try to evaluate the when condition against current facts
    try {
      const compiled = compileSandboxed(`return (${whenCode})`, {
        timeout: 1000,
        maxCodeSize: 2048,
      });
      const result = compiled.execute(facts);
      const wouldFire = Boolean(result);

      if (wouldFire) {
        description += "would FIRE immediately with current facts";
        constraintsFiring.push(String(args.id));
      } else {
        description += "would NOT fire with current facts";
      }
    } catch (err) {
      if (err instanceof SandboxError) {
        description += `cannot evaluate: ${err.message}`;
      } else {
        description += "evaluation failed";
      }
    }
  } else {
    description += "no whenCode provided";
  }

  return {
    description,
    factChanges: [],
    constraintsFiring,
    resolversActivating: require?.type
      ? [`resolvers matching "${require.type}"`]
      : [],
  };
}

function analyzeCreateResolver(
  action: ArchitectAction,
  facts: Record<string, unknown>,
): WhatIfStep {
  const args = action.arguments;
  const resolveCode = args.resolveCode as string | undefined;
  const requirement = args.requirement as string | undefined;
  const factChanges: Array<{ key: string; from: unknown; to: unknown }> = [];
  const resolversActivating: string[] = [];

  let description = `Create resolver "${args.id}" for "${requirement}" — `;

  if (resolveCode) {
    // Try to predict fact changes by running in sandbox
    try {
      const factsCopy: Record<string, unknown> = {
        ...JSON.parse(JSON.stringify(facts)),
        __req: {},
      };
      const compiled = compileSandboxed(resolveCode, {
        timeout: 1000,
        maxCodeSize: 2048,
        factWriteAccess: true,
      });
      compiled.execute(factsCopy);

      // Diff facts
      for (const key of Object.keys(factsCopy)) {
        if (key === "__req") {
          continue;
        }

        if (JSON.stringify(factsCopy[key]) !== JSON.stringify(facts[key])) {
          factChanges.push({
            key,
            from: facts[key],
            to: factsCopy[key],
          });
        }
      }

      if (factChanges.length > 0) {
        description += `would change ${factChanges.length} fact(s)`;
        resolversActivating.push(String(args.id));
      } else {
        description += "no predicted fact changes";
      }
    } catch {
      description += "cannot predict fact changes (sandbox evaluation failed)";
    }
  } else {
    description += "no resolveCode provided";
  }

  return {
    description,
    factChanges,
    constraintsFiring: [],
    resolversActivating,
  };
}

function analyzeSetFact(
  action: ArchitectAction,
  facts: Record<string, unknown>,
): WhatIfStep {
  const key = action.arguments.key as string;
  const valueStr = action.arguments.value as string;

  let value: unknown;
  try {
    value = JSON.parse(valueStr);
  } catch {
    value = valueStr;
  }

  const from = facts[key];
  const changed = JSON.stringify(from) !== JSON.stringify(value);

  return {
    description: changed
      ? `Set fact "${key}" from ${JSON.stringify(from)} to ${JSON.stringify(value)}`
      : `Set fact "${key}" to same value (no-op)`,
    factChanges: changed ? [{ key, from, to: value }] : [],
    constraintsFiring: [],
    resolversActivating: [],
  };
}

function analyzeRemoveDefinition(action: ArchitectAction): WhatIfStep {
  const type = action.arguments.type as string;
  const id = action.arguments.id as string;

  return {
    description: `Remove ${type} "${id}" — any dependent behavior will stop`,
    factChanges: [],
    constraintsFiring: [],
    resolversActivating: [],
  };
}

// ============================================================================
// Cascade Simulation
// ============================================================================

function simulateCascade(
  system: System,
  initialFacts: Record<string, unknown>,
  initialSteps: WhatIfStep[],
  maxSteps: number,
  timeoutMs: number,
): WhatIfCascade {
  const startTime = Date.now();
  const clampedSteps = Math.min(Math.max(maxSteps, 2), 5);
  const rounds: WhatIfCascadeRound[] = [];

  // Deep clone facts — start from initial analysis state
  let currentFacts: Record<string, unknown> = JSON.parse(JSON.stringify(initialFacts));

  // Apply initial fact changes from the first static analysis
  for (const step of initialSteps) {
    for (const change of step.factChanges) {
      currentFacts[change.key] = change.to;
    }
  }

  let totalConstraintsFired = 0;
  let totalResolversActivated = 0;
  let settled = false;

  // Get system constraints and resolvers for simulation
  const inspection = system.inspect() as unknown as Record<string, unknown>;
  const constraints = extractConstraintDefs(inspection);
  const resolvers = extractResolverDefs(inspection);

  for (let round = 1; round <= clampedSteps; round++) {
    // Timeout check
    if (Date.now() - startTime > timeoutMs) {
      break;
    }

    const factsSnapshot = { ...currentFacts };
    const constraintsFired: string[] = [];
    const resolversActivated: string[] = [];
    const factChanges: Array<{ key: string; from: unknown; to: unknown }> = [];

    // Evaluate each constraint against current facts
    for (const constraint of constraints) {
      try {
        const compiled = compileSandboxed(`return (${constraint.whenCode})`, {
          timeout: 500,
          maxCodeSize: 2048,
        });
        const result = compiled.execute(currentFacts);

        if (Boolean(result)) {
          constraintsFired.push(constraint.id);

          // Find matching resolver and simulate
          if (constraint.requirementType) {
            const resolver = resolvers.find((r) => r.requirement === constraint.requirementType);
            if (resolver) {
              resolversActivated.push(resolver.id);

              // Simulate resolver execution
              try {
                const factsCopy: Record<string, unknown> = {
                  ...JSON.parse(JSON.stringify(currentFacts)),
                  __req: constraint.requireObj ?? {},
                };
                const resolverCompiled = compileSandboxed(resolver.resolveCode, {
                  timeout: 500,
                  maxCodeSize: 2048,
                  factWriteAccess: true,
                });
                resolverCompiled.execute(factsCopy);

                // Diff and apply changes
                for (const key of Object.keys(factsCopy)) {
                  if (key === "__req") {
                    continue;
                  }

                  if (JSON.stringify(factsCopy[key]) !== JSON.stringify(currentFacts[key])) {
                    factChanges.push({
                      key,
                      from: currentFacts[key],
                      to: factsCopy[key],
                    });
                    currentFacts[key] = factsCopy[key];
                  }
                }
              } catch {
                // Resolver simulation failed — skip
              }
            }
          }
        }
      } catch {
        // Constraint evaluation failed — skip
      }
    }

    totalConstraintsFired += constraintsFired.length;
    totalResolversActivated += resolversActivated.length;

    rounds.push({
      round,
      factsSnapshot,
      constraintsFired,
      resolversActivated,
      factChanges,
    });

    // Settled: no constraints fired this round
    if (constraintsFired.length === 0) {
      settled = true;
      break;
    }
  }

  return {
    rounds,
    finalFacts: { ...currentFacts },
    totalConstraintsFired,
    totalResolversActivated,
    settled,
  };
}

/** Extract constraint info from system inspection for simulation. */
function extractConstraintDefs(inspection: Record<string, unknown>): Array<{
  id: string;
  whenCode: string;
  requirementType: string;
  requireObj?: Record<string, unknown>;
}> {
  const constraints: Array<{
    id: string;
    whenCode: string;
    requirementType: string;
    requireObj?: Record<string, unknown>;
  }> = [];

  // Try to extract from inspection.constraints
  const rawConstraints = inspection.constraints as Record<string, unknown> | undefined;
  if (rawConstraints && typeof rawConstraints === "object") {
    for (const [id, def] of Object.entries(rawConstraints)) {
      if (def && typeof def === "object") {
        const d = def as Record<string, unknown>;
        // Only simulate constraints that have whenCode (AI-created ones)
        if (typeof d.whenCode === "string") {
          constraints.push({
            id,
            whenCode: d.whenCode,
            requirementType: typeof d.requirementType === "string" ? d.requirementType : "",
            requireObj: d.require as Record<string, unknown> | undefined,
          });
        }
      }
    }
  }

  return constraints;
}

/** Extract resolver info from system inspection for simulation. */
function extractResolverDefs(inspection: Record<string, unknown>): Array<{
  id: string;
  requirement: string;
  resolveCode: string;
}> {
  const resolvers: Array<{ id: string; requirement: string; resolveCode: string }> = [];

  const rawResolvers = inspection.resolvers as Record<string, unknown> | undefined;
  if (rawResolvers && typeof rawResolvers === "object") {
    for (const [id, def] of Object.entries(rawResolvers)) {
      if (def && typeof def === "object") {
        const d = def as Record<string, unknown>;
        if (typeof d.resolveCode === "string" && typeof d.requirement === "string") {
          resolvers.push({
            id,
            requirement: d.requirement,
            resolveCode: d.resolveCode,
          });
        }
      }
    }
  }

  return resolvers;
}

// ============================================================================
// LLM Summary
// ============================================================================

async function getLLMSummary(
  runner: AgentRunner,
  action: ArchitectAction,
  steps: WhatIfStep[],
  facts: Record<string, unknown>,
  onTokens?: (tokens: number) => void,
): Promise<string> {
  const prompt = [
    "## What-If Analysis Summary Request",
    "",
    `Action: ${action.tool} (${action.arguments.id})`,
    "",
    "### Predicted Effects",
    ...steps.map((s) => `- ${s.description}`),
    "",
    "### Current Facts",
    JSON.stringify(facts, null, 2),
    "",
    "Provide a brief (2-3 sentence) summary of the risks and benefits of this action.",
  ].join("\n");

  try {
    const result = await runner(
      {
        name: "directive-what-if",
        instructions: "You summarize the predicted effects of system changes.",
      },
      prompt,
    );

    // M4: track tokens through budget
    if (onTokens && typeof result.totalTokens === "number") {
      onTokens(result.totalTokens);
    }

    return typeof result.output === "string"
      ? result.output
      : JSON.stringify(result.output);
  } catch {
    return "Unable to generate summary.";
  }
}
