/**
 * Mock Guardrails — pattern-matching topic detection with zero API calls.
 *
 * Mirrors the `createModerationGuardrail` pattern from @directive-run/ai
 * but runs entirely locally for the interactive example.
 */

export interface GuardrailResult {
  blocked: boolean;
  guardrailName: string;
  reason: string;
}

// Keyword guardrail — regex patterns for obvious off-topic input
const OFF_TOPIC_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /recipe|cooking|food|bake|ingredient/i, category: "cooking" },
  { pattern: /politic|election|vote|democrat|republican/i, category: "politics" },
  { pattern: /sport|game score|nfl|nba|mlb|soccer|football score/i, category: "sports" },
];

export function checkKeywordGuardrail(text: string): GuardrailResult {
  for (const { pattern, category } of OFF_TOPIC_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        guardrailName: "keyword",
        reason: `Matched off-topic category: ${category}`,
      };
    }
  }

  return {
    blocked: false,
    guardrailName: "keyword",
    reason: "No off-topic keywords detected",
  };
}

// Topic classifier (sync, simulated) — checks against allowed topics list
const TOPIC_SIGNALS: Record<string, RegExp> = {
  product: /product|feature|plan|upgrade|downgrade|pricing/i,
  billing: /bill|invoice|charge|payment|subscription|refund/i,
  support: /help|issue|problem|broken|error|bug|fix|reset|password/i,
  technical: /api|integrate|sdk|webhook|endpoint|config/i,
};

export function checkTopicClassifier(
  text: string,
  allowedTopics: string[],
): GuardrailResult {
  // If any allowed topic matches, it's on-topic
  for (const topic of allowedTopics) {
    const signal = TOPIC_SIGNALS[topic];
    if (signal && signal.test(text)) {
      return {
        blocked: false,
        guardrailName: "classifier",
        reason: `Matched allowed topic: ${topic}`,
      };
    }
  }

  // Short greetings are allowed
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text.trim())) {
    return {
      blocked: false,
      guardrailName: "classifier",
      reason: "Greeting or acknowledgment — allowed",
    };
  }

  // Nothing matched — block as off-topic
  return {
    blocked: true,
    guardrailName: "classifier",
    reason: "No allowed topic detected in input",
  };
}

// Mock agent response — pre-canned product support answers
const MOCK_RESPONSES: Array<{ pattern: RegExp; response: string }> = [
  { pattern: /password|reset/i, response: "To reset your password, go to Settings > Security > Reset Password. You'll receive a confirmation email." },
  { pattern: /bill|invoice|charge|payment/i, response: "You can view your billing history at Settings > Billing. For refund requests, please include your invoice number." },
  { pattern: /pricing|plan|upgrade/i, response: "We offer Free, Pro ($29/mo), and Enterprise plans. Visit our pricing page for a full comparison." },
  { pattern: /api|sdk|webhook|endpoint/i, response: "Our API docs are at docs.example.com/api. Rate limits are 1000 req/min on Pro, 10000 on Enterprise." },
  { pattern: /bug|error|broken|issue/i, response: "I'm sorry to hear that! Could you share the error message? In the meantime, try clearing your cache and refreshing." },
  { pattern: /feature|request/i, response: "Thanks for the suggestion! I've logged this as a feature request. Our product team reviews these weekly." },
  { pattern: /refund/i, response: "Refund requests are processed within 5-7 business days. Please provide your invoice number and I'll start the process." },
  { pattern: /cancel|subscription/i, response: "To cancel your subscription, go to Settings > Billing > Cancel Plan. Your access continues until the end of the billing period." },
];

export function getMockAgentResponse(input: string): string {
  for (const { pattern, response } of MOCK_RESPONSES) {
    if (pattern.test(input)) {
      return response;
    }
  }

  return "I'd be happy to help! Could you tell me more about what you need assistance with? I can help with billing, account settings, technical questions, and more.";
}
