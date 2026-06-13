/**
 * Worker-thread entry. Receives a bundled ESM string + timeout, hooks
 * `console.*` to a capture buffer, evaluates the bundle via a data:
 * URL import (Node's native ESM loader handles top-level await for us),
 * then sends the SandboxResult back.
 *
 * The host (`./host.ts`) enforces the wall-clock budget by calling
 * `worker.terminate()` on overrun — there's no cooperative cancellation
 * from inside the worker. This keeps the worker code simple and means
 * even hostile snippets that try to outlast the budget get hard-killed.
 *
 * Why a data: URL import rather than `vm.runInContext`? `vm` doesn't
 * link ESM imports, so a snippet that imports `@directive-run/core`
 * fails at parse time. Data URL imports go through Node's real ESM
 * loader, which DOES link external imports — `@directive-run/core` is
 * already installed in the parent's node_modules, so the worker finds
 * it via standard resolution. The cost: data URL imports happen
 * exactly once per worker (which is what we want — one-shot execution).
 */

import { performance } from "node:perf_hooks";
import { parentPort } from "node:worker_threads";
import { installFetchWrapper } from "./fetch-wrapper.js";
import { sanitizeStack } from "./sanitize-stack.js";
import type {
  SandboxResult,
  WorkerInputMessage,
  WorkerOutputMessage,
} from "./types.js";

if (!parentPort) {
  throw new Error(
    "@directive-run/sandbox/worker must be loaded via worker_threads",
  );
}

// Install the SSRF fetch wrapper BEFORE the bundle is imported so
// @directive-run/query's / @directive-run/ai's internal fetch calls
// (which the validator can't see because they live in external module
// bodies) hit the loopback / private-IP / IMDS blocklist.
installFetchWrapper();

const port = parentPort;

/**
 * Format a single console.log argument. Directive's `system.facts` is
 * a Proxy over a `FactsStore`; the audit found that
 * `JSON.stringify(system.facts)` produces `"{}"` (or store internals)
 * because the proxy has no `toJSON`. So `console.log("[start] facts:",
 * system.facts)` rendered as `[start] facts: {}` in the transcript
 * while `result.facts` correctly showed the snapshot — two
 * contradictory views in the same response.
 *
 * Fix: detect Directive's facts/derive proxies via the `$store` or
 * `$snapshot` escape hatches the proxy DOES expose, snapshot via the
 * store's `toObject()` (the same call result.facts uses), and JSON-
 * stringify the snapshot. Falls back to JSON.stringify for any value
 * that doesn't look like a Directive proxy.
 */
function serializeArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg === null || arg === undefined) {
    return String(arg);
  }
  // Directive facts/derive proxy fingerprints. `.$store` is the
  // internal FactsStore; `.$snapshot` is the alternate accessor.
  // Either returns a plain object when called.
  if (typeof arg === "object") {
    const obj = arg as {
      $store?: { toObject?: () => Record<string, unknown> };
      $snapshot?: () => Record<string, unknown>;
    };
    if (obj.$store && typeof obj.$store.toObject === "function") {
      try {
        return JSON.stringify(obj.$store.toObject());
      } catch {
        // fall through
      }
    }
    if (typeof obj.$snapshot === "function") {
      try {
        return JSON.stringify(obj.$snapshot());
      } catch {
        // fall through
      }
    }
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Replace console.{log,info,warn,error,debug} with capture functions
 * that push to a shared buffer. The original references are restored
 * in `finally` so this doesn't leak across hot-reloads in tests.
 */
function captureConsole(
  buffer: string[],
  prefix: { log: string; warn: string; error: string },
): () => void {
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const format = (label: string, args: unknown[]) => {
    const text = args.map((a) => serializeArg(a)).join(" ");
    buffer.push(label ? `${label} ${text}` : text);
  };
  console.log = (...a: unknown[]) => format(prefix.log, a);
  console.info = (...a: unknown[]) => format(prefix.log, a);
  console.warn = (...a: unknown[]) => format(prefix.warn, a);
  console.error = (...a: unknown[]) => format(prefix.error, a);
  console.debug = (...a: unknown[]) => format(prefix.log, a);

  return () => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    console.debug = originals.debug;
  };
}

