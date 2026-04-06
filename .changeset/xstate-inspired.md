---
"@directive-run/core": minor
"@directive-run/react": minor
---

XState-inspired improvements: React context provider, observation protocol, coverage testing

**React (`@directive-run/react`):**
- `createDirectiveContext(system)` — returns `{ Provider, useFact, useDerived, useEvents, useDispatch, useSelector, useWatch, useInspect, useExplain, useHistory, useSystem }`. Eliminates prop-drilling. Provider accepts `system` override for testing.

**Core (`@directive-run/core`):**
- `system.observe(observer)` — typed inspection protocol with 18 event types (`ObservationEvent`). Enables browser extensions, third-party tools, and inspection-based test assertions. Implemented as internal plugin — zero overhead when no observers.
- `createCoverageTracker(system)` — run test scenarios, get coverage report showing which constraints/resolvers/effects/derivations were exercised and which were missed. Something XState can't do.
- `createTestObserver(system)` — collect all observation events during tests, filter by type for assertions.
- `CLAUDE.md` — AI contributor guide with architecture, key files, conventions.
