/**
 * The command line.
 *
 * A renderer over the event stream and an argument parser in front of the SDK.
 * It calls `createHarness` and `runComposition` and reads `HarnessEvent`s, which is
 * everything a consumer of this package can do — there is no private channel
 * here, and the CLI cannot report anything a caller of the SDK could not.
 *
 * ## Refusing early
 *
 * Every check that can be made before a provider call is made before one:
 * `--tokens 0`, a negative budget, a preset name that resolves to nothing, an
 * unreadable `--input-file`, a missing API key. A run that gets four turns in
 * and then fails on a typo has already spent money answering a question the
 * operator did not ask.
 *
 * ## The two interrupts
 *
 * The first `SIGINT` flips the chain's interrupt fact. The turn in flight
 * finishes, the chain synthesizes what it has, and the transcript is whole —
 * the core is deliberately built so that stopping early still produces a
 * closing document, and tearing up the request in flight would throw that away.
 * The second exits immediately, because an operator pressing it twice has
 * stopped asking politely.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { intro, isCancel, log, outro, text } from "@clack/prompts";
import type { TokenPricing } from "@directive-run/ai";
import { Command, type CommanderError, InvalidArgumentError } from "commander";
import pc from "picocolors";
import { resolvePresetPricing } from "../../core/agents.js";
import { runComposition } from "../../core/composition.js";
import { type RunEstimate, estimateRun } from "../../core/estimate.js";
import { createMockRunner } from "../../core/mock-runner.js";
import { assertPreset, loadPreset } from "../../core/preset-registry.js";
import type { PresetConfig } from "../../core/preset-types.js";
import type { HarnessOptions } from "../../core/system.js";
import { PRESET_LIST } from "../../presets/index.js";
import { createFileTranscriptStore } from "../node/transcript.js";
import { createHarness } from "../sdk/index.js";
import { createRenderer, dollars, plural } from "./render.js";

// ============================================================================
// Errors
// ============================================================================

/** Something the operator can fix. Printed as a sentence, never as a stack. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** `--help`, which commander renders and which is not a failure. */
export class CliHelp extends Error {
  constructor(readonly text: string) {
    super("help requested");
    this.name = "CliHelp";
  }
}

// ============================================================================
// Argument parsing
// ============================================================================

export interface CliArgs {
  /** Preset ids or paths, in run order. Empty only with `--list-presets`. */
  presets: string[];
  input?: string;
  inputFile?: string;
  listPresets: boolean;
  /** Overrides `tokensPerTurn` on every preset in the run. */
  tokensPerTurn?: number;
  /** Overrides `budgetUsd` on every preset in the run. Per step, not per run. */
  budgetUsd?: number;
  /**
   * Ceiling across every step of a `--compose`.
   *
   * Distinct from `--budget`, which is per step and always was: `--compose a,b,c
   * --budget 5` is $15 of exposure. Defaults to the sum of the steps' budgets.
   */
  totalBudgetUsd?: number;
  model?: string;
  temperature?: number;
  dryRun: boolean;
  outDir: string;
  verbose: boolean;
}

function positiveInteger(flag: string) {
  return (raw: string): number => {
    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidArgumentError(
        `${flag} takes a whole number above zero — got "${raw}".`,
      );
    }

    return value;
  };
}

function positiveNumber(flag: string) {
  return (raw: string): number => {
    const value = Number(raw);

    if (!Number.isFinite(value) || value <= 0) {
      throw new InvalidArgumentError(
        `${flag} takes an amount above zero — got "${raw}".`,
      );
    }

    return value;
  };
}

function unitInterval(flag: string) {
  return (raw: string): number => {
    const value = Number(raw);

    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new InvalidArgumentError(
        `${flag} takes a number between 0 and 1 — got "${raw}".`,
      );
    }

    return value;
  };
}

