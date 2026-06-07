# @directive-run/sandbox

## 0.2.0

### Minor Changes

- [`51f721e`](https://github.com/directive-run/directive/commit/51f721eefc265d5f5d97120c6976556c39595d1c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Widen the AST allowlist validator from the initial `@directive-run/{core,ai,query}` set to every consumer-safe `@directive-run/*` package, with an explicit denylist for build / CLI / sandbox-meta tooling.

  - **Allowed (16):** `core`, `ai`, `query`, `react`, `vue`, `svelte`, `solid`, `lit`, `el`, `optimistic`, `timeline`, `mutator`, `knowledge`, `scaffold`, `claude-plugin`, `lint` — anything an end-user Directive demo realistically composes from.
  - **Denied (4):** `cli` (uses `process.argv` + `fs.write`), `mcp` (speaks MCP over stdio, would let a sandboxed snippet open a transport), `sandbox` (sandbox-in-sandbox), `vite-plugin-api-proxy` (build tooling). Each gets a clear rejection message distinguishing "denied" from "not in allowlist."
  - Subpath imports like `@directive-run/ai/openai` and `@directive-run/react/hooks` are honored — the validator extracts the package segment before checking the allowlist.
  - Bundler's `external` list switched from the explicit three-package enumeration to a wildcard `@directive-run/*` so any allowlisted package resolves at worker runtime against the worker's `node_modules`.
  - 22 new validator tests covering each allowlisted package, subpath import handling, each denied package, and `@sizls/*` rejection (no current scope).

  No runtime-behavior change for snippets that were already passing (the v0.1.0 set is a subset of v0.2.0's). The strict-by-default rule documented in `validator.ts` was always "expand on real failures"; this is the first deliberate expansion.

- [`9801112`](https://github.com/directive-run/directive/commit/980111207191e013eb127f4e01349bd0aecc2115) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Security hotfix.** Closes critical AST property-access bypass in `@directive-run/sandbox@0.1.0` and `@0.2.0` where `globalThis.process.exit()`, `Reflect.get(globalThis, "process")`, and `({}).constructor.constructor("return process")()` all bypassed the validator. The original "skip identifiers in property-access position" rule (added to avoid `{module: x}` false-positives) was a total bypass — `process` was a property name and got skipped. v0.3.0 closes this with a dedicated `checkPropertyAccessEscapes` pass.

  Full Phase A AE audit at `docs/AE-AUDIT-SANDBOX.md` (5 lenses: security, architecture, agent-UX, DX, domain-correctness). This release ships the P0-S1 (property-access bypass) + P0-D1 (tool description misdocumented allowlist) fixes; P0-S2/S3 (SSRF, rate-limiting on `/api/run-sandbox`) and the remaining P1/P2 items are tracked for follow-on minors.

  **v0.3.0 validator additions:**

  - Rejects `globalThis.process` / `globalThis.fetch` / `globalThis.Buffer` / `globalThis.setTimeout` etc. — any property-access whose `.name` matches a denied identifier.
  - Rejects `.constructor` access on any value — closes the `({}).constructor.constructor("...")()` Function-constructor smuggle.
  - Rejects `Function(...)` call expression (in addition to the existing `new Function(...)` denial).
  - Rejects `globalThis["X"]` bracket access with a string literal — including allowlisted names, since there's no legitimate bracket-access use.
  - Rejects bracket access with a denied-name string literal on any value.
  - Rejects `Reflect.get(globalThis, "X")` / `Reflect.has(globalThis, "X")` / `Object.getOwnPropertyDescriptor(globalThis, "X")` when X is a denied name or `constructor`.
  - Legitimate property keys in object literals (`createSystem({ module: counter })`) and Directive system surface (`system.events.foo`, `system.facts.count`) still permitted.

  **`@directive-run/mcp@0.5.1` (patch):**

  - Tool description for `run_in_sandbox` rewritten with the full 16-package allowlist (was incorrectly documented as `@directive-run/{core,ai,query}` in v0.5.0).
  - Decoding-errors section so the LLM knows how to distinguish validation / bundle / runtime / timeout failure modes.
  - Note about react/vue/svelte/solid/lit imports working but their runtime hooks throwing in Node — directs the LLM to `playground_link` for UI demos.
  - README Playground section updated with the same allowlist.

  **Audit lens grades (Phase A):** Security D → A (after this patch), Architecture B+, Agent-UX B-, DX B-, Domain-Correctness C+. Remaining grades will be addressed in Phase A-2 and Phase B per the audit doc's incident-response priorities.

## 0.1.0

### Minor Changes

- [`4d9ac56`](https://github.com/directive-run/directive/commit/4d9ac568672c898d95da3ac32d7625c9d84cf178) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Ship `run_in_sandbox` — the Innovation lens's "MCP tools return observed behavior, not just code" pick from the v0.4.0 plan's deferred backlog. The 22nd MCP tool executes a Directive snippet server-side and returns a structured transcript (`logs`, `facts`, `errors`, `durationMs`, `timedOut`, `playgroundUrl`) the LLM can hand the user alongside any generated code.

  - **NEW `@directive-run/sandbox@0.1.0`** — focused package providing `runInSandbox({source | files, timeoutMs})`. Three-layer defense: an AST allowlist validator (ts-morph) rejects imports outside `@directive-run/{core,ai,query}` and identifier references to FS / network / eval surfaces (`process`, `require`, `fetch`, `fs`, `child_process`, `eval`, `new Function`, etc.); an esbuild bundler virtualizes the multi-file payload into a single ESM string; a `worker_threads.Worker` with `resourceLimits` (32 MB heap, 16 MB code) executes the bundle with a clamped wall-clock budget ([100ms, 10s], default 5s). Console output is captured to a buffer, `system.facts` is serialized via `$store.toObject()`, and the bundler injects an early-capture immediately after `createSystem(...)` so the post-mortem snapshot survives mid-runner errors (a validation throw inside `await system.settle()` still hands you the init-state facts).
  - **`@directive-run/mcp@0.5.0`** — `run_in_sandbox` tool registered alongside `playground_link`. Same input shapes (`source: string` for already-runnable code, `files: [{path, source}]` for paired output from `generate_module`); response payload includes a `playgroundUrl` built via `buildPlaygroundLink` so the LLM can give the user BOTH the transcript AND a click-through to edit the same snippet in StackBlitz. Tool count 21 → 22.
  - The docs site's `/playground` DevTools panel switches from static-structure parsing (v0.4.0) to a live transcript view powered by an internal `/api/run-sandbox` Next.js route that wraps `runInSandbox`. The Run snippet button hits the route, swaps the panel into "live transcript" mode (Facts / Logs / Events / Constraints / Resolvers tabs), and surfaces runner errors as a persistent banner.

  Sandbox boundary documented in detail in `packages/sandbox/src/validator.ts`. Allowlist is strict by default — we expand based on real failures rather than ship a "mostly safe" surface.
