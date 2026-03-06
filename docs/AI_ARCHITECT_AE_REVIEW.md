# AI Architect — AE Review (Post-Implementation)

**Date:** 2026-03-06
**Package:** `@directive-run/architect`
**Reviewers:** 6 perspectives (UX, Product, Architecture, Security/QA, DX, Innovation)
**Scope:** All 8 source files, 6 test files, 340 tests passing

---

## Verdict: Conditional Approval — Fix Critical Issues Before Release

All 6 reviewers affirm the concept is category-creating and the architecture is sound. The implementation is solid for Phase 1 with several critical security bugs that must be fixed before any public release.

---

## 1. Critical Issues (Must Fix Before Shipping)

| # | Issue | Location | Flagged By |
|---|-------|----------|------------|
| C1 | **Sandbox timeout is non-preemptive.** `setTimeout` flag only checked after `fn.apply()` returns. `while(true){}` hangs the process forever. The timeout gives a false sense of security. | `sandbox.ts:309-326` | All 6 reviewers |
| C2 | **Unicode escape bypass.** `\u0065val("alert(1)")` passes static analysis regex but `new Function()` interprets it as `eval`. Completely defeats Layer 1. | `sandbox.ts:51-88` | Quinn |
| C3 | **Computed property access bypass.** `this["con"+"structor"]["con"+"structor"]("return this")()` reaches `globalThis` through `Function.constructor`. Static analysis only checks literal words. | `sandbox.ts:51-88` | Quinn |
| C4 | **Resolver fact mutations never reach the system.** Compiled code operates on deep-cloned copy. Mutations to `scope.facts` are extracted but written to a local spread copy, not `context.system.facts`. | `tools.ts:363-395` | Riley, Nova, Taylor |
| C5 | **Stale snapshot retry has no depth limit.** `analyze()` recursively calls itself when `versionCounter > snapshotVersion + 10` with no recursion cap. Can stack-overflow or burn budget indefinitely. | `pipeline.ts:231-236` | Quinn, Charlie, Nova, Riley |
| C6 | **`remove_definition` has no capability check AND can remove non-AI definitions.** `requiredCapability: null` means read-only architects can delete definitions. No `dynamicIds.has()` guard. | `tools.ts:117-150, 398-444` | Quinn, Charlie, Nova |
| C7 | **`estimateDollars()` hardcoded at $0.003/1K tokens.** Models vary by 100x. Budget enforcement becomes meaningless. Claude Opus at $15/M vs GPT-4o-mini at $0.15/M. | `pipeline.ts:834-837` | Charlie, Nova |
| C8 | **Module-level mutable counters leak across instances.** `actionCounter` and `auditCounter` are module-scope `let` variables. Multiple architect instances share IDs. | `pipeline.ts:45`, `audit.ts:74` | Charlie, Quinn |

---

## 2. Major Issues (Should Fix Soon)

