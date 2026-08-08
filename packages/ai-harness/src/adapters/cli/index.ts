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
 * ## Exit codes
 *
 * See {@link ExitCode}. Every outcome used to be `0`, which meant a shell could
 * not tell a finished run from a failed one and `harness … && ship` shipped on
 * a run that produced nothing. The distinction a caller actually needs is not
 * "did the process crash" but "did the caller get what they asked for", and
 * that is the line the codes are drawn along — which is why a composition that
 * could afford one step of three is not a clean exit either, and why a turn
 * whose provider refused every attempt is a failure rather than a thin run.
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
import type { HarnessEvent } from "../../core/events.js";
import { createMockRunner } from "../../core/mock-runner.js";
import { assertPreset, loadPreset } from "../../core/preset-registry.js";
import type { PresetConfig } from "../../core/preset-types.js";
import type { HarnessOptions } from "../../core/system.js";
import { PRESET_LIST } from "../../presets/index.js";
import { createFileTranscriptStore } from "../node/transcript.js";
import { createHarness } from "../sdk/index.js";
import { createRenderer, dollars, plural } from "./render.js";

// ============================================================================
// Exit codes
// ============================================================================

/**
 * What the process exits with, and what each one means to a script.
 *
 * The line the codes are drawn along is "did the caller get what they asked
 * for", because that is what a caller chains onto. `0` is the only value that
 * says yes. Everything else is a distinct reason it is no, and they are
 * separate because they call for different responses: fix the command, raise
 * the budget, or look at what failed.
 */
