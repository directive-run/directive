---
"@directive-run/core": minor
"@directive-run/ai": minor
"@directive-run/cli": minor
---

Add dynamic runtime definitions, harden security, and refactor internals.

**Features**
- Add `register()`, `assign()`, `getOriginal()`, `restoreOriginal()` for constraints, resolvers, derivations, and effects at runtime
- Add `DerivationsControl` type for dynamic definition methods on `system.derive`
- Add `read()` overload for fact keys on `SingleModuleSystem`

**Fixes**
- Fix command injection vulnerability in CLI `graph` command (`exec` → `execFile`)
- Reject schema keys starting with `$` to prevent internal collision
- Prefix all testing assertion errors with `[Directive]`
- Harden all 11 proxies with `defineProperty`, `getPrototypeOf`, `setPrototypeOf` traps

**Improvements**
- Extract shared adapter utilities (SSE parsing, hooks, error handling) in AI package
- Split orchestrator into pattern-composition, pattern-factories, pattern-serialization (10,272 → 8,729 LOC)
- Split `facts.ts` into `schema-builders.ts` + facts store
- Consolidate `BLOCKED_PROPS` to single export in `tracking.ts`
- Remove 7 internal builder types from public exports

**BREAKING:** `constraintFactory` renamed to `createConstraintFactory`, `resolverFactory` renamed to `createResolverFactory`
