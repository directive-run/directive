# Documentation Gaps Report

Prioritized list of documentation gaps affecting chatbot accuracy and developer experience.

---

## High Priority (Core APIs with zero/minimal docs)

| Gap | Impact | Affected Page | Status |
|-----|--------|---------------|--------|
| `System.onSettledChange()` &ndash; listener method, zero docs | Users can't discover reactive settlement binding | `/docs/api/core` | **Resolved** &ndash; TSDoc added to engine.ts |
| `System.onTimeTravelChange()` &ndash; listener method, zero docs | Same | `/docs/api/core` | **Resolved** &ndash; TSDoc added to engine.ts |
| `TimeTravelAPI.beginChangeset()` / `endChangeset()` &ndash; zero docs | Grouped undo/redo unusable | `/docs/advanced/time-travel` | **Resolved** &ndash; TSDoc added to time-travel.ts |
| `TimeTravelAPI.pause()` / `resume()` &ndash; zero docs | Can't suppress snapshots during batch ops | `/docs/advanced/time-travel` | **Resolved** &ndash; TSDoc added to time-travel.ts |
| `System.inspect()` return shape &ndash; one-liner, no field docs | Users ask "what does inspect return?" and chatbot guesses | `/docs/api/core` | **Resolved** &ndash; TSDoc added to engine.ts + SystemInspection type |
| `System.explain()` return shape &ndash; one-liner | Same problem | `/docs/api/core` | **Resolved** &ndash; TSDoc added to engine.ts |
| Requirement helpers: `req()`, `forType()`, `isRequirementType()`, `RequirementSet` &ndash; zero docs | Advanced requirement composition undiscoverable | New page needed | **Resolved** &ndash; TSDoc added to requirements.ts |
| System lifecycle ordering (`isInitialized` &rarr; `isReady` &rarr; `isRunning` &rarr; `isSettled`) &ndash; minimal | Users confused about when constraints first evaluate | `/docs/api/core` or new lifecycle page | **Resolved** &ndash; TSDoc @remarks on createSystem |

## Medium Priority (Behavioral specs missing)

| Gap | Impact | Affected Page | Status |
|-----|--------|---------------|--------|
| Nested `batch()` behavior | Users unsure if nesting is safe | `/docs/api/core` | **Resolved** &ndash; TSDoc @remarks on batch in engine.ts |
| Derivation recomputation timing (lazy vs eager) | Performance questions unanswerable | `/docs/derivations` | Open |
| `settle()` timeout parameter | Not documented | `/docs/api/core` | **Resolved** &ndash; TSDoc added to engine.ts settle() |
| `System.read()` vs `derive` proxy &ndash; when to use which | Common question, no guidance | `/docs/api/core` | Open |
| Constraint `after` not auto-prefixed in multi-module (runtime bug) | Cross-module after deps silently fail | `/docs/constraints` | Open |
| Error catalog &ndash; no centralized list of runtime warnings/errors | Users ask "what error do I get if..." | New page needed | Open |

## Low Priority (Advanced/internal APIs)

| Gap | Impact | Affected Page | Status |
|-----|--------|---------------|--------|
| Low-level managers (`createFacts`, `createDerivationsManager`, etc.) &ndash; zero docs | Plugin authors can't use them | Mark `@internal` or document | **Resolved** &ndash; All marked `@internal` with TSDoc |
| Tracking APIs (`withTracking`, `withoutTracking`, `trackAccess`) &ndash; scattered mentions | Custom derivation authors blocked | `/docs/advanced/overview` | Open |
| Type interfaces (`ConstraintsControl`, `EffectsControl`, `TimeTravelState`) &ndash; no examples | TypeScript users can't find types | `/docs/api/types` | Open |
| `createSystemWithStatus` / `createStatusHook` &ndash; zero docs | Status plugin composition unclear | `/docs/plugins/overview` | Open |
| Resolver param naming: docs use `req, ctx` but convention is `request, context` | Style inconsistency, not accuracy | All resolver examples | Open &ndash; Convention is `req, context` per project memory |
