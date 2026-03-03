/**
 * Checkers Chat - Directive Module
 *
 * Manages the chat panel state for Claude AI opponent mode.
 * Includes streaming, analysis, and cache stats.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";

// ============================================================================
// Types
// ============================================================================

export interface ChatMessage {
  sender: "claude" | "system" | "user";
  text: string;
  reasoning?: string;
  analysis?: string;
}

// ============================================================================
// Schema
// ============================================================================

export const chatSchema = {
  facts: {
    messages: t.object<ChatMessage[]>(),
    thinking: t.boolean(),
    totalTokens: t.number(),
    estimatedCost: t.number(),
    circuitState: t.string<"CLOSED" | "OPEN" | "HALF_OPEN">(),
    // Streaming
    streamingText: t.string(),
    isStreaming: t.boolean(),
    // Analysis
    analysisText: t.string(),
    // Cache stats
    cacheHitRate: t.number(),
    cacheEntries: t.number(),
  },
  derivations: {},
  events: {
    addMessage: {
      message: t.object<ChatMessage>(),
    },
    setThinking: { thinking: t.boolean() },
    updateAIState: {
      totalTokens: t.number(),
      estimatedCost: t.number(),
      circuitState: t.string<"CLOSED" | "OPEN" | "HALF_OPEN">(),
    },
    clearChat: {},
    // Streaming events
    appendStreamToken: { token: t.string() },
    finishStream: { finalText: t.string() },
    startStream: {},
    // Analysis event
    setAnalysis: { text: t.string() },
    // Cache stats
    updateCacheStats: { hitRate: t.number(), entries: t.number() },
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

export const checkersChat = createModule("checkers-chat", {
  schema: chatSchema,

  init: (facts) => {
    facts.messages = [];
    facts.thinking = false;
    facts.totalTokens = 0;
    facts.estimatedCost = 0;
    facts.circuitState = "CLOSED";
    facts.streamingText = "";
    facts.isStreaming = false;
    facts.analysisText = "";
    facts.cacheHitRate = 0;
    facts.cacheEntries = 0;
  },

  events: {
    addMessage: (facts, { message }) => {
      facts.messages = [...(facts.messages as ChatMessage[]), message];
    },

    setThinking: (facts, { thinking }) => {
      facts.thinking = thinking;
    },

    updateAIState: (facts, { totalTokens, estimatedCost, circuitState }) => {
      facts.totalTokens = totalTokens;
      facts.estimatedCost = estimatedCost;
      facts.circuitState = circuitState;
    },

    clearChat: (facts) => {
      facts.messages = [];
      facts.thinking = false;
      facts.totalTokens = 0;
      facts.estimatedCost = 0;
      facts.circuitState = "CLOSED";
      facts.streamingText = "";
      facts.isStreaming = false;
      facts.analysisText = "";
      facts.cacheHitRate = 0;
      facts.cacheEntries = 0;
    },

    // Streaming
    startStream: (facts) => {
      facts.isStreaming = true;
      facts.streamingText = "";
    },

    appendStreamToken: (facts, { token }) => {
      facts.streamingText = (facts.streamingText as string) + token;
    },

    finishStream: (facts, { finalText }) => {
      facts.isStreaming = false;
      facts.streamingText = finalText;
    },

    // Analysis
    setAnalysis: (facts, { text }) => {
      facts.analysisText = text;
    },

    // Cache stats
    updateCacheStats: (facts, { hitRate, entries }) => {
      facts.cacheHitRate = hitRate;
      facts.cacheEntries = entries;
    },
  },
});
