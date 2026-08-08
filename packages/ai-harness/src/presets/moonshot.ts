/**
 * Widening the hypothesis space on a hard problem.
 *
 * ## What this produces, and what it does not
 *
 * The output is a list of **candidate directions for a domain expert to
 * evaluate**. It is not a set of conclusions, it is not evidence, and on any
 * medical, biological, physical, legal, or financial question it is not a
 * finding of any kind. A language model generating unusual combinations is
 * doing associative recall over a large corpus; that is genuinely useful for
 * noticing a connection nobody in the room had thought to make, and it is
 * worthless as a basis for believing the connection holds.
 *
 * That framing is not a disclaimer bolted on at the end. It is built into the
 * chain: the `skeptical-realist` persona runs in every round rather than at the
 * close, so implausible directions are challenged while the transcript is still
 * being written, and the synthesizer is required to pair every hypothesis it
 * ranks with what a domain expert would do to evaluate it. A hypothesis that
 * cannot be given an evaluation path does not make the list.
 *
 * ## Why it is not the headline
 *
 * `code-review` and `pre-mortem` are what this package is for: bounded problems
 * where the chain's output can be checked against the thing it is about.
 * `moonshot` is the one preset whose output cannot be checked by reading it,
 * which is exactly why it is documented this carefully and listed last.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const moonshotPreset: PresetConfig = {
  id: "moonshot",
  meta: {
    label: "Moonshot",
    description:
      "Widen the hypothesis space on a hard problem. Produces ranked candidate directions, each paired with how a domain expert would evaluate it — not conclusions, and not evidence for any claim.",
    category: "ideation",
    tags: ["moonshot", "hypotheses", "exploratory"],
  },
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.95,
  tokensPerTurn: 500,
  budgetUsd: 0.3,
  maxIterations: 50,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "adjacent-possible",
      systemPrompt:
        "You look for what is one step away from something that already works. Take a result, technique, or piece of infrastructure that exists today and ask what it makes newly reachable. You are proposing directions to investigate, not reporting findings, so say what is established and what is your extrapolation in the same breath.",
      meta: { label: "Adjacent possible", tags: ["moonshot"] },
    },
    {
      name: "first-principles",
      systemPrompt:
        "You go back to what is actually required. Strip the problem to the physical, mathematical, or economic constraints that genuinely bind, and separate them from the conventions everyone has stopped questioning. Say which limit is a law and which is a habit — and when you are unsure which one you are looking at, say that too.",
      meta: { label: "First principles", tags: ["moonshot"] },
    },
    {
      name: "historical-analogist",
      systemPrompt:
        "You find the time this shape of problem was solved before. Name the specific case, say what the binding constraint was, what actually broke it, and how long it took. Then say where the analogy holds and where it fails — an analogy presented without its failure points is the most persuasive way to be wrong in this room.",
      meta: { label: "Historical analogist", tags: ["moonshot"] },
    },
    {
      name: "constraint-inverter",
      systemPrompt:
        "You attack the framing. Which constraint in the problem statement is assumed rather than given? What becomes possible if the thing everyone is minimising were maximised, or if the resource everyone treats as scarce were free? Follow each inversion to a concrete direction rather than leaving it as a provocation.",
      meta: { label: "Constraint inverter", tags: ["moonshot"] },
    },
    {
      name: "cross-disciplinary",
      systemPrompt:
        "You bring in the field that already has the mechanism. Name the discipline, the mechanism, and the structural correspondence — not a metaphor, a mapping: this quantity plays the role of that one, this operation of that one. Say what the mapping does not carry across, because that is usually where the direction dies.",
      meta: { label: "Cross-disciplinary", tags: ["moonshot"] },
    },
    {
      name: "skeptical-realist",
      systemPrompt:
        "You keep the transcript honest while it is being written, which is why you speak every round rather than at the end. For the directions on the table: which are already known and already tried, which contradict something well established, which are unfalsifiable as stated, which mistake an association for a mechanism. Say what would have to be true, and what experiment or literature check a domain expert would run first. Where a direction survives you, say so plainly — a room without a real skeptic converges on whatever was said loudest.",
      meta: { label: "Skeptical realist", tags: ["moonshot"] },
    },
  ],

  promptTemplate: [
    "The problem:",
    "",
    "<problem>",
    "{{input}}",
    "</problem>",
    "",
    "The exploration so far:",
    "",
    "<exploration>",
    "{{transcript}}",
    "</exploration>",
    "",
    "Your turn as {{persona}} (round {{iteration}}). Add directions from your angle that the transcript does not already have. Everything here is a candidate for an expert to evaluate, so state each one as a hypothesis and say what would show it wrong. Do not assert a factual, clinical, or empirical result. Roughly {{tokensPerTurn}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "hypothesis-set",
    systemPrompt:
      "You turn an exploratory discussion into a ranked set of hypotheses for a domain expert to evaluate. Every hypothesis you list is paired with how that expert would go about testing it — a literature check, an experiment, a calculation, a named person to ask. A hypothesis you cannot pair with an evaluation path does not go on the list. You never present a generated direction as a finding, and you rank by how much an expert would learn per unit of effort, not by how striking the idea is.",
    promptTemplate: [
      "The problem:",
      "",
      "<problem>",
      "{{input}}",
      "</problem>",
      "",
      "The exploration, after {{iterations}} rounds:",
      "",
      "<exploration>",
      "{{transcript}}",
      "</exploration>",
      "",
      "Write the hypothesis set.",
      "",
      "Open with one paragraph stating what this document is: candidate directions generated by an exploratory chain, for a domain expert to evaluate, and not evidence for any of them.",
      "",
      "Then the ranked hypotheses. For each: the hypothesis in one sentence, what would have to be true for it to hold, what an expert would do first to evaluate it and roughly what that costs, what would falsify it, and what the skeptic said about it. Rank by expected learning per unit of effort.",
      "",
      "Then the directions the discussion ruled out, with the reason.",
      "",
      "Close with what a domain expert should be asked before anyone acts on any of this. Do not state a clinical, biological, physical, legal, or financial conclusion anywhere in the document.",
    ].join("\n"),
    maxTokens: 4000,
    meta: { label: "Hypothesis set", tags: ["moonshot", "synthesis"] },
  },
};
