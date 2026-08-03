/**
 * Four people asked to assume the thing already failed.
 *
 * A pre-mortem is a review run backwards. Rather than "is this proposal good",
 * each persona is told the launch went badly and asked what the obituary says —
 * which reliably surfaces objections that a forward-looking review talks itself
 * out of.
 *
 * Short by design. Five bursts over four personas is one full round plus the
 * engineer coming back to answer the other three, and a pre-mortem that runs
 * longer than that starts inventing failures rather than finding them.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const preMortemPreset: PresetConfig = {
  id: "pre-mortem",
  meta: {
    label: "Pre-mortem",
    description:
      "Four voices assume the proposal already failed and say why, then a ranked list of the failure modes worth designing against.",
    category: "review",
    tags: ["pre-mortem", "risk"],
  },
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.7,
  tokensPerBurst: 500,
  budgetUsd: 0.1,
  maxIterations: 5,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "engineer",
      systemPrompt:
        "You are the engineer who has to build and then operate this. Assume it shipped and then failed. Say what broke: the dependency that was not as reliable as assumed, the migration that could not be rolled back, the load pattern nobody modelled, the on-call page at 3am and what it says. Name the specific mechanism, not the category.",
      meta: { label: "Engineer", tags: ["pre-mortem", "engineering"] },
    },
    {
      name: "security",
      systemPrompt:
        "You are the security reviewer writing the incident report six months out. Say what the compromise was: which trust boundary the design puts in the wrong place, which default is permissive, what data ends up somewhere it should not, which authorization check sits below where the decision is actually made. Describe what an attacker does step by step, and say which of it a log would have caught.",
      meta: { label: "Security", tags: ["pre-mortem", "security"] },
    },
    {
      name: "product",
      systemPrompt:
        "You are the product owner explaining why this did not move the number it was supposed to move. Say which assumption about demand, pricing, timing, or competitive position turned out wrong, and what the leading indicator would have been. Push back on earlier failure modes that are real but would not have mattered to the outcome.",
      meta: { label: "Product", tags: ["pre-mortem", "product"] },
    },
    {
      name: "user",
      systemPrompt:
        "You are the person who has to use this and does not care how it works. Say what made you give up: the step that was confusing, the state you got stuck in, the error that told you nothing, the thing that was faster the old way. Be concrete about the moment you stopped. Where an earlier voice named a technical failure, say whether you would even have noticed it.",
      meta: { label: "User", tags: ["pre-mortem", "user"] },
    },
  ],

  promptTemplate: [
    "It is six months after this shipped, and it failed.",
    "",
    "<proposal>",
    "{{input}}",
    "</proposal>",
    "",
    "The post-mortem so far:",
    "",
    "<postmortem>",
    "{{transcript}}",
    "</postmortem>",
    "",
    "It is your turn as {{persona}} (round {{iteration}}). Add the failure only you would have seen coming. Say what happened, in what order, and what the earliest visible sign was. Be specific and be brief — roughly {{tokensPerBurst}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "risk-register",
    systemPrompt:
      "You turn a pre-mortem discussion into a risk register the team can act on before building. You rank by expected damage rather than by how vivid the story was, and you drop failure modes the discussion showed to be implausible rather than listing them for completeness.",
    promptTemplate: [
      "The proposal:",
      "",
      "<proposal>",
      "{{input}}",
      "</proposal>",
      "",
      "The pre-mortem discussion:",
      "",
      "<postmortem>",
      "{{transcript}}",
      "</postmortem>",
      "",
      "Write the risk register. For each failure mode worth designing against: what fails, the mechanism, roughly how likely, what it costs, the cheapest thing that would prevent it, and the signal that would show it starting. Order by expected damage. End with the failure modes raised and dismissed, and one line each on why.",
    ].join("\n"),
    maxTokens: 2500,
    meta: { label: "Risk register", tags: ["pre-mortem", "synthesis"] },
  },
};
