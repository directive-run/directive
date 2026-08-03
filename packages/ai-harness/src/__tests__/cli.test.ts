/**
 * The command line refuses early or not at all.
 *
 * Every case below is something the CLI can know is wrong before a provider is
 * called. The cost of getting this wrong is not a confusing message — it is a
 * run that spends four turns of real money and then fails on a typo, with a
 * transcript on disk nobody asked for.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CliArgs,
  CliError,
  CliHelp,
  parseArgs,
  renderPresetList,
  requireCredentials,
  resolveInput,
  resolvePresets,
  runCli,
} from "../adapters/cli/index.js";
import { createRenderer } from "../adapters/cli/render.js";
import { PRESET_LIST } from "../presets/index.js";
import { type Scratch, createScratch, testPreset } from "./fixtures.js";

const DREAM_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "presets",
  "custom",
  "dream.json",
);

function args(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    presets: ["code-review"],
    listPresets: false,
    dryRun: false,
    outDir: "./runs",
    verbose: false,
    ...overrides,
  };
}

describe("cli argument parsing", () => {
  it("accepts the ordinary invocation", () => {
    const parsed = parseArgs(["--preset", "code-review", "--input", "a diff"]);

    expect(parsed.presets).toEqual(["code-review"]);
    expect(parsed.input).toBe("a diff");
    expect(parsed.outDir).toBe("./runs");
    expect(parsed.dryRun).toBe(false);
  });

  it("lets --compose override --preset, in order", () => {
    const parsed = parseArgs([
      "--preset",
      "code-review",
      "--compose",
      "research, pre-mortem ,moonshot",
      "--input",
      "x",
    ]);

    expect(parsed.presets).toEqual(["research", "pre-mortem", "moonshot"]);
  });

  it.each([
    ["--tokens", "0"],
    ["--tokens", "-4"],
    ["--tokens", "2.5"],
    ["--tokens", "many"],
    ["--budget", "0"],
    ["--budget", "-1"],
    ["--budget", "free"],
    ["--temperature", "2"],
    ["--temperature", "-0.1"],
  ])("refuses %s %s at parse time", (flag, value) => {
    expect(() =>
      parseArgs([
        "--preset",
        "code-review",
        "--input",
        "x",
        `${flag}=${value}`,
      ]),
    ).toThrow(CliError);
  });

  it("refuses an invocation with nothing to run", () => {
    expect(() => parseArgs(["--input", "x"])).toThrow(/--list-presets/);
  });

  it("refuses an empty --compose", () => {
    expect(() => parseArgs(["--compose", " , ,", "--input", "x"])).toThrow(
      CliError,
    );
  });

  it("refuses two sources of input", () => {
    expect(() =>
      parseArgs([
        "--preset",
        "code-review",
        "--input",
        "x",
        "--input-file",
        "y",
      ]),
    ).toThrow(/pick one/);
  });

  it("refuses an unknown flag", () => {
    expect(() => parseArgs(["--preset", "code-review", "--nope"])).toThrow(
      CliError,
    );
  });

  it("allows --list-presets on its own", () => {
    const parsed = parseArgs(["--list-presets"]);

    expect(parsed.listPresets).toBe(true);
    expect(parsed.presets).toEqual([]);
  });

  it("treats --help as output rather than failure", () => {
    try {
      parseArgs(["--help"]);
      expect.unreachable("--help should have thrown CliHelp");
    } catch (error) {
      expect(error).toBeInstanceOf(CliHelp);
      expect((error as CliHelp).text).toContain("--list-presets");
    }
  });
});

describe("cli preset resolution", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("resolves built-in ids", async () => {
    const resolved = await resolvePresets(args({ presets: ["code-review"] }));

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe("code-review");
  });

  it("resolves the shipped JSON preset by path", async () => {
    const resolved = await resolvePresets(args({ presets: [DREAM_PATH] }));

    expect(resolved[0]?.id).toBe("dream");
    expect(resolved[0]?.personas).toHaveLength(5);
  });

  it("points an unknown name at --list-presets", async () => {
    await expect(
      resolvePresets(args({ presets: ["code-reviw"] })),
    ).rejects.toThrow(/--list-presets/);
  });

  it("says which file it could not read", async () => {
    const missing = join(scratch.dir, "nope.json");

    await expect(resolvePresets(args({ presets: [missing] }))).rejects.toThrow(
      /could not load the preset file/,
    );
  });

  it("reports why a JSON preset on disk is not valid", async () => {
    const path = join(scratch.dir, "broken.json");
    await writeFile(path, JSON.stringify(testPreset({ personas: [] })), "utf8");

    await expect(resolvePresets(args({ presets: [path] }))).rejects.toThrow(
      /personas/,
    );
  });

  it("applies overrides to every preset in the run", async () => {
    const resolved = await resolvePresets(
      args({
        presets: ["code-review", "pre-mortem"],
        tokensPerTurn: 120,
        budgetUsd: 0.05,
        model: "claude-haiku-4-5",
        temperature: 0.1,
      }),
    );

    for (const preset of resolved) {
      expect(preset.tokensPerTurn).toBe(120);
      expect(preset.budgetUsd).toBe(0.05);
      expect(preset.model).toBe("claude-haiku-4-5");
      expect(preset.temperature).toBe(0.1);
    }
  });

  it("routes overrides through the same schema a file goes through", async () => {
    // `--model ""` cannot come through commander's parser, but it can come
    // through a caller of the exported function, and there is one definition of
    // a valid preset either way.
    await expect(
      resolvePresets(args({ presets: ["code-review"], model: "" })),
    ).rejects.toThrow(/model/);
  });
});

describe("cli credentials and input", () => {
  let scratch: Scratch;

  beforeEach(async () => {
    scratch = await createScratch();
  });

  afterEach(async () => {
    await scratch.cleanup();
  });

  it("says one sentence when the key is missing", () => {
    expect(() => requireCredentials(args(), {})).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
    expect(() =>
      requireCredentials(args(), { ANTHROPIC_API_KEY: "  " }),
    ).toThrow(CliError);
  });

  it("does not need a key for a dry run", () => {
    expect(() => requireCredentials(args({ dryRun: true }), {})).not.toThrow();
  });

  it("reads --input-file, and says so when it cannot", async () => {
    const path = join(scratch.dir, "input.txt");
    await writeFile(path, "the contents", "utf8");

    expect(await resolveInput(args({ inputFile: path }))).toBe("the contents");

    await expect(
      resolveInput(args({ inputFile: join(scratch.dir, "absent.txt") })),
    ).rejects.toThrow(/could not read --input-file/);
  });
});

describe("--list-presets", () => {
  it("renders every preset from its own meta", () => {
    const rendered = renderPresetList();

    for (const preset of PRESET_LIST) {
      expect(rendered).toContain(preset.id);
      expect(rendered).toContain(preset.meta?.label ?? preset.id);
      // The description is wrapped, so check its opening rather than the whole
      // string.
      const opening = (preset.meta?.description ?? "")
        .split(" ")
        .slice(0, 4)
        .join(" ");
      expect(rendered).toContain(opening);
    }

    expect(rendered).toContain("./presets/custom/dream.json");
  });

  /**
   * The listing used to print `$2.00` and nothing else, which reads as a price
   * and is a ceiling — and on a preset whose turn count runs out first, a
   * ceiling the run never approaches.
   */
  it("names the limit that actually stops each preset, and calls the figure a cap", () => {
    const rendered = renderPresetList();

    for (const preset of PRESET_LIST) {
      expect(rendered).toContain(`${preset.tokensPerTurn} tokens a turn`);
    }

    // Both limits are represented across the library, and each is named.
    expect(rendered).toContain("stops on: the budget, after about");
    expect(rendered).toContain("stops on: the turn ceiling, at");
    expect(rendered).toContain("expect about");
    expect(rendered).toContain("cap");
    expect(rendered).toContain("The dollar figure is a ceiling, not a price");
  });

  /**
   * The shipped JSON preset is an outlier on purpose, and it is also the only
   * JSON example and the file this listing points at for "write your own".
   */
  it("says the shipped example is unusual, and where a conventional one lives", () => {
    const rendered = renderPresetList();

    expect(rendered).toContain("deliberately unusual");
    expect(rendered).toContain("three tokens a turn");
    expect(rendered).toContain("Writing a preset");
  });
});