function buildProgram(sink: string[]): Command {
  const program = new Command();

  program
    .name("harness")
    .description(
      "Run a persona chain over one input, then write the transcript and the closing document.",
    )
    .option(
      "--preset <name|path>",
      "built-in id or a path to a preset JSON file",
    )
    .option("--compose <a,b,c>", "run presets in order; overrides --preset")
    .option("--input <text>", "the question / diff / codebase summary")
    .option("--input-file <path>", "read input from a file (large inputs)")
    .option("--list-presets", "print the registry and exit", false)
    .option(
      "--tokens <n>",
      "override the preset's tokens per turn",
      positiveInteger("--tokens"),
    )
    .option(
      "--budget <usd>",
      "override each preset's budget (per step, not per run)",
      positiveNumber("--budget"),
    )
    .option(
      "--total-budget <usd>",
      "ceiling across every step of a --compose (default: the steps' budgets, summed)",
      positiveNumber("--total-budget"),
    )
    .option("--model <id>", "override the model")
    .option(
      "--temperature <n>",
      "sampling temperature, 0 to 1",
      unitInterval("--temperature"),
    )
    .option(
      "--dry-run",
      "no API calls; canned responses and fictional costs",
      false,
    )
    .option(
      "--out-dir <path>",
      "directory the artefacts are written to",
      "./runs",
    )
    .option("--verbose", "print the event stream structurally", false)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (chunk) => sink.push(chunk),
      writeErr: (chunk) => sink.push(chunk),
    });

  return program;
}

/** Commander prefixes its own messages; the CLI adds its own prefix already. */
function withoutErrorPrefix(message: string): string {
  return message.replace(/^error:\s*/i, "");
}

/**
 * Parse and validate, without touching the disk or the network.
 *
 * Throws {@link CliError} for anything the operator can fix and {@link CliHelp}
 * for `--help`, so `runCli` can tell "print this and succeed" from "print this
 * and fail" without inspecting an exit code.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const output: string[] = [];
  const program = buildProgram(output);

  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    const commanderError = error as CommanderError;

    if (commanderError.exitCode === 0) {
      throw new CliHelp(output.join(""));
    }

    throw new CliError(withoutErrorPrefix(commanderError.message));
  }

  const options = program.opts();
  const listPresets = options.listPresets === true;
  const presets = readPresetTokens(options.compose, options.preset);

  if (!listPresets && presets.length === 0) {
    throw new CliError(
      "nothing to run — pass --preset <name|path> or --compose <a,b,c>. Run `harness --list-presets` to see what ships.",
    );
  }
  if (options.input !== undefined && options.inputFile !== undefined) {
    throw new CliError(
      "--input and --input-file were both given — pick one, since only one of them can be the input.",
    );
  }

  return {
    presets,
    input: options.input,
    inputFile: options.inputFile,
    listPresets,
    tokensPerTurn: options.tokens,
    budgetUsd: options.budget,
    totalBudgetUsd: options.totalBudget,
    model: options.model,
    temperature: options.temperature,
    dryRun: options.dryRun === true,
    outDir: options.outDir,
    verbose: options.verbose === true,
  };
}

function readPresetTokens(
  compose: string | undefined,
  preset: string | undefined,
): string[] {
  if (compose !== undefined) {
    const tokens = compose
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");

    if (tokens.length === 0) {
      throw new CliError(
        "--compose needs at least one preset — for example --compose code-review,pre-mortem.",
      );
    }

    return tokens;
  }

  if (preset !== undefined) {
    const trimmed = preset.trim();

    if (trimmed === "") {
      throw new CliError(
        "--preset needs a built-in id or a path to a preset JSON file.",
      );
    }

    return [trimmed];
  }

  return [];
}

// ============================================================================
// Resolution
// ============================================================================

/** A token with a separator or a `.json` tail was meant as a file, not a name. */
function looksLikePath(token: string): boolean {
  return token.includes("/") || token.includes("\\") || token.endsWith(".json");
}

function withoutPackagePrefix(message: string): string {
  return message.replace(/^\[ai-harness\]\s*/, "");
}

/**
 * Load every preset named on the command line, with the overrides applied.
 *
 * Overrides go on before validation, so `--tokens 0` and `--budget -1` are
 * refused by the same schema that refuses them in a file. There is one
 * definition of a valid preset and the command line does not get its own.
 */
export async function resolvePresets(args: CliArgs): Promise<PresetConfig[]> {
  const resolved: PresetConfig[] = [];

  for (const token of args.presets) {
    let loaded: PresetConfig;

    try {
      loaded = await loadPreset(token);
    } catch (error) {
      throw new CliError(describeLoadFailure(token, error as Error));
    }

    resolved.push(applyOverrides(loaded, args));
  }

  return resolved;
}

