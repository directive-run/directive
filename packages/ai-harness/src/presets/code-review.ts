/**
 * Four reviewers reading the same diff, in turn, then a report.
 *
 * The one preset that ships with the package — an example of the shape, not a
 * library. Each reviewer sees the whole conversation so far, so the second one
 * is arguing with the first rather than repeating it, and the synthesizer reads
 * all of it rather than four disconnected reviews.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const codeReviewPreset: PresetConfig = {
  id: "code-review",
  meta: {
    label: "Code review",
    description:
      "Four reviewers take turns on one diff, then a written report.",
    category: "review",
    tags: ["code-review"],
  },
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.6,
  tokensPerTurn: 700,
  budgetUsd: 0.3,
  maxIterations: 8,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "correctness",
      systemPrompt:
        "You review for correctness. Look for logic errors, off-by-one mistakes, wrong error handling, and cases the code does not cover. Cite specific lines. If an earlier reviewer already made a point, either sharpen it with something concrete or move on — do not restate it.",
      meta: { label: "Correctness", tags: ["review", "correctness"] },
    },
    {
      name: "security",
      systemPrompt:
        "You review for security. Look for injection, unvalidated input crossing a trust boundary, secrets in code, permissive defaults, and authorization checks that sit below where the decision is made. Say what an attacker does with each finding, concretely.",
      meta: { label: "Security", tags: ["review", "security"] },
    },
    {
      name: "design",
      systemPrompt:
        "You review design. Ask whether each guarantee has exactly one place to live, whether a caller can hold this wrong, and whether the shape will still be right after the next two features. Name the alternative you would prefer and what it costs.",
      meta: { label: "Design", tags: ["review", "design"] },
    },
    {
      name: "tests",
      systemPrompt:
        "You review the tests. Ask which of the findings so far a test would have caught, which are untested, and which tests assert on incidental detail rather than behavior. Propose specific cases, not coverage targets.",
      meta: { label: "Tests", tags: ["review", "tests"] },
    },
  ],

  promptTemplate: [
    "You are reviewing the following change.",
    "",
    "<change>",
    "{{input}}",
    "</change>",
    "",
    "The review so far:",
    "",
    "<review>",
    "{{transcript}}",
    "</review>",
    "",
    "It is your turn as the {{persona}} reviewer (round {{iteration}}). Add what only you would notice. Be specific and be brief — roughly {{tokensPerTurn}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "report",
    systemPrompt:
      "You turn a multi-reviewer discussion into one report an author can act on. You resolve disagreements rather than listing both sides, and you rank by what would actually go wrong.",
    promptTemplate: [
      "The change under review:",
      "",
      "<change>",
      "{{input}}",
      "</change>",
      "",
      "The full review discussion:",
      "",
      "<review>",
      "{{transcript}}",
      "</review>",
      "",
      "Write the review report. Lead with the findings that would cause real damage, then the rest, then what the reviewers agreed was fine. Where two reviewers disagreed, say which is right and why. Cite the reviewer behind each finding.",
    ].join("\n"),
    maxTokens: 4000,
    meta: { label: "Review report", tags: ["review", "synthesis"] },
  },
};
