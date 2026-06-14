# @directive-run/sandbox

Execute Directive snippets server-side and return a structured transcript (logs, facts, errors). Used by [`@directive-run/mcp`](../mcp)'s `run_in_sandbox` tool and by `directive.run/playground`'s live DevTools panel.

## What it does

Takes a TypeScript snippet (single source string OR a paired library + runner `files: [{path, source}]` array — same shape `playground_link` accepts), validates it against an AST allowlist, bundles the multi-file payload via esbuild, and executes the result in a bounded `worker_threads` sandbox. Returns:

```ts
interface SandboxResult {
  logs: string[];                       // captured console.log/warn/error lines
  facts: Record<string, unknown>;       // system.facts.$store.toObject() snapshot
  errors: string[];                     // structured error messages
  durationMs: number;
  timedOut: boolean;
}
```

The bundler injects an early-capture immediately after `createSystem(...)`, so the post-mortem snapshot survives mid-runner errors — a validation throw inside `await system.settle()` still hands you the init-state facts.

## Sandbox boundary

Three layers:

1. **AST allowlist validator** (`ts-morph`). Imports are restricted to a curated `@directive-run/*` set + relative `./*.js`:
   - **Allowed:** `core`, `ai`, `query`, `react`, `vue`, `svelte`, `solid`, `lit`, `el`, `optimistic`, `timeline`, `mutator`, `knowledge`, `scaffold`, `claude-plugin`, `lint`, `sources` (17 packages — anything an end-user demo realistically composes from; the canonical, drift-proof list is `ALLOWED_DIRECTIVE_PACKAGES` in `src/validator.ts`).
   - **Denied:** `cli`, `mcp`, `sandbox`, `vite-plugin-api-proxy` (build / CLI / sandbox-meta tooling — no legitimate use inside a sandboxed demo).
   - Everything else (`node:fs`, `express`, `@sizls/*`, etc.) is rejected.
   - **Identifier references** to FS / network / eval surfaces (`process`, `require`, `fetch`, `fs`, `child_process`, `eval`, `new Function`, `setTimeout`, `Buffer`, etc.) are rejected as free identifiers.
   - **Property-access bypass chains** are rejected (v0.3.0): `globalThis.process`, `globalThis.fetch`, `globalThis["X"]` bracket access with string literal, `.constructor` access on any value, `Function(...)` call without `new`, `Reflect.get/has/getOwnPropertyDescriptor(globalThis, "X")` smuggle chains. The [June 2026 security audit](../../docs/security/sandbox-audit-2026-06.md) traces these PoCs and how v0.3.0 closes them.
2. **esbuild bundler**. Virtualizes the multi-file payload into a single ESM string with `@directive-run/*` externalized. Throws on imports that can't be resolved against the in-memory file map.
3. **`worker_threads.Worker`** with `resourceLimits` (32 MB heap, 16 MB code) and a clamped wall-clock budget (`[100ms, 10s]`, default 5s). The worker is hard-terminated on timeout — no cooperative cancellation needed.

Resource limits are heap-only — workers share the parent process's FS / network access. The allowlist validator is what actually prevents sandbox escape; the worker layer adds OOM / runaway-CPU bounding on top.

## API

```ts
import { runInSandbox } from "@directive-run/sandbox";

const result = await runInSandbox({
  files: [
    { path: "src/counter.ts", source: moduleSource },
    { path: "src/main.ts", source: runnerSource },
  ],
  timeoutMs: 5000,
});

console.log(result.logs);   // ["[start] count= 0", "[settled] count= 2"]
console.log(result.facts);  // { count: 2 }
```

The single-source shortcut `runInSandbox({ source: "..." })` maps onto `src/main.ts` internally — convenient for already-runnable snippets from `get_example` / `fix_code`.

### Cancellation

`runInSandbox` accepts an optional `AbortSignal`. Wire it to your HTTP request's signal (Next.js, Express, and Hono all expose one) so a client that disconnects mid-flight releases its worker slot immediately. Without this, an abandoned caller still occupies the per-process worker queue until the worker times out (up to 10s) — under sustained load that drives the pool to deadlock.

```ts
// Next.js App Router — `request.signal` fires on client disconnect.
export async function POST(request: Request) {
  const result = await runInSandbox({
    source,
    signal: request.signal,
  });
  return Response.json(result);
}
```

The signal aborts the queue-wait phase AND the running worker — the slot frees the moment the signal trips, not when the wall-clock budget expires.

### Operator knobs

`setMaxConcurrentWorkers(n)` caps the per-process worker pool. Each worker reserves ~32 MB of heap + a thread; without a cap, a burst from many distinct IPs (each within any per-IP rate limit) can each spawn their own worker and OOM the host. Calls beyond the cap queue FIFO; abandoned callers (signal-aborted or dropped promises) deregister cleanly. Defaults to `navigator.hardwareConcurrency` (falls back to 4); pass `Infinity` to disable.

```ts
import { setMaxConcurrentWorkers } from "@directive-run/sandbox";
// At module init — runs once per cold start.
setMaxConcurrentWorkers(8);
```

`sanitizeStack(stack)` strips host filesystem paths from a stack trace string. The worker uses it internally before reporting errors back; consumers building custom error-routing (Sentry pipelines, audit-log middleware, structured-log adapters) can use the same helper so their own logs don't re-leak `/Users/`, `/home/`, `/app/`, `/var/task/`, Windows drive paths, or UNC paths.

```ts
import { sanitizeStack } from "@directive-run/sandbox";
logger.error({ msg: "sandbox failed", err: sanitizeStack(err.stack) });
```

## See also

- [`@directive-run/mcp`](../mcp) — wraps `runInSandbox` as the `run_in_sandbox` MCP tool, returns the transcript to the AI client alongside a `playgroundUrl`.
- [`@directive-run/scaffold`](../scaffold) — `generateRunner` produces the canonical runner shape this sandbox expects to execute (`createSystem` → `start()` → dispatch → `settle()` → log).