/**
 * Look for a system on globalThis the snippet attached. The runner
 * scaffold emits `const system = createSystem({...}); system.start();`
 * at top level, but inside an ESM module those bindings are scoped to
 * the module's own scope — we can't read them from the worker.
 *
 * Workaround: the worker patches `createSystem` to also stash the
 * returned system on `globalThis.__directiveSandbox_system__`. After
 * the bundle finishes, we read facts from there.
 *
 * This monkey-patch happens via a tiny ESM module we prepend to the
 * bundle before evaluation (see `wrapForExecution`).
 */
interface SandboxSystem {
  facts: { $store: { toObject(): Record<string, unknown> } };
  derive: Record<string, unknown>;
  destroy(): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __directiveSandbox_system__: SandboxSystem | null;
}

async function runOne(message: WorkerInputMessage): Promise<SandboxResult> {
  const logs: string[] = [];
  const errors: string[] = [];
  const restoreConsole = captureConsole(logs, {
    log: "[log]",
    warn: "[warn]",
    error: "[error]",
  });
  globalThis.__directiveSandbox_system__ = null;
  const startMs = performance.now();
  try {
    // Import the bundle via file:// URL. Node's ESM loader resolves
    // `@directive-run/core` against node_modules relative to the
    // file path's anchor. The bundler appends a trailing assignment
    // to the entry module that lifts the runner's `system` binding
    // onto `globalThis.__directiveSandbox_system__` so we can read
    // it from here after execution.
    await import(message.bundlePath);
  } catch (err) {
    const e = err as Error & { code?: string; cause?: unknown };
    const parts = [e.message ?? String(err)];
    if (e.code) {
      parts.push(`[code: ${e.code}]`);
    }
    if (e.stack) {
      parts.push(sanitizeStack(e.stack));
    }
    if (e.cause) {
      const cause = e.cause as Error;
      parts.push(`Cause: ${cause.message ?? String(cause)}`);
      if (cause.stack) {
        parts.push(sanitizeStack(cause.stack));
      }
    }
    errors.push(parts.join("\n"));
  } finally {
    restoreConsole();
  }
  const durationMs = performance.now() - startMs;

  let facts: Record<string, unknown> = {};
  const derived: Record<string, unknown> = {};
  // Cast through unknown because TS narrows `globalThis.X` to `null`
  // after the earlier assignment, even though the bundle's epilogue
  // may have populated it before we read here.
  const system = globalThis.__directiveSandbox_system__ as SandboxSystem | null;
  if (system) {
    try {
      facts = system.facts.$store.toObject();
    } catch (err) {
      errors.push(
        `facts snapshot failed: ${(err as Error).message}\n${sanitizeStack((err as Error).stack)}`,
      );
    }
    // Snapshot derivations. The host pre-extracts the key names from
    // the source files (system.derive's proxy has no ownKeys trap) and
    // passes them via message.derivationKeys; we read each via
    // `system.derive[key]`, swallowing per-key errors so one bad
    // derivation doesn't kill the whole snapshot.
    if (message.derivationKeys.length > 0 && system.derive) {
      for (const key of message.derivationKeys) {
        try {
          const value = (system.derive as Record<string, unknown>)[key];
          if (value !== undefined) {
            derived[key] = value;
          }
        } catch (err) {
          errors.push(
            `derivation "${key}" snapshot failed: ${(err as Error).message}`,
          );
        }
      }
    }
    try {
      system.destroy();
    } catch {
      // best-effort
    }
    globalThis.__directiveSandbox_system__ = null;
  }

  return {
    logs,
    facts,
    derived,
    errors,
    durationMs,
    timedOut: false,
  };
}

port.once("message", async (msg: WorkerInputMessage) => {
  try {
    const result = await runOne(msg);
    const out: WorkerOutputMessage = { ok: true, result };
    port.postMessage(out);
  } catch (err) {
    const out: WorkerOutputMessage = {
      ok: false,
      error:
        sanitizeStack((err as Error).stack) ||
        (err as Error).message ||
        String(err),
    };
    port.postMessage(out);
  }
});
