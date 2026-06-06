# @directive-run/sandbox

## 0.1.0

### Minor Changes

- [`4d9ac56`](https://github.com/directive-run/directive/commit/4d9ac568672c898d95da3ac32d7625c9d84cf178) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Ship `run_in_sandbox` — the Innovation lens's "MCP tools return observed behavior, not just code" pick from the v0.4.0 plan's deferred backlog. The 22nd MCP tool executes a Directive snippet server-side and returns a structured transcript (`logs`, `facts`, `errors`, `durationMs`, `timedOut`, `playgroundUrl`) the LLM can hand the user alongside any generated code.

  - **NEW `@directive-run/sandbox@0.1.0`** — focused package providing `runInSandbox({source | files, timeoutMs})`. Three-layer defense: an AST allowlist validator (ts-morph) rejects imports outside `@directive-run/{core,ai,query}` and identifier references to FS / network / eval surfaces (`process`, `require`, `fetch`, `fs`, `child_process`, `eval`, `new Function`, etc.); an esbuild bundler virtualizes the multi-file payload into a single ESM string; a `worker_threads.Worker` with `resourceLimits` (32 MB heap, 16 MB code) executes the bundle with a clamped wall-clock budget ([100ms, 10s], default 5s). Console output is captured to a buffer, `system.facts` is serialized via `$store.toObject()`, and the bundler injects an early-capture immediately after `createSystem(...)` so the post-mortem snapshot survives mid-runner errors (a validation throw inside `await system.settle()` still hands you the init-state facts).
  - **`@directive-run/mcp@0.5.0`** — `run_in_sandbox` tool registered alongside `playground_link`. Same input shapes (`source: string` for already-runnable code, `files: [{path, source}]` for paired output from `generate_module`); response payload includes a `playgroundUrl` built via `buildPlaygroundLink` so the LLM can give the user BOTH the transcript AND a click-through to edit the same snippet in StackBlitz. Tool count 21 → 22.
  - The docs site's `/playground` DevTools panel switches from static-structure parsing (v0.4.0) to a live transcript view powered by an internal `/api/run-sandbox` Next.js route that wraps `runInSandbox`. The Run snippet button hits the route, swaps the panel into "live transcript" mode (Facts / Logs / Events / Constraints / Resolvers tabs), and surfaces runner errors as a persistent banner.

  Sandbox boundary documented in detail in `packages/sandbox/src/validator.ts`. Allowlist is strict by default — we expand based on real failures rather than ship a "mostly safe" surface.
