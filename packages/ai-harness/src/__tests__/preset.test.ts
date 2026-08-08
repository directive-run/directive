import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listPresets,
  loadPreset,
  validatePreset,
} from "../core/preset-registry.js";
import { renderTemplate } from "../core/preset-types.js";
import { codeReviewPreset } from "../presets/code-review.js";
import { type Scratch, createScratch, testPreset } from "./fixtures.js";

describe("presets", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("validates the shipped code-review preset", () => {
    const result = validatePreset(codeReviewPreset);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.preset.personas).toHaveLength(4);
      expect(result.preset.synthesizer.name).toBe("report");
    }
  });

  it("survives a JSON round trip, which is the whole point of the shape", () => {
    const roundTripped = JSON.parse(JSON.stringify(codeReviewPreset));

    expect(validatePreset(roundTripped)).toEqual({
      valid: true,
      preset: codeReviewPreset,
    });
  });

  it("carries DefinitionMeta rather than a parallel description vocabulary", () => {
    // The meta a preset carries is handed straight to Directive's definitions,
    // so it has to be Directive's shape.
    expect(codeReviewPreset.meta?.label).toBe("Code review");
    expect(codeReviewPreset.personas[0]?.meta?.tags).toContain("correctness");
  });

  it("reports every problem at once rather than the first", () => {
    const result = validatePreset({
      id: "",
      model: "m",
      personas: [],
      tokensPerTurn: 0,
      budgetUsd: -1,
      maxIterations: 3,
      promptTemplate: "x",
      synthesizer: {
        name: "s",
        systemPrompt: "s",
        promptTemplate: "s",
        maxTokens: 10,
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(3);
      expect(result.errors.join("\n")).toContain("personas");
      expect(result.errors.join("\n")).toContain("budgetUsd");
    }
  });

  it("rejects an empty persona list, which would divide by zero on turn order", () => {
    expect(validatePreset(testPreset({ personas: [] })).valid).toBe(false);
  });

  it("lists the built-ins", () => {
    expect(listPresets()).toEqual([
      "archaeology",
      "brainstorm",
      "code-review",
      "crypto-101",
      "decipher",
      "moonshot",
      "pre-mortem",
      "research",
    ]);
  });

  it("refuses two voices sharing one agent name", () => {
    // The name is the orchestrator's agent ID: a duplicate silently discards a
    // system prompt, and a persona sharing the synthesizer's name silently
    // takes the closing document's token cap.
    const duplicated = validatePreset(
      testPreset({
        personas: [
          { name: "alpha", systemPrompt: "one" },
          { name: "alpha", systemPrompt: "two" },
        ],
      }),
    );
    expect(duplicated.valid).toBe(false);

    const shadowsSynthesizer = validatePreset(
      testPreset({
        personas: [{ name: "synth", systemPrompt: "one" }],
      }),
    );
    expect(shadowsSynthesizer.valid).toBe(false);
    if (!shadowsSynthesizer.valid) {
      expect(shadowsSynthesizer.errors.join("\n")).toContain("synthesizer");
    }
  });

  it("loads by name, by JSON string, and by path", async () => {
    const byName = await loadPreset("code-review");
    expect(byName.id).toBe("code-review");

    const byJson = await loadPreset(JSON.stringify(testPreset()));
    expect(byJson.id).toBe("test-chain");

    const path = join(scratch.dir, "mine.json");
    await writeFile(path, JSON.stringify(testPreset({ id: "from-disk" })));
    const byPath = await loadPreset(path);
    expect(byPath.id).toBe("from-disk");
  });

  it("names the built-ins when nothing resolves", async () => {
    await expect(loadPreset("no-such-preset")).rejects.toThrow(/code-review/);
  });

  it("renders known placeholders and leaves unknown ones alone", () => {
    expect(
      renderTemplate("{{persona}} on {{iteration}} — {{unknown}}", {
        persona: "alpha",
        iteration: 2,
      }),
    ).toBe("alpha on 2 — {{unknown}}");
  });
});
