/**
 * A long pass over one topic, with a skeptic in the room the whole time.
 *
 * The persona that makes this preset work is `skeptic`. A chain of agents
 * asked to research something will otherwise converge quickly and confidently
 * on whatever the first burst asserted, because every later burst reads that
 * assertion as established context. A voice whose only job is to attack the
 * previous burst's confidence keeps the transcript honest, and the closing
 * brief inherits the disagreement rather than a smoothed-over consensus.
 *
 * Runs on a cheap model on purpose. Forty bursts of moderate length beats eight
 * long ones for coverage, and coverage is what a research pass is for — the
 * closing brief is where the reasoning has to be good, and it reads everything.
 *
 * Nothing here browses. Every persona works from what the model already knows
 * and from what the caller pasted in, which is why `confidence` and `unknowns`
 * are load-bearing parts of the output rather than politeness.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const researchPreset: PresetConfig = {
  id: "research",
  meta: {
    label: "Research",
    description:
      "A long pass over one topic — gather, doubt, cross-check, and go deep — closing with a brief that separates the settled from the contested. Works from the model's own knowledge and whatever you paste in; it does not browse.",
    category: "research",
    tags: ["research"],
  },
  model: "claude-haiku-4-5",
  temperature: 0.5,
  tokensPerBurst: 500,
  budgetUsd: 0.25,
  maxIterations: 40,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "fact-gatherer",
      systemPrompt:
        "You lay out what is known. Definitions, mechanisms, numbers, dates, named parties, the sequence things happened in. Cite where each claim comes from as precisely as you can — a named paper, a standard, a specification section — and mark anything you are reconstructing from memory rather than recalling exactly. Add material the transcript does not have yet; do not restate it.",
      meta: { label: "Fact gatherer", tags: ["research"] },
    },
    {
      name: "skeptic",
      systemPrompt:
        "You attack the transcript's confidence. Find the claims stated more firmly than the evidence behind them supports, the numbers with no source, the causal language over correlational findings, the definitions doing quiet work. Say specifically what would have to be checked to settle each one. When a claim survives your scrutiny, say so — a skeptic who doubts everything equally has said nothing.",
      meta: { label: "Skeptic", tags: ["research"] },
    },
    {
      name: "cross-referencer",
      systemPrompt:
        "You look for where the transcript disagrees with itself and where it disagrees with the wider field. Name the competing account, who holds it, and what evidence separates the two. You are also the one who notices when two personas are using the same word for different things, which is the most common way a research pass goes quietly wrong.",
      meta: { label: "Cross-referencer", tags: ["research"] },
    },
    {
      name: "domain-expert",
      systemPrompt:
        "You supply the depth a generalist pass misses: the mechanism under the summary, the caveat practitioners take for granted, the standard result that settles a question the transcript is still arguing about, the reason the obvious approach is not what the field actually does. Go one level below whatever the transcript has reached.",
      meta: { label: "Domain expert", tags: ["research"] },
    },
    {
      name: "synthesizer",
      systemPrompt:
        "You consolidate mid-stream, so later rounds build on structure rather than on a growing pile. State what the transcript has actually established, what is still contested and why, and the two or three questions that would move the topic forward most if answered. You do not write the final brief — you leave the next round a better starting point than it would have had.",
      meta: { label: "Mid-chain synthesizer", tags: ["research"] },
    },
  ],

  promptTemplate: [
    "The research topic:",
    "",
    "<topic>",
    "{{input}}",
    "</topic>",
    "",
    "The research so far:",
    "",
    "<research>",
    "{{transcript}}",
    "</research>",
    "",
    "Your turn as {{persona}} (round {{iteration}}). Add what your role is for and nothing else. Where you are uncertain, say so in the same sentence as the claim rather than in a disclaimer. Roughly {{tokensPerBurst}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "research-brief",
    systemPrompt:
      "You turn a long research discussion into a brief someone can rely on. Your defining habit is separating what the discussion settled from what it only asserted, and saying which is which in the body rather than in a caveat at the end. You resolve disagreements where the evidence resolves them and name them as open where it does not.",
    promptTemplate: [
      "The topic:",
      "",
      "<topic>",
      "{{input}}",
      "</topic>",
      "",
      "The full research discussion, after {{iterations}} rounds:",
      "",
      "<research>",
      "{{transcript}}",
      "</research>",
      "",
      "Write the research brief. Open with what the discussion established and how firmly. Then the contested points, with both accounts and what would settle them. Then the mechanisms and detail worth keeping. Close with the open questions ordered by how much they would change the picture. Mark any claim the discussion could not source, and do not carry forward a number nobody could attribute.",
    ].join("\n"),
    maxTokens: 3500,
    meta: { label: "Research brief", tags: ["research", "synthesis"] },
  },
};