describe("a run that could not afford a turn", () => {
  /**
   * The quiet outcome. A budget clears the closing document's price — which is
   * all construction checks — and not a first turn alongside the reserve that
   * turn would leave owing. The run is correct and it is also an empty screen,
   * so the renderer says which of the two happened.
   */
  it("says why, rather than printing an empty run", () => {
    const chunks: string[] = [];
    const renderer = createRenderer({
      verbose: false,
      write: (text) => chunks.push(text),
    });

    renderer({
      type: "chain:complete",
      runId: "r",
      phase: "complete",
      stopReason: "budget",
      iterations: 0,
      spentUsd: 0,
      budgetUsd: 0.04,
      synthesis: "",
      synthesisSkipped: false,
      transcriptPath: "memory://r.md",
      jsonlPath: "memory://r.jsonl",
      at: 1,
    });

    const printed = chunks.join("");
    expect(printed).toContain("no turns");
    expect(printed).toContain("$0.0400");
    expect(printed).toContain("Raise the budget");
  });

  it("says nothing extra when turns did run", () => {
    const chunks: string[] = [];
    const renderer = createRenderer({
      verbose: false,
      write: (text) => chunks.push(text),
    });

    renderer({
      type: "chain:complete",
      runId: "r",
      phase: "complete",
      stopReason: "budget",
      iterations: 3,
      spentUsd: 0.02,
      budgetUsd: 0.04,
      synthesis: "done",
      synthesisSkipped: false,
      transcriptPath: "memory://r.md",
      jsonlPath: "memory://r.jsonl",
      at: 1,
    });

    expect(chunks.join("")).not.toContain("no turns");
  });
});

