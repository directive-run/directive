import type { AgentRunner } from "@directive-run/ai";
import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  AGENTS,
  AGENT_ORDER,
  WEIGHTS,
  computeSatisfaction,
  createHeistRunner,
  getApiKey,
  setFailForger,
  setFailHacker,
  setApiKey as storeApiKey,
} from "./agents.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export interface StepRecord {
  step: number;
  nodesRun: string[];
  factsProduced: string[];
  satisfaction: number;
  satisfactionDelta: number;
  tokens: number;
}

export interface RelaxationRecord {
  step: number;
  label: string;
  strategy: string;
}

export type StrategyId = "allReady" | "highestImpact" | "costEfficient";

// ---------------------------------------------------------------------------
// State shared between module and resolvers
// ---------------------------------------------------------------------------

let runner: AgentRunner | null = null;
let stepResolve: (() => void) | null = null;
let abortController: AbortController | null = null;

function waitForStep(): Promise<void> {
  return new Promise((resolve) => {
    stepResolve = resolve;
  });
}

export function advanceStep(): void {
  if (stepResolve) {
    const fn = stepResolve;
    stepResolve = null;
    fn();
  }
}

// ---------------------------------------------------------------------------
// Selection strategies
// ---------------------------------------------------------------------------

function selectAgents(
  ready: string[],
  strategyId: StrategyId,
  nodeTokens: Record<string, number>,
): string[] {
  if (ready.length <= 1 || strategyId === "allReady") {
    return ready;
  }

  if (strategyId === "highestImpact") {
    const scored = ready.map((id) => {
      const agent = AGENTS[id];
      const weight =
        agent?.produces.reduce((sum, key) => sum + (WEIGHTS[key] ?? 0), 0) ?? 0;

      return { id, weight };
    });

    scored.sort((a, b) => b.weight - a.weight);

    return [scored[0].id];
  }

  if (strategyId === "costEfficient") {
    const scored = ready.map((id) => ({
      id,
      tokens: nodeTokens[id] ?? 0,
    }));

    scored.sort((a, b) => a.tokens - b.tokens);

    return [scored[0].id];
  }

  return ready;
}

// ---------------------------------------------------------------------------
// Helper: compute ready nodes
// ---------------------------------------------------------------------------

