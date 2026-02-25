/**
 * Fraud Case Analysis — Directive Module
 *
 * Multi-stage fraud detection pipeline showcasing every major Directive feature:
 * - 6 constraints with priority + `after` ordering (including competing constraints)
 * - 6 resolvers with retry policies and custom dedup keys
 * - 3 effects with explicit deps
 * - 9 derivations with composition
 * - AI package integration (PII detection, checkpoints, AI-powered analysis)
 * - DevTools panel with time-travel debugging
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";
import {
  detectPII,
  redactPII,
  InMemoryCheckpointStore,
  createCheckpointId,
  validateCheckpoint,
  createRunner,
  type Checkpoint,
  type AgentRunner,
} from "@directive-run/ai";

import {
  type PipelineStage,
  type FlagEvent,
  type FraudCase,
  type CheckpointEntry,
  type TimelineEntry,
  type Severity,
  type Disposition,
  getMockEnrichment,
} from "./mock-data.js";

// ============================================================================
// API Key Management (localStorage)
// ============================================================================

const STORAGE_KEY = "fraud-analysis-api-key";

export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

// ============================================================================
// AI Runner
// ============================================================================

let runner: AgentRunner | null = null;

function getOrCreateRunner(apiKey: string): AgentRunner {
  if (!runner) {
    runner = createRunner({
      buildRequest: (_agent, input) => ({
        url: "/api/claude",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 512,
            system: "You are a fraud analyst AI. Analyze the provided case data and return a JSON risk assessment.",
            messages: [{ role: "user", content: input }],
          }),
        },
      }),
      parseResponse: async (res) => {
        const data = await res.json();
        const text = data.content?.[0]?.text ?? "";
        const inputTokens = data.usage?.input_tokens ?? 0;
        const outputTokens = data.usage?.output_tokens ?? 0;

        return { text, totalTokens: inputTokens + outputTokens };
      },
      parseOutput: (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      },
    });
  }

  return runner;
}

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

/** AI-powered risk analysis via Claude */
async function analyzeWithAI(
  apiKey: string,
  fraudCase: FraudCase,
): Promise<AnalysisResult | null> {
  try {
    const run = getOrCreateRunner(apiKey);

    const totalAmount = fraudCase.events.reduce((sum, e) => sum + e.amount, 0);
    const prompt = [
      `Analyze this fraud case and return JSON with: risk_score (0-100), severity ("low"|"medium"|"high"|"critical"), disposition ("cleared"|"flagged"|"pending"), and notes (string).`,
      ``,
      `Case ${fraudCase.id}:`,
      `- Account: ${fraudCase.accountId}`,
      `- Transactions: ${fraudCase.events.length} totaling $${totalAmount.toFixed(2)}`,
      `- PII detected: ${fraudCase.events.some((e) => e.piiFound) ? "yes" : "no"}`,
      `- Enrichment signals:`,
      ...fraudCase.signals.map((s) => `  - ${s.source}: risk ${s.risk}/100 — ${s.detail}`),
      ``,
      `Return ONLY valid JSON: { "risk_score": number, "severity": string, "disposition": string, "notes": string }`,
    ].join("\n");

    const agent = { name: "fraud-analyst", instructions: "You are a fraud analyst AI. Analyze cases and return structured risk assessments as JSON." };
    const result = await run(agent, prompt);
    const output = result.output as Record<string, unknown>;

    if (typeof output !== "object" || output === null) {
      return null;
    }

    const riskScore = Math.min(100, Math.max(0, Number(output.risk_score) || 0));

    let severity: Severity = "low";
    if (["critical", "high", "medium", "low"].includes(String(output.severity))) {
      severity = output.severity as Severity;
    } else if (riskScore >= 80) {
      severity = "critical";
    } else if (riskScore >= 60) {
      severity = "high";
    } else if (riskScore >= 40) {
      severity = "medium";
    }

    let disposition: Disposition = "pending";
    if (["cleared", "flagged", "pending"].includes(String(output.disposition))) {
      disposition = output.disposition as Disposition;
    } else if (riskScore <= 30) {
      disposition = "cleared";
    } else if (riskScore <= 50) {
      disposition = "flagged";
    }

    const notes = `[AI] ${String(output.notes || `Risk: ${riskScore}/100`)}`;

    return { riskScore, severity, disposition, analysisNotes: notes };
  } catch {
    return null;
  }
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
    apiKeySet: t.boolean(),
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
    setApiKey: { key: t.string() },
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
    facts.apiKeySet = getApiKey() !== null;
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
        "idle", "ingesting", "normalizing", "grouping",
        "enriching", "analyzing", "complete",
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

    setApiKey: (facts, { key }) => {
      setApiKey(key);
      facts.apiKeySet = true;
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
        return (
          facts.stage === "ingesting" &&
          facts.flagEvents.length > 0
        );
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
        return facts.cases.some(
          (c) => !c.enriched && c.signals.length < 3,
        );
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
        const target = facts.cases.find(
          (c) => c.enriched && !c.analyzed,
        );

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
        context.facts.stage = "normalizing";
        addTimeline("stage", "normalizing events");

        const events = [...context.facts.flagEvents];
        let piiCount = 0;

        for (let i = 0; i < events.length; i++) {
          const event = events[i];

          // Run PII detection on merchant + memo fields
          const merchantResult = await detectPII(
            event.merchant,
            { types: ["credit_card", "bank_account", "ssn"] },
          );
          const memoResult = await detectPII(
            event.memo,
            { types: ["credit_card", "bank_account", "ssn"] },
          );

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

        context.facts.flagEvents = events;
        context.facts.totalPiiDetections =
          context.facts.totalPiiDetections + piiCount;

        // Simulate processing delay
        await delay(300);
      },
    },

    groupEvents: {
      requirement: "GROUP_EVENTS",
      resolve: async (_req, context) => {
        context.facts.stage = "grouping";
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

        context.facts.flagEvents = markedEvents;
        context.facts.cases = existingCases;

        await delay(200);
      },
    },

    enrichCase: {
      requirement: "ENRICH_CASE",
      key: (req) => `enrich-${req.caseId}`,
      retry: { attempts: 2, backoff: "exponential" },
      resolve: async (req, context) => {
        context.facts.stage = "enriching";
        addTimeline("stage", `enriching ${req.caseId}`);

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const signals = getMockEnrichment(cases[idx].accountId);

        // Simulate API call
        await delay(400);

        cases[idx] = {
          ...cases[idx],
          signals,
          enriched: true,
        };
        context.facts.cases = cases;
      },
    },

    analyzeCase: {
      requirement: "ANALYZE_CASE",
      key: (req) => `analyze-${req.caseId}`,
      retry: { attempts: 1, backoff: "none" },
      resolve: async (req, context) => {
        context.facts.stage = "analyzing";

        const cases = [...context.facts.cases];
        const idx = cases.findIndex((c) => c.id === req.caseId);
        if (idx < 0) {
          return;
        }

        const fraudCase = cases[idx];

        // Consume budget
        const cost = 25 + Math.floor(fraudCase.events.length * 5);
        context.facts.analysisBudget =
          Math.max(0, context.facts.analysisBudget - cost);

        // AI-powered analysis when API key is available
        const apiKey = getApiKey();
        if (apiKey && context.facts.apiKeySet) {
          addTimeline("stage", `AI analyzing ${req.caseId}`);
          const result = await analyzeWithAI(apiKey, fraudCase);

          if (result) {
            cases[idx] = { ...fraudCase, ...result, analyzed: true };
            context.facts.cases = cases;

            return;
          }

          // Fall through to deterministic on AI failure
          addTimeline("info", `AI fallback for ${req.caseId} — using formula`);
        } else {
          addTimeline("stage", `analyzing ${req.caseId}`);
        }

        // Deterministic analysis (fallback or default)
        await delay(500);
        cases[idx] = { ...fraudCase, ...analyzeWithFormula(fraudCase), analyzed: true };
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

        cases[idx] = {
          ...cases[idx],
          disposition: "human_review",
          dispositionReason: "Risk score exceeds threshold",
        };
        context.facts.cases = cases;

        await delay(100);
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

        cases[idx] = {
          ...cases[idx],
          disposition: "escalated",
          dispositionReason: "Analysis budget exhausted",
        };
        context.facts.cases = cases;

        await delay(100);
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
          addTimeline("pii", `PII guardrail fired (${facts.totalPiiDetections} total detections)`);
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
  plugins: [
    devtoolsPlugin({ panel: true }),
  ],
  debug: {
    timeTravel: true,
    maxSnapshots: 50,
  },
});

// ============================================================================
// Helpers
// ============================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
