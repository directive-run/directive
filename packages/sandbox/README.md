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

1. **AST allowlist validator** (`ts-morph`). Rejects imports outside `@directive-run/{core,ai,query}` or relative `./*.js`; rejects identifier references to FS / network / eval surfaces (`process`, `require`, `fetch`, `fs`, `child_process`, `eval`, `new Function`, `setTimeout`, etc.).
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

## See also

- [`@directive-run/mcp`](../mcp) — wraps `runInSandbox` as the `run_in_sandbox` MCP tool, returns the transcript to the AI client alongside a `playgroundUrl`.
- [`@directive-run/scaffold`](../scaffold) — `generateRunner` produces the canonical runner shape this sandbox expects to execute (`createSystem` → `start()` → dispatch → `settle()` → log).
