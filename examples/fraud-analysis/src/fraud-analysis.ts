/**
 * Fraud Case Analysis — Directive Module
 *
 * Multi-stage fraud detection pipeline showcasing every major Directive feature:
 * - 6 constraints with priority + `after` ordering (including competing constraints)
 * - 6 resolvers with retry policies and custom dedup keys
 * - 3 effects with explicit deps
 * - 9 derivations with composition
 * - Local PII detection + checkpoint store
 * - DevTools panel with time-travel debugging
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import { InMemoryCheckpointStore } from "./checkpoint.js";
import { detectPII, redactPII } from "./pii.js";

import {
  type CheckpointEntry,
  type Disposition,
  type FlagEvent,
  type FraudCase,
  type PipelineStage,
  type Severity,
  type TimelineEntry,
  getMockEnrichment,
} from "./mock-data.js";

// ============================================================================
// Timeline (external mutable array, same pattern as ai-checkpoint)
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
  type: TimelineEntry["type"],
  message: string,
): void {
  timeline.push({
    time: new Date().toLocaleTimeString(),
    type,
    message,
  });
}

// ============================================================================
// Checkpoint Store
// ============================================================================

export const checkpointStore = new InMemoryCheckpointStore();

// ============================================================================
// Analysis Helpers
// ============================================================================

interface AnalysisResult {
  riskScore: number;
  severity: Severity;
  disposition: Disposition;
  analysisNotes: string;
}

/** Deterministic risk scoring formula */
function analyzeWithFormula(fraudCase: FraudCase): AnalysisResult {
  const avgSignalRisk =
    fraudCase.signals.length > 0
      ? fraudCase.signals.reduce((sum, s) => sum + s.risk, 0) /
        fraudCase.signals.length
      : 50;

  const totalAmount = fraudCase.events.reduce((sum, e) => sum + e.amount, 0);
  const amountFactor = Math.min(totalAmount / 10000, 1) * 30;
  const eventFactor = Math.min(fraudCase.events.length / 10, 1) * 20;
  const piiFactor = fraudCase.events.some((e) => e.piiFound) ? 15 : 0;

  const riskScore = Math.min(
    100,
    Math.round(avgSignalRisk * 0.5 + amountFactor + eventFactor + piiFactor),
  );

  let severity: Severity = "low";
  if (riskScore >= 80) {
    severity = "critical";
  } else if (riskScore >= 60) {
    severity = "high";
  } else if (riskScore >= 40) {
    severity = "medium";
  }

  let disposition: Disposition = "pending";
  let notes = `Risk: ${riskScore}/100. Signals: ${fraudCase.signals.map((s) => s.source).join(", ")}.`;

  if (riskScore <= 30) {
    disposition = "cleared";
    notes += " Auto-cleared: low risk.";
  } else if (riskScore <= 50) {
    disposition = "flagged";
    notes += " Flagged for monitoring.";
  }

  return { riskScore, severity, disposition, analysisNotes: notes };
}

// ============================================================================
// Schema
// ============================================================================