function describeLoadFailure(token: string, error: Error): string {
  if (looksLikePath(token)) {
    return `could not load the preset file "${token}" — ${withoutPackagePrefix(error.message)}`;
  }

  return `unknown preset "${token}". Run \`harness --list-presets\` to see what ships, or pass a path to a preset JSON file.`;
}

function applyOverrides(preset: PresetConfig, args: CliArgs): PresetConfig {
  const overridden: PresetConfig = {
    ...preset,
    ...(args.tokensPerTurn === undefined
      ? {}
      : { tokensPerTurn: args.tokensPerTurn }),
    ...(args.budgetUsd === undefined ? {} : { budgetUsd: args.budgetUsd }),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.temperature === undefined
      ? {}
      : { temperature: args.temperature }),
  };

  try {
    return assertPreset(overridden, `preset "${preset.id}" after overrides`);
  } catch (error) {
    throw new CliError(withoutPackagePrefix((error as Error).message));
  }
}

/**
 * Refuse a live run with no credentials, in a sentence.
 *
 * The alternative is the Anthropic adapter's own 401 four layers down, which
 * arrives as a stack trace after the transcript file has already been created.
 */
export function requireCredentials(
  args: CliArgs,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (args.dryRun) {
    return;
  }

  const key = env.ANTHROPIC_API_KEY;
  if (typeof key === "string" && key.trim() !== "") {
    return;
  }

  throw new CliError(
    "ANTHROPIC_API_KEY is not set. Export it, or pass --dry-run to exercise the chain offline with canned responses.",
  );
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];

  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }

  return chunks.join("");
}

/**
 * The input, from wherever it is.
 *
 * `--input`, then `--input-file`, then a prompt on a terminal, then whatever
 * was piped in. The prompt is last among the interactive options and first
 * among none of them: a script with no TTY and no flags gets an error, not a
 * hung process waiting on a keystroke nobody is there to press.
 */
export async function resolveInput(args: CliArgs): Promise<string> {
  if (args.input !== undefined) {
    return args.input;
  }

  if (args.inputFile !== undefined) {
    try {
      return await readFile(args.inputFile, "utf8");
    } catch (error) {
      throw new CliError(
        `could not read --input-file "${args.inputFile}" — ${(error as Error).message}`,
      );
    }
  }

  if (process.stdin.isTTY) {
    const answer = await text({
      message: "What is the input?",
      placeholder: "a diff, a question, a codebase summary",
      validate: (value) =>
        value.trim() === ""
          ? "Say something for the chain to work on."
          : undefined,
    });

    if (isCancel(answer)) {
      throw new CliError("cancelled.");
    }

    return answer;
  }

  const piped = await readStdin();
  if (piped.trim() === "") {
    throw new CliError(
      "no input — pass --input <text>, --input-file <path>, or pipe it in on stdin.",
    );
  }

  return piped;
}

// ============================================================================
// The registry, printed
// ============================================================================

const LIST_WIDTH = 74;

function wrap(body: string, indent: string): string[] {
  const words = body.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (`${current} ${word}`.length > LIST_WIDTH) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current !== "") {
    lines.push(current);
  }

  return lines.map((line) => `${indent}${line}`);
}

/**
 * What stops a preset, and what it is expected to cost getting there.
 *
 * The line this replaces printed `$2.00` and nothing else, which reads as a
 * price and is a ceiling — and on the presets whose turn count runs out first,
 * a ceiling the run never approaches. So the ceiling is labelled as one, the
 * expected spend sits beside it, and the limit that actually ends the run is
 * named. `estimateRun` replays the chain's own stopping rules rather than
 * guessing; see `../../core/estimate.js` for what it assumes.
 */
function renderPresetLimits(preset: PresetConfig): string {
  let estimate: RunEstimate;
  try {
    estimate = estimateRun(preset, resolvePresetPricing(preset));
  } catch {
    // A model with no published rate. The ceilings are still worth printing;
    // the estimate is not available and is not invented.
    return `    stops on: whichever comes first — ${preset.maxIterations} turns, or the ${dollars(preset.budgetUsd)} cap`;
  }

  const reason =
    estimate.limit === "iterations"
      ? `the turn ceiling, at ${plural(estimate.turns, "turn")}`
      : `the budget, after about ${plural(estimate.turns, "turn")}`;
  const cap =
    estimate.limit === "iterations"
      ? `, well under the ${dollars(preset.budgetUsd)} cap`
      : ` of the ${dollars(preset.budgetUsd)} cap`;

  return `    stops on: ${reason} — expect about ${dollars(estimate.expectedUsd)}${cap}`;
}

