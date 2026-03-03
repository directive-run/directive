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
    messages: t.object<ChatMessage[]>(),
    isProcessing: t.boolean(),
    lastGuardrailResult: t.object<GuardrailResult | null>(),
    guardrailLog: t.object<GuardrailLogEntry[]>(),
    allowedTopics: t.object<string[]>(),
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
      return (facts.messages as ChatMessage[]).filter((m) => m.role === "user")
        .length;
    },

    blockedCount: (facts) => {
      return (facts.messages as ChatMessage[]).filter(
        (m) => m.role === "user" && m.blocked,
      ).length;
    },

    allowedCount: (facts) => {
      return (facts.messages as ChatMessage[]).filter(
        (m) => m.role === "user" && !m.blocked,
      ).length;
    },

    blockRate: (facts, derive) => {
      const total = derive.messageCount as number;
      if (total === 0) {
        return "0%";
      }
      const blocked = derive.blockedCount as number;
      const rate = Math.round((blocked / total) * 100);

      return `${rate}%`;
    },

    canSend: (facts) => {
      return (
        (facts.input as string).trim().length > 0 &&
        !(facts.isProcessing as boolean)
      );
    },

    lastMessageBlocked: (facts) => {
      const msgs = facts.messages as ChatMessage[];
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
      const text = (facts.input as string).trim();
      if (text.length === 0 || facts.isProcessing) {
        return;
      }

      // Add user message
      const messages = [...(facts.messages as ChatMessage[])];
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

      const classifierResult = checkTopicClassifier(
        text,
        facts.allowedTopics as string[],
      );
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
      const topics = [...(facts.allowedTopics as string[])];
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
        const result = facts.lastGuardrailResult as GuardrailResult | null;

        return result?.blocked === true && (facts.isProcessing as boolean);
      },
      require: (facts) => {
        const result = facts.lastGuardrailResult as GuardrailResult;

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
        const result = facts.lastGuardrailResult as GuardrailResult | null;

        return result?.blocked === false && (facts.isProcessing as boolean);
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
        const messages = [...(context.facts.messages as ChatMessage[])];
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
        const messages = [...(context.facts.messages as ChatMessage[])];
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
        const result = facts.lastGuardrailResult as GuardrailResult | null;
        if (!result) {
          return;
        }

        const msgs = facts.messages as ChatMessage[];
        const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
        const log = [...(facts.guardrailLog as GuardrailLogEntry[])];
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