export const fraudSchema = {
  facts: {
    stage: t.string<PipelineStage>(),
    flagEvents: t.array<FlagEvent>(),
    cases: t.array<FraudCase>(),
    isRunning: t.boolean(),
    totalEventsProcessed: t.number(),
    totalPiiDetections: t.number(),
    analysisBudget: t.number(),
    maxAnalysisBudget: t.number(),
    riskThreshold: t.number(),
    lastError: t.string(),
    checkpoints: t.array<CheckpointEntry>(),
    selectedScenario: t.string(),
  },
  derivations: {
    ungroupedCount: t.number(),
    caseCount: t.number(),
    criticalCaseCount: t.number(),
    pendingAnalysisCount: t.number(),
    needsHumanReview: t.boolean(),
    budgetExhausted: t.boolean(),
    completionPercentage: t.number(),
    averageRiskScore: t.number(),
    dispositionSummary: t.object<Record<string, number>>(),
  },
  events: {
    ingestEvents: { events: t.array<FlagEvent>() },
    setRiskThreshold: { value: t.number() },
    setBudget: { value: t.number() },
    selectScenario: { key: t.string() },
    reset: {},
  },
  requirements: {
    NORMALIZE_EVENTS: {},
    GROUP_EVENTS: {},
    ENRICH_CASE: { caseId: t.string() },
    ANALYZE_CASE: { caseId: t.string() },
    HUMAN_REVIEW: { caseId: t.string() },
    ESCALATE: { caseId: t.string() },
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const fraudAnalysisModule = createModule("fraud", {
  schema: fraudSchema,

  init: (facts) => {
    facts.stage = "idle";
    facts.flagEvents = [];
    facts.cases = [];
    facts.isRunning = false;
    facts.totalEventsProcessed = 0;
    facts.totalPiiDetections = 0;
    facts.analysisBudget = 300;
    facts.maxAnalysisBudget = 300;
    facts.riskThreshold = 70;
    facts.lastError = "";
    facts.checkpoints = [];
    facts.selectedScenario = "card-skimming";
  },

  // ============================================================================
  // Derivations (9)
  // ============================================================================

  derive: {
    ungroupedCount: (facts) => {
      return facts.flagEvents.filter((e) => !e.grouped).length;
    },

    caseCount: (facts) => {
      return facts.cases.length;
    },

    criticalCaseCount: (facts) => {
      return facts.cases.filter((c) => c.severity === "critical").length;
    },

    pendingAnalysisCount: (facts) => {
      return facts.cases.filter((c) => c.enriched && !c.analyzed).length;
    },

    needsHumanReview: (facts) => {
      return facts.cases.some(
        (c) => c.riskScore > facts.riskThreshold && c.disposition === "pending",
      );
    },

    budgetExhausted: (facts) => {
      return facts.analysisBudget <= 0;
    },

    completionPercentage: (facts) => {
      const stages: PipelineStage[] = [
        "idle",
        "ingesting",
        "normalizing",
        "grouping",
        "enriching",
        "analyzing",
        "complete",
      ];
      const idx = stages.indexOf(facts.stage);
      if (idx < 0) {
        return 0;
      }

      return Math.round((idx / (stages.length - 1)) * 100);
    },

    averageRiskScore: (facts) => {
      if (facts.cases.length === 0) {
        return 0;
      }

      const sum = facts.cases.reduce((acc, c) => acc + c.riskScore, 0);

      return Math.round(sum / facts.cases.length);
    },

    // Composition: derives from cases (same source as caseCount)
    dispositionSummary: (facts) => {
      const summary: Record<string, number> = {};
      for (const c of facts.cases) {
        summary[c.disposition] = (summary[c.disposition] || 0) + 1;
      }

      return summary;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    ingestEvents: (facts, { events }) => {
      facts.flagEvents = [...facts.flagEvents, ...events];
      facts.totalEventsProcessed = facts.totalEventsProcessed + events.length;
      facts.stage = "ingesting";
      facts.isRunning = true;
      facts.lastError = "";
    },

    setRiskThreshold: (facts, { value }) => {
      facts.riskThreshold = Math.max(50, Math.min(90, value));
    },

    setBudget: (facts, { value }) => {
      facts.analysisBudget = Math.max(0, Math.min(500, value));
      facts.maxAnalysisBudget = Math.max(facts.maxAnalysisBudget, value);
    },

    selectScenario: (facts, { key }) => {
      facts.selectedScenario = key;
    },

    reset: (facts) => {
      facts.stage = "idle";
      facts.flagEvents = [];
      facts.cases = [];
      facts.isRunning = false;
      facts.totalEventsProcessed = 0;
      facts.totalPiiDetections = 0;
      facts.lastError = "";
      facts.checkpoints = [];
      timeline.length = 0;
    },
  },

  // ============================================================================
  // Constraints (6 with priority + after ordering)
  // ============================================================================

  constraints: {
    normalizeNeeded: {
      priority: 100,
      when: (facts) => {
        return facts.stage === "ingesting" && facts.flagEvents.length > 0;
      },
      require: { type: "NORMALIZE_EVENTS" },
    },

    groupingNeeded: {
      priority: 90,
      after: ["normalizeNeeded"],
      when: (facts) => {
        return facts.flagEvents.some((e) => !e.grouped);
      },
      require: { type: "GROUP_EVENTS" },
    },

    enrichmentNeeded: {
      priority: 80,
      after: ["groupingNeeded"],
      when: (facts) => {
        return facts.cases.some((c) => !c.enriched && c.signals.length < 3);
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) => !c.enriched && c.signals.length < 3,
        );

        return { type: "ENRICH_CASE", caseId: target?.id ?? "" };
      },
    },

    analysisNeeded: {
      priority: 70,
      after: ["enrichmentNeeded"],
      when: (facts) => {
        return (
          facts.analysisBudget > 0 &&
          facts.cases.some((c) => c.enriched && !c.analyzed)
        );
      },
      require: (facts) => {
        const target = facts.cases.find((c) => c.enriched && !c.analyzed);

        return { type: "ANALYZE_CASE", caseId: target?.id ?? "" };
      },
    },

    humanReviewNeeded: {
      priority: 65,
      after: ["analysisNeeded"],
      when: (facts) => {
        return facts.cases.some(
          (c) =>
            c.analyzed &&
            c.riskScore > facts.riskThreshold &&
            c.disposition === "pending",
        );
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) =>
            c.analyzed &&
            c.riskScore > facts.riskThreshold &&
            c.disposition === "pending",
        );

        return { type: "HUMAN_REVIEW", caseId: target?.id ?? "" };
      },
    },

    budgetEscalation: {
      priority: 60,
      when: (facts) => {
        return (
          facts.analysisBudget <= 0 &&
          facts.cases.some(
            (c) => c.enriched && !c.analyzed && c.disposition === "pending",
          )
        );
      },
      require: (facts) => {
        const target = facts.cases.find(
          (c) => c.enriched && !c.analyzed && c.disposition === "pending",
        );

        return { type: "ESCALATE", caseId: target?.id ?? "" };
      },
    },
  },

  // ============================================================================
  // Resolvers (6)
  // ============================================================================

  resolvers: {
    normalizeEvents: {
      requirement: "NORMALIZE_EVENTS",
      resolve: async (_req, context) => {
        addTimeline("stage", "normalizing events");

        const events = [...context.facts.flagEvents];
        let piiCount = 0;

        for (let i = 0; i < events.length; i++) {
          const event = events[i];

          // Run PII detection on merchant + memo fields
          const merchantResult = await detectPII(event.merchant, {
            types: ["credit_card", "bank_account", "ssn"],
          });
          const memoResult = await detectPII(event.memo, {
            types: ["credit_card", "bank_account", "ssn"],
          });

          const hasPii = merchantResult.detected || memoResult.detected;
          if (hasPii) {
            piiCount++;
          }

          events[i] = {
            ...event,
            piiFound: hasPii,
            redactedMerchant: merchantResult.detected
              ? redactPII(event.merchant, merchantResult.items, "typed")
              : event.merchant,
            redactedMemo: memoResult.detected
              ? redactPII(event.memo, memoResult.items, "typed")
              : event.memo,
          };
        }

        // Simulate processing delay (before fact mutations to avoid
        // mid-resolver reconcile canceling this resolver)
        await delay(300);

        // All fact mutations at the end — no more awaits after this
        context.facts.stage = "normalizing";
        context.facts.flagEvents = events;
        context.facts.totalPiiDetections =
          context.facts.totalPiiDetections + piiCount;
      },
    },

    groupEvents: {
      requirement: "GROUP_EVENTS",
      resolve: async (_req, context) => {
        addTimeline("stage", "grouping events into cases");

        const events = [...context.facts.flagEvents];
        const existingCases = [...context.facts.cases];

        // Group by accountId
        const groups = new Map<string, FlagEvent[]>();
        for (const event of events) {
          if (event.grouped) {
            continue;
          }

          const existing = groups.get(event.accountId) ?? [];
          existing.push(event);
          groups.set(event.accountId, existing);
        }

        // Create cases from groups
        let caseNum = existingCases.length;
        for (const [accountId, groupEvents] of groups) {
          caseNum++;
          const newCase: FraudCase = {
            id: `case-${String(caseNum).padStart(3, "0")}`,
            accountId,
            events: groupEvents,
            signals: [],
            enriched: false,
            analyzed: false,
            riskScore: 0,
            severity: "low",
            disposition: "pending",
          };
          existingCases.push(newCase);
        }

        // Mark all events as grouped
        const markedEvents = events.map((e) => ({ ...e, grouped: true }));

        await delay(200);

        // All fact mutations at the end — no more awaits after this
        context.facts.stage = "grouping";
        context.facts.flagEvents = markedEvents;
        context.facts.cases = existingCases;
      },
    },

    enrichCase: {
      requirement: "ENRICH_CASE",
      key: (req) => `enrich-${req.caseId}`,
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        addTimeline("stage", `enriching ${req.caseId}`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const signals = getMockEnrichment(cases[idx].accountId);

        // Simulate API call
        await delay(400);

        // All fact mutations at the end — no more awaits after this
        cases[idx] = {
          ...cases[idx],
          signals,
          enriched: true,
        };
        context.facts.stage = "enriching";
        context.facts.cases = cases;
      },
    },

    analyzeCase: {
      requirement: "ANALYZE_CASE",
      key: (req) => `analyze-${req.caseId}`,
      retry: { attempts: 1, backoff: "none" },
      resolve: async (req, context) => {
        addTimeline("stage", `analyzing ${req.caseId}`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const fraudCase = cases[idx];

        // Consume budget
        const cost = 25 + Math.floor(fraudCase.events.length * 5);

        // Deterministic analysis
        await delay(500);
        const result = analyzeWithFormula(fraudCase);
        if (
          result.disposition === "pending" &&
          result.riskScore <= context.facts.riskThreshold
        ) {
          result.disposition = "flagged";
          result.analysisNotes +=
            " Auto-flagged: below human review threshold.";
        }

        // All fact mutations at the end — no more awaits after this
        cases[idx] = { ...fraudCase, ...result, analyzed: true };
        context.facts.stage = "analyzing";
        context.facts.analysisBudget = Math.max(
          0,
          context.facts.analysisBudget - cost,
        );
        context.facts.cases = cases;
      },
    },

    humanReview: {
      requirement: "HUMAN_REVIEW",
      resolve: async (req, context) => {
        addTimeline("info", `${req.caseId} sent to human review`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        await delay(100);

        cases[idx] = {
          ...cases[idx],
          disposition: "human_review",
          dispositionReason: "Risk score exceeds threshold",
        };
        context.facts.cases = cases;
      },
    },

    escalate: {
      requirement: "ESCALATE",
      resolve: async (req, context) => {
        addTimeline("info", `${req.caseId} escalated (budget exhausted)`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        await delay(100);

        cases[idx] = {
          ...cases[idx],
          disposition: "escalated",
          dispositionReason: "Analysis budget exhausted",
        };
        context.facts.cases = cases;
      },
    },
  },

  // ============================================================================
  // Effects (3)
  // ============================================================================

  effects: {
    logStageChange: {
      deps: ["stage"],
      run: (facts, prev) => {
        if (prev && prev.stage !== facts.stage) {
          addTimeline("stage", `${prev.stage} → ${facts.stage}`);
        }
      },
    },

    logPiiDetection: {
      deps: ["totalPiiDetections"],
      run: (facts, prev) => {
        if (prev && facts.totalPiiDetections !== prev.totalPiiDetections) {
          addTimeline(
            "pii",
            `PII guardrail fired (${facts.totalPiiDetections} total detections)`,
          );
        }
      },
    },

    logBudgetWarning: {
      deps: ["analysisBudget"],
      run: (facts, prev) => {
        if (prev && prev.analysisBudget > 0 && facts.analysisBudget <= 0) {
          addTimeline("budget", "analysis budget exhausted");
        }
      },
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: fraudAnalysisModule,
  plugins: [devtoolsPlugin({ name: "fraud-analysis", panel: true })],
  history: { maxSnapshots: 50 },
  trace: { maxRuns: 100 },
});

// ============================================================================
// Helpers
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
