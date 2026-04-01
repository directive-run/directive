---
"@directive-run/core": patch
---

Performance optimizations: 3.1x faster reads, 97x faster reconcile

- Hoist `__DEV__` const – prevents V8 JIT deopt in proxy get trap (fact reads 6.1M -> 18.9M ops/sec)
- Fast-path `trackAccess` – skip when no tracking context active (+25% on reads)
- Reorder proxy get trap – symbols first for React probe elimination
- Replace `setTimeout(0)` with `queueMicrotask` in settle() – reconcile cycles 813 -> 18,780 ops/sec
- Skip `withTracking` for derivations with stable deps – benefits multi-component renders
- Guard `onCompute` allocation – eliminates array spread when no plugin listens
- Add benchmark suite (15 benchmarks across 10 categories)