| # | Issue | Location | Flagged By |
|---|-------|----------|------------|
| M1 | **Missing Proxy traps.** No `defineProperty`, `getOwnPropertyDescriptor`, `has`, `ownKeys`. `Object.defineProperty(wrapped, '__proto__', ...)` bypasses `set` trap. | `sandbox.ts:122-164` | Quinn |
| M2 | **`toSource()` vulnerable to code injection.** Interpolates `whenCode`, `resolveCode`, `def.id` without escaping. Backticks, `${}`, or `"` in values break the output. | `pipeline.ts:664-710` | Quinn |
| M3 | **Triggers `onError`/`onUnmetRequirement`/`onFactChange` never wired.** Only `onSchedule` works. `unsubscribers` array created but never populated. | `architect.ts:101-111` | Riley, Nova, Blake |
| M4 | **`confidence: 0.8` hardcoded for all actions.** Prompt asks LLM for confidence but value is never parsed. | `pipeline.ts:312` | Charlie, Nova |
| M5 | **`risk` always `"medium"`/`"low"` based on `tool.mutates`.** Same issue as M4 — never parsed from LLM response. | `pipeline.ts:313` | Charlie, Nova |
| M6 | **`markRolledBack` breaks the hash chain.** Re-hashing entry invalidates next entry's `prevHash`. `verifyChain()` returns false after any rollback. | `audit.ts:123-143` | Quinn, Charlie |
| M7 | **`on()` overload is type-unsafe.** Casts params to `unknown` then forces through. Pipeline's `on()` correctly discriminates, so the cast is unnecessary. | `architect.ts:162-167` | Charlie |
| M8 | **`arguments.callee` not blocked.** Defense-in-depth gap. Should be in blocked patterns. | `sandbox.ts:14-35` | Quinn |
| M9 | **`Symbol` and well-known symbols not blocked.** `new Function()` inherits outer scope's `Symbol`. Enables shared symbol leaks between sandbox invocations. | `sandbox.ts:14-35` | Quinn |
| M10 | **`Date` enables timing side channels.** `Date.now()` allows timing attacks and locale/timezone leakage. | `sandbox.ts:39, 206` | Quinn |
| M11 | **`console` methods not rate-limited.** Tight-loop `console.log()` can flood stdout/stderr. | `sandbox.ts:209-214` | Quinn |
| M12 | **`JSON.parse` enables prototype pollution.** `JSON.parse('{"__proto__": ...}')` returns unwrapped object bypassing membrane. | `sandbox.ts:39, 212` | Quinn |
| M13 | **Approval trigger lost on `approve()`.** Hardcoded to `"demand"` instead of preserving original trigger. Corrupts audit trail. | `pipeline.ts:521` | Charlie, Nova |
| M14 | **`createTestArchitect` types first param as `unknown`.** Loses all type checking at call site. | `testing.ts:109-111` | Charlie |
| M15 | **No `set_fact` tool despite `facts: 'read-write'` capability.** Only mutation path is through resolver requiring a constraint. | `tools.ts` | Nova |
| M16 | **Concurrent `analyze()` calls unguarded.** No mutex preventing simultaneous LLM calls. | `pipeline.ts` | Riley |
| M17 | **`pendingCount` and `cascadeDepth` guards exist but never called.** Guards defined in `guards.ts` but not invoked in pipeline. | `guards.ts`, `pipeline.ts` | Riley |
| M18 | **Dead code: duplicate code-size check in `compileSandboxed()`.** `staticAnalysis()` already checks size. Second check can never be reached. | `sandbox.ts:262-276` | Charlie |

---

## 3. Enhancement Opportunities (Nice to Have)

| # | Enhancement | Location |
|---|-------------|----------|
| E1 | Remove `QueuedTrigger`, `CircuitBreakerState`, `GuardConfig` from public exports — internal details | `index.ts:66-69` |
| E2 | Add `vitest` to devDependencies | `package.json` |
| E3 | Tighten peer dependency ranges from `"*"` to `"^0.1.0"` | `package.json:62-63` |
| E4 | Gate BSL `console.info` behind `process.env.NODE_ENV !== 'test'` | `architect.ts:114-118` |
| E5 | Rename `resolverContext` to `context` per naming convention | `tools.ts:375-376` |
| E6 | Fix blank line before return conventions | Various |
| E7 | Add `"arguments"`, `"Proxy"`, `"Reflect"`, `"Symbol"`, `"Atomics"`, `"SharedArrayBuffer"`, `"Worker"`, `"Blob"`, `"URL"`, `"crypto"`, `"navigator"`, `"location"`, `"document"`, `"alert"`, `"async"`, `"await"` to `DEFAULT_BLOCKED_PATTERNS` | `sandbox.ts:14-35` |
| E8 | Wrap `JSON` in a membrane before providing to sandbox | `sandbox.ts:212` |
| E9 | Validate `allowedGlobals` against hardcoded allowlist | `sandbox.ts:204-217` |
| E10 | Rate-limit sandboxed `console` (max 100 calls per execution) | `sandbox.ts:209-214` |
| E11 | Sanitize error messages in `tools.ts` (currently leak raw stacks via `String(err)`) | `tools.ts:247-260` |
| E12 | FNV-1a is 32-bit only — file header claims SHA-256 but implementation uses FNV-1a | `audit.ts:31-41` |
| E13 | `extractSection()` regex fails on multiline/escaped LLM output | `pipeline.ts:351-361` |
| E14 | Clean up circuit breaker half-open timer in `destroy()` | `guards.ts` |
| E15 | `actions` Map grows unbounded (no eviction) | `pipeline.ts` |
| E16 | Asymmetry: can remove effects/derivations but not create them (Phase 1 exclusion but confusing) | `tools.ts` |

