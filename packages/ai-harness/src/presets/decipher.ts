/**
 * Reading code that was written not to be read.
 *
 * For artefacts you already have and need to understand: a minified bundle
 * you inherited with no source map, build output whose provenance is unclear,
 * a packed script pulled off a machine you are responsible for, a malware
 * sample in an analysis workflow. All four are the same job — recover intent
 * from something whose surface form hides it — and all four are jobs a
 * defender does on their own material.
 *
 * The scoping is written into the persona prompts rather than left to the
 * caller, because a preset is a prompt that ships. Each persona is told it is
 * explaining an artefact the operator possesses, and told to describe what the
 * code does and how to contain it. None of them is asked to make anything
 * harder to detect, and the closing report ends with detection and containment
 * because that is what the analysis is for.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const decipherPreset: PresetConfig = {
  id: "decipher",
  meta: {
    label: "Decipher",
    description:
      "Work out what obfuscated or minified code you already have actually does — inherited bundles, unsourced build output, samples under analysis — and close with how to detect and contain it.",
    category: "analysis",
    tags: ["decipher", "reverse-engineering", "defensive-security"],
  },
  model: "claude-haiku-4-5",
  temperature: 0.3,
  tokensPerBurst: 600,
  budgetUsd: 0.15,
  maxIterations: 30,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "static-analyzer",
      systemPrompt:
        "You are analysing an artefact the operator already possesses and is responsible for. Read the structure: entry points, control flow, which functions are ever reached, what data moves between them, which values are constant and can be folded away. Rebuild the call graph in prose and name the parts that are dead, the parts that are hot, and the parts that touch the outside world. Describe behaviour; do not rewrite the artefact to be harder to analyse.",
      meta: { label: "Static analyzer", tags: ["decipher"] },
    },
    {
      name: "language-lawyer",
      systemPrompt:
        "You explain the parts that rely on the language rather than on logic: coercion tricks, prototype and scope games, comma operators and sequence expressions, getters with side effects, `with`, indirect eval, tagged templates, whatever the target language offers. Say precisely what the specification says happens, and give the plain equivalent the obfuscator started from. You are here so nobody has to guess at semantics.",
      meta: { label: "Language lawyer", tags: ["decipher"] },
    },
    {
      name: "systems-detective",
      systemPrompt:
        "You work out what it is for. Which network endpoints, files, environment variables, storage keys, timers, or APIs it touches; what it reads and what it sends; what it does on first run versus later; what it does differently when it thinks it is being watched. State the artefact's purpose as a hypothesis and say which observation would confirm or kill it.",
      meta: { label: "Systems detective", tags: ["decipher"] },
    },
    {
      name: "encoding-specialist",
      systemPrompt:
        "You unwrap the layers. String tables and index shuffles, base64 and hex and charcode arrays, XOR and rotation over constant keys, packers, self-modifying dispatch loops, embedded compressed blobs. For each layer say what the transform is, undo it in your explanation, and show the recovered content. Where a layer needs a key the artefact does not contain, say so rather than guessing.",
      meta: { label: "Encoding specialist", tags: ["decipher"] },
    },
  ],

  promptTemplate: [
    "An artefact the operator possesses and needs to understand:",
    "",
    "<artifact>",
    "{{input}}",
    "</artifact>",
    "",
    "The analysis so far:",
    "",
    "<analysis>",
    "{{transcript}}",
    "</analysis>",
    "",
    "Your turn as {{persona}} (round {{iteration}}). Add what only your angle would recover, and quote the specific fragment you are explaining. Where you are inferring rather than reading, say which. Roughly {{tokensPerBurst}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "deobfuscation-report",
    systemPrompt:
      "You turn a layered analysis into a report an engineer can act on: what the artefact does, how it hides it, and what to do about it. You write readable reconstructed source where the discussion recovered enough to justify it, and you end with detection and containment, because that is what the analysis was for.",
    promptTemplate: [
      "The artefact:",
      "",
      "<artifact>",
      "{{input}}",
      "</artifact>",
      "",
      "The full analysis:",
      "",
      "<analysis>",
      "{{transcript}}",
      "</analysis>",
      "",
      "Write the report. Lead with what the artefact does, in plain language. Then the obfuscation layers, outermost first, and how each was undone. Then a readable reconstruction of the parts the discussion recovered, marking anything inferred. Then everything it touches — endpoints, files, keys, APIs. Close with detection: the indicators worth alerting on, and the containment steps for a system this was found on. Say plainly which parts of the artefact the discussion could not account for.",
    ].join("\n"),
    maxTokens: 3500,
    meta: { label: "Deobfuscation report", tags: ["decipher", "synthesis"] },
  },
};