export const ExitCode = {
  /**
   * The run finished and produced everything it was asked for: a closing
   * document, and — for a `--compose` — one from every step.
   *
   * A single interrupt lands here when it still produced a closing document.
   * That is what one interrupt asks for: the summary now rather than later, and
   * the run delivered it. The double interrupt is `130`.
   */
  ok: 0,
  /**
   * The command could not run: bad arguments, an unreadable input file, a
   * preset that resolves to nothing, no API key, nothing on stdin. Nothing was
   * spent.
   */
  usage: 1,
  /**
   * The run finished short of what was asked for, without anything failing.
   *
   * Either no closing document was written — the budget covered the synthesis
   * but not a first turn alongside it, or ran out before the synthesis came
   * due, or an interrupt arrived before the first turn finished — or a
   * `--compose` could not afford all of its steps and stopped after the ones it
   * could. A larger `--budget` or `--total-budget` is the answer in every case,
   * and the line above the totals says which one it was.
   */
  noOutput: 2,
  /**
   * A run failed.
   *
   * The synthesizer threw, a turn's provider call failed every attempt, a
   * composition step could not run, or the transcript could not be written. The
   * error is on stderr and whatever the run did produce is in memory; whether
   * it reached the transcript is the one case worth reading the error for.
   *
   * A turn that failed every attempt lands here even when the chain went on to
   * synthesize what it had. The closing document is real and so is the gap in
   * the transcript underneath it, and a script that chains on this output is
   * entitled to know the difference.
   */
  failed: 3,
  /**
   * Interrupted twice. The conventional `128 + SIGINT`, so a shell reports it
   * the way it reports any other interrupted command. One interrupt is not
   * this — the chain synthesizes what it has and exits on its own outcome.
   */
  interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

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
    .addHelpText(
      "after",
      [
        "",
        "Exit codes:",
        "  0    finished, and produced everything asked for",
        "  1    the command could not run — nothing was spent",
        "  2    finished short — no closing document, or a --compose that ran out of budget",
        "  3    the run failed — a call, a step, or the transcript",
        "  130  interrupted twice",
        "",
      ].join("\n"),
    )
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

/**
 * How long stdin has to deliver its first byte before the command gives up.
 *
 * A deadline on the *first* byte only. Once anything has arrived the rest is
 * read to end with no clock on it, because a slow producer piping a large diff
 * is the case this must not interrupt.
 *
 * It is here because "no TTY" does not mean "something is going to write". A CI
 * step that inherits an open pipe nobody ever closes leaves the stream readable
 * forever and empty forever, and the loop below waits on it — so a job that
 * should have exited with the usage code hangs until the runner kills it. Two
 * seconds is far longer than a pipe's first write takes and far shorter than
 * anyone's patience with a stuck build.
 */
const STDIN_FIRST_BYTE_MS = 2_000;

/**
 * Everything on stdin, or nothing if it never starts.
 *
 * Resolves `null` when the deadline passes with no byte delivered and the
 * stream has not ended, which the caller reports as missing input rather than
 * as empty input — they are different mistakes and want different sentences.
 */
async function readStdin(firstByteMs: number): Promise<string | null> {
  const chunks: string[] = [];

  process.stdin.setEncoding("utf8");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), firstByteMs);
  });

  const read = (async () => {
    for await (const chunk of process.stdin) {
      // The first byte retires the deadline. `unref` is not enough on its own
      // — the timer would stop holding the process open but would still fire
      // and resolve the race under a large, slow input.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      chunks.push(chunk as string);
    }

    return chunks.join("");
  })();

  try {
    return await Promise.race([read, stalled]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Overrides for the parts of {@link resolveInput} a test needs to drive. */
export interface ResolveInputOptions {
  /** See {@link STDIN_FIRST_BYTE_MS}. */
  stdinFirstByteMs?: number;
}

/**
 * The input, from wherever it is.
 *
 * `--input`, then `--input-file`, then a prompt on a terminal, then whatever
 * was piped in. The prompt is last among the interactive options and first
 * among none of them: a script with no TTY and no flags gets an error, not a
 * hung process waiting on a keystroke nobody is there to press — and, since a
 * pipe that is never written to and never closed is the same hang wearing a
 * different hat, not a process waiting on one of those either.
 */
export async function resolveInput(
  args: CliArgs,
  options: ResolveInputOptions = {},
): Promise<string> {
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

  const piped = await readStdin(
    options.stdinFirstByteMs ?? STDIN_FIRST_BYTE_MS,
  );
  if (piped === null || piped.trim() === "") {
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

    process.exit(ExitCode.interrupted);
  };

  process.on("SIGINT", handler);

  return () => {
    process.off("SIGINT", handler);
  };
}

/**
 * What the run amounted to, read off the same event stream the screen is.
 *
 * Not off the result objects, deliberately. A composition's last step is the
 * one whose closing document is the answer, a single run has exactly one, and
 * reading either from its own return shape would be two ways of deciding the
 * exit code — which is how they come to disagree. The events say it once.
 */
export interface Outcome {
  /** Whether the last chain to finish wrote a closing document. */
  produced: boolean;
  /** Whether anything failed outright. */
  failed: boolean;
  /**
   * Whether the run finished short of what was asked for without failing.
   *
   * Currently only a composition that ran some of its steps and declined the
   * rest for want of budget. A chain that produced no closing document is
   * already covered by `produced`.
   */
  short: boolean;
}

/** Nothing has happened yet. */
export function emptyOutcome(): Outcome {
  return { produced: false, failed: false, short: false };
}

/**
 * Fold one event into what the run amounted to.
 *
 * Separate from the rendering, and exported, because this is the whole of the
 * exit-code decision and it is worth being able to state it in a test without
 * standing up a provider. Mutates rather than returns, because a run is a
 * stream of events and rebuilding the record for each one would say nothing
 * extra.
 */
export function observeOutcome(outcome: Outcome, event: HarnessEvent): void {
  if (event.type === "chain:complete") {
    outcome.produced = event.synthesis !== "";
    // `phase` is not the whole answer and was once read as though it were.
    // It reports `"failed"` only when the *synthesizer* failed, because a chain
    // whose turn failed goes on to synthesize what it has and finishes
    // legitimately complete. A first turn that failed has nothing to
    // synthesize, so the chain completes with no document and no phase to say
    // why — which the exit code then read as a budget problem while the screen,
    // correctly, said it was not one. `stopReason` is the field that knows, and
    // it is on this event already.
    outcome.failed =
      outcome.failed ||
      event.phase === "failed" ||
      event.stopReason === "error";
  }

  // A composition that ran some of its steps and declined the rest. What ran is
  // whole, so nothing failed — but the caller did not get what they asked for,
  // and a larger ceiling is the answer.
  if (event.type === "composition:budget-exhausted") {
    outcome.short = true;
  }

  // A step that could not run, and a transcript that could not be written. The
  // second is a failure of the command's output contract rather than of the
  // run: the paths are printed either way, and a caller reading one that was
  // never written has been told something untrue.
  if (
    event.type === "error" &&
    (event.scope === "step" || event.scope === "transcript")
  ) {
    outcome.failed = true;
  }
}

/** What the process should exit with, given what the run amounted to. */
export function exitCodeFor(outcome: Outcome): number {
  if (outcome.failed) {
    return ExitCode.failed;
  }
  if (!outcome.produced || outcome.short) {
    return ExitCode.noOutput;
  }

  return ExitCode.ok;
}

async function execute(
  presets: readonly PresetConfig[],
  input: string,
  args: CliArgs,
  onEvent: ReturnType<typeof createRenderer>,
  signal: AbortSignal,
): Promise<Outcome> {
  const outcome = emptyOutcome();
  const observe = (event: HarnessEvent) => {
    observeOutcome(outcome, event);
    onEvent(event);
  };

  const shared = {
    ...providerOptions(presets, args),
    // The command line is where the filesystem enters. Nothing under
    // `../../core/` knows there is one — see `../node/transcript.js`.
    transcripts: createFileTranscriptStore({ dir: args.outDir }),
    onEvent: observe,
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

    return outcome;
  }

  await runComposition(presets, input, {
    ...shared,
    ...(args.totalBudgetUsd === undefined
      ? {}
      : { totalBudgetUsd: args.totalBudgetUsd }),
  });

  return outcome;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Run the CLI and return the process exit code.
 *
 * Returns rather than exits, so the whole surface is callable from a test.
 * See {@link ExitCode} for what each value means.
 *
 * @param argv - Arguments only — no `node`, no script path.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  const write = (chunk: string) => {
    process.stdout.write(chunk);
  };
  const fail = (message: string, code: number = ExitCode.usage) => {
    process.stderr.write(`${pc.red("harness:")} ${message}\n`);

    return code;
  };

  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliHelp) {
      write(error.text);

      return ExitCode.ok;
    }

    return fail((error as Error).message);
  }

  if (args.listPresets) {
    write(renderPresetList());

    return ExitCode.ok;
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

    const outcome = await execute(
      presets,
      input,
      args,
      createRenderer({ verbose: args.verbose, dryRun: args.dryRun, write }),
      controller.signal,
    );

    outro(pc.dim(args.dryRun ? "done (dry run)" : "done"));

    return exitCodeFor(outcome);
  } catch (error) {
    // A throw out of `execute` is the run itself failing — a torn-down system,
    // a store that would not open. `CliError` is the other kind and is the
    // operator's to fix, which is a different code and a different response.
    return fail(
      (error as Error).message,
      error instanceof CliError ? ExitCode.usage : ExitCode.failed,
    );
  } finally {
    uninstall();
  }
}
