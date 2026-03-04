// Example: ai-guardrails
// Source: examples/ai-guardrails/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * AI Safety Shield — Prompt Injection & PII Detection
 *
 * Chat interface where every message passes through prompt injection detection,
 * PII detection, and compliance checks. All run locally using built-in patterns.
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

interface ChatMessage {
  id: string;
  text: string;
  blocked: boolean;
  redactedText: string;
  injectionResult: InjectionDetectionResult | null;
  piiResult: PIIDetectionResult | null;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type: "pass" | "injection" | "pii" | "compliance" | "info";
}

type ComplianceMode = "standard" | "gdpr" | "hipaa";

// ============================================================================
// Timeline
// ============================================================================

const timeline: TimelineEntry[] = [];

function addTimeline(
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

const schema = {
  facts: {
    messages: t.object<ChatMessage[]>(),
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

const system = createSystem({
  module: guardrailModule,
  plugins: [devtoolsPlugin({ name: "ai-guardrails" })],
});
system.start();

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeMessage(text: string): ChatMessage {
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let blocked = false;

  // 1. Prompt injection detection
  const injectionResult = detectPromptInjection(text);
  if (injectionResult.detected) {
    blocked = true;
    system.facts.injectionAttempts =
      (system.facts.injectionAttempts as number) + 1;
    for (const p of injectionResult.patterns) {
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
    }

    if (mode === "gdpr" && hasContactInfo) {
      blocked = true;
      system.facts.complianceBlocks =
        (system.facts.complianceBlocks as number) + 1;
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
  }


  return {
    id,
    text,
    blocked,
    redactedText,
    injectionResult: injectionResult.detected ? injectionResult : null,
    piiResult: piiResult.detected ? piiResult : null,
  };
}

// ============================================================================
// DOM References
// ============================================================================

  "gs-compliance",
  "gs-redaction",

// Timeline

// Pre-built test buttons

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}


// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [
  ...Object.keys(schema.facts),
  ...Object.keys(schema.derivations),
];
system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

function sendMessage(text: string) {
  if (!text.trim()) {
    return;
  }

  const msg = analyzeMessage(text);
  const messages = [...(system.facts.messages as ChatMessage[]), msg];
  system.facts.messages = messages;
}


// Test buttons


// ============================================================================
// Initial Render
// ============================================================================

render();