---

## 4. Innovation Ideas (10x Improvements for Roadmap)

### Tier 1: High Impact, Moderate Effort

1. **Constraint Discovery Mode** — Observe-only mode watches system for N minutes, identifies patterns (recurring errors, unmet requirements), produces a report of recommended constraints with `toSource()` output. "AI pair programmer for system design." Effort: ~1 week.

2. **"What-If" Analysis** — Before applying an AI-proposed action, simulate its effect on a forked copy of the system state using time-travel debugging. Show "here's how your system would behave over 100 reconciliation cycles." Effort: 2-3 weeks.

3. **Visual Constraint Graph** — Web dashboard / VS Code extension rendering live constraint/resolver/derivation graph with AI-created nodes highlighted. Click node for audit history + `toSource()`. Effort: 2-3 weeks.

### Tier 2: Strategic, Larger Effort

4. **Architect Replay** — Record system fact timeline, replay with different architect config. Turns architect into a design tool. Effort: 1-2 weeks.

5. **Cross-system Architect Federation** — In microservices, share anonymized constraint patterns across systems. "System A learned retry-with-backoff works for payment failures; System B has similar failures." Network effect play. Effort: Phase 2+.

6. **Architect-as-a-Service** — Hosted version with persistent audit (Postgres), Slack/email approvals, multi-architect coordination, dashboard, analytics. Monetization path. Effort: 3-6 months for SaaS MVP.

### Competitive Differentiation

No existing framework (LangGraph, CrewAI, AutoGen, OpenAI Swarm, Claude MCP) offers the combination of:
- Constraint-driven runtime introspection
- Sandboxed code generation with defense-in-depth
- Hash-chained audit trail
- Human-in-the-loop approval workflow
- `toSource()` code export

Each exists in isolation elsewhere. The combination is unique.

---

## 5. Action Items with Priority

### P0 — Must Fix Before Any Release

| # | Action | Effort | Source |
|---|--------|--------|--------|
| 1 | **Block `while`/`for` in static analysis** (move from WARN to BLOCKED) OR document timeout limitation honestly. Long-term: Web Worker with `terminate()`. | 30 min (quick) / 2 hrs (Worker) | C1 |
| 2 | **Add unicode escape normalization** before static analysis. Run checks on both original and normalized code. | 30 min | C2 |
| 3 | **Add recursion depth limit** to stale-state `analyze()`. `maxRetries = 3`, then throw "System too volatile." | 15 min | C5 |
| 4 | **Gate `remove_definition`** behind capability check + restrict to `dynamicIds.has(key)` only. | 15 min | C6 |
| 5 | **Fix resolver fact mutations** to actually write back to `context.system.facts`. | 30 min | C4 |
| 6 | **Add missing Proxy traps**: `defineProperty` (return false), `getOwnPropertyDescriptor` (block BLOCKED_PROPS), `has` (block BLOCKED_PROPS), `ownKeys`. | 30 min | M1 |
| 7 | **Move counters into closures.** `actionCounter` local to `createPipeline()`, `auditCounter` local to `createAuditLog()`. | 15 min | C8 |

### P1 — Should Fix Before Public Launch

