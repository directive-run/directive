---
"@directive-run/core": patch
---

Performance and correctness improvements to the core runtime.

**Performance**
- Convert recursive `invalidateDerivation` to iterative work queue (prevents stack overflow on 50+ deep derivation chains)
- Effects auto-tracking stability optimization (skips `withTracking` overhead after 3 consecutive stable runs)
- Resolver cache uses LRU eviction instead of FIFO (recently-used entries no longer evicted at capacity)
- Conditional topo sort rebuild in constraints (skips full graph traversal when registering constraints without `after` deps)

**Fixes**
- Add `destroy()` to FactsStore — clears all listeners on system destroy (prevents memory leaks)
- Add `setPrototypeOf` trap to all 13 proxies for consistent prototype pollution protection
- Share visited Set across `invalidateMany` calls for correct deduplication
- Reset effects dependency stability on errors and `runAll()`
- Re-entrance guard on `engine.destroy()`
