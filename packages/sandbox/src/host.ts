/**
 * Host-side worker_threads orchestration. Mirrors the lint-runner
 * pattern in `@directive-run/mcp`: spawn a fresh worker per call,
 * race the response against a wall-clock timer, terminate on overrun.
 *
 * Workers are NOT pooled. Each call gets a clean process state — no
 * carry-over globals between snippets, no shared `console` patches,
 * no leaked timers from a prior run. Cold-start is ~5ms which is
 * cheap relative to the 50-200ms a typical Directive demo actually
 * spends in `system.settle()`.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  SandboxResult,
  WorkerInputMessage,
  WorkerOutputMessage,
} from "./types.js";

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Concurrency cap on simultaneously-running workers within one host
 * process. Each worker reserves ~32 MB of heap + a thread; a malicious
 * burst (multi-tab playground, MCP client storm) can spawn enough
 * workers to OOM the surface. Cap to one-per-CPU by default; consumers
 * can override via `setMaxConcurrentWorkers()`. Excess calls queue
 * FIFO and run as slots free.
 */
const DEFAULT_MAX_WORKERS = Math.max(
  1,
  (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator
    ?.hardwareConcurrency ?? 4,
);

let maxConcurrentWorkers = DEFAULT_MAX_WORKERS;
let activeWorkers = 0;

/**
 * A waiter holds the promise resolver for one caller blocked in
 * `acquireSlot()`. `aborted` lets a caller deregister BEFORE its
 * resolver fires — without this, an abandoned caller (HTTP client
 * disconnect, parent `Promise.race` rejection, AbortSignal trigger)
 * leaves a phantom resolver that bumps `activeWorkers` for a caller
 * that no longer exists, pinning a slot permanently. After enough
 * cancellations the pool deadlocks.
 */
interface Waiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  aborted: boolean;
}
const waiters: Waiter[] = [];

/**
 * Wake the first non-aborted waiter, skipping any that aborted while
 * still queued. The `activeWorkers` increment happens HERE (not in
 * the waiter's resolve path) so a higher new cap or a freed slot
 * cannot accidentally allow more than `maxConcurrentWorkers` to run.
 */
function wakeNextWaiter(): void {
  while (waiters.length > 0 && activeWorkers < maxConcurrentWorkers) {
    const next = waiters.shift();
    if (!next || next.aborted) continue;
    activeWorkers++;
    next.resolve();
    return;
  }
}

/**
 * Override the per-process worker cap. Pass `Infinity` to disable.
 * Returns the previous value.
 *
 * Lowering the cap below `activeWorkers` does NOT terminate running
 * workers — the new ceiling applies as those workers drain. New
 * `acquireSlot()` callers queue until `activeWorkers` falls below
 * the new cap. Raising the cap immediately drains any waiters the
 * new ceiling can absorb.
 *
 * @example Cap the worker pool at boot for a Next.js API route
 * ```ts
 * // app/api/sandbox/route.ts — runs once per cold start
 * import { setMaxConcurrentWorkers } from "@directive-run/sandbox";
 * setMaxConcurrentWorkers(8);
 * ```
 */
export function setMaxConcurrentWorkers(value: number): number {
  const prev = maxConcurrentWorkers;
  if (!Number.isFinite(value) && value !== Number.POSITIVE_INFINITY) {
    return prev;
  }
  maxConcurrentWorkers = Math.max(1, Math.floor(value));
  // Drain waiters the new (higher) cap can absorb. wakeNextWaiter()
  // checks the cap before each increment so a LOWER cap does nothing
  // here — drains happen organically as releaseSlot() fires.
  while (waiters.length > 0 && activeWorkers < maxConcurrentWorkers) {
    wakeNextWaiter();
  }
  return prev;
}

function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("sandbox: acquireSlot aborted"),
    );
  }
  if (activeWorkers < maxConcurrentWorkers) {
    activeWorkers++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, aborted: false };
    waiters.push(waiter);
    if (signal) {
      const onAbort = () => {
        waiter.aborted = true;
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("sandbox: acquireSlot aborted"),
        );
        // Don't splice — `wakeNextWaiter()` will skip aborted waiters
        // naturally. Splicing here would race with concurrent shifts.
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Decorate resolve/reject to clean up the listener once the
      // waiter is finally settled (acquired OR aborted).
      const originalResolve = waiter.resolve;
      const originalReject = waiter.reject;
      waiter.resolve = () => {
        signal.removeEventListener("abort", onAbort);
        originalResolve();
      };
      waiter.reject = (reason) => {
        signal.removeEventListener("abort", onAbort);
        originalReject(reason);
      };
    }
  });
}

