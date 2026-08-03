/**
 * Turning the event stream into terminal output.
 *
 * Everything printed below comes out of a {@link HarnessEvent} and nothing
 * else. The renderer never sees the system, the facts, or the transcript — if
 * something belongs on screen and is not in the union, the union is what
 * changes.
 *
 * ## Why finished turns and not deltas
 *
 * The default renderer prints a turn when it completes rather than streaming
 * its deltas, even though `turn:delta` is right there. A turn can be replayed
 * — a retry re-invokes the runner and the provider starts the response over,
 * which is what `turn:restarted` announces — and a terminal cannot unprint. A
 * surface that streamed deltas would show the abandoned attempt and the real
 * one end to end as a single run-on turn, which is precisely the corruption
 * the transcript's pending buffer exists to prevent. The closing document
 * *does* stream, because synthesis is the last thing that happens and there is
 * nothing after it to be confused by.
 *
 * ## Why every field is sanitized on the way out
 *
 * A terminal executes what is written to it. Model output reaches this file
 * verbatim, and so do persona names and preset ids, which come from a preset a
 * caller may have loaded off disk. An escape sequence in any of them clears the
 * screen, hides text behind the conceal attribute, rewrites the window title, or
 * — with an operating-system command — writes the reader's clipboard. So every
 * string that came from outside this package goes through
 * {@link sanitizeForTerminal} before it is composed into a line, and the
 * package's own colour codes go on afterwards. `--verbose` was always safe by
 * accident, because it serializes through `JSON.stringify`; the default path was
 * not.
 *
 * The closing document streams, so its sanitizer is stateful — an escape
 * sequence split across two chunks is two harmless halves that a terminal
 * reassembles, and per-chunk stripping would pass both.
 *
 * @module
 */

import pc from "picocolors";
import type { HarnessEvent } from "../../core/events.js";
import {
  createTerminalSanitizer,
  sanitizeForTerminal,
} from "../../core/safety.js";

export interface RendererOptions {
  /** Print the event stream structurally instead of as prose. */
  verbose: boolean;
  /**
   * Mark every total as offline money.
   *
   * A dry run bills at one nominal rate for every model and answers with a
   * fixed paragraph that ignores `tokensPerTurn`, so its figures compare
   * neither between presets nor to a live run. The command line says so once
   * before the run starts; this is what keeps the closing totals — the figures
   * someone scrolls back to — from being read as real after that line has
   * scrolled away. @default false
   */
  dryRun?: boolean;
  /** Where output goes. Injected so the renderer is testable without a TTY. */
  write: (text: string) => void;
}

/** Four decimal places, which is where a per-turn cost lives. */
function money(value: number, places = 4): string {
  return `$${value.toFixed(places)}`;
}

/**
 * A dollar figure, at enough precision to be the number the operator typed.
 *
 * Two places reads well for the dollar-ish budgets the built-ins carry, and
 * rounds `--budget 0.005` to `$0.01` — printing a ceiling twice the one in
 * force, beside a spend figure at four places that appears to be under it.
 * Cents when it is cents.
 */
export function dollars(value: number): string {
  return money(value, value >= 0.1 ? 2 : 4);
}

/** `1 turn`, `3 turns`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// ============================================================================
// Verbose
// ============================================================================

const MAX_FIELD_CHARS = 80;

/** Token-level events, omitted from `--verbose`. See the module note. */
const TOKEN_EVENTS = new Set(["turn:delta", "synthesis:chunk"]);

function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(",");
  }
  if (typeof value !== "string") {
    return String(value);
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  const clipped =
    collapsed.length > MAX_FIELD_CHARS
      ? `${collapsed.slice(0, MAX_FIELD_CHARS)}…`
      : collapsed;

  return JSON.stringify(clipped);
}

/**
 * One line per event: the type, then every field it carries.
 *
 * The two token-level events are the exception — one line per twenty-four
 * characters of model output is not a structural view of anything, and a
 * `--verbose` that scrolled them past would be less legible than the default.
 * `turn:restarted` is kept, because that is the one a delta consumer needs.
 */
function renderVerbose(event: HarnessEvent): string | undefined {
  if (TOKEN_EVENTS.has(event.type)) {
    return undefined;
  }

  const fields = Object.entries(event)
    .filter(([key]) => key !== "type")
    .map(([key, value]) => `${key}=${renderValue(value)}`)
    .join(" ");

  return `${pc.cyan(event.type)} ${pc.dim(fields)}\n`;
}

// ============================================================================
// Default
// ============================================================================

