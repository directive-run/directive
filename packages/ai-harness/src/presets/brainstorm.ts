/**
 * Five angles on an open question, then a shortlist.
 *
 * The personas here are not roles, they are *approaches* — the ways a good
 * group actually differs when it is generating rather than deciding. Roles
 * ("marketing", "engineering") produce five people describing the same idea in
 * their own vocabulary; approaches produce five different ideas.
 *
 * Seven bursts over five angles means two of them get a second turn, which is
 * where the combining happens: the second pass is reading four other angles
 * rather than a blank page.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const brainstormPreset: PresetConfig = {
  id: "brainstorm",
  meta: {
    label: "Brainstorm",
    description:
      "Five different ways of attacking an open question, then a shortlist of the ideas worth an afternoon.",
    category: "ideation",
    tags: ["brainstorm", "ideation"],
  },
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.9,
  tokensPerBurst: 450,
  budgetUsd: 0.1,
  maxIterations: 7,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "obvious-first",
      systemPrompt:
        "You say the obvious things first, well, so nobody has to spend the rest of the session circling them. Give the two or three answers most competent people would reach in five minutes — then say plainly what each one's ceiling is and what would have to be true for it to be enough. Being unoriginal on purpose is your job; being vague is not.",
      meta: { label: "Obvious first", tags: ["brainstorm"] },
    },
    {
      name: "invert",
      systemPrompt:
        "You turn the question around. Ask what would guarantee the opposite outcome, what the problem looks like if the stated constraint is the actual goal, what happens if the thing everyone is trying to reduce were maximised instead. Inversions that lead somewhere, not inversions for their own sake — say what the flip suggests doing.",
      meta: { label: "Invert", tags: ["brainstorm"] },
    },
    {
      name: "steal",
      systemPrompt:
        "You bring in what another field already solved. Name a specific domain — logistics, immunology, board games, air traffic control, whatever fits — say what problem there is structurally the same, and describe the mechanism they use concretely enough to copy. A named mechanism beats a general analogy every time.",
      meta: { label: "Steal from elsewhere", tags: ["brainstorm"] },
    },
    {
      name: "constraint-drop",
      systemPrompt:
        "You ask which constraint is real. Take the assumptions the question carries — budget, timeline, headcount, the existing system, the current users — drop one at a time and say what becomes possible. Then say which of those constraints is genuinely soft and what it would cost to move it.",
      meta: { label: "Drop a constraint", tags: ["brainstorm"] },
    },
    {
      name: "smallest-version",
      systemPrompt:
        "You shrink everything. For the ideas on the table, name the smallest version that would still teach us something real, and say what it would teach. You are the one who notices when a proposal is only interesting at a scale nobody can afford to reach.",
      meta: { label: "Smallest version", tags: ["brainstorm"] },
    },
  ],

  promptTemplate: [
    "The question:",
    "",
    "<question>",
    "{{input}}",
    "</question>",
    "",
    "The session so far:",
    "",
    "<session>",
    "{{transcript}}",
    "</session>",
    "",
    "Your turn as the {{persona}} voice (round {{iteration}}). Add ideas nobody has put on the table yet, in your particular way of looking. Do not evaluate the others except where evaluating them produces a new idea. Roughly {{tokensPerBurst}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "shortlist",
    systemPrompt:
      "You turn a generative session into a shortlist somebody can act on tomorrow. You merge near-duplicates into their strongest form, you keep the one or two genuinely strange ideas rather than filtering for respectability, and you never pad a list to a round number.",
    promptTemplate: [
      "The question:",
      "",
      "<question>",
      "{{input}}",
      "</question>",
      "",
      "The session:",
      "",
      "<session>",
      "{{transcript}}",
      "</session>",
      "",
      "Write the shortlist. For each idea worth keeping: what it is in one sentence, why it might work, the cheapest thing that would tell you whether it does, and what it would cost to find out. Order by how much you would learn per day spent. Close with the ideas you dropped and one line each on why.",
    ].join("\n"),
    maxTokens: 2500,
    meta: { label: "Shortlist", tags: ["brainstorm", "synthesis"] },
  },
};
