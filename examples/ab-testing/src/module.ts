/**
 * A/B Testing Engine — Directive Module
 *
 * Types, schema, helpers, module definition, timeline, and system creation
 * for a constraint-driven A/B testing engine with deterministic hashing.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export interface Variant {
  id: string;
  weight: number;
  label: string;
}

export interface Experiment {
  id: string;
  name: string;
  variants: Variant[];
  active: boolean;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: string;
}

// ============================================================================
// Deterministic Hash
// ============================================================================

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return Math.abs(hash);
}

function pickVariant(
  userId: string,
  experimentId: string,
  variants: Variant[],
): string {
  const hash = hashCode(`${userId}:${experimentId}`);
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  let roll = hash % totalWeight;

  for (const variant of variants) {
    roll -= variant.weight;
    if (roll < 0) {
      return variant.id;
    }
  }

  return variants[variants.length - 1].id;
}

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addLog(type: "event" | "constraint" | "resolver", msg: string) {
  console.log(`[AB] [${type}] ${msg}`);

  // Classify for timeline
  let event = "";
  let detail = msg;
  let tlType = "register";

  if (msg.startsWith("Registered")) {
    event = "registered";
    detail = msg.replace("Registered experiment: ", "");
    tlType = "register";
  } else if (msg.startsWith("Assigned") || msg.includes("→")) {
    event = "assigned";
    detail = msg;
    tlType = "assign";
  } else if (msg.includes("Exposure tracked")) {
    event = "exposure";
    detail = msg.replace("Exposure tracked: ", "");
    tlType = "exposure";
  } else if (msg.includes("Manual assignment")) {
    event = "manual";
    detail = msg.replace("Manual assignment: ", "");
    tlType = "assign";
  } else if (
    msg.includes("Paused") ||
    msg.includes("Resumed") ||
    msg.includes("Reset")
  ) {
    event = msg.toLowerCase().split(" ")[0];
    detail = msg;
    tlType = "control";
  } else {
    event = type;
    detail = msg;
    tlType = "register";
  }

  timeline.unshift({ time: Date.now(), event, detail, type: tlType });
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    experiments: t.array<Experiment>(),
    assignments: t.object<Record<string, string>>(),
    exposures: t.object<Record<string, number>>(),
    userId: t.string(),
    paused: t.boolean(),
  },
  derivations: {
    activeExperiments: t.array<Experiment>(),
    assignedCount: t.number(),
    exposedCount: t.number(),
  },
  events: {
    registerExperiment: {
      id: t.string(),
      name: t.string(),
      variants: t.array<Variant>(),
    },
    assignVariant: { experimentId: t.string(), variantId: t.string() },
    recordExposure: { experimentId: t.string() },
    pauseAll: {},
    resumeAll: {},
    reset: {},
  },
  requirements: {
    ASSIGN_VARIANT: { experimentId: t.string() },
    TRACK_EXPOSURE: { experimentId: t.string(), variantId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const abTesting = createModule("ab-testing", {
  schema,

  init: (facts) => {
    facts.experiments = [];
    facts.assignments = {};
    facts.exposures = {};
    facts.userId = `user-${hashCode(String(Date.now())).toString(36)}`;
    facts.paused = false;
  },

  derive: {
    activeExperiments: (facts) =>
      facts.experiments.filter((e: Experiment) => e.active && !facts.paused),
    assignedCount: (facts) => Object.keys(facts.assignments).length,
    exposedCount: (facts) => Object.keys(facts.exposures).length,
  },

  events: {
    registerExperiment: (facts, { id, name, variants }) => {
      const experiments = facts.experiments as Experiment[];
      if (!experiments.find((e: Experiment) => e.id === id)) {
        facts.experiments = [
          ...experiments,
          { id, name, variants, active: true },
        ];
      }
    },
    assignVariant: (facts, { experimentId, variantId }) => {
      facts.assignments = { ...facts.assignments, [experimentId]: variantId };
    },
    recordExposure: (facts, { experimentId }) => {
      facts.exposures = { ...facts.exposures, [experimentId]: Date.now() };
    },
    pauseAll: (facts) => {
      facts.paused = true;
    },
    resumeAll: (facts) => {
      facts.paused = false;
    },
    reset: (facts) => {
      facts.assignments = {};
      facts.exposures = {};
      facts.paused = false;
    },
  },

  constraints: {
    needsAssignment: {
      priority: 100,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }
        const experiments = facts.experiments as Experiment[];
        const assignments = facts.assignments as Record<string, string>;

        return experiments.some(
          (e: Experiment) => e.active && !assignments[e.id],
        );
      },
      require: (facts) => {
        const experiments = facts.experiments as Experiment[];
        const assignments = facts.assignments as Record<string, string>;
        const unassigned = experiments.find(
          (e: Experiment) => e.active && !assignments[e.id],
        );

        return { type: "ASSIGN_VARIANT", experimentId: unassigned!.id };
      },
    },

    needsExposure: {
      priority: 50,
      when: (facts) => {
        if (facts.paused) {
          return false;
        }
        const assignments = facts.assignments as Record<string, string>;
        const exposures = facts.exposures as Record<string, number>;

        return Object.keys(assignments).some((id) => !exposures[id]);
      },
      require: (facts) => {
        const assignments = facts.assignments as Record<string, string>;
        const exposures = facts.exposures as Record<string, number>;
        const experimentId = Object.keys(assignments).find(
          (id) => !exposures[id],
        )!;

        return {
          type: "TRACK_EXPOSURE",
          experimentId,
          variantId: assignments[experimentId],
        };
      },
    },
  },

  resolvers: {
    assignVariant: {
      requirement: "ASSIGN_VARIANT",
      resolve: async (req, context) => {
        const experiments = context.facts.experiments as Experiment[];
        const experiment = experiments.find(
          (e: Experiment) => e.id === req.experimentId,
        );
        if (!experiment) {
          return;
        }

        const variantId = pickVariant(
          context.facts.userId,
          req.experimentId,
          experiment.variants,
        );

        context.facts.assignments = {
          ...context.facts.assignments,
          [req.experimentId]: variantId,
        };
        addLog("resolver", `Assigned ${req.experimentId} → ${variantId}`);
      },
    },

    trackExposure: {
      requirement: "TRACK_EXPOSURE",
      resolve: async (req, context) => {
        const now = Date.now();
        context.facts.exposures = {
          ...context.facts.exposures,
          [req.experimentId]: now,
        };
        addLog(
          "resolver",
          `Exposure tracked: ${req.experimentId} (variant: ${req.variantId}) at ${new Date(now).toLocaleTimeString()}`,
        );
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: abTesting,
  debug: { runHistory: true },
  plugins: [devtoolsPlugin({ name: "ab-testing" })],
});
