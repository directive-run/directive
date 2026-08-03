/**
 * Every preset that ships has to be a preset.
 *
 * The failure this guards against is a preset library that type-checks and then
 * does not run — a placeholder left in a prompt, an agent name reused between a
 * persona and the synthesizer, a budget too small to reach the first burst.
 * None of those show up in a type, and all of them show up on the first run, so
 * every built-in is run here rather than only validated.
 *
 * `dream` is in the same table despite not being a built-in. It is loaded off
 * disk exactly the way `--preset ./presets/custom/dream.json` loads it, which is
 * the point of shipping it as a file.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockRunner } from "../core/mock-runner.js";
import { loadPreset, validatePreset } from "../core/preset-registry.js";
import type { PresetConfig } from "../core/preset-types.js";
import { createHarnessSystem } from "../core/system.js";
import { BUILTIN_PRESETS, PRESET_LIST } from "../presets/index.js";
import { type Scratch, createScratch } from "./fixtures.js";

/** The file `--preset ./presets/custom/dream.json` resolves to. */
const DREAM_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "presets",
  "custom",
  "dream.json",
);

/**
 * Long enough that spend accrues on every burst, so the presets with large
 * iteration ceilings terminate on their budget rather than grinding through
 * fifty mock calls.
 */
const CANNED = `A considered contribution. ${"It makes a specific point and then supports it. ".repeat(40)}`;

function runnerFor(): ReturnType<typeof createMockRunner> {
  return createMockRunner({ defaultResponse: CANNED, chunkChars: 64 });
}

describe("preset library", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("ships the presets the registry claims, and no `debate`", () => {
    expect(Object.keys(BUILTIN_PRESETS).sort()).toEqual([
      "archaeology",
      "brainstorm",
      "code-review",
      "crypto-101",
      "decipher",
      "moonshot",
      "pre-mortem",
      "research",
    ]);
    // `@directive-run/ai` already ships a debate pattern.
    expect(BUILTIN_PRESETS.debate).toBeUndefined();
  });

  it("leads with the bounded presets and lists the exploratory one last", () => {
    expect(PRESET_LIST[0]?.id).toBe("code-review");
    expect(PRESET_LIST[1]?.id).toBe("pre-mortem");
    expect(PRESET_LIST.at(-1)?.id).toBe("moonshot");
  });

  describe.each(PRESET_LIST.map((preset) => [preset.id, preset] as const))(
    "%s",
    (id, preset) => {
      it("validates against the schema", () => {
        expect(validatePreset(preset)).toEqual({ valid: true, preset });
      });

      it("survives a JSON round trip", () => {
        expect(validatePreset(JSON.parse(JSON.stringify(preset))).valid).toBe(
          true,
        );
      });

      it("carries a label and a description for the registry listing", () => {
        expect(preset.meta?.label).toBeTruthy();
        expect((preset.meta?.description ?? "").length).toBeGreaterThan(20);
      });

      it("gives every voice its own agent name", () => {
        const names = preset.personas.map((persona) => persona.name);

        expect(new Set(names).size).toBe(names.length);
        expect(names).not.toContain(preset.synthesizer.name);
      });

      it("runs to completion with the mock runner", async () => {
        const harness = createHarnessSystem(preset, {
          runner: runnerFor(),
          outputDir: scratch.dir,
          runId: `library-${id}`,
          retry: { maxRetries: 0 },
        });

        const result = await harness.run("the subject under discussion");
        harness.system.destroy();

        expect(result.phase).toBe("complete");
        expect(result.iterations).toBeGreaterThan(0);
        expect(result.synthesis).not.toBe("");
        expect(["budget", "max-iterations"]).toContain(result.stopReason);
      });
    },
  );

  describe("scoping written into the presets themselves", () => {
    it("scopes decipher to artefacts the operator already has", () => {
      const preset = BUILTIN_PRESETS.decipher as PresetConfig;
      const description = preset.meta?.description ?? "";

      expect(preset.meta?.tags).toContain("defensive-security");
      expect(description.toLowerCase()).toContain("already have");
      // The closing document ends with detection and containment, which is
      // what the analysis is for.
      expect(preset.synthesizer.promptTemplate.toLowerCase()).toContain(
        "containment",
      );
    });

    it("scopes crypto-101 as educational and defensive", () => {
      const preset = BUILTIN_PRESETS["crypto-101"] as PresetConfig;

      expect(preset.meta?.tags).toContain("defensive-security");
      expect(preset.meta?.category).toBe("education");
      const reviewer = preset.personas.find(
        (persona) => persona.name === "code-reviewer",
      );
      expect(reviewer?.systemPrompt).toContain("operator's own code");
    });

    it("frames moonshot as candidate directions rather than conclusions", () => {
      const preset = BUILTIN_PRESETS.moonshot as PresetConfig;
      const description = (preset.meta?.description ?? "").toLowerCase();

      expect(description).toContain("candidate");
      expect(description).toContain("not conclusions");
      // A hypothesis with no evaluation path does not make the list.
      expect(preset.synthesizer.systemPrompt).toContain("evaluation path");
      expect(preset.synthesizer.promptTemplate).toContain("falsify");
      // The skeptic is in the room the whole time, not only at the close.
      expect(preset.personas.map((persona) => persona.name)).toContain(
        "skeptical-realist",
      );
    });
  });

  describe("dream, loaded off disk", () => {
    it("loads by path the way the CLI loads it", async () => {
      const preset = await loadPreset(DREAM_PATH);

      expect(preset.id).toBe("dream");
      expect(preset.personas.map((persona) => persona.name)).toEqual([
        "skeptic",
        "engineer",
        "historian",
        "poet",
        "futurist",
      ]);
      // Three *tokens* a turn, not three turns. The fragment is the artifact:
      // each voice gets about a word and a half and has to hand over
      // mid-thought, which is why the iteration ceiling sits far above what
      // the budget will actually pay for. The budget is the real stop.
      expect(preset.tokensPerBurst).toBe(3);
      expect(preset.maxIterations).toBeGreaterThan(preset.personas.length * 4);
      expect(preset.budgetUsd).toBe(0.1);
    });

    it("is not a built-in", () => {
      expect(BUILTIN_PRESETS.dream).toBeUndefined();
    });

    it("runs to completion", async () => {
      const preset = await loadPreset(DREAM_PATH);
      const harness = createHarnessSystem(preset, {
        runner: runnerFor(),
        outputDir: scratch.dir,
        runId: "library-dream",
        retry: { maxRetries: 0 },
      });

      const result = await harness.run("a half-formed idea");
      harness.system.destroy();

      expect(result.phase).toBe("complete");
      expect(result.synthesis).not.toBe("");
    });
  });
});
