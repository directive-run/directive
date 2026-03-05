# Examples

> Auto-generated from extracted examples. Do not edit manually.

## ai-guardrails

```typescript
// Example: ai-guardrails
// Source: examples/ai-guardrails/src/module.ts
// Pure module file — no DOM wiring

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
  debug: { runHistory: true },
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
```

## topic-guard

```typescript
// Example: topic-guard
// Source: examples/topic-guard/src/topic-guard.ts
// Pure module file — no DOM wiring

/**
 * Topic Guard — Directive Module
 *
 * Demonstrates input guardrails for AI agents. Messages are checked against
 * configurable guardrails before reaching the mock agent. Blocked messages
 * are rejected with an explanation; allowed messages get a mock response.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import {
  type GuardrailResult,
  checkKeywordGuardrail,
  checkTopicClassifier,
  getMockAgentResponse,
} from "./mock-guardrails.js";

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  role: "user" | "agent" | "system";
  text: string;
  blocked: boolean;
  guardrail?: string;
}

export interface GuardrailLogEntry {
  timestamp: number;
  input: string;
  result: GuardrailResult;
}

// ============================================================================
// Schema
// ============================================================================

export const topicGuardSchema = {
  facts: {
    input: t.string(),
    messages: t.array<ChatMessage>(),
    isProcessing: t.boolean(),
    lastGuardrailResult: t.object<GuardrailResult | null>(),
    guardrailLog: t.array<GuardrailLogEntry>(),
    allowedTopics: t.array<string>(),
  },
  derivations: {
    messageCount: t.number(),
    blockedCount: t.number(),
    allowedCount: t.number(),
    blockRate: t.string(),
    canSend: t.boolean(),
    lastMessageBlocked: t.boolean(),
  },
  events: {
    send: {},
    clear: {},
    setInput: { value: t.string() },
    toggleTopic: { topic: t.string() },
  },
  requirements: {
    BLOCK_MESSAGE: {
      reason: t.string(),
      guardrailName: t.string(),
    },
    ALLOW_MESSAGE: {},
  },
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const topicGuardModule = createModule("topic-guard", {
  schema: topicGuardSchema,

  init: (facts) => {
    facts.input = "";
    facts.messages = [];
    facts.isProcessing = false;
    facts.lastGuardrailResult = null;
    facts.guardrailLog = [];
    facts.allowedTopics = ["product", "billing", "support", "technical"];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    messageCount: (facts) => {
      return facts.messages.filter((m) => m.role === "user").length;
    },

    blockedCount: (facts) => {
      return facts.messages.filter((m) => m.role === "user" && m.blocked)
        .length;
    },

    allowedCount: (facts) => {
      return facts.messages.filter((m) => m.role === "user" && !m.blocked)
        .length;
    },

    blockRate: (facts, derive) => {
      const total = derive.messageCount;
      if (total === 0) {
        return "0%";
      }
      const blocked = derive.blockedCount;
      const rate = Math.round((blocked / total) * 100);

      return `${rate}%`;
    },

    canSend: (facts) => {
      return facts.input.trim().length > 0 && !facts.isProcessing;
    },

    lastMessageBlocked: (facts) => {
      const msgs = facts.messages;
      if (msgs.length === 0) {
        return false;
      }

      return msgs[msgs.length - 1].blocked;
    },
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    send: (facts) => {
      const text = facts.input.trim();
      if (text.length === 0 || facts.isProcessing) {
        return;
      }

      // Add user message
      const messages = [...facts.messages];
      messages.push({ role: "user", text, blocked: false });
      facts.messages = messages;

      // Run guardrails
      const keywordResult = checkKeywordGuardrail(text);
      if (keywordResult.blocked) {
        facts.lastGuardrailResult = keywordResult;
        facts.isProcessing = true;
        facts.input = "";

        return;
      }

      const classifierResult = checkTopicClassifier(text, facts.allowedTopics);
      facts.lastGuardrailResult = classifierResult;
      facts.isProcessing = true;
      facts.input = "";
    },

    clear: (facts) => {
      facts.messages = [];
      facts.guardrailLog = [];
      facts.lastGuardrailResult = null;
      facts.isProcessing = false;
    },

    setInput: (facts, { value }) => {
      facts.input = value;
    },

    toggleTopic: (facts, { topic }) => {
      const topics = [...facts.allowedTopics];
      const idx = topics.indexOf(topic);
      if (idx >= 0) {
        topics.splice(idx, 1);
      } else {
        topics.push(topic);
      }
      facts.allowedTopics = topics;
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    offTopicDetected: {
      priority: 100,
      when: (facts) => {
        return (
          facts.lastGuardrailResult?.blocked === true && facts.isProcessing
        );
      },
      require: (facts) => {
        const result = facts.lastGuardrailResult!;

        return {
          type: "BLOCK_MESSAGE",
          reason: result.reason,
          guardrailName: result.guardrailName,
        };
      },
    },

    onTopicConfirmed: {
      priority: 90,
      when: (facts) => {
        return (
          facts.lastGuardrailResult?.blocked === false && facts.isProcessing
        );
      },
      require: () => ({
        type: "ALLOW_MESSAGE",
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    blockMessage: {
      requirement: "BLOCK_MESSAGE",
      resolve: async (req, context) => {
        const messages = [...context.facts.messages];
        // Mark the last user message as blocked
        const lastUserIdx = messages.length - 1;
        if (lastUserIdx >= 0) {
          messages[lastUserIdx] = {
            ...messages[lastUserIdx],
            blocked: true,
            guardrail: req.guardrailName,
          };
        }
        // Add system rejection message
        messages.push({
          role: "system",
          text: "I can only help with product-related questions.",
          blocked: true,
          guardrail: req.guardrailName,
        });
        context.facts.messages = messages;
        context.facts.isProcessing = false;
      },
    },

    allowMessage: {
      requirement: "ALLOW_MESSAGE",
      resolve: async (_req, context) => {
        const messages = [...context.facts.messages];
        const lastUserMsg = messages.filter((m) => m.role === "user").pop();
        const responseText = getMockAgentResponse(lastUserMsg?.text ?? "");
        messages.push({
          role: "agent",
          text: responseText,
          blocked: false,
        });
        context.facts.messages = messages;
        context.facts.isProcessing = false;
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logGuardrailResult: {
      deps: ["lastGuardrailResult"],
      run: (facts) => {
        const result = facts.lastGuardrailResult;
        if (!result) {
          return;
        }

        const lastUserMsg = [...facts.messages]
          .reverse()
          .find((m) => m.role === "user");
        const log = [...facts.guardrailLog];
        log.push({
          timestamp: Date.now(),
          input: lastUserMsg?.text ?? "",
          result,
        });
        facts.guardrailLog = log;
      },
    },
  },
});
```
