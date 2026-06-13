// Lint shim for @directive-run/lint.
//
// AE Security review (P0 #3): synchronous ts-morph parsing cannot be
// aborted via setTimeout on the main thread, so a hostile source
// could in principle pin a CPU past our budget. Pre-parse byte caps
// + a soft timeout are enforced here; worker_threads-based hard
// termination is gated behind DIRECTIVE_MCP_USE_LINT_WORKER=1 (the
// integration is sound but vitest's pool model + Worker spawning
// don't co-exist cleanly, so the default is in-process for now —
// see v0.3.0 candidates).
//
// Pre-parse caps are enforced HERE, not in the worker, so a hostile
// source can't even reach the parser if it's over the size budget.

import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { applyFix, runRules } from "@directive-run/lint";
import type { Finding, FixResult, RunResult } from "@directive-run/lint";

const MAX_SOURCE_BYTES = 200_000;
const PARSE_BUDGET_MS = 5_000;
const FILENAME_RE = /^[\w./-]{1,128}$/;

/**
 * Cap simultaneously-running lint workers within the MCP host process.
 * Each worker spawns a ts-morph project + a thread; a multi-client MCP
 * burst (Cursor + Claude + IDE all calling `review_source` in parallel)
 * could amplify into a thread-spawn storm. Cap to one-per-CPU by default;
 * queued calls run as slots free.
 */
const DEFAULT_MAX_WORKERS = Math.max(
  1,
  (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator
    ?.hardwareConcurrency ?? 4,
);
let maxConcurrentLintWorkers = DEFAULT_MAX_WORKERS;
let activeLintWorkers = 0;
const lintWaiters: Array<() => void> = [];

/** Override the cap. Returns the previous value. */
export function setMaxConcurrentLintWorkers(value: number): number {
  const prev = maxConcurrentLintWorkers;
  if (!Number.isFinite(value) && value !== Number.POSITIVE_INFINITY) {
    return prev;
  }
  maxConcurrentLintWorkers = Math.max(1, Math.floor(value));
  while (
    lintWaiters.length > 0 &&
    activeLintWorkers < maxConcurrentLintWorkers
  ) {
    const next = lintWaiters.shift();
    if (next) next();
  }
  return prev;
}

function acquireLintSlot(): Promise<void> {
  if (activeLintWorkers < maxConcurrentLintWorkers) {
    activeLintWorkers++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    lintWaiters.push(() => {
      activeLintWorkers++;
      resolve();
    });
  });
}

function releaseLintSlot(): void {
  activeLintWorkers = Math.max(0, activeLintWorkers - 1);
  const next = lintWaiters.shift();
  if (next) next();
}

export interface LintRunInput {
  source: string;
  fileName?: string;
  ruleFilter?: string[];
}

export interface LintFixInput {
  source: string;
  finding: Finding;
}

export class LintRunnerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "source-too-large"
      | "bad-filename"
      | "worker-error"
      | "timeout",
  ) {
    super(message);
  }
}

function validate(input: LintRunInput | LintFixInput): void {
  const bytes = Buffer.byteLength(input.source, "utf8");
  if (bytes > MAX_SOURCE_BYTES) {
    throw new LintRunnerError(
      `source is ${bytes} bytes (max ${MAX_SOURCE_BYTES})`,
      "source-too-large",
    );
  }
  const fileName = "fileName" in input ? input.fileName : undefined;
  if (fileName !== undefined && !FILENAME_RE.test(fileName)) {
    throw new LintRunnerError("invalid fileName", "bad-filename");
  }
}

async function resolveWorkerPath(): Promise<string> {
  // import.meta.resolve is ESM-native and respects the `import`-only
  // export at `@directive-run/lint/worker`. It returns a file: URL.
  const url = await import.meta.resolve("@directive-run/lint/worker");
  return fileURLToPath(url);
}

async function runInWorker<TIn, TOut>(payload: TIn): Promise<TOut> {
  await acquireLintSlot();
  let workerPath: string;
  try {
    workerPath = await resolveWorkerPath();
  } catch (err) {
    releaseLintSlot();
    throw err;
  }
  const worker = new Worker(workerPath, { stderr: false });
  let timer: NodeJS.Timeout | null = null;
  try {
    return await new Promise<TOut>((resolve, reject) => {
      let resolved = false;
      worker.once(
        "message",
        (msg: { ok: boolean; result?: TOut; error?: string }) => {
          resolved = true;
          if (msg.ok && msg.result !== undefined) {
            resolve(msg.result);
          } else {
            reject(
              new LintRunnerError(
                msg.error ?? "worker returned without result",
                "worker-error",
              ),
            );
          }
        },
      );
      worker.once("error", (err: Error) => {
        resolved = true;
        reject(new LintRunnerError(err.message, "worker-error"));
      });
      worker.once("exit", (code) => {
        if (!resolved && code !== 0 && code !== null) {
          reject(
            new LintRunnerError(
              `worker exited with code ${code} before responding`,
              "worker-error",
            ),
          );
        }
      });
      timer = setTimeout(() => {
        worker.terminate();
        reject(
          new LintRunnerError(
            `parse exceeded ${PARSE_BUDGET_MS}ms budget`,
            "timeout",
          ),
        );
      }, PARSE_BUDGET_MS);
      worker.postMessage(payload);
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    await worker.terminate().catch(() => undefined);
    releaseLintSlot();
  }
}

function shouldUseWorker(): boolean {
  // Default ON in production so synchronous ts-morph parses cannot pin
  // the event loop past the 5-second budget (AE v0.2.0 P0 #3). Disable
  // inside vitest (Vitest's pool model conflicts with spawned Workers)
  // or via explicit DIRECTIVE_MCP_USE_LINT_WORKER=0.
  if (process.env.DIRECTIVE_MCP_USE_LINT_WORKER === "0") {
    return false;
  }
  if (process.env.VITEST === "true") {
    return false;
  }
  return true;
}

export async function runLintInWorker(input: LintRunInput): Promise<RunResult> {
  validate(input);
  if (shouldUseWorker()) {
    return runInWorker<
      {
        kind: "run";
        source: string;
        options?: { fileName?: string; ruleFilter?: string[] };
      },
      RunResult
    >({
      kind: "run",
      source: input.source,
      options: {
        fileName: input.fileName,
        ruleFilter: input.ruleFilter,
      },
    });
  }
  return runRules(input.source, {
    fileName: input.fileName,
    ruleFilter: input.ruleFilter,
  });
}

export async function applyFixInWorker(
  input: LintFixInput,
): Promise<FixResult> {
  validate(input);
  if (shouldUseWorker()) {
    return runInWorker<
      { kind: "fix"; source: string; finding: Finding },
      FixResult
    >({
      kind: "fix",
      source: input.source,
      finding: input.finding,
    });
  }
  return applyFix(input.source, input.finding);
}
