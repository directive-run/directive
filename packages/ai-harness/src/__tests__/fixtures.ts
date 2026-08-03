/**
 * Shared test scaffolding: a small preset and a scratch output directory.
 *
 * The preset names a real Anthropic model, so every test prices its calls
 * through `ANTHROPIC_PRICING` with no rate table of its own and no conversion
 * step. If the published entry ever stopped being the shape `withBudget` reads,
 * these tests are where it would show.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PresetConfig } from "../core/preset-types.js";

/** The model every fixture prices against. Must exist in `ANTHROPIC_PRICING`. */
export const TEST_MODEL = "claude-sonnet-4-5-20250929";

/** Distinct, long-ish canned turns, so cost accrues and text is countable. */
export function cannedTurn(persona: string, turn: number): string {
  return `[${persona}#${turn}] ${"considered point ".repeat(60)}end-of-${persona}-${turn}`;
}

export function testPreset(
  overrides: Partial<PresetConfig> = {},
): PresetConfig {
  return {
    id: "test-chain",
    meta: { label: "Test chain", tags: ["test"] },
    model: TEST_MODEL,
    personas: [
      {
        name: "alpha",
        systemPrompt: "You are alpha.",
        meta: { label: "Alpha" },
      },
      { name: "beta", systemPrompt: "You are beta." },
      { name: "gamma", systemPrompt: "You are gamma." },
    ],
    tokensPerTurn: 300,
    budgetUsd: 1,
    maxIterations: 6,
    promptTemplate:
      "Input: {{input}}\nSo far:\n{{transcript}}\nYour turn, {{persona}} (round {{iteration}}).",
    synthesizer: {
      name: "synth",
      systemPrompt: "You synthesize.",
      promptTemplate: "Transcript after {{iterations}} rounds:\n{{transcript}}",
      maxTokens: 1000,
    },
    ...overrides,
  };
}

/** Canned responses for every agent in {@link testPreset}. */
export function cannedResponses(): Record<string, string[]> {
  const turns = [1, 2, 3, 4, 5, 6];

  return {
    alpha: turns.map((turn) => cannedTurn("alpha", turn)),
    beta: turns.map((turn) => cannedTurn("beta", turn)),
    gamma: turns.map((turn) => cannedTurn("gamma", turn)),
    synth: ["SYNTHESIS: the reviewers converged on three things."],
  };
}

export interface Scratch {
  dir: string;
  cleanup(): Promise<void>;
}

export async function createScratch(): Promise<Scratch> {
  const dir = await mkdtemp(join(tmpdir(), "ai-harness-"));

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
