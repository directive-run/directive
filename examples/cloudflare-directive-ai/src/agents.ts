import {
  createMultiAgentOrchestrator,
  sequential,
  type AgentLike,
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createEnhancedPIIGuardrail } from "@directive-run/ai";
import type { ArticleFrontmatter, IngestQueueEntry } from "./schema.js";

const aggregatorAgent: AgentLike = {
  name: "aggregator",
  instructions: [
    "You are an aggregator. Given 3-8 sources on the same event,",
    "produce a unified summary with headline + 3-5 bullets + why-it-matters.",
    "Cite each source inline as [N] with a card at the bottom.",
    "Return JSON with keys: title (string), sources (array of {url, publisher, tier}),",
    "confidence (0-1 number).",
  ].join(" "),
};

const rewriterAgent: AgentLike = {
  name: "rewriter",
  instructions: [
    "Rewrite this aggregation into the publication's unified voice.",
    "Preserve all citations. Never verbatim-quote beyond fair-use excerpt",
    "(< 30 words + attribution). Ensure headline is scannable.",
    "Return JSON matching the full ArticleFrontmatter schema.",
  ].join(" "),
};

const publisherAgent: AgentLike = {
  name: "publisher",
  instructions: [
    "You receive the rewriter's full JSON article. Add a slug (kebab-case,",
    "no more than 60 chars) and publishedAt (ISO 8601 UTC). Echo every",
    "other field verbatim so the returned JSON matches the full",
    "ArticleFrontmatter schema (title, slug, publishedAt, sources,",
    "confidence, aiTier).",
  ].join(" "),
};

export interface PublishingChain {
  run: (
    sources: readonly IngestQueueEntry[],
    tenantId: string,
  ) => Promise<ArticleFrontmatter>;
}

export function createPublishingChain(apiKey: string): PublishingChain {
  const runner = createAnthropicRunner({
    apiKey,
    model: "claude-sonnet-4-5-20250929",
  });

  const orchestrator = createMultiAgentOrchestrator({
    runner,
    agents: {
      aggregator: { agent: aggregatorAgent },
      rewriter: { agent: rewriterAgent },
      publisher: { agent: publisherAgent },
    },
    guardrails: {
      input: [createEnhancedPIIGuardrail()],
    },
    patterns: {
      publish: sequential(["aggregator", "rewriter", "publisher"]),
    },
    maxTokenBudget: 50_000,
  });

  return {
    run: async (sources, tenantId) => {
      const input = JSON.stringify({ sources, tenantId });
      const result = await orchestrator.runPattern<string>("publish", input);
      return JSON.parse(result) as ArticleFrontmatter;
    },
  };
}