/** Anything that came from a preset, a provider, or a model. */
function safe(value: string): string {
  return sanitizeForTerminal(value);
}

function renderProse(
  event: HarnessEvent,
  stream: (chunk: string) => string,
  /** Appended to every total, so an offline figure is never read as a real one. */
  costCaveat: string,
): string | undefined {
  switch (event.type) {
    case "composition:started":
      return pc.dim(`composition: ${event.presets.map(safe).join(" → ")}\n\n`);

    case "composition:step:started":
      return `${pc.bold(pc.magenta(`[${event.step}/${event.total}] ${safe(event.presetId)}`))}\n`;

    case "composition:step:complete":
      return pc.dim(
        `  step ${event.step} done — ${plural(event.iterations, "turn")}, ${money(event.spentUsd)}, ${safe(event.transcriptPath)}\n\n`,
      );

    case "chain:started":
      return pc.dim(
        `  ${event.personas.map(safe).join(" · ")}\n  budget ${dollars(event.budgetUsd)} → ${safe(event.transcriptPath)}\n\n`,
      );

    case "turn:restarted":
      return pc.dim(
        `  ↻ ${safe(event.persona)} restarting turn ${event.iteration + 1} — ${safe(event.reason)}\n`,
      );

    case "turn:completed":
      return `${pc.cyan(`${event.iteration + 1}. ${safe(event.persona)}`)} ${pc.dim(money(event.costUsd))}\n\n${safe(event.text).trim()}\n\n`;

    case "budget:warning":
      return `${pc.yellow(`  budget ${Math.round(event.fraction * 100)}% spent`)} ${pc.dim(`(${money(event.spentUsd)} of ${dollars(event.budgetUsd)})`)}\n\n`;

    case "budget:synthesis-skipped":
      return `${pc.yellow("  no closing document —")} ${pc.dim(`the synthesis prices at ${money(event.reserveUsd)} and only ${money(event.remainingUsd)} of ${dollars(event.budgetUsd)} is left. The ${plural(event.iterations, "turn")} above ${event.iterations === 1 ? "is" : "are"} the whole run; raise the budget for a summary of them.`)}\n\n`;

    case "synthesis:started":
      return `${pc.bold(pc.green("synthesis"))} ${pc.dim(`after ${plural(event.iteration, "turn")} — stopped on ${event.stopReason || "settled"}`)}\n\n`;

    case "synthesis:chunk":
      return stream(event.text);

    case "error":
      return `${pc.red(`  error (${event.scope}${event.iteration === undefined ? "" : ` turn ${event.iteration + 1}`}):`)} ${safe(event.message)}\n\n`;

    case "chain:complete":
      return pc.dim(
        `\n\n  ${plural(event.iterations, "turn")} · ${money(event.spentUsd)} of ${dollars(event.budgetUsd)}${costCaveat} · stopped on ${event.stopReason || "settled"}\n  ${safe(event.transcriptPath)}\n\n`,
      );

    case "composition:budget-exhausted":
      return `${pc.yellow(`  stopping before step ${event.step}/${event.total} (${safe(event.presetId)})`)} ${pc.dim(`— ${money(event.spentUsd)} of ${dollars(event.budgetUsd)} spent, and that step needs at least ${money(event.requiredUsd)}. Raise --total-budget to run the rest.`)}\n\n`;

    case "composition:complete":
      return pc.dim(
        `  ${plural(event.steps, "step")} · ${money(event.spentUsd)} of ${dollars(event.budgetUsd)} total${costCaveat}${event.interrupted ? " · interrupted" : ""}${event.budgetExhausted ? " · budget exhausted" : ""}\n  ${safe(event.combinedPath)}\n`,
      );

    default:
      return undefined;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createRenderer(
  options: RendererOptions,
): (event: HarnessEvent) => void {
  const { verbose, write } = options;
  const costCaveat = options.dryRun === true ? " (dry-run pricing)" : "";
  // One sanitizer for the whole run, because the closing document arrives in
  // pieces and a sequence can be split across two of them. Anything held at the
  // end of a chunk is an incomplete sequence, so it is released — as nothing —
  // when the next event that is not a chunk arrives.
  const synthesis = createTerminalSanitizer();

  return (event) => {
    if (event.type !== "synthesis:chunk") {
      const remainder = synthesis.flush();
      if (remainder !== "") {
        write(remainder);
      }
    }

    const text = verbose
      ? renderVerbose(event)
      : renderProse(event, (chunk) => synthesis.push(chunk), costCaveat);

    if (text !== undefined && text !== "") {
      write(text);
    }
  };
}
