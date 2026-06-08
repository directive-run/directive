/**
 * Public API for `@directive-run/sandbox`.
 *
 * Single entry point: `runInSandbox({files, timeoutMs})` validates the
 * payload against the AST allowlist, bundles the multi-file payload via
 * esbuild, and executes the result in a bounded worker_threads sandbox.
 * Returns a structured `SandboxResult` with captured logs, the final
 * facts snapshot, and any errors that occurred at any stage.
 *
 * Consumers:
 *
 * - `@directive-run/mcp` — the `run_in_sandbox` MCP tool returns the
 *   result to AI clients alongside a `playground_link` URL.
 * - `directive-docs` — the `/api/run-sandbox` Next.js route wraps this
 *   for the playground page's live DevTools transcript view.
 */

import { BundleError, bundleSandboxFiles } from "./bundler.js";
import { WorkerExecError, execInWorker } from "./host.js";
import { extractDerivationKeys } from "./key-extractor.js";
import { SandboxError } from "./types.js";
import type {
  PlaygroundFile,
  RunInSandboxInput,
  SandboxResult,
} from "./types.js";
import { validateSandboxInput } from "./validator.js";

export {
  SandboxError,
  type PlaygroundFile,
  type RunInSandboxInput,
  type SandboxResult,
} from "./types.js";
export type { ValidationError } from "./validator.js";

const MAX_PAYLOAD_BYTES = 200_000;
const MAX_FILES = 10;
const MAIN_PATH = "src/main.ts";

function normalizeInput(input: RunInSandboxInput): PlaygroundFile[] {
  if (input.files && input.source) {
    throw new SandboxError(
      "pass either `source` or `files`, not both",
      "input-invalid",
    );
  }
  if (!input.files && !input.source) {
    throw new SandboxError(
      "must pass either `source` or `files`",
      "input-invalid",
    );
  }
  const files: PlaygroundFile[] = input.files
    ? input.files
    : [{ path: MAIN_PATH, source: input.source ?? "" }];

  if (files.length === 0) {
    throw new SandboxError("files array is empty", "input-invalid");
  }
  if (files.length > MAX_FILES) {
    throw new SandboxError(
      `payload exceeds ${MAX_FILES} files`,
      "input-invalid",
    );
  }
  let totalBytes = 0;
  for (const file of files) {
    if (typeof file.path !== "string" || file.path.length === 0) {
      throw new SandboxError(
        "every file must have a non-empty path",
        "input-invalid",
      );
    }
    if (typeof file.source !== "string" || file.source.length === 0) {
      throw new SandboxError(
        `file "${file.path}" has empty source`,
        "input-invalid",
      );
    }
    totalBytes += Buffer.byteLength(file.source, "utf8");
  }
  if (totalBytes > MAX_PAYLOAD_BYTES) {
    throw new SandboxError(
      `total payload is ${totalBytes} bytes (max ${MAX_PAYLOAD_BYTES})`,
      "input-invalid",
    );
  }
  // Ensure src/main.ts is present — that's the runner / entry point.
  if (!files.some((f) => f.path === MAIN_PATH)) {
    throw new SandboxError(
      `payload must include "${MAIN_PATH}" — the runner entry point`,
      "input-invalid",
    );
  }
  return files;
}

export async function runInSandbox(
  input: RunInSandboxInput,
): Promise<SandboxResult> {
  let files: PlaygroundFile[];
  try {
    files = normalizeInput(input);
  } catch (err) {
    if (err instanceof SandboxError) {
      return {
        logs: [],
        facts: {},
        derived: {},
        errors: [err.message],
        durationMs: 0,
        timedOut: false,
      };
    }
    throw err;
  }

  const validationErrors = validateSandboxInput(files);
  if (validationErrors.length > 0) {
    return {
      logs: [],
      facts: {},
      derived: {},
      errors: validationErrors.map(
        (e) => `${e.path}:${e.line}:${e.column} — ${e.message}`,
      ),
      durationMs: 0,
      timedOut: false,
    };
  }

  // Phase A audit P0-DM2: pre-extract derivation key names from the
  // source files so the worker can iterate them after settle. The
  // `system.derive` proxy has no `ownKeys` trap.
  const derivationKeys = extractDerivationKeys(files);

  let bundled: { source: string; bytes: number };
  try {
    bundled = await bundleSandboxFiles(files);
  } catch (err) {
    if (err instanceof BundleError) {
      return {
        logs: [],
        facts: {},
        derived: {},
        errors: [err.message],
        durationMs: 0,
        timedOut: false,
      };
    }
    throw err;
  }

  try {
    const result = await execInWorker({
      bundledSource: bundled.source,
      derivationKeys,
      timeoutMs: input.timeoutMs,
    });
    return result;
  } catch (err) {
    if (err instanceof WorkerExecError) {
      return {
        logs: [],
        facts: {},
        derived: {},
        errors: [err.message],
        durationMs: 0,
        timedOut: err.code === "timeout",
      };
    }
    throw err;
  }
}