/**
 * `--list-presets`, rendered from each preset's own `meta`.
 *
 * Nothing here is a second description of a preset kept alongside the preset.
 * A built-in whose `meta.description` is wrong prints wrongly, which is the
 * behaviour that gets it fixed.
 */
export function renderPresetList(): string {
  const lines: string[] = [pc.bold("Built-in presets"), ""];

  for (const preset of PRESET_LIST) {
    const label = preset.meta?.label ?? preset.id;
    lines.push(`  ${pc.cyan(pc.bold(preset.id))}  ${pc.dim(`— ${label}`)}`);
    for (const line of wrap(preset.meta?.description ?? "", "    ")) {
      lines.push(line);
    }
    lines.push(
      pc.dim(
        `    ${preset.personas.length} personas · ${preset.tokensPerTurn} tokens a turn · ${preset.model}`,
      ),
    );
    lines.push(pc.dim(renderPresetLimits(preset)));
    lines.push("");
  }

  for (const line of wrap(
    "The dollar figure is a ceiling, not a price: the chain refuses to start a turn it cannot pay for alongside the closing document it still owes. The expected figure assumes an empty input, which puts it low, and every turn using its full token allowance, which puts it high — so it is a middle estimate a real run can land either side of. The cap is not an estimate.",
    "",
  )) {
    lines.push(pc.dim(line));
  }
  lines.push("");

  lines.push(pc.dim("A path to a preset JSON file works anywhere an id does:"));
  lines.push(
    pc.dim('  harness --preset ./presets/custom/dream.json --input "…"'),
  );
  for (const line of wrap(
    'That file is deliberately unusual — three tokens a turn, where every built-in above uses several hundred — because for that preset the fragment is the whole artefact. Copy it for the shape of a preset file, not for its numbers. The README\'s "Writing a preset" section carries an annotated template with conventional ones.',
    "",
  )) {
    lines.push(pc.dim(line));
  }
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Running
// ============================================================================

/**
 * What a dry run bills at.
 *
 * A dry run still accrues spend, because a chain whose ledger never moves never
 * terminates on the condition it terminates on in production. The rate is
 * nominal rather than the preset's real one: a composition can name several
 * models and the ledger takes one rate, and pricing a made-up call precisely is
 * a precision the number does not have.
 */
const DRY_RUN_PRICING: TokenPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

/**
 * Said once, before the first figure appears.
 *
 * Two things make an offline cost fictional rather than approximate, and both
 * are worth naming where someone is about to read dollars off a screen: every
 * model is billed at one nominal rate regardless of what the preset names, and
 * the canned answer is a fixed paragraph that ignores `tokensPerTurn` entirely.
 * So the figures do not compare between presets and do not compare to a live
 * run. What they *do* is move, which is the whole reason a dry run bills at all
 * — a ledger that never moves never reaches the condition the chain terminates
 * on, and the offline path would stop exercising the path it exists to exercise.
 */
const DRY_RUN_COST_NOTICE =
  "Costs below are fictional: every model bills at one nominal rate and the canned answers ignore each preset's tokens-per-turn, so they compare neither between presets nor to a live run. Use --list-presets for what a real run is expected to cost.";

function cannedTurn(agent: string): string {
  return [
    `(dry run — ${agent})`,
    "",
    "No provider was called. This paragraph stands in for a persona's turn so the run exercises the same transcript, the same ledger, and the same termination path a live one does. It is this long on purpose: the offline runner reports token usage proportional to the text it produces, and a chain whose spend never moves is a chain that only ever stops on the iteration backstop.",
  ].join("\n");
}

function cannedSynthesis(agent: string): string {
  return [
    `(dry run — closing document by ${agent})`,
    "",
    "No provider was called. A live run puts the synthesizer's document here, written from the whole transcript above.",
  ].join("\n");
}

/**
 * Canned answers for every agent in the run.
 *
 * Keyed by agent name and nothing else, because that is all the offline runner
 * is given. Two presets in a composition can name a persona the same thing —
 * `pre-mortem` and `dream` both have an `engineer` — so the canned text cannot
 * mention which preset it belongs to without being wrong for one of them.
 */
function dryRunOptions(presets: readonly PresetConfig[]): HarnessOptions {
  const responses: Record<string, string> = {};

  for (const preset of presets) {
    for (const persona of preset.personas) {
      responses[persona.name] = cannedTurn(persona.name);
    }
    responses[preset.synthesizer.name] = cannedSynthesis(
      preset.synthesizer.name,
    );
  }

  return {
    runner: createMockRunner({ responses, chunkChars: 48 }),
    pricing: DRY_RUN_PRICING,
  };
}

function providerOptions(
  presets: readonly PresetConfig[],
  args: CliArgs,
): HarnessOptions {
  if (args.dryRun) {
    return dryRunOptions(presets);
  }

  return { apiKey: process.env.ANTHROPIC_API_KEY };
}

/**
 * The first interrupt asks; the second insists.
 *
 * Aborting the controller flips the chain's interrupt fact and stops a
 * composition from starting another step. It deliberately does not cancel the
 * request in flight — see the module note.
 */
function installInterrupt(
  controller: AbortController,
  notify: (message: string) => void,
): () => void {
  let count = 0;

  const handler = () => {
    count += 1;

    if (count === 1) {
      notify(
        "Interrupt — finishing the turn in flight, then synthesizing. Press Ctrl-C again to exit now.",
      );
      controller.abort();

      return;
    }

    process.exit(130);
  };

  process.on("SIGINT", handler);

  return () => {
    process.off("SIGINT", handler);
  };
}

async function execute(
  presets: readonly PresetConfig[],
  input: string,
  args: CliArgs,
  onEvent: ReturnType<typeof createRenderer>,
  signal: AbortSignal,
): Promise<void> {
  const shared = {
    ...providerOptions(presets, args),
    // The command line is where the filesystem enters. Nothing under
    // `../../core/` knows there is one — see `../node/transcript.js`.
    transcripts: createFileTranscriptStore({ dir: args.outDir }),
    onEvent,
    signal,
  };

  const [only] = presets;
  if (presets.length === 1 && only !== undefined) {
    if (args.totalBudgetUsd !== undefined) {
      throw new CliError(
        "--total-budget is the ceiling across a --compose's steps. With a single --preset there is one step, and --budget is its ceiling.",
      );
    }

    const harness = createHarness(only, shared);

    try {
      await harness.run(input);
    } finally {
      harness.system.destroy();
    }

    return;
  }

  await runComposition(presets, input, {
    ...shared,
    ...(args.totalBudgetUsd === undefined
      ? {}
      : { totalBudgetUsd: args.totalBudgetUsd }),
  });
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Run the CLI and return the process exit code.
 *
 * Returns rather than exits, so the whole surface is callable from a test.
 *
 * @param argv - Arguments only — no `node`, no script path.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const write = (chunk: string) => {
    process.stdout.write(chunk);
  };
  const fail = (message: string) => {
    process.stderr.write(`${pc.red("harness:")} ${message}\n`);

    return 1;
  };

  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliHelp) {
      write(error.text);

      return 0;
    }

    return fail((error as Error).message);
  }

  if (args.listPresets) {
    write(renderPresetList());

    return 0;
  }

  const controller = new AbortController();
  let uninstall = () => {};

  try {
    const presets = await resolvePresets(args);
    requireCredentials(args);
    const input = await resolveInput(args);

    intro(pc.inverse(pc.bold(" harness ")));
    // Ahead of the first cost on screen, because that is the figure it is about.
    if (args.dryRun) {
      log.warn(DRY_RUN_COST_NOTICE);
    }
    uninstall = installInterrupt(controller, (message) => log.warn(message));

    await execute(
      presets,
      input,
      args,
      createRenderer({ verbose: args.verbose, dryRun: args.dryRun, write }),
      controller.signal,
    );

    outro(pc.dim(args.dryRun ? "done (dry run)" : "done"));

    return 0;
  } catch (error) {
    return fail((error as Error).message);
  } finally {
    uninstall();
  }
}
