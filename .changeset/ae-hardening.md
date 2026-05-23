---
"@directive-run/core": minor
---

fix + feat: AE hardening of `owns` (RFC-0003) and data-form predicates (RFC-0004)

A nine-round AE review loop on the v1.5.0 `owns` + data-form predicate
surface closed 2 critical and 59 major issues. The release pairs a
headline bug fix — `owns` was silently broken in every multi-module
system — with a handful of new public exports for observability and
safety. Pure-function fixes; no breaking API changes against v1.5.0.

**Critical bug fixes (visible in v1.5.0)**

- `owns:` keys are now namespace-prefixed inside `prefixConstraints`. In
  v1.5.0 the entire RFC-0003 clobber-detection feature silently no-op'd
  in every multi-module system — a constraint owning `["status"]` in
  module `counter` kept `owns=["status"]` while resolver writes flowed
  as `"counter::status"`, so the proxy's ownership check missed every
  namespaced write.
- `$changed` inside a constraint `when` now throws **unconditionally**
  at registration. v1.5.0 threw only in dev and silently mis-evaluated
  in production (collapsing to a defined-check via `prev=undefined`).
- `$matches` now requires a `RegExp` operand and throws on a string
  operand. JSON-loaded predicates were a real ReDoS surface.
- Every registered spec is now **deeply** frozen (was shallow), so
  post-registration mutation of a nested operand can't silently
  change the compiled closure.
- Three predicate AST walkers (evaluatePredicate, validatePredicate,
  containsChangedOperator) are now depth- and cycle-guarded with
  `MAX_PREDICATE_DEPTH = 64`.
- `evaluateKeySelector` typed-value collisions fixed — `stableStringify`
  now handles `bigint`, `Date`, `RegExp`, `Map`, `Set` with distinct
  prefixes (was producing `"{}"` for all).
- `evaluateTemplate` now uses `Object.hasOwn` (was walking the
  prototype chain — `${toString}` returned the function source).
- Facts proxy `getOwnPropertyDescriptor` now honours `BLOCKED_PROPS`
  consistently with the `get` trap.
- Bound-facts intended-value staging fixed (the proxy now stores the
  resolver's intended value before `Reflect.set`, so a listener
  mutation during the write can't silently transfer ownership).
- Sibling bound-resolver clobber gap fixed via a pre-dispatch
  `factsBaseline` snapshot threaded into `createBoundFacts`.
- `validateOwnsKeys` rejects `BLOCKED_PROPS` / `$`-prefixed owns keys
  at registration. `self`, `prev`, `current` reserved as fact names.
- `validatePivotNameConflicts` rejects same-named facts at
  registration (was a silent shadowing).

**New public exports (additive)**

- `validatePredicate(spec: unknown): void` — opt-in JSON-safety
  validator. Throws on non-RegExp `$matches`, `bigint`, `Set`, `Map`,
  or nested non-rehydratable operands. Call after `JSON.parse` of a
  persisted predicate.
- `MAX_PREDICATE_DEPTH = 64` — exported so a caller designing a deep
  predicate can see the cap.
- `resolver.write.rejected` observation event + `onResolverWriteRejected`
  plugin hook. Surfaces dropped owned-fact writes through the standard
  observation channel. Discriminated union on `kind`:
  ```ts
  | { type: "resolver.write.rejected"; kind: "rejection";
      resolver; requirementId; fact; expected; actual; reason: "clobbered" }
  | { type: "resolver.write.rejected"; kind: "summary";
      resolver; requirementId; dropped: number; reason: "clobbered" }
  ```
  Devtools and the logging plugin surface this event by default.
  Per-resolver-instance rate-limit caps per-write events at 10 and
  fires one summary event with the dropped count.

**DX / docs**

- Owner attribution on predicate throws: errors thrown from a
  constraint / effect / derivation predicate now identify the owning
  definition (`[Directive] constraint '<id>': ...`) and preserve the
  original error as `cause`.
- Runtime-async-`when` warning is explicit about the runtime promotion
  case (your `when()` returned a Promise) and suggests three fixes.
- Pivot-name conflict error lists three remediations (rename / drop
  from `crossModuleDeps` / wrap under a namespace).

See `docs/rfcs/0003-resolver-constraint-binding.md`,
`docs/rfcs/0004-data-configuration-triggers.md`, and
`docs/upgrade-guides/constraint-binding.md` for the full reference.
