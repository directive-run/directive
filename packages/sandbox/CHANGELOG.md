# @directive-run/sandbox

## 0.3.2

### Patch Changes

- [`84117e8`](https://github.com/directive-run/directive/commit/84117e8203be19263da563ca2b3d9ea4ac4670d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Include the full stack trace, error `code`, and `cause` chain in `SandboxResult.errors` when the user's bundle throws during dynamic import. Previously only `err.message` was captured, which stripped the frame-by-frame location and made debugging crashes inside framework code (e.g. `createSystem`-time null derefs) impossible from the transcript alone. Facts-snapshot failures also now include their stack. No API change; only the strings inside `errors[]` get richer.

- Updated dependencies [[`08d84df`](https://github.com/directive-run/directive/commit/08d84dfe4ac558d2dd9013407e6b12a60ec6cfac), [`2109c31`](https://github.com/directive-run/directive/commit/2109c31b407dda9dbac5c587af745cb67f8b898e), [`ac879b5`](https://github.com/directive-run/directive/commit/ac879b5bbab111b27075da088826410064961b04), [`18c9a46`](https://github.com/directive-run/directive/commit/18c9a4651cdffc607ad4e570af1d4415470bd5a9), [`099490d`](https://github.com/directive-run/directive/commit/099490dc9cb20d85369a69933ab26ef561822585), [`f9a2181`](https://github.com/directive-run/directive/commit/f9a2181838c89585dc44b2b961df6d290b4b6dc2), [`38d950a`](https://github.com/directive-run/directive/commit/38d950af9f02d2281f3b7b08285a3685e8afb2c0)]:
  - @directive-run/core@1.18.0

## 0.3.1

### Patch Changes

- [`039f8c0`](https://github.com/directive-run/directive/commit/039f8c0d2138ac483f4e40b46a8882552a94a8f4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Resolve the worker entry via a static `new URL("./worker.js", import.meta.url)` reference before falling back to `createRequire().resolve()`. Bundlers (Next.js `outputFileTracing`, esbuild, webpack) follow static URL references at build time and now include `worker.js` in the output bundle automatically — fixing "Cannot find module worker.js" 500s on Vercel, AWS Lambda, and Cloud Run without any consumer-side config. The fallback path preserves Vitest dev-mode resolution where `import.meta.url` points at the `.ts` source.

## 0.3.0

### Minor Changes

- [`4237df7`](https://github.com/directive-run/directive/commit/4237df771965e29f7f4eec3005d35811cc6d0fbc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Close the remaining 4 P0s from the Phase A AE audit (`docs/AE-AUDIT-SANDBOX.md`). With the v0.3.0 property-access bypass already closed, this release lands the SSRF defense, Vercel-compatible temp-file location, facts-proxy console serialization, and derivations in the snapshot.

  - **P0-A1 — Temp-file location works on Vercel read-only FS.** Bundle now writes to `os.tmpdir()` (with a fallback to the package dir if `/tmp` is somehow unwritable). Bundler rewrites `@directive-run/*` imports to absolute `file://` URLs via `createRequire(...).resolve()` so the worker doesn't need a `node_modules` chain above the temp file. Unblocks `directive.run/api/run-sandbox` and any other deploy target with a read-only filesystem outside `/tmp`.
  - **P0-S2 — SSRF wrapper.** New `installFetchWrapper()` patches `globalThis.fetch` in the worker BEFORE the user's bundle imports anything. Rejects loopback (127.0.0.0/8, `::1`, `localhost`), link-local (169.254.0.0/16 — includes AWS/GCP/Azure IMDS at `.169.254`), RFC-1918 private (10/8, 172.16-31/12, 192.168/16), multicast / reserved, IPv4-mapped IPv6 in literal or hex form (`::ffff:a9fe:a9fe`), and non-HTTP(S) protocols. Catches `@directive-run/query`'s internal fetch calls — the validator never saw them because they live in external module bodies.
  - **P0-DM1 — `console.log(system.facts)` no longer renders `{}`.** Worker's `captureConsole` now detects Directive's facts proxy via the `$store.toObject()` and `$snapshot()` escape hatches, serializes via the snapshot, falls back to `JSON.stringify` for non-Directive values. Pre-fix, `console.log("[start] facts:", system.facts)` rendered as `[start] facts: {}` because `JSON.stringify` on the FactsStore proxy returned `"{}"` while `result.facts` correctly held the snapshot — two contradictory views in the same response.
  - **P0-DM2 — Derivations in `SandboxResult.derived`.** Host pre-extracts derivation key names from source files via a brace/paren-balanced scanner that handles both multi-line and compact `derive: { isPositive: ... }` forms. Worker iterates `system.derive[key]` after settle for each key. Modules whose primary product is a derivation (`status`, `isReady`, `total`, etc.) now surface the computed value alongside facts.

  New unit suites at `__tests__/fetch-wrapper.test.ts` (18 cases — protocols, IPv4 ranges, IPv6 ranges, localhost variants) and `__tests__/key-extractor.test.ts` (8 cases — multi-line, single-line, multi-file dedupe, quoted-key tolerance). Extended `__tests__/run-in-sandbox.test.ts` with end-to-end derivation + facts-proxy verification.

  **Remaining P0:** P0-S3 (Origin allowlist + per-IP rate limit on `/api/run-sandbox`) lives in the `directive-docs` repo; that commit ships alongside this release.

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
