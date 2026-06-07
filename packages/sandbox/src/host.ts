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
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  SandboxResult,
  WorkerInputMessage,
  WorkerOutputMessage,
} from "./types.js";

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;

async function resolveWorkerPath(): Promise<string> {
  // Use createRequire instead of `import.meta.resolve` — Vitest's SSR
  // shim of import.meta exposes a `resolve` that isn't callable, and
  // `createRequire` works in both real Node ESM and Vitest dev mode.
  // The worker subpath export points at dist/worker.js; CJS resolution
  // picks up the "default" condition we set in package.json.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require.resolve("@directive-run/sandbox/worker");
}

export interface HostRunInput {
  bundledSource: string;
  /** Derivation key names extracted from the payload's source files. */
  derivationKeys: string[];
  timeoutMs?: number;
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
 * Phase A audit P0-A1: previous versions wrote inside the sandbox
 * package's own directory so Node's resolver could walk up to find
 * `@directive-run/core` in node_modules — but Vercel / AWS Lambda /
 * Cloud Run all ship read-only FS outside `/tmp`. The bundler now
 * rewrites `@directive-run/*` imports to ABSOLUTE `file://` URLs of
 * the host's resolved paths (see `bundleSandboxFiles`), so the temp
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
  const workerPath = await resolveWorkerPath();
  const { bundlePath, cleanup: cleanupTempDir } = await writeBundleToTemp(
    input.bundledSource,
  );
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
    await worker.terminate().catch(() => undefined);
    cleanupTempDir();
    void timedOut;
  }
}
