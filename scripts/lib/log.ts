/**
 * Shared build logger for the docs pipeline.
 *
 * Zero dependencies — uses Node built-in ANSI codes.
 * Respects NO_COLOR env var (https://no-color.org).
 *
 * Usage:
 *   import log from "../../scripts/lib/log";
 *   log.header("Extract API Docs");
 *   log.step("Parsing packages/core/src...");
 *   log.done("Extract API Docs", startTime);
 */

const NO_COLOR = "NO_COLOR" in process.env;

const c = {
  reset: NO_COLOR ? "" : "\x1b[0m",
  bold: NO_COLOR ? "" : "\x1b[1m",
  dim: NO_COLOR ? "" : "\x1b[2m",
  cyan: NO_COLOR ? "" : "\x1b[36m",
  green: NO_COLOR ? "" : "\x1b[32m",
  yellow: NO_COLOR ? "" : "\x1b[33m",
  red: NO_COLOR ? "" : "\x1b[31m",
};

const PREFIX = `${c.dim}[directive]${c.reset}`;

const timers = new Map<string, number>();

function write(msg: string): void {
  process.stdout.write(`${PREFIX} ${msg}\n`);
}

/** ━━━ Phase Name ━━━━━━━━━━━━━━━━━━━━━━━━━ */
function header(name: string): void {
  const bar = "━".repeat(Math.max(1, 40 - name.length));
  write("");
  write(`${c.cyan}${c.bold}━━━ ${name} ${bar}${c.reset}`);
  write("");
  timers.set(name, Date.now());
}

/** ▸ step description */
function step(msg: string): void {
  write(`${c.dim}▸${c.reset} ${msg}`);
}

/** · detail item */
function item(name: string, detail?: string): void {
  const suffix = detail ? `${c.dim}: ${detail}${c.reset}` : "";
  write(`  ${c.dim}·${c.reset} ${name}${suffix}`);
}

/** ✓ green success */
function success(msg: string): void {
  write(`${c.green}✓${c.reset} ${msg}`);
}

/** ⚠ yellow warning */
function warn(msg: string): void {
  write(`${c.yellow}⚠${c.reset} ${msg}`);
}

/** ✗ red error */
function error(msg: string): void {
  write(`${c.red}✗${c.reset} ${msg}`);
}

/** ✓ Done in X.Xs */
function done(name: string): void {
  const start = timers.get(name);
  const elapsed = start ? Date.now() - start : 0;
  const time = elapsed >= 1000
    ? `${(elapsed / 1000).toFixed(1)}s`
    : `${elapsed}ms`;
  write(`${c.green}✓${c.reset} done ${c.dim}${time}${c.reset}`);
  write("");
  timers.delete(name);
}

/** key: value summary table */
function summary(data: Record<string, number | string>): void {
  const maxKeyLen = Math.max(...Object.keys(data).map((k) => k.length));
  write("");
  for (const [key, value] of Object.entries(data)) {
    write(`  ${c.dim}${key.padEnd(maxKeyLen)}${c.reset}  ${value}`);
  }
}

/** thin divider */
function divider(): void {
  write(`${c.dim}${"─".repeat(44)}${c.reset}`);
}

/** ← input → output */
function io(input: string, output: string): void {
  write(`  ${c.dim}←${c.reset} ${input} ${c.dim}→${c.reset} ${output}`);
}

/** ← reads list */
function reads(files: string[]): void {
  for (const f of files) {
    write(`  ${c.dim}←${c.reset} ${f}`);
  }
}

/** → writes file (with optional size) */
function writes(file: string, size?: string): void {
  const suffix = size ? ` ${c.dim}(${size})${c.reset}` : "";
  write(`  ${c.dim}→${c.reset} ${file}${suffix}`);
}

const log = {
  header,
  step,
  item,
  success,
  warn,
  error,
  done,
  summary,
  divider,
  io,
  reads,
  writes,
};

export { log };
