/**
 * Public types for `@directive-run/sandbox`.
 *
 * The package executes user-supplied Directive snippets in a bounded
 * worker_threads sandbox and returns a structured transcript. The
 * shape below is what the MCP `run_in_sandbox` tool returns to the
 * AI client and what `directive.run/playground`'s `/api/run-sandbox`
 * route serializes to JSON.
 */

export interface PlaygroundFile {
  /**
   * Relative path inside the project, e.g. "src/main.ts" or
   * "src/counter.ts". One file should be "src/main.ts" — that's
   * the entry point the runner targets.
   */
  path: string;
  /** File contents. */
  source: string;
}

export interface RunInSandboxInput {
  /** Single-file shortcut. Mapped onto "src/main.ts" internally. */
  source?: string;
  /** Multi-file payload (the `generate_module` paired output shape). */
  files?: PlaygroundFile[];
  /** Wall-clock timeout in milliseconds. Defaults to 5000. Clamped to [100, 10000]. */
  timeoutMs?: number;
}

export interface SandboxResult {
  /**
   * Captured `console.log` / `console.warn` / `console.error` lines,
   * in dispatch order. Each entry is the stringified arguments
   * joined by " " (matches Node's default console format).
   */
  logs: string[];
  /**
   * Final `system.facts.$store.toObject()` snapshot at end-of-run.
   * Empty when no system was constructed (e.g. validator rejection).
   */
  facts: Record<string, unknown>;
  /**
   * Final `system.derive` snapshot — every derivation declared in the
   * module config, evaluated by reading `system.derive[key]`. Empty
   * when the module has no `derive:` block or when validation rejected
   * before bundle. The June 2026 security audit flagged the original
   * sandbox for snapshotting only facts; modules whose primary product
   * is a derivation (`status`, `isReady`, etc.) returned an empty-
   * looking transcript.
   */
  derived: Record<string, unknown>;
  /**
   * Structured error messages from validation, bundling, or runtime
   * exceptions. Empty on a clean run.
   */
  errors: string[];
  /** Elapsed wall-clock duration of the worker execution. */
  durationMs: number;
  /** True when the wall-clock budget elapsed before settle()/destroy(). */
  timedOut: boolean;
}

export type SandboxErrorCode =
  | "validation-failed"
  | "bundle-failed"
  | "worker-error"
  | "timeout"
  | "input-invalid";

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code: SandboxErrorCode,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

/**
 * Wire shape for messages from host → worker. The host writes the
 * bundled snippet to a temp file (so Node's ESM loader can resolve
 * `@directive-run/core` against the parent's node_modules; bare
 * specifiers don't resolve from data: URLs) and passes the file URL.
 * Replies on the same channel with a `SandboxResult`.
 */
export interface WorkerInputMessage {
  /** `file://` URL of the temp .mjs bundle the host wrote. */
  bundlePath: string;
  timeoutMs: number;
  /**
   * Derivation key names the host extracted from the source files.
   * `system.derive` is a Proxy with no `ownKeys` trap, so we can't
   * enumerate from the worker; the host's pre-bundle pass scans the
   * source for `derive:` and `derivations:` blocks and forwards the
   * keys here. Worker reads `system.derive[key]` for each.
   */
  derivationKeys: string[];
}

/** Wire shape for messages from worker → host. */
export type WorkerOutputMessage =
  | { ok: true; result: SandboxResult }
  | { ok: false; error: string };