function releaseSlot(): void {
  activeWorkers = Math.max(0, activeWorkers - 1);
  // Only hand the slot off when the cap allows — protects against
  // `setMaxConcurrentWorkers(lower)` followed by releases that would
  // otherwise immediately re-saturate above the new ceiling.
  if (activeWorkers < maxConcurrentWorkers) {
    wakeNextWaiter();
  }
}

async function resolveWorkerPath(): Promise<string> {
  // PRIMARY: static URL relative to this module's own file. Bundlers
  // (Next.js outputFileTracing, esbuild, webpack, etc.) follow this
  // static reference at build time and include `worker.js` in the
  // output bundle automatically. Works on Vercel + AWS Lambda + Cloud
  // Run without any consumer-side config.
  //
  // FALLBACK (Vitest dev path): `import.meta.url` resolves to the
  // .ts source file in tests, so `./worker.js` doesn't exist there —
  // fall through to `createRequire(import.meta.url).resolve(...)`
  // which Vitest handles correctly via its SSR loader.
  try {
    const staticUrl = new URL("./worker.js", import.meta.url);
    const path = fileURLToPath(staticUrl);
    if (existsSync(path)) {
      return path;
    }
  } catch {
    // fall through
  }
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require.resolve("@directive-run/sandbox/worker");
}

export interface HostRunInput {
  bundledSource: string;
  /** Derivation key names extracted from the payload's source files. */
  derivationKeys: string[];
  timeoutMs?: number;
  /**
   * Optional AbortSignal. When the signal aborts BEFORE a worker slot
   * is acquired, the queued waiter is removed cleanly — no phantom
   * slot increment. When the signal aborts AFTER worker spawn, the
   * worker is terminated and the slot released. Callers wiring this
   * to an HTTP request signal close the connection-cancel → leaked-
   * slot DoS vector exposed in the AE review of v0.3.x.
   */
  signal?: AbortSignal;
}

export class WorkerExecError extends Error {
  constructor(
    message: string,
    public readonly code: "worker-error" | "timeout",
  ) {
    super(message);
    this.name = "WorkerExecError";
  }
}

function clampTimeout(value: number | undefined): number {
  const raw = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(raw)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(raw)));
}

/**
 * Try `os.tmpdir()` first (Vercel-friendly: /tmp is the only writable
 * location on serverless functions). Fall back to the sandbox package
 * dir if /tmp ISN'T writable for some reason. The fallback inherits
 * the package's node_modules walking chain so bare specifiers like
 * `@directive-run/core` resolve naturally.
 */
async function getTempBundleDir(): Promise<string> {
  const osTmp = tmpdir();
  if (existsSync(osTmp)) {
    return osTmp;
  }
  // Reuse the worker-resolution path so we land at the same package
  // regardless of whether the consumer is in production or Vitest dev.
  const workerPath = await resolveWorkerPath();
  // dist/worker.js → ../ → package root.
  return dirname(dirname(workerPath));
}

/**
 * Write the bundled snippet to a temp file Node's ESM loader can
 * import via a file:// URL.
 *
 * Previous versions wrote inside the sandbox package's own directory
 * so Node's resolver could walk up to find `@directive-run/core` in
 * node_modules — but Vercel / AWS Lambda / Cloud Run all ship
 * read-only FS outside `/tmp`. The bundler now rewrites
 * `@directive-run/*` imports to ABSOLUTE `file://` URLs of the
 * host's resolved paths (see `bundleSandboxFiles`), so the temp
 * file can live in `/tmp` without needing a node_modules anchor.
 *
 * Caller MUST clean the directory up in a finally block.
 */