describe("runCli", () => {
  let scratch: Scratch;
  let stdout: string[];
  let stderr: string[];

  beforeEach(async () => {
    scratch = await createScratch();
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));

      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));

      return true;
    });
    // Unset rather than blanked — a developer with a real key in their
    // environment must get the same result CI does.
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await scratch.cleanup();
  });

  it("prints the registry and exits clean", async () => {
    expect(await runCli(["--list-presets"])).toBe(0);
    expect(stdout.join("")).toContain("code-review");
    expect(stderr).toEqual([]);
  });

  it("refuses a live run with no key, in a sentence", async () => {
    expect(await runCli(["--preset", "code-review", "--input", "x"])).toBe(1);
    expect(stderr.join("")).toContain("ANTHROPIC_API_KEY is not set");
    expect(stderr.join("")).not.toContain("at ");
  });

  it("completes a dry-run chain of two presets with no key present", async () => {
    const code = await runCli([
      "--compose",
      "code-review,pre-mortem",
      "--input",
      "a change worth reviewing",
      "--dry-run",
      "--out-dir",
      scratch.dir,
    ]);

    expect(code).toBe(0);
    const printed = stdout.join("");
    expect(printed).toContain("[1/2] code-review");
    expect(printed).toContain("[2/2] pre-mortem");
    expect(printed).toContain("dry run");
    expect(stderr).toEqual([]);
  }, 30_000);

  it("prints the event stream structurally under --verbose", async () => {
    const code = await runCli([
      "--preset",
      "pre-mortem",
      "--input",
      "a proposal",
      "--dry-run",
      "--verbose",
      "--out-dir",
      scratch.dir,
    ]);

    expect(code).toBe(0);
    const printed = stdout.join("");
    expect(printed).toContain("chain:started");
    expect(printed).toContain("turn:completed");
    expect(printed).toContain("chain:complete");
    // Token-level events would be one line per two dozen characters.
    expect(printed).not.toContain("turn:delta");
  }, 30_000);

  it("reports a bad flag as a sentence rather than a stack", async () => {
    expect(
      await runCli(["--preset", "code-review", "--input", "x", "--tokens=0"]),
    ).toBe(1);
    expect(stderr.join("")).toContain("--tokens");
  });
});