| # | Action | Effort | Source |
|---|--------|--------|--------|
| 8 | **Make dollar estimation configurable.** Add `costPerThousandTokens` to `ArchitectBudget`, default `0.003`. | 20 min | C7 |
| 9 | **Wire `onError`/`onUnmetRequirement`/`onFactChange` triggers** using `system.on()` and `system.watch()`. | 2-3 hrs | M3 |
| 10 | **Parse confidence/risk from LLM output.** Add extraction in `parseToolCalls()`, fall back to current defaults. | 1 hr | M4, M5 |
| 11 | **Fix hash chain after rollback.** Append "rollback" entry referencing original ID instead of mutating frozen entry. | 1 hr | M6 |
| 12 | **Fix `on()` type forwarding.** Use proper overload discrimination instead of `unknown` casts. | 15 min | M7 |
| 13 | **Fix approval trigger attribution.** Store original trigger on `ArchitectAction`, pass to `applyAction()`. | 15 min | M13 |
| 14 | **Sanitize `toSource()` output.** Validate IDs match `/^[a-zA-Z_][a-zA-Z0-9_-]*$/`, escape code strings. | 30 min | M2 |
| 15 | **Invoke `pendingCount` and `cascadeDepth` guards** in pipeline where they belong. | 30 min | M17 |
| 16 | **Add concurrent analysis mutex.** Prevent simultaneous `analyze()` calls from conflicting. | 30 min | M16 |

### P2 — Nice to Have

| # | Action | Effort | Source |
|---|--------|--------|--------|
| 17 | Expand `DEFAULT_BLOCKED_PATTERNS` with `arguments`, `Proxy`, `Reflect`, `Symbol`, `async`, `await`, etc. | 10 min | E7 |
| 18 | Clean up public exports (remove internal types). | 5 min | E1 |
| 19 | Gate BSL notice behind `NODE_ENV !== 'test'`. | 5 min | E4 |
| 20 | Add `set_fact` tool for `facts: 'read-write'` capability. | 1-2 hrs | M15 |
| 21 | Wrap `JSON` in membrane before providing to sandbox. | 30 min | E8 |
| 22 | Rate-limit sandboxed `console` (max 100 calls). | 15 min | E10 |
| 23 | Fix `extractSection()` regex with JSON.parse fallback. | 20 min | E13 |
| 24 | Remove dead duplicate code-size check. | 5 min | M18 |
| 25 | Type `createTestArchitect` first param as `System`. | 5 min | M14 |
| 26 | Tighten peer deps, add vitest to devDeps, rename `resolverContext`. | 10 min | E2, E3, E5 |

---

## Strengths Highlighted Across All Reviews

- **Category-creating concept.** No competitor gives an LLM architectural control over a live runtime engine.
- **Defense-in-depth sandbox architecture.** Six layers exceed anything in the AI agent framework space.
- **Progressive engagement (3 tiers).** Zero-risk observe-only entry point solves adoption friction.
- **`toSource()` bridges AI experiments to production code.** Unique "AI suggests, human commits" workflow.
- **Required budget field prevents bill shock.** Combined with graduated alerts, more financially responsible than any competitor.
- **Kill switch is synchronous, atomic, correct.** The red button enterprises require.
- **Hash-chained audit log is enterprise-compelling.** Tamper-evident history for SOC2 reviewers.
- **API surface follows established project patterns.** `createAIArchitect()` mirrors `createModule`/`createSystem`.
- **Export hygiene is clean.** Internal modules not re-exported. Testing subpath separated.
- **Build config matches project standards.** ESM+CJS, dts, minify, treeshake, es2022.

---

## Phase 1.1 Priorities (After P0/P1 Fixes)

1. Wire remaining triggers (transforms architect from manual to reactive)
2. Constraint Discovery Mode (the "wow" feature)
3. Webhook/callback support for approval events (Slack/PagerDuty)
4. Audit log persistence + export (SOC2 compliance)
5. OpenTelemetry spans (enterprise observability)
6. Visual constraint graph MVP (the demo that makes people tweet)
