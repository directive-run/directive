---
"@directive-run/sandbox": minor
"@directive-run/mcp": patch
---

**Security hotfix.** Closes critical AST property-access bypass in `@directive-run/sandbox@0.1.0` and `@0.2.0` where `globalThis.process.exit()`, `Reflect.get(globalThis, "process")`, and `({}).constructor.constructor("return process")()` all bypassed the validator. The original "skip identifiers in property-access position" rule (added to avoid `{module: x}` false-positives) was a total bypass — `process` was a property name and got skipped. v0.3.0 closes this with a dedicated `checkPropertyAccessEscapes` pass.

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