function getReadyNodes(
  nodeStatuses: Record<string, NodeStatus>,
  goalFacts: Record<string, unknown>,
): string[] {
  const ready: string[] = [];

  for (const id of AGENT_ORDER) {
    if (nodeStatuses[id] !== "pending" && nodeStatuses[id] !== "ready") {
      continue;
    }

    const agent = AGENTS[id];
    const depsReady =
      agent.requires.length === 0 ||
      agent.requires.every((dep) => goalFacts[dep] != null);

    if (depsReady) {
      ready.push(id);
    }
  }

  return ready;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const heistSchema = {
  facts: {
    status: t.string<"idle" | "running" | "paused" | "completed" | "error">(),
    currentStep: t.number(),
    satisfaction: t.number(),
    stallCount: t.number(),
    totalTokens: t.number(),
    achieved: t.boolean(),
    error: t.string(),
    nodeStatuses: t.object<Record<string, NodeStatus>>(),
    nodeTokens: t.object<Record<string, number>>(),
    nodeProduced: t.object<Record<string, string[]>>(),
    goalFacts: t.object<Record<string, unknown>>(),
    stepHistory: t.array<StepRecord>(),
    relaxations: t.array<RelaxationRecord>(),
    selectedStrategy: t.string<StrategyId>(),
    stepMode: t.boolean(),
    selectedNode: t.string(),
    apiKeySet: t.boolean(),
    failHacker: t.boolean(),
    failForger: t.boolean(),
    maxSteps: t.number(),
  },
  derivations: {
    progressPercent: t.number(),
    readyNodes: t.array<string>(),
    summaryText: t.string(),
    isStalled: t.boolean(),
    avgTokensPerStep: t.number(),
  },
  events: {
    start: {},
    pause: {},
    step: {},
    reset: {},
    changeStrategy: { strategy: t.string<StrategyId>() },
    selectNode: { nodeId: t.string() },
    toggleFailHacker: { enabled: t.boolean() },
    toggleFailForger: { enabled: t.boolean() },
    setApiKey: { key: t.string() },
    setStepMode: { enabled: t.boolean() },
  },
  requirements: {
    EXECUTE_NEXT_STEP: {},
    APPLY_RELAXATION: {},
  },
} satisfies ModuleSchema;

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const heistModule = createModule("heist", {
  schema: heistSchema,

  init: (facts) => {
    facts.status = "idle";
    facts.currentStep = 0;
    facts.satisfaction = 0;
    facts.stallCount = 0;
    facts.totalTokens = 0;
    facts.achieved = false;
    facts.error = "";

    const statuses: Record<string, NodeStatus> = {};

    for (const id of AGENT_ORDER) {
      statuses[id] = "pending";
    }

    facts.nodeStatuses = statuses;
    facts.nodeTokens = {};
    facts.nodeProduced = {};
    facts.goalFacts = {};
    facts.stepHistory = [];
    facts.relaxations = [];
    facts.selectedStrategy = "allReady";
    facts.stepMode = false;
    facts.selectedNode = "";
    facts.apiKeySet = !!getApiKey();
    facts.failHacker = false;
    facts.failForger = false;
    facts.maxSteps = 20;
  },

  // ---------- Derivations ----------

  derive: {
    progressPercent: (facts) => Math.round(facts.satisfaction * 100),

    readyNodes: (facts) => getReadyNodes(facts.nodeStatuses, facts.goalFacts),

    summaryText: (facts) => {
      if (facts.status === "idle") {
        return "Awaiting orders...";
      }

      if (facts.achieved) {
        return `Mission complete! ${facts.currentStep} steps, ${facts.totalTokens} tokens.`;
      }

      if (facts.status === "error") {
        return `Mission failed: ${facts.error}`;
      }

      const running = Object.entries(facts.nodeStatuses)
        .filter(([, s]) => s === "running")
        .map(([id]) => AGENTS[id]?.name ?? id);

      if (running.length > 0) {
        return `Step ${facts.currentStep}: ${running.join(", ")} in the field...`;
      }

      return `Step ${facts.currentStep}: Planning next move...`;
    },

    isStalled: (facts) => {
      const ready = getReadyNodes(facts.nodeStatuses, facts.goalFacts);

      return (
        facts.status === "running" &&
        facts.stallCount >= 2 &&
        ready.length === 0
      );
    },

    avgTokensPerStep: (facts) => {
      if (facts.currentStep === 0) {
        return 0;
      }

      return Math.round(facts.totalTokens / facts.currentStep);
    },
  },

  // ---------- Events ----------

  events: {
    start: (facts) => {
      abortController?.abort();
      abortController = new AbortController();
      runner = createHeistRunner(getApiKey());
      facts.status = "running";
      facts.stepMode = false;
      setFailHacker(facts.failHacker);
      setFailForger(facts.failForger);
    },

    pause: (facts) => {
      facts.status = "paused";
    },

    step: (facts) => {
      if (facts.status === "idle") {
        abortController?.abort();
        abortController = new AbortController();
        runner = createHeistRunner(getApiKey());
        facts.status = "running";
        facts.stepMode = true;
        setFailHacker(facts.failHacker);
        setFailForger(facts.failForger);
      }

      advanceStep();
    },

    reset: (facts) => {
      abortController?.abort();
      abortController = null;
      runner = null;
      stepResolve = null;
      facts.status = "idle";
      facts.currentStep = 0;
      facts.satisfaction = 0;
      facts.stallCount = 0;
      facts.totalTokens = 0;
      facts.achieved = false;
      facts.error = "";

      const statuses: Record<string, NodeStatus> = {};

      for (const id of AGENT_ORDER) {
        statuses[id] = "pending";
      }

      facts.nodeStatuses = statuses;
      facts.nodeTokens = {};
      facts.nodeProduced = {};
      facts.goalFacts = {};
      facts.stepHistory = [];
      facts.relaxations = [];
    },

    changeStrategy: (facts, { strategy }) => {
      facts.selectedStrategy = strategy;
    },

    selectNode: (facts, { nodeId }) => {
      facts.selectedNode = nodeId;
    },

    toggleFailHacker: (facts, { enabled }) => {
      facts.failHacker = enabled;
      setFailHacker(enabled);
    },

    toggleFailForger: (facts, { enabled }) => {
      facts.failForger = enabled;
      setFailForger(enabled);
    },

    setApiKey: (facts, { key }) => {
      storeApiKey(key);
      facts.apiKeySet = true;
      runner = null;
    },

    setStepMode: (facts, { enabled }) => {
      facts.stepMode = enabled;
    },
  },

  // ---------- Constraints ----------

  constraints: {
    // When running in auto mode, keep advancing steps
    autoAdvance: {
      priority: 50,
      when: (facts) => {
        const ready = getReadyNodes(facts.nodeStatuses, facts.goalFacts);

        return (
          facts.status === "running" &&
          !facts.stepMode &&
          facts.currentStep < facts.maxSteps &&
          !facts.achieved &&
          ready.length > 0
        );
      },
      require: { type: "EXECUTE_NEXT_STEP" },
    },

    // When stalled with no ready nodes, trigger relaxation
    stallDetected: {
      priority: 80,
      when: (facts) => {
        const ready = getReadyNodes(facts.nodeStatuses, facts.goalFacts);

        return (
          facts.status === "running" &&
          ready.length === 0 &&
          !facts.achieved &&
          facts.stallCount >= 2
        );
      },
      require: { type: "APPLY_RELAXATION" },
    },
  },

  // ---------- Resolvers ----------

  resolvers: {
    executeStep: {
      requirement: "EXECUTE_NEXT_STEP",
      resolve: async (req, context) => {
        const {
          goalFacts,
          nodeStatuses,
          nodeTokens,
          nodeProduced,
          selectedStrategy,
          currentStep,
          satisfaction: prevSatisfaction,
          stepMode,
        } = context.facts;

        // Capture abort signal for this run
        const signal = abortController?.signal;

        // Wait for user click in step mode
        if (stepMode) {
          await waitForStep();
        }

        if (signal?.aborted) {
          return;
        }

        // Ensure runner exists
        const activeRunner = runner ?? createHeistRunner(getApiKey());
        runner = activeRunner;

        const ready = getReadyNodes(nodeStatuses, goalFacts);
        const selected = selectAgents(ready, selectedStrategy, nodeTokens);

        if (selected.length === 0) {
          context.facts.stallCount = context.facts.stallCount + 1;

          return;
        }

        const step = currentStep + 1;
        context.facts.currentStep = step;

        // Mark selected nodes as running
        const updatedStatuses = { ...nodeStatuses };

        for (const id of selected) {
          updatedStatuses[id] = "running";
        }

        context.facts.nodeStatuses = updatedStatuses;

        // Run agents in parallel
        const results = await Promise.allSettled(
          selected.map(async (id) => {
            const agent = AGENTS[id];
            const input = JSON.stringify(
              Object.fromEntries(
                agent.requires
                  .filter((key) => goalFacts[key] != null)
                  .map((key) => [key, goalFacts[key]]),
              ),
            );

            const result = await activeRunner(
              {
                name: agent.name,
                instructions: agent.instruction,
                model: "claude-haiku-4-5-20251001",
              },
              input.length > 2 ? input : "Execute your mission.",
            );

            return { id, result };
          }),
        );

        // Bail if reset was called while agents were running
        if (signal?.aborted) {
          return;
        }

        // Process results
        const newGoalFacts = { ...goalFacts };
        const newStatuses = { ...context.facts.nodeStatuses };
        const newTokens = { ...nodeTokens };
        const newProduced = { ...nodeProduced };
        const nodesRun: string[] = [];
        const factsProduced: string[] = [];
        let stepTokens = 0;

        for (let i = 0; i < results.length; i++) {
          const outcome = results[i];
          const id = selected[i];

          if (outcome.status === "fulfilled") {
            const { result } = outcome.value;
            nodesRun.push(id);
            newStatuses[id] = "completed";
            newTokens[id] = (newTokens[id] ?? 0) + result.totalTokens;
            stepTokens += result.totalTokens;

            const agent = AGENTS[id];

            try {
              const parsed =
                typeof result.output === "string"
                  ? JSON.parse(result.output)
                  : result.output;

              const produced: string[] = [];

              for (const key of agent.produces) {
                if (parsed[key] != null) {
                  newGoalFacts[key] = parsed[key];
                  produced.push(key);
                  factsProduced.push(key);
                }
              }

              newProduced[id] = produced;
            } catch {
              newProduced[id] = [];
            }
          } else {
            nodesRun.push(id);
            newStatuses[id] = "failed";
            console.warn(`[Heist] ${AGENTS[id]?.name} failed:`, outcome.reason);
          }
        }

        // Update facts
        context.facts.goalFacts = newGoalFacts;
        context.facts.nodeStatuses = newStatuses;
        context.facts.nodeTokens = newTokens;
        context.facts.nodeProduced = newProduced;
        context.facts.totalTokens = context.facts.totalTokens + stepTokens;

        // Compute satisfaction
        const newSatisfaction = computeSatisfaction(newGoalFacts);
        const delta = newSatisfaction - prevSatisfaction;
        context.facts.satisfaction = newSatisfaction;

        if (delta <= 0) {
          context.facts.stallCount = context.facts.stallCount + 1;
        } else {
          context.facts.stallCount = 0;
        }

        // Record step
        context.facts.stepHistory = [
          ...context.facts.stepHistory,
          {
            step,
            nodesRun,
            factsProduced,
            satisfaction: newSatisfaction,
            satisfactionDelta: delta,
            tokens: stepTokens,
          },
        ];

        // Check goal completion
        if (newGoalFacts.all_clear != null) {
          context.facts.achieved = true;
          context.facts.status = "completed";
        }
      },
    },

    applyRelaxation: {
      requirement: "APPLY_RELAXATION",
      resolve: async (req, context) => {
        const {
          relaxations,
          currentStep,
          nodeStatuses,
          failHacker,
          failForger,
        } = context.facts;
        const applied = relaxations.length;

        // Heightened Security: Hacker fails -> inject cameras_disabled
        if (failHacker && !context.facts.goalFacts.cameras_disabled) {
          if (applied === 0) {
            const updated = { ...nodeStatuses };
            updated.h4x = "pending";
            context.facts.nodeStatuses = updated;
            context.facts.stallCount = 0;
            context.facts.relaxations = [
              ...relaxations,
              {
                step: currentStep,
                label: "Retry H4X \u2014 rebooting from backup terminal",
                strategy: "allow_rerun",
              },
            ];

            return;
          }

          const newFacts = { ...context.facts.goalFacts };
          newFacts.cameras_disabled =
            "Insider keycard used \u2014 cameras disabled via physical override.";
          context.facts.goalFacts = newFacts;
          context.facts.satisfaction = computeSatisfaction(newFacts);
          context.facts.stallCount = 0;
          context.facts.relaxations = [
            ...relaxations,
            {
              step: currentStep,
              label: "Insider slipped a keycard \u2014 cameras disabled",
              strategy: "inject_facts",
            },
          ];

          return;
        }

        // Forger Arrested: inject blueprints from library records
        if (failForger && !context.facts.goalFacts.blueprints) {
          const newFacts = { ...context.facts.goalFacts };
          newFacts.blueprints =
            "Public library records used \u2014 floor plan reconstructed from building permits.";
          context.facts.goalFacts = newFacts;
          context.facts.satisfaction = computeSatisfaction(newFacts);
          context.facts.stallCount = 0;
          context.facts.relaxations = [
            ...relaxations,
            {
              step: currentStep,
              label: "Library records used as backup blueprints",
              strategy: "inject_facts",
            },
          ];

          return;
        }

        // Generic fallback
        context.facts.stallCount = 0;
        context.facts.status = "error";
        context.facts.error = "Mission stalled \u2014 no recovery available.";
      },
    },
  },

  // ---------- Effects ----------

  effects: {
    logStep: {
      run: (facts, prev) => {
        if (
          prev &&
          facts.currentStep !== prev.currentStep &&
          facts.currentStep > 0
        ) {
          const latest = facts.stepHistory[facts.stepHistory.length - 1];

          if (latest) {
            console.log(
              `[Heist] Step ${latest.step}: ${latest.nodesRun.join(", ")} \u2192 ${latest.satisfaction.toFixed(3)}`,
            );
          }
        }
      },
    },

    announceResult: {
      deps: ["achieved"],
      run: (facts, prev) => {
        if (facts.achieved && (!prev || !prev.achieved)) {
          console.log(
            `[Heist] Mission complete! ${facts.stepHistory.length} steps, ${facts.totalTokens} tokens`,
          );
        }
      },
    },
  },
});
