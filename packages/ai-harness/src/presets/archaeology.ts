/**
 * Landing in a codebase nobody left notes about.
 *
 * The four personas are the four questions someone actually asks in their first
 * week, in the order they become answerable: what are the pieces, where does
 * the state live, what will I break, and what should I do about it. The last
 * one is last on purpose — refactor advice given before the state has been
 * traced is where a confident newcomer does the most damage.
 *
 * Feed it whatever you can get: a file tree, the output of a dependency graph,
 * the interesting modules pasted end to end, a package manifest and the entry
 * point. The personas work from what is in front of them and are told to say
 * when the material does not support a conclusion, rather than filling the gap
 * with the shape a codebase like this usually has.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const archaeologyPreset: PresetConfig = {
  id: "archaeology",
  meta: {
    label: "Archaeology",
    description:
      "Make sense of an unfamiliar codebase: what the pieces are, where the state lives, what breaks when you touch it, and what to do first.",
    category: "analysis",
    tags: ["archaeology", "codebase"],
  },
  model: "claude-haiku-4-5",
  temperature: 0.4,
  tokensPerTurn: 600,
  budgetUsd: 0.2,
  maxIterations: 30,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "module-mapper",
      systemPrompt:
        "You draw the map. What the top-level pieces are, what each one is responsible for, which direction the dependencies point, where the layering is violated, and which module everything else reaches into. Name the seams — the places the codebase could be cut apart — and the couplings that would make cutting expensive. Work from what you were given and say when a piece is only inferred from its name.",
      meta: { label: "Module mapper", tags: ["archaeology"] },
    },
    {
      name: "state-tracer",
      systemPrompt:
        "You follow the state. Where each piece of durable and in-memory state is created, who writes it, who reads it, and which invariants it is supposed to hold. Find the state with more than one owner, the caches with no invalidation, the values kept in two places that are meant to agree, and the initialisation order things quietly depend on. This is where the real behaviour of an unfamiliar system lives.",
      meta: { label: "State tracer", tags: ["archaeology"] },
    },
    {
      name: "breakage-predictor",
      systemPrompt:
        "You say what breaks. Given the map and the state trace, name the changes that look local and are not: the function whose callers rely on a side effect, the shape that crosses a serialisation boundary, the timing nobody wrote down, the error path only one caller handles. For each, say what the symptom would look like and how far from the change it would surface.",
      meta: { label: "Breakage predictor", tags: ["archaeology"] },
    },
    {
      name: "refactor-suggester",
      systemPrompt:
        "You say what to do first. Only changes the discussion has actually justified: the one that makes the next five changes cheaper, the one that removes a whole class of the breakage the previous voice predicted, the boundary worth drawing before anything else. Give each a rough size and say what has to be true before starting. Where the right answer is to leave something alone, say that.",
      meta: { label: "Refactor suggester", tags: ["archaeology"] },
    },
  ],

  promptTemplate: [
    "An unfamiliar codebase:",
    "",
    "<codebase>",
    "{{input}}",
    "</codebase>",
    "",
    "What has been worked out so far:",
    "",
    "<findings>",
    "{{transcript}}",
    "</findings>",
    "",
    "Your turn as {{persona}} (round {{iteration}}). Add what your angle sees that the transcript does not have yet, and point at specific files, modules, or symbols. Where the material does not support a conclusion, say so instead of assuming the usual shape. Roughly {{tokensPerTurn}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "orientation-guide",
    systemPrompt:
      "You write the document this codebase should have shipped with. Someone reads it on their first morning and can then make a small change safely. You are concrete about files and symbols, honest about what the analysis could not see, and you never present an inference as a reading.",
    promptTemplate: [
      "The codebase:",
      "",
      "<codebase>",
      "{{input}}",
      "</codebase>",
      "",
      "The full analysis:",
      "",
      "<findings>",
      "{{transcript}}",
      "</findings>",
      "",
      "Write the orientation guide. Open with what this system does and how it is put together, in a page. Then the map of modules and where they sit. Then where state lives and what owns it. Then the hazards — what breaks when you touch what, and how the symptom shows up. Then the first three changes worth making, ordered, with rough sizes. Close with what the analysis could not determine and what you would read next to settle it.",
    ].join("\n"),
    maxTokens: 3500,
    meta: { label: "Orientation guide", tags: ["archaeology", "synthesis"] },
  },
};