async function writeBundleToTemp(bundledSource: string): Promise<{
  bundlePath: string;
  cleanup: () => void;
}> {
  const baseDir = await getTempBundleDir();
  const dir = mkdtempSync(join(baseDir, "directive-sandbox-"));
  const bundlePath = join(dir, "bundle.mjs");
  writeFileSync(bundlePath, bundledSource, "utf8");
  return {
    bundlePath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

export async function execInWorker(
  input: HostRunInput,
): Promise<SandboxResult> {
  const timeoutMs = clampTimeout(input.timeoutMs);
  // Block here until a slot frees. A burst that exceeds the cap is
  // queued rather than amplified into worker-spawn pressure on the host.
  // The optional signal lets a cancelled caller deregister from the
  // wait queue without leaking a phantom slot.
  await acquireSlot(input.signal);
  let workerPath: string;
  let bundlePath: string;
  let cleanupTempDir: () => void;
  try {
    workerPath = await resolveWorkerPath();
    ({ bundlePath, cleanup: cleanupTempDir } = await writeBundleToTemp(
      input.bundledSource,
    ));
  } catch (err) {
    // Release the slot if we never made it to the worker construction.
    releaseSlot();
    throw err;
  }
  const worker = new Worker(workerPath, {
    // 32 MB heap ceiling — bounded enough to prevent runaway allocations
    // without crowding the typical demo footprint (~2-5 MB).
    resourceLimits: {
      maxOldGenerationSizeMb: 32,
      maxYoungGenerationSizeMb: 8,
      codeRangeSizeMb: 16,
    },
    // Bypass stderr noise from the worker process showing up in the
    // host's logs. The transcript captures everything we care about.
    stderr: false,
  });

  let timer: NodeJS.Timeout | null = null;
  let timedOut = false;
  let aborted = false;
  let abortListener: (() => void) | null = null;
  const startMs = Date.now();

  try {
    const result = await new Promise<SandboxResult>((resolve, reject) => {
      let settled = false;

      worker.once("message", (msg: WorkerOutputMessage) => {
        settled = true;
        if (msg.ok) {
          resolve(msg.result);
        } else {
          reject(new WorkerExecError(msg.error, "worker-error"));
        }
      });

      worker.once("error", (err: Error) => {
        settled = true;
        reject(new WorkerExecError(err.message, "worker-error"));
      });

      worker.once("exit", (code) => {
        if (!settled && code !== 0 && code !== null) {
          reject(
            new WorkerExecError(
              `worker exited with code ${code} before responding`,
              "worker-error",
            ),
          );
        }
      });

      timer = setTimeout(() => {
        timedOut = true;
        worker.terminate();
        reject(
          new WorkerExecError(
            `wall-clock budget of ${timeoutMs}ms elapsed`,
            "timeout",
          ),
        );
      }, timeoutMs);

      // Post-acquisition signal wiring: when the caller's AbortSignal
      // fires (HTTP client disconnect, parent cancellation), terminate
      // the running worker so the slot frees IMMEDIATELY instead of
      // hanging until `timeoutMs` (up to 10s) elapses. Without this,
      // an abandoned caller still ties up the slot for the full
      // worker timeout — driving the per-process pool to deadlock
      // under sustained disconnect load.
      if (input.signal) {
        abortListener = () => {
          if (settled) return;
          settled = true;
          aborted = true;
          worker.terminate();
          reject(
            new WorkerExecError(
              "sandbox: aborted by caller signal",
              "worker-error",
            ),
          );
        };
        if (input.signal.aborted) {
          // Pre-acquired-then-aborted — fire synchronously.
          abortListener();
        } else {
          input.signal.addEventListener("abort", abortListener, {
            once: true,
          });
        }
      }

      const message: WorkerInputMessage = {
        bundlePath: pathToFileURL(bundlePath).href,
        timeoutMs,
        derivationKeys: input.derivationKeys,
      };
      worker.postMessage(message);
    });

    return result;
  } catch (err) {
    if (err instanceof WorkerExecError && err.code === "timeout") {
      // The worker captured nothing because we killed it; surface
      // structured timeout info to the caller.
      return {
        logs: [],
        facts: {},
        derived: {},
        errors: [err.message],
        durationMs: Date.now() - startMs,
        timedOut: true,
      };
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (abortListener && input.signal) {
      input.signal.removeEventListener("abort", abortListener);
    }
    await worker.terminate().catch(() => undefined);
    cleanupTempDir();
    releaseSlot();
    void timedOut;
    void aborted;
  }
}
