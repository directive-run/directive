# Phase 0 gate decisions

Date: 2026-10-18. Jason approved every recommendation below.

## Targets (budgets only tighten)

Raising a budget needs a written reason and Jason's OK.

| What | Target | Ceiling | Today |
| --- | --- | --- | --- |
| Aperture lab chunk (gzip) | about 6 KB | 8 KB | 41.7 KB |
| Aperture per frame | 15 µs or less, 1 KB or less allocated | same | 95 µs, 35 KB |
| L0 reactive graph | within 1.15x of alien-signals on every js-reactivity-benchmark workload, about 1.2 KB | | |
| Core through effects (L4) | about 4.8 KB | | |
| Everything imported | about 22 KB | 25 KB | |
| Engine speed vs 1.35 | 1.0x or better everywhere from L1; 0.8x or better on the frame loop by L5 | | |
| Nightly mutation score | 80% or better | | |

## Frozen contracts

- Public API: 434 exports and 525 referenced types in `api-surface.json`
- `SystemLike`
- The 46 plugin hook names
- The 32 `ObservationEvent` kinds
- The `inspect()` shape
- Golden files: history, persistence, signed snapshot, audit chain. They round-trip both ways.
- Requirement ids, built from content
- The write-log record shape (types only)

## The four 1.35 bugs

Fixed in 2.0 only. 1.x is untouched. Each gets an entry in `diff/divergences.json`
with Jason's sign-off when its layer lands.

| | Bug in 1.35 | 2.0 behaviour | Layer |
| --- | --- | --- | --- |
| a | `onFactDelete` is never emitted | 2.0 emits it | L0 |
| b | An effect's nested write (`facts.list.push`) changes the store before it is flagged | Tracked in-place writes fix it | L1 |
| c | Dev warnings dedupe once per process, not per system | Once per system | L0 / L3 |
| d | The `"throw"` error strategy in async resolvers leaves an unhandled rejection | Errors become stream records and are never thrown into the host from a flush | L3 |

## Other decisions

- Decision 1, main branch: no required review. Required checks are
  build-and-test, conformance, oracle-guard, package-checks, examples and e2e.
  `enforce_admins` is on. Already applied in GitHub settings.
- Decision 2: the unused offline licence validator is deleted (see `WHITE-BOX.md`).
- Decision 3: the white-box test fates in `WHITE-BOX.md` are approved.
- Decision 5: no new token. `release.yml` re-runs build, tests and package
  checks before it publishes (see `RELEASING.md`).
- Decision 6: `ClobberSummaryEvent` is signed in PR #185.
