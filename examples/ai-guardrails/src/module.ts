/**
 * AI Safety Shield — Directive Module
 *
 * Types, schema, module definition, timeline, analysis functions,
 * and system creation for prompt injection & PII detection guardrails.
 */

import {
  type InjectionDetectionResult,
  type PIIDetectionResult,
  detectPII,
  detectPromptInjection,
} from "@directive-run/ai";
import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin, emitDevToolsEvent } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  id: string;
  text: string;
  blocked: boolean;
  redactedText: string;
  injectionResult: InjectionDetectionResult | null;
  piiResult: PIIDetectionResult | null;
}

export interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "pass" | "injection" | "pii" | "compliance" | "info";
}

export type ComplianceMode = "standard" | "gdpr" | "hipaa";

// ============================================================================
// Timeline
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
) {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    messages: t.array<ChatMessage>(),
    complianceMode: t.string<ComplianceMode>(),
    redactionEnabled: t.boolean(),
    blockedCount: t.number(),
    injectionAttempts: t.number(),
    piiDetections: t.number(),
    complianceBlocks: t.number(),
  },
  derivations: {
    messageCount: t.number(),
    blockRate: t.string(),
    piiTypeCounts: t.string(),
  },
  events: {
    setComplianceMode: { value: t.string() },
    toggleRedaction: {},
    clearHistory: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const guardrailModule = createModule("guardrails", {
  schema,

  init: (facts) => {
    facts.messages = [];
    facts.complianceMode = "standard";
    facts.redactionEnabled = true;
    facts.blockedCount = 0;
    facts.injectionAttempts = 0;
    facts.piiDetections = 0;
    facts.complianceBlocks = 0;
  },

  derive: {
    messageCount: (facts) => facts.messages.length,
    blockRate: (facts) => {
      if (facts.messages.length === 0) {
        return "0%";
      }

      const blocked = (facts.messages as ChatMessage[]).filter(
        (m) => m.blocked,
      ).length;

      return `${Math.round((blocked / facts.messages.length) * 100)}%`;
    },
    piiTypeCounts: (facts) => {
      const counts: Record<string, number> = {};
      for (const msg of facts.messages as ChatMessage[]) {
        if (msg.piiResult?.detected) {
          for (const item of msg.piiResult.items) {
            counts[item.type] = (counts[item.type] ?? 0) + 1;
          }
        }
      }

      return (
        Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ") || "none"
      );
    },
  },

  events: {
    setComplianceMode: (facts, { value }) => {
      facts.complianceMode = value as ComplianceMode;
    },
    toggleRedaction: (facts) => {
      facts.redactionEnabled = !facts.redactionEnabled;
    },
    clearHistory: (facts) => {
      facts.messages = [];
      facts.blockedCount = 0;
      facts.injectionAttempts = 0;
      facts.piiDetections = 0;
      facts.complianceBlocks = 0;
      timeline.length = 0;
    },
  },
});

// ============================================================================
// System
// ============================================================================

export const system = createSystem({
  module: guardrailModule,
  trace: true,
  plugins: [devtoolsPlugin({ name: "ai-guardrails" })],
});

// ============================================================================
// Analysis Functions
// ============================================================================

export function analyzeMessage(text: string): ChatMessage {
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let blocked = false;

  // 1. Prompt injection detection
  const injectionResult = detectPromptInjection(text);
  if (injectionResult.detected) {
    blocked = true;
    system.facts.injectionAttempts =
      (system.facts.injectionAttempts as number) + 1;
    for (const p of injectionResult.patterns) {
      addTimeline("injection", `${p.name} (${p.severity})`, "injection");
    }
  }

  emitDevToolsEvent({
    type: "guardrail_check",
    guardrailName: "prompt-injection",
    guardrailType: "input",
    passed: !injectionResult.detected,
    inputLength: text.length,
  });

  // 2. PII detection
  const piiResult = detectPII(text, {
    redact: system.facts.redactionEnabled as boolean,
    redactionStyle: "typed",
  });
  if (piiResult.detected) {
    system.facts.piiDetections = (system.facts.piiDetections as number) + 1;
    for (const item of piiResult.items) {
      addTimeline("pii", `${item.type} found`, "pii");
    }
  }

  emitDevToolsEvent({
    type: "guardrail_check",
    guardrailName: "pii-detection",
    guardrailType: "input",
    passed: !piiResult.detected,
    inputLength: text.length,
  });

  // 3. Compliance check
  const mode = system.facts.complianceMode as ComplianceMode;
  if (mode !== "standard" && piiResult.detected) {
    const hasPHI = piiResult.items.some(
      (i) =>
        i.type === "medical_id" ||
        i.type === "ssn" ||
        i.type === "date_of_birth",
    );
    const hasContactInfo = piiResult.items.some(
      (i) => i.type === "email" || i.type === "phone" || i.type === "name",
    );

    if (mode === "hipaa" && hasPHI) {
      blocked = true;
      system.facts.complianceBlocks =
        (system.facts.complianceBlocks as number) + 1;
      addTimeline("compliance", "HIPAA: PHI detected", "compliance");
    }

    if (mode === "gdpr" && hasContactInfo) {
      blocked = true;
      system.facts.complianceBlocks =
        (system.facts.complianceBlocks as number) + 1;
      addTimeline("compliance", "GDPR: personal data detected", "compliance");
    }
  }

  emitDevToolsEvent({
    type: "guardrail_check",
    guardrailName: `compliance-${mode}`,
    guardrailType: "input",
    passed: !blocked || !piiResult.detected,
    inputLength: text.length,
  });

  if (blocked) {
    system.facts.blockedCount = (system.facts.blockedCount as number) + 1;
  }

  if (!blocked && !piiResult.detected) {
    addTimeline("pass", "message passed all checks", "pass");
  }

  const redactedText = piiResult.redactedText ?? text;

  return {
    id,
    text,
    blocked,
    redactedText,
    injectionResult: injectionResult.detected ? injectionResult : null,
    piiResult: piiResult.detected ? piiResult : null,
  };
}
