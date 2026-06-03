/**
 * Worker-thread entry for ts-morph parsing + rule evaluation. Spawned
 * by `@directive-run/mcp`'s `review_source` and `fix_code` tools so
 * the main MCP server can `worker.terminate()` after a 5s budget —
 * synchronous ts-morph parsing cannot be aborted via `setTimeout` on
 * the main thread.
 *
 * Protocol over `parentPort`:
 *
 *   in:  { kind: "run", source, options? } | { kind: "fix", source, finding }
 *   out: { ok: true, result } | { ok: false, error }
 *
 * The worker exits naturally after one message; the host spawns a
 * fresh worker per call. This keeps memory predictable and isolates
 * parse-bomb impact.
 *
 * v0.1.0 skeleton handles the protocol; the actual `runRules` and
 * `applyFix` come from the package's public API surface so the
 * worker stays a thin wrapper.
 */

import { parentPort } from "node:worker_threads";
import { applyFix, runRules } from "./index.js";
import type { Finding, RunOptions } from "./types.js";

type RunMessage = { kind: "run"; source: string; options?: RunOptions };
type FixMessage = { kind: "fix"; source: string; finding: Finding };
type IncomingMessage = RunMessage | FixMessage;

if (!parentPort) {
  throw new Error(
    "@directive-run/lint/worker must be loaded via worker_threads",
  );
}

const port = parentPort;

port.once("message", async (msg: IncomingMessage) => {
  try {
    if (msg.kind === "run") {
      const result = await runRules(msg.source, msg.options);
      port.postMessage({ ok: true, result });
      return;
    }
    if (msg.kind === "fix") {
      const result = await applyFix(msg.source, msg.finding);
      port.postMessage({ ok: true, result });
      return;
    }
    port.postMessage({
      ok: false,
      error: `unknown message kind: ${(msg as { kind: string }).kind}`,
    });
  } catch (err) {
    port.postMessage({ ok: false, error: (err as Error).message });
  } finally {
    port.close();
  }
});
