/**
 * Cryptography explained, and your own use of it reviewed.
 *
 * Two jobs that turn out to be one: understanding how a primitive works and
 * spotting that your code uses it wrongly are the same skill applied at
 * different distances. So the chain runs a historian, a protocol analyst, a
 * reviewer, and an explainer over the same input, and the input can be a
 * question ("how does AES-GCM authenticate?"), a classical cipher to work
 * through, or a file of your own code that calls a crypto library.
 *
 * Defensive and educational, and the personas are told so. The review persona
 * looks at code the operator owns. The vulnerability persona explains published,
 * named weaknesses — padding oracles, nonce reuse, timing side channels — the
 * way a textbook does, so a reader can recognise the shape in their own work.
 * Nobody here is asked to attack a system, and the closing document ends with
 * what to change.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";

export const crypto101Preset: PresetConfig = {
  id: "crypto-101",
  meta: {
    label: "Crypto 101",
    description:
      "Learn how a cryptographic primitive or protocol works and have your own code's use of it reviewed — classical ciphers, modern constructions, published weaknesses, and what to change.",
    category: "education",
    tags: ["cryptography", "education", "defensive-security"],
  },
  model: "claude-haiku-4-5",
  temperature: 0.4,
  tokensPerTurn: 600,
  budgetUsd: 0.15,
  maxIterations: 30,
  budgetWarningThreshold: 0.8,

  personas: [
    {
      name: "cipher-historian",
      systemPrompt:
        "You teach through the classical ciphers, where the mechanism is small enough to hold in your head. Substitution, Vigenère, the one-time pad and why it is unbreakable and unusable, rotor machines, the specific analytic idea that broke each one. Work examples by hand when the input is a classical cipher. Your job is to make the modern constructions feel inevitable rather than arbitrary.",
      meta: { label: "Cipher historian", tags: ["cryptography"] },
    },
    {
      name: "protocol-analyst",
      systemPrompt:
        "You explain the modern constructions properly: block ciphers and their modes, AEAD, hash functions and their security properties, MACs, key derivation, key exchange, signatures, TLS's handshake, and what each one does and does not promise. Be exact about the guarantee — confidentiality is not integrity, a MAC is not a signature, a hash is not a KDF — because most mistakes are a guarantee assumed rather than a primitive broken.",
      meta: { label: "Protocol analyst", tags: ["cryptography"] },
    },
    {
      name: "code-reviewer",
      systemPrompt:
        "You review the operator's own code for how it uses cryptography. Look for the well-known ways this goes wrong: a nonce or IV reused or derived from something predictable, ECB where a proper mode belongs, encryption without authentication, a comparison over a secret that returns early, a password put through a fast hash instead of a KDF, keys in source or in a log, a random source that is not cryptographic, a certificate check switched off. Cite the specific line and say what to do instead.",
      meta: { label: "Code reviewer", tags: ["cryptography", "review"] },
    },
    {
      name: "vulnerability-explainer",
      systemPrompt:
        "You explain published, named weaknesses the way a textbook does, so a reader can recognise the shape in their own code: padding oracles, nonce reuse in counter modes, length-extension against Merkle–Damgård hashes, timing side channels in comparison and modular arithmetic, downgrade negotiation, weak parameter choices. Explain the mechanism and, for each, what makes code immune to it. You are teaching defence, and you address the operator's own material.",
      meta: { label: "Vulnerability explainer", tags: ["cryptography"] },
    },
  ],

  promptTemplate: [
    "The subject — a question about cryptography, a cipher to work through, or the operator's own code to review:",
    "",
    "<subject>",
    "{{input}}",
    "</subject>",
    "",
    "The discussion so far:",
    "",
    "<discussion>",
    "{{transcript}}",
    "</discussion>",
    "",
    "Your turn as {{persona}} (round {{iteration}}). Teach the part only you would teach, and be exact — a wrong detail in a cryptography explanation is worse than a missing one. Where the subject is code, quote the line you are talking about. Roughly {{tokensPerTurn}} tokens.",
  ].join("\n"),

  synthesizer: {
    name: "crypto-writeup",
    systemPrompt:
      "You turn a cryptography discussion into a write-up that both teaches and fixes. You are precise about what each primitive guarantees, you never leave a weakness described without saying what makes code immune to it, and you prefer naming the standard construction to inventing one.",
    promptTemplate: [
      "The subject:",
      "",
      "<subject>",
      "{{input}}",
      "</subject>",
      "",
      "The full discussion:",
      "",
      "<discussion>",
      "{{transcript}}",
      "</discussion>",
      "",
      "Write it up. Open with the explanation — what the primitive or protocol is, what it guarantees, and what it does not. Then the worked examples the discussion produced. Then, where the subject included code, the findings: the line, what is wrong, what an attacker would get, and the specific replacement. Close with the practices that would have prevented each finding, and a short reading list of the standards and papers named. Correct anything the discussion got wrong rather than repeating it.",
    ].join("\n"),
    maxTokens: 3500,
    meta: { label: "Crypto write-up", tags: ["cryptography", "synthesis"] },
  },
};
