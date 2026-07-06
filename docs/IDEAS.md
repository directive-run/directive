# Directive — Ideas backlog

Rolling backlog of improvements, missing features, awkward APIs, and
real bugs surfaced while building Directive itself OR while downstream
consumers hit a gap that traces back to a Directive root cause.

The point of routing findings here is to **fix the root and delete the
workaround in the consumer**, not to monkey-patch every consumer that
hits the same shape.

## Format per entry

Entries routed from a consumer's static-analysis or code-review pass
use this shape:

```markdown
### From <consumer> review, YYYY-MM-DD — <one-line symptom>

**First impacted consumer:** <project> (<commit/feature context>)
**Symptom:** What the consumer sees when it tries to use the current API/feature.
**Suggested root fix:** What Directive should ship to make the consumer code clean.
**Effort:** S / M / L
**Workaround used in consumer (if any):** `<consumer>/src/...` — `// FIXME: directive#<future-issue>`
```

Entries authored from inside Directive (during static-analysis passes
or regular development) use a freer shape — same headings where they
fit, but no "first impacted consumer" required.

## Status sections

### Active (highest leverage first)

#### From directive static audit, 2026-07-05 — bump vitest to ≥3.2.6 across the monorepo

**Symptom:** `pnpm audit` reports a critical advisory
(GHSA-9crc-q9x8-hgqq) against `vitest <3.2.6` — Vitest UI server can
read and execute arbitrary files when the UI mode is listening.
Multiple packages still pin `^2.1.9` (sources, mutator, optimistic,
timeline) alongside the root `^2.1.8`, so the transitive resolution
picks a vulnerable version even for packages that already declared
`^3.0.0`.

**Suggested root fix:** Bump every direct `vitest` pin to `^3.2.6`
and refresh the lockfile in one go. The Vitest 2 → 3 major carries
API changes (config shape, some deprecated matchers, workspace file
rename); the migration needs a per-package test-suite verification
pass, not a global search-and-replace. Also touches whatever tests
in `packages/*` currently import from `vitest/config`, `vitest/node`,
etc.

**Effort:** M — mechanical bump is one line per package, but the
verification sweep across ~15 packages needs an eyes-on run each.

**Workaround for now:** the vuln is dev-only (only reachable when
`vitest --ui` is running, which the CI never does), so it doesn't
gate a release. Sits in the queue until it can get a proper
migration commit.

#### From directive static audit, 2026-07-05 — pnpm.overrides for transitive dev-dep advisories

**Symptom:** `pnpm audit` surfaces 18 high-severity + 29 moderate
advisories across the transitive dev-dep tree: `minimatch` /
`picomatch` / `path-to-regexp` / `fast-uri` ReDoS, `rollup` +
`vite` path traversal, `ws` memory DoS, `immutable` prototype
pollution, `happy-dom` code exec, `devalue` sparse-array DoS. All
in dev / test / build tooling — nothing ships to consumers.

**Suggested root fix:** Add a `pnpm.overrides` block to the root
`package.json` pinning each transitive to a patched floor
(`minimatch@>=9.0.5`, `picomatch@>=4.0.3`, `path-to-regexp@>=8.0.0`,
`fast-uri@>=3.1.0`, `ws@>=8.18.2`, `rollup@>=4.44.2`). Several of
these are major-version bumps for the transitive deps (e.g. jotai
/ @vitejs/plugin-react → @babel/core → minimatch chain), so the
override needs a full `pnpm install` + build + test cycle to
confirm nothing in the toolchain regresses.

**Effort:** S per override (one line each) but M in aggregate —
each override risks breaking a build-tool that assumes the older
transitive.

**Workaround for now:** solo-dev + on-personal-equipment
attack surface is essentially zero; the vulns are ReDoS and
path-traversal-during-build. Defer until the migration can share
a commit with the vitest bump.

### Building

### Shipped

### Killed (kept for the record of why)
