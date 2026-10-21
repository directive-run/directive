window.BENCHMARK_DATA = {
  "lastUpdate": 1792562381031,
  "repoUrl": "https://github.com/directive-run/directive",
  "entries": {
    "@directive-run/core": [
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "fe218abcad57b7f653a1454c9f30d153b369cffa",
          "message": "ci: benchmark history on bench-data branch (report-only PR alerts) (#183)",
          "timestamp": "2026-10-18T13:44:12-05:00",
          "tree_id": "00d161ae2f9184fb13ccce98f0d297bed813760b",
          "url": "https://github.com/directive-run/directive/commit/fe218abcad57b7f653a1454c9f30d153b369cffa"
        },
        "date": 1792349190502,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 77.76,
            "unit": "ns/op",
            "extra": "samples: 6430415, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 45.07,
            "unit": "ns/op",
            "extra": "samples: 11095035, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 46.18,
            "unit": "ns/op",
            "extra": "samples: 10827435, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 62.76,
            "unit": "ns/op",
            "extra": "samples: 7967044, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 107.66,
            "unit": "ns/op",
            "extra": "samples: 4644208, rme: ±0.42%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 46.4,
            "unit": "ns/op",
            "extra": "samples: 10775054, rme: ±0.33%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 48.21,
            "unit": "ns/op",
            "extra": "samples: 10370590, rme: ±0.47%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 295.99,
            "unit": "ns/op",
            "extra": "samples: 1689240, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 83.98,
            "unit": "ns/op",
            "extra": "samples: 5953638, rme: ±0.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 750.49,
            "unit": "ns/op",
            "extra": "samples: 666228, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 162.6,
            "unit": "ns/op",
            "extra": "samples: 3075006, rme: ±0.47%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 582.99,
            "unit": "ns/op",
            "extra": "samples: 857653, rme: ±0.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 51.17,
            "unit": "ns/op",
            "extra": "samples: 9771500, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 1415.37,
            "unit": "ns/op",
            "extra": "samples: 353266, rme: ±0.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 173896.89,
            "unit": "ns/op",
            "extra": "samples: 2876, rme: ±1.48%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 44259.64,
            "unit": "ns/op",
            "extra": "samples: 11297, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 685587.4,
            "unit": "ns/op",
            "extra": "samples: 730, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 119249.66,
            "unit": "ns/op",
            "extra": "samples: 4193, rme: ±0.22%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 591715.63,
            "unit": "ns/op",
            "extra": "samples: 846, rme: ±1.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 14849.69,
            "unit": "ns/op",
            "extra": "samples: 33671, rme: ±1.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 1441542.59,
            "unit": "ns/op",
            "extra": "samples: 347, rme: ±0.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1065.85,
            "unit": "ns/op",
            "extra": "samples: 469110, rme: ±1.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 89.74,
            "unit": "ns/op",
            "extra": "samples: 5571842, rme: ±3.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 751.35,
            "unit": "ns/op",
            "extra": "samples: 665530, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 319.97,
            "unit": "ns/op",
            "extra": "samples: 1562647, rme: ±0.38%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 1709.17,
            "unit": "ns/op",
            "extra": "samples: 292540, rme: ±3.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 65.54,
            "unit": "ns/op",
            "extra": "samples: 7628706, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 1469.48,
            "unit": "ns/op",
            "extra": "samples: 340257, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 5852.59,
            "unit": "ns/op",
            "extra": "samples: 85433, rme: ±0.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 2097.56,
            "unit": "ns/op",
            "extra": "samples: 238373, rme: ±0.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 34340.49,
            "unit": "ns/op",
            "extra": "samples: 14561, rme: ±0.62%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 5793.67,
            "unit": "ns/op",
            "extra": "samples: 86302, rme: ±0.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 22984.71,
            "unit": "ns/op",
            "extra": "samples: 21754, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 589.56,
            "unit": "ns/op",
            "extra": "samples: 848092, rme: ±1.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 71650.64,
            "unit": "ns/op",
            "extra": "samples: 6979, rme: ±1.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 64072.17,
            "unit": "ns/op",
            "extra": "samples: 7852, rme: ±14.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 512.19,
            "unit": "ns/op",
            "extra": "samples: 976192, rme: ±0.42%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 64092.93,
            "unit": "ns/op",
            "extra": "samples: 7802, rme: ±1.57%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 684.56,
            "unit": "ns/op",
            "extra": "samples: 730400, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 46603.48,
            "unit": "ns/op",
            "extra": "samples: 10730, rme: ±12.88%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 51,
            "unit": "ns/op",
            "extra": "samples: 9803490, rme: ±2.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 6977.92,
            "unit": "ns/op",
            "extra": "samples: 71655, rme: ±5.16%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 2199.99,
            "unit": "ns/op",
            "extra": "samples: 227275, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1008,
            "unit": "ns/op",
            "extra": "samples: 497551, rme: ±9.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 44.66,
            "unit": "ns/op",
            "extra": "samples: 11195478, rme: ±0.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 6326.99,
            "unit": "ns/op",
            "extra": "samples: 79027, rme: ±7.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 859.67,
            "unit": "ns/op",
            "extra": "samples: 581618, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 300.12,
            "unit": "ns/op",
            "extra": "samples: 1665980, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 575.56,
            "unit": "ns/op",
            "extra": "samples: 868718, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 56.98,
            "unit": "ns/op",
            "extra": "samples: 8775199, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 778.47,
            "unit": "ns/op",
            "extra": "samples: 642290, rme: ±10.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 1177214.01,
            "unit": "ns/op",
            "extra": "samples: 425, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 400842.57,
            "unit": "ns/op",
            "extra": "samples: 1248, rme: ±0.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 7078740.65,
            "unit": "ns/op",
            "extra": "samples: 71, rme: ±2.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 1045600.49,
            "unit": "ns/op",
            "extra": "samples: 479, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 4860833.47,
            "unit": "ns/op",
            "extra": "samples: 103, rme: ±6.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 112005.4,
            "unit": "ns/op",
            "extra": "samples: 4465, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 14148165.19,
            "unit": "ns/op",
            "extra": "samples: 36, rme: ±0.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 16816.46,
            "unit": "ns/op",
            "extra": "samples: 29733, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 4571.73,
            "unit": "ns/op",
            "extra": "samples: 109368, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 71698.45,
            "unit": "ns/op",
            "extra": "samples: 6974, rme: ±1.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 13726.07,
            "unit": "ns/op",
            "extra": "samples: 36428, rme: ±0.52%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 62853.91,
            "unit": "ns/op",
            "extra": "samples: 7955, rme: ±1.90%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 1551.44,
            "unit": "ns/op",
            "extra": "samples: 322281, rme: ±0.88%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 138799.42,
            "unit": "ns/op",
            "extra": "samples: 3603, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 2039.6,
            "unit": "ns/op",
            "extra": "samples: 245147, rme: ±1.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 621.17,
            "unit": "ns/op",
            "extra": "samples: 804933, rme: ±0.91%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 103.28,
            "unit": "ns/op",
            "extra": "samples: 4841202, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 3818.46,
            "unit": "ns/op",
            "extra": "samples: 131313, rme: ±5.00%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 372.63,
            "unit": "ns/op",
            "extra": "samples: 1341827, rme: ±0.43%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 81.9,
            "unit": "ns/op",
            "extra": "samples: 6105120, rme: ±0.07%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 10877.04,
            "unit": "ns/op",
            "extra": "samples: 45969, rme: ±0.87%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 8830.63,
            "unit": "ns/op",
            "extra": "samples: 56622, rme: ±0.19%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1066.97,
            "unit": "ns/op",
            "extra": "samples: 468615, rme: ±0.69%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 6265.59,
            "unit": "ns/op",
            "extra": "samples: 79801, rme: ±2.87%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 27976.98,
            "unit": "ns/op",
            "extra": "samples: 17872, rme: ±1.14%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 1571.35,
            "unit": "ns/op",
            "extra": "samples: 318199, rme: ±1.04%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 432.76,
            "unit": "ns/op",
            "extra": "samples: 1155369, rme: ±0.10%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 437.97,
            "unit": "ns/op",
            "extra": "samples: 1141626, rme: ±0.09%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 436.79,
            "unit": "ns/op",
            "extra": "samples: 1144725, rme: ±0.31%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 71196.3,
            "unit": "ns/op",
            "extra": "samples: 7060, rme: ±12.28%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 81281.07,
            "unit": "ns/op",
            "extra": "samples: 6152, rme: ±8.01%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 67818.59,
            "unit": "ns/op",
            "extra": "samples: 7373, rme: ±9.34%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 59165.92,
            "unit": "ns/op",
            "extra": "samples: 8451, rme: ±9.07%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 43566.16,
            "unit": "ns/op",
            "extra": "samples: 11477, rme: ±11.39%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 61208.05,
            "unit": "ns/op",
            "extra": "samples: 8190, rme: ±9.43%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 94384.6,
            "unit": "ns/op",
            "extra": "samples: 5298, rme: ±7.74%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 92718.08,
            "unit": "ns/op",
            "extra": "samples: 5393, rme: ±6.45%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 79077.01,
            "unit": "ns/op",
            "extra": "samples: 6323, rme: ±8.47%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 618547.68,
            "unit": "ns/op",
            "extra": "samples: 812, rme: ±7.23%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 506622.56,
            "unit": "ns/op",
            "extra": "samples: 990, rme: ±6.62%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5d44ce9715b84a91b3ac2823aaf4b9a927a66ea2",
          "message": "[chore] conformance: record Phase 0 gate decisions, delete unused licence validator, re-verify before publish (#186)",
          "timestamp": "2026-10-18T17:11:07-05:00",
          "tree_id": "d468391d52f5daf95a9d5170435cdb3f7585530e",
          "url": "https://github.com/directive-run/directive/commit/5d44ce9715b84a91b3ac2823aaf4b9a927a66ea2"
        },
        "date": 1792361607570,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 171.88,
            "unit": "ns/op",
            "extra": "samples: 2908968, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 75.08,
            "unit": "ns/op",
            "extra": "samples: 6659369, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 78.05,
            "unit": "ns/op",
            "extra": "samples: 6406324, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 130.75,
            "unit": "ns/op",
            "extra": "samples: 3824114, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 221.84,
            "unit": "ns/op",
            "extra": "samples: 2253900, rme: ±1.56%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 79.98,
            "unit": "ns/op",
            "extra": "samples: 6251286, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 78.3,
            "unit": "ns/op",
            "extra": "samples: 6385650, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 572.31,
            "unit": "ns/op",
            "extra": "samples: 873677, rme: ±1.26%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 169.91,
            "unit": "ns/op",
            "extra": "samples: 2942660, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1323.62,
            "unit": "ns/op",
            "extra": "samples: 377753, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 331.86,
            "unit": "ns/op",
            "extra": "samples: 1506666, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 1017.42,
            "unit": "ns/op",
            "extra": "samples: 491441, rme: ±0.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 85.09,
            "unit": "ns/op",
            "extra": "samples: 5876008, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2466.59,
            "unit": "ns/op",
            "extra": "samples: 202710, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 311178.01,
            "unit": "ns/op",
            "extra": "samples: 1607, rme: ±0.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 85256.15,
            "unit": "ns/op",
            "extra": "samples: 5865, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1190659.81,
            "unit": "ns/op",
            "extra": "samples: 421, rme: ±0.83%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 233304.44,
            "unit": "ns/op",
            "extra": "samples: 2144, rme: ±0.57%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1070837.26,
            "unit": "ns/op",
            "extra": "samples: 467, rme: ±3.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 22242.59,
            "unit": "ns/op",
            "extra": "samples: 22480, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2319601.13,
            "unit": "ns/op",
            "extra": "samples: 216, rme: ±0.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1730.06,
            "unit": "ns/op",
            "extra": "samples: 289009, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 175.18,
            "unit": "ns/op",
            "extra": "samples: 2854127, rme: ±0.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1344.78,
            "unit": "ns/op",
            "extra": "samples: 371809, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 610.73,
            "unit": "ns/op",
            "extra": "samples: 818696, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2940.95,
            "unit": "ns/op",
            "extra": "samples: 170013, rme: ±5.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 116.05,
            "unit": "ns/op",
            "extra": "samples: 4308409, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2458.37,
            "unit": "ns/op",
            "extra": "samples: 203387, rme: ±1.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12065.62,
            "unit": "ns/op",
            "extra": "samples: 41441, rme: ±0.33%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 4013.47,
            "unit": "ns/op",
            "extra": "samples: 124581, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 58656.87,
            "unit": "ns/op",
            "extra": "samples: 8525, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 10790.55,
            "unit": "ns/op",
            "extra": "samples: 46337, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 43735.77,
            "unit": "ns/op",
            "extra": "samples: 11433, rme: ±1.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 897.23,
            "unit": "ns/op",
            "extra": "samples: 557268, rme: ±1.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 116547.73,
            "unit": "ns/op",
            "extra": "samples: 4291, rme: ±1.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 119373.3,
            "unit": "ns/op",
            "extra": "samples: 4217, rme: ±12.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 855.81,
            "unit": "ns/op",
            "extra": "samples: 584241, rme: ±0.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 226892.76,
            "unit": "ns/op",
            "extra": "samples: 2204, rme: ±3.93%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1213.06,
            "unit": "ns/op",
            "extra": "samples: 412183, rme: ±0.28%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 109349.73,
            "unit": "ns/op",
            "extra": "samples: 4573, rme: ±10.48%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 85.78,
            "unit": "ns/op",
            "extra": "samples: 5829200, rme: ±0.28%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 11900.63,
            "unit": "ns/op",
            "extra": "samples: 42015, rme: ±5.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3895.34,
            "unit": "ns/op",
            "extra": "samples: 128359, rme: ±1.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1469.04,
            "unit": "ns/op",
            "extra": "samples: 340358, rme: ±10.21%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 65.5,
            "unit": "ns/op",
            "extra": "samples: 7633920, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 10329.37,
            "unit": "ns/op",
            "extra": "samples: 48406, rme: ±8.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1234.92,
            "unit": "ns/op",
            "extra": "samples: 404886, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 560.03,
            "unit": "ns/op",
            "extra": "samples: 892813, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 888.03,
            "unit": "ns/op",
            "extra": "samples: 563042, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 95.41,
            "unit": "ns/op",
            "extra": "samples: 5240742, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1257.9,
            "unit": "ns/op",
            "extra": "samples: 397489, rme: ±0.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2432925.55,
            "unit": "ns/op",
            "extra": "samples: 206, rme: ±2.32%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 778598.57,
            "unit": "ns/op",
            "extra": "samples: 643, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 11823428.56,
            "unit": "ns/op",
            "extra": "samples: 43, rme: ±0.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2115634.19,
            "unit": "ns/op",
            "extra": "samples: 237, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 8475541.88,
            "unit": "ns/op",
            "extra": "samples: 60, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 230269.2,
            "unit": "ns/op",
            "extra": "samples: 2172, rme: ±1.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 24219833.24,
            "unit": "ns/op",
            "extra": "samples: 21, rme: ±0.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 31693.12,
            "unit": "ns/op",
            "extra": "samples: 15777, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 8867.16,
            "unit": "ns/op",
            "extra": "samples: 56388, rme: ±1.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 121674.27,
            "unit": "ns/op",
            "extra": "samples: 4110, rme: ±1.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 25214.46,
            "unit": "ns/op",
            "extra": "samples: 19830, rme: ±0.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 126200.03,
            "unit": "ns/op",
            "extra": "samples: 3962, rme: ±1.93%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 3151.34,
            "unit": "ns/op",
            "extra": "samples: 158663, rme: ±1.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 258491.24,
            "unit": "ns/op",
            "extra": "samples: 1935, rme: ±2.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3815.11,
            "unit": "ns/op",
            "extra": "samples: 131058, rme: ±4.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 990.8,
            "unit": "ns/op",
            "extra": "samples: 504837, rme: ±0.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 175.84,
            "unit": "ns/op",
            "extra": "samples: 2843492, rme: ±0.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6573.6,
            "unit": "ns/op",
            "extra": "samples: 76063, rme: ±6.68%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 677.87,
            "unit": "ns/op",
            "extra": "samples: 737606, rme: ±0.81%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 158.69,
            "unit": "ns/op",
            "extra": "samples: 3150723, rme: ±0.11%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 14885.51,
            "unit": "ns/op",
            "extra": "samples: 33590, rme: ±0.44%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 12165.32,
            "unit": "ns/op",
            "extra": "samples: 41101, rme: ±0.41%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1905.08,
            "unit": "ns/op",
            "extra": "samples: 262457, rme: ±1.58%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 9693.34,
            "unit": "ns/op",
            "extra": "samples: 51582, rme: ±1.12%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 44180.82,
            "unit": "ns/op",
            "extra": "samples: 11318, rme: ±1.11%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2729.72,
            "unit": "ns/op",
            "extra": "samples: 183169, rme: ±1.70%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 851.98,
            "unit": "ns/op",
            "extra": "samples: 586867, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 854.17,
            "unit": "ns/op",
            "extra": "samples: 585362, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 858.38,
            "unit": "ns/op",
            "extra": "samples: 582495, rme: ±0.11%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 197438.07,
            "unit": "ns/op",
            "extra": "samples: 2533, rme: ±12.02%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 246852.77,
            "unit": "ns/op",
            "extra": "samples: 2026, rme: ±9.88%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 199132.81,
            "unit": "ns/op",
            "extra": "samples: 2511, rme: ±9.64%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 159049.24,
            "unit": "ns/op",
            "extra": "samples: 3144, rme: ±8.36%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 110243.85,
            "unit": "ns/op",
            "extra": "samples: 4536, rme: ±10.22%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 168693.31,
            "unit": "ns/op",
            "extra": "samples: 2964, rme: ±9.08%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 236353.95,
            "unit": "ns/op",
            "extra": "samples: 2116, rme: ±7.14%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 233691.11,
            "unit": "ns/op",
            "extra": "samples: 2140, rme: ±6.25%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 195269.37,
            "unit": "ns/op",
            "extra": "samples: 2561, rme: ±7.55%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1050441.54,
            "unit": "ns/op",
            "extra": "samples: 479, rme: ±8.48%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 881304.74,
            "unit": "ns/op",
            "extra": "samples: 568, rme: ±7.46%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5377e59c3bd31e5e28c3e83d7c989f96a7d98ac9",
          "message": "test(conformance): kill surviving facts.ts mutants (M2) (#188)\n\n* test(conformance): kill surviving facts.ts mutants (M2)\n\n* conformance: format facts mutant tests; keep ported production import on one line",
          "timestamp": "2026-10-18T20:04:51-05:00",
          "tree_id": "dc212aaf35d8dbe17796c6ba9bbf86c72adc5a1f",
          "url": "https://github.com/directive-run/directive/commit/5377e59c3bd31e5e28c3e83d7c989f96a7d98ac9"
        },
        "date": 1792372028694,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 160.23,
            "unit": "ns/op",
            "extra": "samples: 3120451, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 78.73,
            "unit": "ns/op",
            "extra": "samples: 6350991, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 78.19,
            "unit": "ns/op",
            "extra": "samples: 6394926, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 132.75,
            "unit": "ns/op",
            "extra": "samples: 3766391, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 224.94,
            "unit": "ns/op",
            "extra": "samples: 2222826, rme: ±3.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 76.67,
            "unit": "ns/op",
            "extra": "samples: 6521263, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 80.24,
            "unit": "ns/op",
            "extra": "samples: 6231243, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 550.57,
            "unit": "ns/op",
            "extra": "samples: 908154, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 161.33,
            "unit": "ns/op",
            "extra": "samples: 3099545, rme: ±1.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1261.84,
            "unit": "ns/op",
            "extra": "samples: 396248, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 348.36,
            "unit": "ns/op",
            "extra": "samples: 1435294, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 997.25,
            "unit": "ns/op",
            "extra": "samples: 501378, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 87.66,
            "unit": "ns/op",
            "extra": "samples: 5703655, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2498.77,
            "unit": "ns/op",
            "extra": "samples: 200099, rme: ±0.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 318530.45,
            "unit": "ns/op",
            "extra": "samples: 1570, rme: ±0.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 76324.39,
            "unit": "ns/op",
            "extra": "samples: 6551, rme: ±0.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1148433.18,
            "unit": "ns/op",
            "extra": "samples: 436, rme: ±0.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 249943.07,
            "unit": "ns/op",
            "extra": "samples: 2001, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1090701.71,
            "unit": "ns/op",
            "extra": "samples: 459, rme: ±2.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 21258.34,
            "unit": "ns/op",
            "extra": "samples: 23521, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2299664.24,
            "unit": "ns/op",
            "extra": "samples: 218, rme: ±0.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1735.49,
            "unit": "ns/op",
            "extra": "samples: 288104, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 172.08,
            "unit": "ns/op",
            "extra": "samples: 2905566, rme: ±1.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1287.94,
            "unit": "ns/op",
            "extra": "samples: 388219, rme: ±0.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 636.73,
            "unit": "ns/op",
            "extra": "samples: 785266, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2910.44,
            "unit": "ns/op",
            "extra": "samples: 172420, rme: ±4.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 117.44,
            "unit": "ns/op",
            "extra": "samples: 4257598, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2445.95,
            "unit": "ns/op",
            "extra": "samples: 204420, rme: ±0.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12577.36,
            "unit": "ns/op",
            "extra": "samples: 39754, rme: ±0.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3627.15,
            "unit": "ns/op",
            "extra": "samples: 137850, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 58387.62,
            "unit": "ns/op",
            "extra": "samples: 8564, rme: ±0.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 10633.61,
            "unit": "ns/op",
            "extra": "samples: 47021, rme: ±0.33%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 44745.81,
            "unit": "ns/op",
            "extra": "samples: 11175, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 901.25,
            "unit": "ns/op",
            "extra": "samples: 554785, rme: ±1.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 116553.39,
            "unit": "ns/op",
            "extra": "samples: 4290, rme: ±1.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 142318.81,
            "unit": "ns/op",
            "extra": "samples: 3514, rme: ±13.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 852.04,
            "unit": "ns/op",
            "extra": "samples: 586827, rme: ±0.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 257309.1,
            "unit": "ns/op",
            "extra": "samples: 1944, rme: ±4.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1291.46,
            "unit": "ns/op",
            "extra": "samples: 387158, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 136369.21,
            "unit": "ns/op",
            "extra": "samples: 3667, rme: ±10.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 82.79,
            "unit": "ns/op",
            "extra": "samples: 6039225, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 13583.13,
            "unit": "ns/op",
            "extra": "samples: 36811, rme: ±5.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3886.24,
            "unit": "ns/op",
            "extra": "samples: 128660, rme: ±0.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1441.17,
            "unit": "ns/op",
            "extra": "samples: 346943, rme: ±9.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 69.19,
            "unit": "ns/op",
            "extra": "samples: 7226357, rme: ±0.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 11008.93,
            "unit": "ns/op",
            "extra": "samples: 45418, rme: ±8.41%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1447.22,
            "unit": "ns/op",
            "extra": "samples: 345491, rme: ±0.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 619.57,
            "unit": "ns/op",
            "extra": "samples: 807007, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 983.5,
            "unit": "ns/op",
            "extra": "samples: 508391, rme: ±0.29%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 100.38,
            "unit": "ns/op",
            "extra": "samples: 4981064, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1296.46,
            "unit": "ns/op",
            "extra": "samples: 385665, rme: ±1.05%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2448599.89,
            "unit": "ns/op",
            "extra": "samples: 205, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 736927.08,
            "unit": "ns/op",
            "extra": "samples: 679, rme: ±1.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 11985576.36,
            "unit": "ns/op",
            "extra": "samples: 42, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2187843.03,
            "unit": "ns/op",
            "extra": "samples: 229, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 9852432.92,
            "unit": "ns/op",
            "extra": "samples: 51, rme: ±10.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 206494.35,
            "unit": "ns/op",
            "extra": "samples: 2422, rme: ±1.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 23478471.32,
            "unit": "ns/op",
            "extra": "samples: 22, rme: ±0.34%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 34701.01,
            "unit": "ns/op",
            "extra": "samples: 14409, rme: ±0.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 8063.02,
            "unit": "ns/op",
            "extra": "samples: 62012, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 119545.53,
            "unit": "ns/op",
            "extra": "samples: 4184, rme: ±0.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 27048.18,
            "unit": "ns/op",
            "extra": "samples: 18486, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 108896.6,
            "unit": "ns/op",
            "extra": "samples: 4592, rme: ±1.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2745.24,
            "unit": "ns/op",
            "extra": "samples: 182134, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 237225.03,
            "unit": "ns/op",
            "extra": "samples: 2108, rme: ±0.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3730.12,
            "unit": "ns/op",
            "extra": "samples: 134044, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1015.43,
            "unit": "ns/op",
            "extra": "samples: 492423, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 196.63,
            "unit": "ns/op",
            "extra": "samples: 2542872, rme: ±0.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6373.45,
            "unit": "ns/op",
            "extra": "samples: 78451, rme: ±5.89%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 647.77,
            "unit": "ns/op",
            "extra": "samples: 771874, rme: ±0.63%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 168.95,
            "unit": "ns/op",
            "extra": "samples: 2959410, rme: ±0.17%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 20054.75,
            "unit": "ns/op",
            "extra": "samples: 24932, rme: ±0.20%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 15515.98,
            "unit": "ns/op",
            "extra": "samples: 32225, rme: ±0.34%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1854.21,
            "unit": "ns/op",
            "extra": "samples: 269658, rme: ±1.66%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 9767.71,
            "unit": "ns/op",
            "extra": "samples: 51190, rme: ±0.99%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 45640.58,
            "unit": "ns/op",
            "extra": "samples: 10956, rme: ±0.93%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2840.17,
            "unit": "ns/op",
            "extra": "samples: 176046, rme: ±0.92%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 824.25,
            "unit": "ns/op",
            "extra": "samples: 606611, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 823.21,
            "unit": "ns/op",
            "extra": "samples: 607381, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 809.15,
            "unit": "ns/op",
            "extra": "samples: 617930, rme: ±1.05%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 188755.73,
            "unit": "ns/op",
            "extra": "samples: 2649, rme: ±11.00%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 223232.8,
            "unit": "ns/op",
            "extra": "samples: 2240, rme: ±6.66%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 218059.45,
            "unit": "ns/op",
            "extra": "samples: 2293, rme: ±7.23%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 177835.75,
            "unit": "ns/op",
            "extra": "samples: 2813, rme: ±7.37%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 129681.74,
            "unit": "ns/op",
            "extra": "samples: 3856, rme: ±8.59%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 191115.71,
            "unit": "ns/op",
            "extra": "samples: 2619, rme: ±7.57%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 248954.88,
            "unit": "ns/op",
            "extra": "samples: 2009, rme: ±6.46%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 263309.01,
            "unit": "ns/op",
            "extra": "samples: 1899, rme: ±5.64%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 216269.92,
            "unit": "ns/op",
            "extra": "samples: 2312, rme: ±6.24%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1386173.92,
            "unit": "ns/op",
            "extra": "samples: 361, rme: ±6.41%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 1117630.81,
            "unit": "ns/op",
            "extra": "samples: 448, rme: ±5.46%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "88c4d88782d095b1bce9c8478721568326902b6d",
          "message": "test(conformance): strengthen oracle against derivations.ts mutants (#189)\n\n* test(conformance): kill surviving derivations.ts mutants, triage the rest\n\n* test(conformance): derivations fix round — registerModule replace, stability freshness, housekeeping, v1-bug triage",
          "timestamp": "2026-10-18T20:23:08-05:00",
          "tree_id": "78d9ba520a9460c609f6d436018ba54e026a0e7c",
          "url": "https://github.com/directive-run/directive/commit/88c4d88782d095b1bce9c8478721568326902b6d"
        },
        "date": 1792373135219,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 110.51,
            "unit": "ns/op",
            "extra": "samples: 4524448, rme: ±0.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 61.27,
            "unit": "ns/op",
            "extra": "samples: 8160223, rme: ±0.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 65.18,
            "unit": "ns/op",
            "extra": "samples: 7670816, rme: ±0.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 105.98,
            "unit": "ns/op",
            "extra": "samples: 4718074, rme: ±0.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 145.6,
            "unit": "ns/op",
            "extra": "samples: 3433951, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 66.95,
            "unit": "ns/op",
            "extra": "samples: 7468789, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 64.51,
            "unit": "ns/op",
            "extra": "samples: 7750404, rme: ±0.28%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 353.86,
            "unit": "ns/op",
            "extra": "samples: 1412997, rme: ±1.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 114.42,
            "unit": "ns/op",
            "extra": "samples: 4369877, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 810.31,
            "unit": "ns/op",
            "extra": "samples: 617046, rme: ±0.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 206.67,
            "unit": "ns/op",
            "extra": "samples: 2419294, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 700.15,
            "unit": "ns/op",
            "extra": "samples: 714137, rme: ±3.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 68.12,
            "unit": "ns/op",
            "extra": "samples: 7339927, rme: ±0.26%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 1533.74,
            "unit": "ns/op",
            "extra": "samples: 326001, rme: ±1.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 209825.95,
            "unit": "ns/op",
            "extra": "samples: 2383, rme: ±0.96%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 54832.65,
            "unit": "ns/op",
            "extra": "samples: 9120, rme: ±0.93%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 683644.68,
            "unit": "ns/op",
            "extra": "samples: 732, rme: ±1.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 165952.15,
            "unit": "ns/op",
            "extra": "samples: 3013, rme: ±0.98%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 769207.41,
            "unit": "ns/op",
            "extra": "samples: 651, rme: ±2.90%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 16103.19,
            "unit": "ns/op",
            "extra": "samples: 31050, rme: ±1.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 1452059.63,
            "unit": "ns/op",
            "extra": "samples: 345, rme: ±1.01%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1045.92,
            "unit": "ns/op",
            "extra": "samples: 478048, rme: ±1.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 126.25,
            "unit": "ns/op",
            "extra": "samples: 3960480, rme: ±1.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 813.04,
            "unit": "ns/op",
            "extra": "samples: 614976, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 370.25,
            "unit": "ns/op",
            "extra": "samples: 1350427, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2064.42,
            "unit": "ns/op",
            "extra": "samples: 242979, rme: ±4.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 93.09,
            "unit": "ns/op",
            "extra": "samples: 5371273, rme: ±0.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 1587.25,
            "unit": "ns/op",
            "extra": "samples: 315010, rme: ±0.94%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 8583.92,
            "unit": "ns/op",
            "extra": "samples: 58249, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 2585.43,
            "unit": "ns/op",
            "extra": "samples: 193392, rme: ±2.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 33538.8,
            "unit": "ns/op",
            "extra": "samples: 14909, rme: ±0.76%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 6769.69,
            "unit": "ns/op",
            "extra": "samples: 73859, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 31796.89,
            "unit": "ns/op",
            "extra": "samples: 15725, rme: ±1.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 646.04,
            "unit": "ns/op",
            "extra": "samples: 773942, rme: ±1.04%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 70435.44,
            "unit": "ns/op",
            "extra": "samples: 7099, rme: ±0.98%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 73027.3,
            "unit": "ns/op",
            "extra": "samples: 6847, rme: ±13.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 674.29,
            "unit": "ns/op",
            "extra": "samples: 741518, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 113034.56,
            "unit": "ns/op",
            "extra": "samples: 4424, rme: ±2.78%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 916.26,
            "unit": "ns/op",
            "extra": "samples: 545696, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 56985.18,
            "unit": "ns/op",
            "extra": "samples: 8828, rme: ±12.22%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 66.72,
            "unit": "ns/op",
            "extra": "samples: 7494024, rme: ±1.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 10032.12,
            "unit": "ns/op",
            "extra": "samples: 49840, rme: ±6.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3005.22,
            "unit": "ns/op",
            "extra": "samples: 166378, rme: ±1.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1219.37,
            "unit": "ns/op",
            "extra": "samples: 410057, rme: ±8.94%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 56.61,
            "unit": "ns/op",
            "extra": "samples: 8832323, rme: ±0.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 8098.27,
            "unit": "ns/op",
            "extra": "samples: 61781, rme: ±8.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1083.34,
            "unit": "ns/op",
            "extra": "samples: 461536, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 442.83,
            "unit": "ns/op",
            "extra": "samples: 1129109, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 701.51,
            "unit": "ns/op",
            "extra": "samples: 712753, rme: ±0.53%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 80.08,
            "unit": "ns/op",
            "extra": "samples: 6244067, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 940.04,
            "unit": "ns/op",
            "extra": "samples: 531892, rme: ±0.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 1413220.95,
            "unit": "ns/op",
            "extra": "samples: 354, rme: ±1.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 492785.09,
            "unit": "ns/op",
            "extra": "samples: 1015, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 6661561.21,
            "unit": "ns/op",
            "extra": "samples: 76, rme: ±1.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 1269558.39,
            "unit": "ns/op",
            "extra": "samples: 394, rme: ±1.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 6194401.67,
            "unit": "ns/op",
            "extra": "samples: 81, rme: ±2.06%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 187021.15,
            "unit": "ns/op",
            "extra": "samples: 2675, rme: ±2.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 15595301.09,
            "unit": "ns/op",
            "extra": "samples: 33, rme: ±3.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 21562.55,
            "unit": "ns/op",
            "extra": "samples: 23189, rme: ±1.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 6067.93,
            "unit": "ns/op",
            "extra": "samples: 82401, rme: ±1.89%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 71988.2,
            "unit": "ns/op",
            "extra": "samples: 6946, rme: ±1.93%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 16331.97,
            "unit": "ns/op",
            "extra": "samples: 30617, rme: ±1.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 93013.1,
            "unit": "ns/op",
            "extra": "samples: 5376, rme: ±1.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2309.77,
            "unit": "ns/op",
            "extra": "samples: 216473, rme: ±2.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 162551.86,
            "unit": "ns/op",
            "extra": "samples: 3076, rme: ±2.89%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 2084.6,
            "unit": "ns/op",
            "extra": "samples: 239854, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 695.49,
            "unit": "ns/op",
            "extra": "samples: 718915, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 129.8,
            "unit": "ns/op",
            "extra": "samples: 3852041, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 4490.78,
            "unit": "ns/op",
            "extra": "samples: 111340, rme: ±5.64%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 391.57,
            "unit": "ns/op",
            "extra": "samples: 1276896, rme: ±0.82%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 114.87,
            "unit": "ns/op",
            "extra": "samples: 4352625, rme: ±0.31%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 13663.22,
            "unit": "ns/op",
            "extra": "samples: 36595, rme: ±0.45%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 10296.19,
            "unit": "ns/op",
            "extra": "samples: 48562, rme: ±0.52%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1116.84,
            "unit": "ns/op",
            "extra": "samples: 447691, rme: ±1.15%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 7456.93,
            "unit": "ns/op",
            "extra": "samples: 67052, rme: ±1.57%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 29229.9,
            "unit": "ns/op",
            "extra": "samples: 17106, rme: ±1.19%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 1981.38,
            "unit": "ns/op",
            "extra": "samples: 252368, rme: ±2.14%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 517.48,
            "unit": "ns/op",
            "extra": "samples: 966214, rme: ±0.42%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 490.14,
            "unit": "ns/op",
            "extra": "samples: 1020112, rme: ±0.25%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 489.7,
            "unit": "ns/op",
            "extra": "samples: 1021036, rme: ±0.25%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 99508.04,
            "unit": "ns/op",
            "extra": "samples: 5025, rme: ±12.88%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 123035.45,
            "unit": "ns/op",
            "extra": "samples: 4064, rme: ±8.97%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 95551.74,
            "unit": "ns/op",
            "extra": "samples: 5233, rme: ±9.56%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 79520.79,
            "unit": "ns/op",
            "extra": "samples: 6288, rme: ±9.37%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 59516.28,
            "unit": "ns/op",
            "extra": "samples: 8407, rme: ±11.57%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 88765.78,
            "unit": "ns/op",
            "extra": "samples: 5662, rme: ±9.93%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 136374.15,
            "unit": "ns/op",
            "extra": "samples: 3667, rme: ±8.10%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 131559.75,
            "unit": "ns/op",
            "extra": "samples: 3801, rme: ±7.44%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 109370.64,
            "unit": "ns/op",
            "extra": "samples: 4572, rme: ±8.40%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 787766.07,
            "unit": "ns/op",
            "extra": "samples: 635, rme: ±8.21%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 681502.72,
            "unit": "ns/op",
            "extra": "samples: 734, rme: ±7.68%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "49a2c7f14b15f6a7b9b64fdc51ae9eefa0923216",
          "message": "[test] conformance: black-box mutant tests for the effects manager (#190)",
          "timestamp": "2026-10-18T21:03:05-05:00",
          "tree_id": "88a8aa89091d4b74bba95c7c970ab325511a264d",
          "url": "https://github.com/directive-run/directive/commit/49a2c7f14b15f6a7b9b64fdc51ae9eefa0923216"
        },
        "date": 1792375527203,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 127.02,
            "unit": "ns/op",
            "extra": "samples: 3936299, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 58.25,
            "unit": "ns/op",
            "extra": "samples: 8584038, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 59.9,
            "unit": "ns/op",
            "extra": "samples: 8347777, rme: ±0.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 99.4,
            "unit": "ns/op",
            "extra": "samples: 5030389, rme: ±0.26%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 168.08,
            "unit": "ns/op",
            "extra": "samples: 2974751, rme: ±5.00%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 60.2,
            "unit": "ns/op",
            "extra": "samples: 8305612, rme: ±0.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 61.07,
            "unit": "ns/op",
            "extra": "samples: 8187619, rme: ±0.16%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 461.46,
            "unit": "ns/op",
            "extra": "samples: 1083508, rme: ±2.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 149.38,
            "unit": "ns/op",
            "extra": "samples: 3347158, rme: ±1.57%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1091.04,
            "unit": "ns/op",
            "extra": "samples: 458278, rme: ±1.00%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 246.55,
            "unit": "ns/op",
            "extra": "samples: 2027992, rme: ±0.88%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 853.66,
            "unit": "ns/op",
            "extra": "samples: 589000, rme: ±3.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 67.02,
            "unit": "ns/op",
            "extra": "samples: 7460447, rme: ±0.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 1932.77,
            "unit": "ns/op",
            "extra": "samples: 258697, rme: ±0.86%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 240253.59,
            "unit": "ns/op",
            "extra": "samples: 2082, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 74546.26,
            "unit": "ns/op",
            "extra": "samples: 6708, rme: ±1.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 923629.91,
            "unit": "ns/op",
            "extra": "samples: 542, rme: ±1.18%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 184622.81,
            "unit": "ns/op",
            "extra": "samples: 2709, rme: ±0.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 819287.62,
            "unit": "ns/op",
            "extra": "samples: 611, rme: ±1.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 19106.79,
            "unit": "ns/op",
            "extra": "samples: 26182, rme: ±1.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 1946457.31,
            "unit": "ns/op",
            "extra": "samples: 258, rme: ±1.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1531.52,
            "unit": "ns/op",
            "extra": "samples: 326474, rme: ±3.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 168.19,
            "unit": "ns/op",
            "extra": "samples: 2972901, rme: ±3.89%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1077.08,
            "unit": "ns/op",
            "extra": "samples: 464218, rme: ±1.06%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 454.62,
            "unit": "ns/op",
            "extra": "samples: 1099823, rme: ±1.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2497.14,
            "unit": "ns/op",
            "extra": "samples: 200634, rme: ±6.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 94.2,
            "unit": "ns/op",
            "extra": "samples: 5307847, rme: ±0.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2039.24,
            "unit": "ns/op",
            "extra": "samples: 245190, rme: ±1.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 10137.78,
            "unit": "ns/op",
            "extra": "samples: 49321, rme: ±0.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3403.34,
            "unit": "ns/op",
            "extra": "samples: 146915, rme: ±1.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 46261.12,
            "unit": "ns/op",
            "extra": "samples: 10809, rme: ±1.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 7620.94,
            "unit": "ns/op",
            "extra": "samples: 65609, rme: ±0.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 33767.83,
            "unit": "ns/op",
            "extra": "samples: 14807, rme: ±1.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 799.6,
            "unit": "ns/op",
            "extra": "samples: 625312, rme: ±2.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 97492.86,
            "unit": "ns/op",
            "extra": "samples: 5129, rme: ±1.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 107489.46,
            "unit": "ns/op",
            "extra": "samples: 4652, rme: ±14.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 676.68,
            "unit": "ns/op",
            "extra": "samples: 738899, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 180181.48,
            "unit": "ns/op",
            "extra": "samples: 2775, rme: ±3.78%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1102.38,
            "unit": "ns/op",
            "extra": "samples: 453565, rme: ±2.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 87634.8,
            "unit": "ns/op",
            "extra": "samples: 5706, rme: ±9.93%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 67.44,
            "unit": "ns/op",
            "extra": "samples: 7414122, rme: ±1.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 10331.57,
            "unit": "ns/op",
            "extra": "samples: 48396, rme: ±6.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3072.67,
            "unit": "ns/op",
            "extra": "samples: 162725, rme: ±1.42%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1344.67,
            "unit": "ns/op",
            "extra": "samples: 371838, rme: ±10.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 51.03,
            "unit": "ns/op",
            "extra": "samples: 9798266, rme: ±0.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 9739.99,
            "unit": "ns/op",
            "extra": "samples: 51335, rme: ±9.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 956.5,
            "unit": "ns/op",
            "extra": "samples: 522741, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 395.79,
            "unit": "ns/op",
            "extra": "samples: 1263305, rme: ±0.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 665.5,
            "unit": "ns/op",
            "extra": "samples: 751313, rme: ±0.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 73.92,
            "unit": "ns/op",
            "extra": "samples: 6764147, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1028.73,
            "unit": "ns/op",
            "extra": "samples: 486038, rme: ±1.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2042681.65,
            "unit": "ns/op",
            "extra": "samples: 245, rme: ±0.91%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 631096.57,
            "unit": "ns/op",
            "extra": "samples: 793, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 9234115.67,
            "unit": "ns/op",
            "extra": "samples: 55, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 1587790.38,
            "unit": "ns/op",
            "extra": "samples: 315, rme: ±0.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 6613552.07,
            "unit": "ns/op",
            "extra": "samples: 76, rme: ±3.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 170549.81,
            "unit": "ns/op",
            "extra": "samples: 2932, rme: ±1.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 19242362,
            "unit": "ns/op",
            "extra": "samples: 26, rme: ±0.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 26101.89,
            "unit": "ns/op",
            "extra": "samples: 19156, rme: ±0.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 7351.67,
            "unit": "ns/op",
            "extra": "samples: 68012, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 95249.92,
            "unit": "ns/op",
            "extra": "samples: 5250, rme: ±0.83%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 18888.3,
            "unit": "ns/op",
            "extra": "samples: 26472, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 83172.93,
            "unit": "ns/op",
            "extra": "samples: 6012, rme: ±1.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2325.65,
            "unit": "ns/op",
            "extra": "samples: 214994, rme: ±0.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 189312.63,
            "unit": "ns/op",
            "extra": "samples: 2642, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 2796.8,
            "unit": "ns/op",
            "extra": "samples: 178776, rme: ±0.94%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 784.25,
            "unit": "ns/op",
            "extra": "samples: 637550, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 137.05,
            "unit": "ns/op",
            "extra": "samples: 3648419, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 5544.44,
            "unit": "ns/op",
            "extra": "samples: 90198, rme: ±7.49%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 528.9,
            "unit": "ns/op",
            "extra": "samples: 945354, rme: ±1.04%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 121.04,
            "unit": "ns/op",
            "extra": "samples: 4130958, rme: ±0.10%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 12167.69,
            "unit": "ns/op",
            "extra": "samples: 41093, rme: ±1.37%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 9277.53,
            "unit": "ns/op",
            "extra": "samples: 53894, rme: ±0.43%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1444.07,
            "unit": "ns/op",
            "extra": "samples: 346244, rme: ±0.93%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 7527.08,
            "unit": "ns/op",
            "extra": "samples: 66428, rme: ±0.65%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 35416.63,
            "unit": "ns/op",
            "extra": "samples: 14118, rme: ±1.00%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2183.12,
            "unit": "ns/op",
            "extra": "samples: 229068, rme: ±1.45%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 663.47,
            "unit": "ns/op",
            "extra": "samples: 753615, rme: ±0.10%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 691.12,
            "unit": "ns/op",
            "extra": "samples: 723473, rme: ±0.29%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 677.81,
            "unit": "ns/op",
            "extra": "samples: 737668, rme: ±0.11%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 140203.24,
            "unit": "ns/op",
            "extra": "samples: 3596, rme: ±10.94%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 181115.91,
            "unit": "ns/op",
            "extra": "samples: 2771, rme: ±7.78%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 163222.15,
            "unit": "ns/op",
            "extra": "samples: 3086, rme: ±8.83%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 137368.85,
            "unit": "ns/op",
            "extra": "samples: 3640, rme: ±8.64%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 97022.13,
            "unit": "ns/op",
            "extra": "samples: 5154, rme: ±10.35%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 146505.72,
            "unit": "ns/op",
            "extra": "samples: 3413, rme: ±9.07%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 199950.77,
            "unit": "ns/op",
            "extra": "samples: 2501, rme: ±7.70%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 198588.35,
            "unit": "ns/op",
            "extra": "samples: 2518, rme: ±7.06%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 174281.17,
            "unit": "ns/op",
            "extra": "samples: 2869, rme: ±8.36%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 855566.29,
            "unit": "ns/op",
            "extra": "samples: 585, rme: ±7.73%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 651274.6,
            "unit": "ns/op",
            "extra": "samples: 769, rme: ±6.27%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "64e79dce25a8ee7dc14aef45eed9d374b1923ebb",
          "message": "test(conformance): black-box effects tests (B2) (#195)\n\n* test(conformance): black-box effects tests kill effects.ts mutants (B2)\n\n* conformance: unknown-effect guard is public; assert the error and drop its internals-only triage",
          "timestamp": "2026-10-18T22:51:41-05:00",
          "tree_id": "63dbf0dc56fb8cbb1df32e2169197b27b1f21fb5",
          "url": "https://github.com/directive-run/directive/commit/64e79dce25a8ee7dc14aef45eed9d374b1923ebb"
        },
        "date": 1792382044175,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 163.58,
            "unit": "ns/op",
            "extra": "samples: 3056691, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 76.6,
            "unit": "ns/op",
            "extra": "samples: 6527233, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 76.28,
            "unit": "ns/op",
            "extra": "samples: 6554570, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 127.44,
            "unit": "ns/op",
            "extra": "samples: 3923404, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 221.6,
            "unit": "ns/op",
            "extra": "samples: 2256351, rme: ±1.21%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 76.71,
            "unit": "ns/op",
            "extra": "samples: 6517889, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 76.86,
            "unit": "ns/op",
            "extra": "samples: 6505543, rme: ±0.18%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 580.2,
            "unit": "ns/op",
            "extra": "samples: 861769, rme: ±1.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 177.77,
            "unit": "ns/op",
            "extra": "samples: 2812664, rme: ±1.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1247.12,
            "unit": "ns/op",
            "extra": "samples: 400923, rme: ±2.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 359.57,
            "unit": "ns/op",
            "extra": "samples: 1390557, rme: ±0.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 1059.59,
            "unit": "ns/op",
            "extra": "samples: 471881, rme: ±1.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 87.28,
            "unit": "ns/op",
            "extra": "samples: 5728746, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2426.42,
            "unit": "ns/op",
            "extra": "samples: 206065, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 339973.49,
            "unit": "ns/op",
            "extra": "samples: 1471, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 76359.38,
            "unit": "ns/op",
            "extra": "samples: 6548, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1161901.1,
            "unit": "ns/op",
            "extra": "samples: 431, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 269231.52,
            "unit": "ns/op",
            "extra": "samples: 1858, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1123245.33,
            "unit": "ns/op",
            "extra": "samples: 446, rme: ±1.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 23690.58,
            "unit": "ns/op",
            "extra": "samples: 21106, rme: ±1.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2351790.95,
            "unit": "ns/op",
            "extra": "samples: 213, rme: ±1.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1759.78,
            "unit": "ns/op",
            "extra": "samples: 284128, rme: ±1.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 170.33,
            "unit": "ns/op",
            "extra": "samples: 2935440, rme: ±1.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1249.93,
            "unit": "ns/op",
            "extra": "samples: 400022, rme: ±0.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 651.58,
            "unit": "ns/op",
            "extra": "samples: 767361, rme: ±0.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 3040.59,
            "unit": "ns/op",
            "extra": "samples: 164442, rme: ±6.05%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 123.79,
            "unit": "ns/op",
            "extra": "samples: 4039108, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2449.49,
            "unit": "ns/op",
            "extra": "samples: 204124, rme: ±0.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12599.93,
            "unit": "ns/op",
            "extra": "samples: 39683, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3877.34,
            "unit": "ns/op",
            "extra": "samples: 128955, rme: ±1.34%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 58614.91,
            "unit": "ns/op",
            "extra": "samples: 8531, rme: ±1.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 10281.67,
            "unit": "ns/op",
            "extra": "samples: 48631, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 46578.78,
            "unit": "ns/op",
            "extra": "samples: 10735, rme: ±1.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 902.02,
            "unit": "ns/op",
            "extra": "samples: 554309, rme: ±1.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 119220.6,
            "unit": "ns/op",
            "extra": "samples: 4194, rme: ±2.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 149763.87,
            "unit": "ns/op",
            "extra": "samples: 3339, rme: ±12.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 951.49,
            "unit": "ns/op",
            "extra": "samples: 525611, rme: ±2.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 243903.5,
            "unit": "ns/op",
            "extra": "samples: 2050, rme: ±4.26%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1468.65,
            "unit": "ns/op",
            "extra": "samples: 340449, rme: ±1.78%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 139244.74,
            "unit": "ns/op",
            "extra": "samples: 3619, rme: ±11.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 83.46,
            "unit": "ns/op",
            "extra": "samples: 5991046, rme: ±1.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 14269.04,
            "unit": "ns/op",
            "extra": "samples: 35041, rme: ±6.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 4049.53,
            "unit": "ns/op",
            "extra": "samples: 123472, rme: ±2.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1643.09,
            "unit": "ns/op",
            "extra": "samples: 305594, rme: ±11.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 72.97,
            "unit": "ns/op",
            "extra": "samples: 6851987, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 13080.24,
            "unit": "ns/op",
            "extra": "samples: 38323, rme: ±10.18%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1383.48,
            "unit": "ns/op",
            "extra": "samples: 361407, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 627.46,
            "unit": "ns/op",
            "extra": "samples: 796870, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 1054.36,
            "unit": "ns/op",
            "extra": "samples: 474223, rme: ±2.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 98.47,
            "unit": "ns/op",
            "extra": "samples: 5077442, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1311.97,
            "unit": "ns/op",
            "extra": "samples: 381107, rme: ±1.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2294094.79,
            "unit": "ns/op",
            "extra": "samples: 218, rme: ±2.53%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 717400.34,
            "unit": "ns/op",
            "extra": "samples: 697, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 11800935.67,
            "unit": "ns/op",
            "extra": "samples: 43, rme: ±0.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2348780.21,
            "unit": "ns/op",
            "extra": "samples: 213, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 9366960.43,
            "unit": "ns/op",
            "extra": "samples: 54, rme: ±4.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 217536.09,
            "unit": "ns/op",
            "extra": "samples: 2299, rme: ±1.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 23723858.86,
            "unit": "ns/op",
            "extra": "samples: 22, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 32553.25,
            "unit": "ns/op",
            "extra": "samples: 15360, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 8247.35,
            "unit": "ns/op",
            "extra": "samples: 60626, rme: ±1.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 122402.63,
            "unit": "ns/op",
            "extra": "samples: 4085, rme: ±1.52%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 26722.99,
            "unit": "ns/op",
            "extra": "samples: 18711, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 113125.14,
            "unit": "ns/op",
            "extra": "samples: 4420, rme: ±1.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2799.41,
            "unit": "ns/op",
            "extra": "samples: 178633, rme: ±0.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 237315.78,
            "unit": "ns/op",
            "extra": "samples: 2107, rme: ±1.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3577.79,
            "unit": "ns/op",
            "extra": "samples: 139752, rme: ±1.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1021.96,
            "unit": "ns/op",
            "extra": "samples: 489258, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 201.12,
            "unit": "ns/op",
            "extra": "samples: 2486055, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6857.83,
            "unit": "ns/op",
            "extra": "samples: 72910, rme: ±7.06%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 661.15,
            "unit": "ns/op",
            "extra": "samples: 756264, rme: ±0.92%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 158.41,
            "unit": "ns/op",
            "extra": "samples: 3156497, rme: ±0.15%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 18842.94,
            "unit": "ns/op",
            "extra": "samples: 26536, rme: ±0.33%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 14958.36,
            "unit": "ns/op",
            "extra": "samples: 33427, rme: ±0.40%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1829.22,
            "unit": "ns/op",
            "extra": "samples: 273341, rme: ±0.26%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 9865.05,
            "unit": "ns/op",
            "extra": "samples: 50684, rme: ±0.75%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 46775.64,
            "unit": "ns/op",
            "extra": "samples: 10690, rme: ±1.29%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2681.6,
            "unit": "ns/op",
            "extra": "samples: 186456, rme: ±1.39%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 821.23,
            "unit": "ns/op",
            "extra": "samples: 608843, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 834.28,
            "unit": "ns/op",
            "extra": "samples: 599319, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 823.94,
            "unit": "ns/op",
            "extra": "samples: 606839, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 197573.1,
            "unit": "ns/op",
            "extra": "samples: 2531, rme: ±9.96%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 234146.04,
            "unit": "ns/op",
            "extra": "samples: 2136, rme: ±7.35%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 240088.58,
            "unit": "ns/op",
            "extra": "samples: 2083, rme: ±8.96%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 184530.05,
            "unit": "ns/op",
            "extra": "samples: 2710, rme: ±7.98%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 136786.57,
            "unit": "ns/op",
            "extra": "samples: 3656, rme: ±9.65%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 196332.72,
            "unit": "ns/op",
            "extra": "samples: 2547, rme: ±8.69%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 258753.53,
            "unit": "ns/op",
            "extra": "samples: 1933, rme: ±7.15%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 282868.07,
            "unit": "ns/op",
            "extra": "samples: 1768, rme: ±6.57%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 227020.56,
            "unit": "ns/op",
            "extra": "samples: 2203, rme: ±7.76%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1523149.22,
            "unit": "ns/op",
            "extra": "samples: 329, rme: ±8.61%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 1073676.12,
            "unit": "ns/op",
            "extra": "samples: 466, rme: ±6.77%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "bd9330debc6ba6c2562da7d2481104bdc49627c2",
          "message": "test(core): black-box facts tests for the mutation gate (B1) (#196)\n\n* test(core): black-box tests for facts.ts to lift the honest mutation gate\n\n* test(conformance): pin user-visible facts behaviour, drop Proxy/dev-warning mechanics",
          "timestamp": "2026-10-18T23:12:31-05:00",
          "tree_id": "0cf377ef81aebae5a1695e402a1e236c726f4b13",
          "url": "https://github.com/directive-run/directive/commit/bd9330debc6ba6c2562da7d2481104bdc49627c2"
        },
        "date": 1792383296659,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 160.1,
            "unit": "ns/op",
            "extra": "samples: 3123109, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 75.45,
            "unit": "ns/op",
            "extra": "samples: 6627307, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 75.7,
            "unit": "ns/op",
            "extra": "samples: 6604888, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 119.04,
            "unit": "ns/op",
            "extra": "samples: 4200125, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 207.17,
            "unit": "ns/op",
            "extra": "samples: 2413520, rme: ±5.01%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 76.62,
            "unit": "ns/op",
            "extra": "samples: 6525423, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 76.25,
            "unit": "ns/op",
            "extra": "samples: 6557585, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 548.72,
            "unit": "ns/op",
            "extra": "samples: 911207, rme: ±0.89%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 159.99,
            "unit": "ns/op",
            "extra": "samples: 3125280, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1260.95,
            "unit": "ns/op",
            "extra": "samples: 396528, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 331.43,
            "unit": "ns/op",
            "extra": "samples: 1508629, rme: ±0.52%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 1016.01,
            "unit": "ns/op",
            "extra": "samples: 492122, rme: ±0.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 84.36,
            "unit": "ns/op",
            "extra": "samples: 5926801, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2399.24,
            "unit": "ns/op",
            "extra": "samples: 208400, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 342515.93,
            "unit": "ns/op",
            "extra": "samples: 1460, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 85239.74,
            "unit": "ns/op",
            "extra": "samples: 5866, rme: ±0.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1143045.5,
            "unit": "ns/op",
            "extra": "samples: 438, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 245320.59,
            "unit": "ns/op",
            "extra": "samples: 2039, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1117923.38,
            "unit": "ns/op",
            "extra": "samples: 448, rme: ±3.26%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 21325,
            "unit": "ns/op",
            "extra": "samples: 23447, rme: ±0.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2238182.51,
            "unit": "ns/op",
            "extra": "samples: 224, rme: ±0.52%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1742.98,
            "unit": "ns/op",
            "extra": "samples: 286865, rme: ±1.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 164.91,
            "unit": "ns/op",
            "extra": "samples: 3032037, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1229.16,
            "unit": "ns/op",
            "extra": "samples: 406784, rme: ±0.21%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 623.12,
            "unit": "ns/op",
            "extra": "samples: 802418, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2808.24,
            "unit": "ns/op",
            "extra": "samples: 178048, rme: ±4.76%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 116.37,
            "unit": "ns/op",
            "extra": "samples: 4296710, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2405.94,
            "unit": "ns/op",
            "extra": "samples: 207819, rme: ±0.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12564.47,
            "unit": "ns/op",
            "extra": "samples: 39795, rme: ±0.33%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3658.53,
            "unit": "ns/op",
            "extra": "samples: 136667, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 57571.06,
            "unit": "ns/op",
            "extra": "samples: 8685, rme: ±2.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 10294.75,
            "unit": "ns/op",
            "extra": "samples: 48569, rme: ±0.29%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 45798.11,
            "unit": "ns/op",
            "extra": "samples: 10923, rme: ±1.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 851.62,
            "unit": "ns/op",
            "extra": "samples: 587117, rme: ±0.88%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 113496.6,
            "unit": "ns/op",
            "extra": "samples: 4406, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 168026.61,
            "unit": "ns/op",
            "extra": "samples: 2976, rme: ±13.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 870.51,
            "unit": "ns/op",
            "extra": "samples: 574374, rme: ±1.01%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 262728.2,
            "unit": "ns/op",
            "extra": "samples: 1904, rme: ±5.01%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1214.73,
            "unit": "ns/op",
            "extra": "samples: 411616, rme: ±0.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 139523.87,
            "unit": "ns/op",
            "extra": "samples: 3584, rme: ±11.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 81.76,
            "unit": "ns/op",
            "extra": "samples: 6115810, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 13758.49,
            "unit": "ns/op",
            "extra": "samples: 36342, rme: ±5.36%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3884.68,
            "unit": "ns/op",
            "extra": "samples: 128711, rme: ±1.16%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1428.45,
            "unit": "ns/op",
            "extra": "samples: 350030, rme: ±9.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 69.14,
            "unit": "ns/op",
            "extra": "samples: 7231635, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 12265.58,
            "unit": "ns/op",
            "extra": "samples: 40765, rme: ±9.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1329.71,
            "unit": "ns/op",
            "extra": "samples: 376023, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 614.11,
            "unit": "ns/op",
            "extra": "samples: 814183, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 931.27,
            "unit": "ns/op",
            "extra": "samples: 536901, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 98.23,
            "unit": "ns/op",
            "extra": "samples: 5089892, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1340.64,
            "unit": "ns/op",
            "extra": "samples: 372958, rme: ±0.47%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2209692.2,
            "unit": "ns/op",
            "extra": "samples: 227, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 704341.26,
            "unit": "ns/op",
            "extra": "samples: 710, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 11716286.53,
            "unit": "ns/op",
            "extra": "samples: 43, rme: ±0.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2055777.36,
            "unit": "ns/op",
            "extra": "samples: 244, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 9259400.94,
            "unit": "ns/op",
            "extra": "samples: 54, rme: ±3.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 199666.76,
            "unit": "ns/op",
            "extra": "samples: 2505, rme: ±0.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 22987080.18,
            "unit": "ns/op",
            "extra": "samples: 22, rme: ±0.28%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 34072.16,
            "unit": "ns/op",
            "extra": "samples: 14675, rme: ±1.22%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 7752.21,
            "unit": "ns/op",
            "extra": "samples: 64498, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 117953.1,
            "unit": "ns/op",
            "extra": "samples: 4239, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 25823.73,
            "unit": "ns/op",
            "extra": "samples: 19363, rme: ±0.32%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 112731.9,
            "unit": "ns/op",
            "extra": "samples: 4436, rme: ±1.41%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2609.87,
            "unit": "ns/op",
            "extra": "samples: 191581, rme: ±0.68%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 231667.54,
            "unit": "ns/op",
            "extra": "samples: 2159, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3586.16,
            "unit": "ns/op",
            "extra": "samples: 139425, rme: ±1.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1038.23,
            "unit": "ns/op",
            "extra": "samples: 481588, rme: ±0.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 187.62,
            "unit": "ns/op",
            "extra": "samples: 2664981, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6484.68,
            "unit": "ns/op",
            "extra": "samples: 77105, rme: ±6.12%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 631.02,
            "unit": "ns/op",
            "extra": "samples: 792374, rme: ±0.66%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 158.59,
            "unit": "ns/op",
            "extra": "samples: 3152704, rme: ±0.15%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 19828.18,
            "unit": "ns/op",
            "extra": "samples: 25217, rme: ±0.33%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 15108.44,
            "unit": "ns/op",
            "extra": "samples: 33095, rme: ±0.32%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1811.2,
            "unit": "ns/op",
            "extra": "samples: 276061, rme: ±1.39%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 10143.73,
            "unit": "ns/op",
            "extra": "samples: 49292, rme: ±1.80%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 46124.07,
            "unit": "ns/op",
            "extra": "samples: 10841, rme: ±0.69%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2648.87,
            "unit": "ns/op",
            "extra": "samples: 188762, rme: ±0.86%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 792.82,
            "unit": "ns/op",
            "extra": "samples: 630663, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 812.55,
            "unit": "ns/op",
            "extra": "samples: 615345, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 819.26,
            "unit": "ns/op",
            "extra": "samples: 610308, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 186200.75,
            "unit": "ns/op",
            "extra": "samples: 2686, rme: ±11.30%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 227399.48,
            "unit": "ns/op",
            "extra": "samples: 2199, rme: ±7.10%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 221767.03,
            "unit": "ns/op",
            "extra": "samples: 2255, rme: ±7.68%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 180468.71,
            "unit": "ns/op",
            "extra": "samples: 2771, rme: ±7.94%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 134160.26,
            "unit": "ns/op",
            "extra": "samples: 3754, rme: ±8.76%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 190362.93,
            "unit": "ns/op",
            "extra": "samples: 2627, rme: ±7.77%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 261548.53,
            "unit": "ns/op",
            "extra": "samples: 1912, rme: ±6.51%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 269180.92,
            "unit": "ns/op",
            "extra": "samples: 1858, rme: ±5.78%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 228382.11,
            "unit": "ns/op",
            "extra": "samples: 2190, rme: ±6.40%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1424917.23,
            "unit": "ns/op",
            "extra": "samples: 351, rme: ±6.65%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 1059592.51,
            "unit": "ns/op",
            "extra": "samples: 472, rme: ±5.60%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "c38a4d3e6f92377c88d02f3d6491027e11247a4f",
          "message": "[test] conformance: black-box tests for tracking.ts and derivations.ts mutants (#193)\n\n* [test] conformance: black-box tests for tracking and derivations mutants\n\n* [test] conformance: fix round for derivations/tracking mutation triage",
          "timestamp": "2026-10-18T23:19:38-05:00",
          "tree_id": "194c86283094757a3fd4479f9331952ff76c2fa8",
          "url": "https://github.com/directive-run/directive/commit/c38a4d3e6f92377c88d02f3d6491027e11247a4f"
        },
        "date": 1792383718593,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 160.26,
            "unit": "ns/op",
            "extra": "samples: 3119883, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 78.81,
            "unit": "ns/op",
            "extra": "samples: 6344611, rme: ±0.18%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 79,
            "unit": "ns/op",
            "extra": "samples: 6329508, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 128.59,
            "unit": "ns/op",
            "extra": "samples: 3888446, rme: ±0.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 206.29,
            "unit": "ns/op",
            "extra": "samples: 2423792, rme: ±0.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 78.92,
            "unit": "ns/op",
            "extra": "samples: 6335718, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 79.95,
            "unit": "ns/op",
            "extra": "samples: 6254208, rme: ±0.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 559.93,
            "unit": "ns/op",
            "extra": "samples: 892977, rme: ±1.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 169.29,
            "unit": "ns/op",
            "extra": "samples: 2954006, rme: ±0.86%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1246.31,
            "unit": "ns/op",
            "extra": "samples: 401185, rme: ±0.31%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 314.81,
            "unit": "ns/op",
            "extra": "samples: 1588237, rme: ±0.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 996.86,
            "unit": "ns/op",
            "extra": "samples: 501575, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 89.19,
            "unit": "ns/op",
            "extra": "samples: 5606045, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2417.65,
            "unit": "ns/op",
            "extra": "samples: 206813, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 315514.75,
            "unit": "ns/op",
            "extra": "samples: 1585, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 85400.85,
            "unit": "ns/op",
            "extra": "samples: 5855, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1138431.44,
            "unit": "ns/op",
            "extra": "samples: 440, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 230420.5,
            "unit": "ns/op",
            "extra": "samples: 2170, rme: ±0.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1101479.74,
            "unit": "ns/op",
            "extra": "samples: 454, rme: ±3.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 22215.13,
            "unit": "ns/op",
            "extra": "samples: 22508, rme: ±0.69%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2294501.48,
            "unit": "ns/op",
            "extra": "samples: 218, rme: ±0.58%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1727.12,
            "unit": "ns/op",
            "extra": "samples: 289500, rme: ±1.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 175.3,
            "unit": "ns/op",
            "extra": "samples: 2852176, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1265.61,
            "unit": "ns/op",
            "extra": "samples: 395068, rme: ±0.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 564.79,
            "unit": "ns/op",
            "extra": "samples: 885288, rme: ±0.57%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2912.29,
            "unit": "ns/op",
            "extra": "samples: 171686, rme: ±4.29%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 115.96,
            "unit": "ns/op",
            "extra": "samples: 4311722, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2419.71,
            "unit": "ns/op",
            "extra": "samples: 206636, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12477.74,
            "unit": "ns/op",
            "extra": "samples: 40073, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 4007.47,
            "unit": "ns/op",
            "extra": "samples: 124767, rme: ±0.79%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 56157.52,
            "unit": "ns/op",
            "extra": "samples: 8904, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 9572.5,
            "unit": "ns/op",
            "extra": "samples: 52233, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 42821.79,
            "unit": "ns/op",
            "extra": "samples: 11677, rme: ±1.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 957.83,
            "unit": "ns/op",
            "extra": "samples: 522011, rme: ±1.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 117935.08,
            "unit": "ns/op",
            "extra": "samples: 4241, rme: ±1.41%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 131118.98,
            "unit": "ns/op",
            "extra": "samples: 3848, rme: ±14.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 880.03,
            "unit": "ns/op",
            "extra": "samples: 568160, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 226801.33,
            "unit": "ns/op",
            "extra": "samples: 2205, rme: ±3.00%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1343.67,
            "unit": "ns/op",
            "extra": "samples: 372117, rme: ±0.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 110757.7,
            "unit": "ns/op",
            "extra": "samples: 4515, rme: ±10.89%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 87.02,
            "unit": "ns/op",
            "extra": "samples: 5745912, rme: ±2.55%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 12227.66,
            "unit": "ns/op",
            "extra": "samples: 40891, rme: ±5.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3833.17,
            "unit": "ns/op",
            "extra": "samples: 130441, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1413.97,
            "unit": "ns/op",
            "extra": "samples: 355126, rme: ±9.38%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 70.07,
            "unit": "ns/op",
            "extra": "samples: 7135585, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 12430.83,
            "unit": "ns/op",
            "extra": "samples: 40223, rme: ±10.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1232.5,
            "unit": "ns/op",
            "extra": "samples: 405680, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 534.5,
            "unit": "ns/op",
            "extra": "samples: 935463, rme: ±2.21%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 864.51,
            "unit": "ns/op",
            "extra": "samples: 578365, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 95.43,
            "unit": "ns/op",
            "extra": "samples: 5239710, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1260.07,
            "unit": "ns/op",
            "extra": "samples: 396804, rme: ±0.61%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2317003.57,
            "unit": "ns/op",
            "extra": "samples: 216, rme: ±0.53%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 778327.82,
            "unit": "ns/op",
            "extra": "samples: 643, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 12206187,
            "unit": "ns/op",
            "extra": "samples: 41, rme: ±0.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2056668.82,
            "unit": "ns/op",
            "extra": "samples: 244, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 8951420.25,
            "unit": "ns/op",
            "extra": "samples: 56, rme: ±6.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 217161.92,
            "unit": "ns/op",
            "extra": "samples: 2303, rme: ±0.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 24096446.71,
            "unit": "ns/op",
            "extra": "samples: 21, rme: ±0.37%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 31692.24,
            "unit": "ns/op",
            "extra": "samples: 15777, rme: ±0.41%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 8520.6,
            "unit": "ns/op",
            "extra": "samples: 58682, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 119435.72,
            "unit": "ns/op",
            "extra": "samples: 4187, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 24708.27,
            "unit": "ns/op",
            "extra": "samples: 20237, rme: ±0.42%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 107411.85,
            "unit": "ns/op",
            "extra": "samples: 4655, rme: ±1.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2955.1,
            "unit": "ns/op",
            "extra": "samples: 169199, rme: ±0.81%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 244222.28,
            "unit": "ns/op",
            "extra": "samples: 2048, rme: ±0.90%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3643.19,
            "unit": "ns/op",
            "extra": "samples: 137243, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1007.78,
            "unit": "ns/op",
            "extra": "samples: 496139, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 175.5,
            "unit": "ns/op",
            "extra": "samples: 2849064, rme: ±0.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6704.2,
            "unit": "ns/op",
            "extra": "samples: 74670, rme: ±6.69%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 662.05,
            "unit": "ns/op",
            "extra": "samples: 755230, rme: ±0.72%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 153.69,
            "unit": "ns/op",
            "extra": "samples: 3253287, rme: ±0.17%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 13352.54,
            "unit": "ns/op",
            "extra": "samples: 37447, rme: ±0.29%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 11883.52,
            "unit": "ns/op",
            "extra": "samples: 42076, rme: ±0.43%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1861.63,
            "unit": "ns/op",
            "extra": "samples: 268582, rme: ±1.72%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 9703.96,
            "unit": "ns/op",
            "extra": "samples: 51527, rme: ±1.19%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 46032.81,
            "unit": "ns/op",
            "extra": "samples: 10862, rme: ±1.50%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2658.28,
            "unit": "ns/op",
            "extra": "samples: 188092, rme: ±1.26%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 824.3,
            "unit": "ns/op",
            "extra": "samples: 606576, rme: ±0.11%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 829.64,
            "unit": "ns/op",
            "extra": "samples: 602675, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 833.91,
            "unit": "ns/op",
            "extra": "samples: 599585, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 168887.3,
            "unit": "ns/op",
            "extra": "samples: 2961, rme: ±11.48%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 216090.74,
            "unit": "ns/op",
            "extra": "samples: 2329, rme: ±6.73%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 201636.34,
            "unit": "ns/op",
            "extra": "samples: 2480, rme: ±7.90%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 166190.17,
            "unit": "ns/op",
            "extra": "samples: 3009, rme: ±7.83%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 120744.07,
            "unit": "ns/op",
            "extra": "samples: 4141, rme: ±10.02%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 174358.43,
            "unit": "ns/op",
            "extra": "samples: 2868, rme: ±7.63%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 238797.82,
            "unit": "ns/op",
            "extra": "samples: 2094, rme: ±6.77%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 241436.8,
            "unit": "ns/op",
            "extra": "samples: 2071, rme: ±5.71%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 207573.95,
            "unit": "ns/op",
            "extra": "samples: 2412, rme: ±7.43%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1021469.24,
            "unit": "ns/op",
            "extra": "samples: 490, rme: ±6.75%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 826529.98,
            "unit": "ns/op",
            "extra": "samples: 605, rme: ±5.94%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "36ed15ce4c32375ba38019e00b28e9c69a9a977a",
          "message": "test(conformance): black-box gate for read-only-view and module (#197)\n\n* test(conformance): black-box tests for read-only-view and module, with triage\n\n* test(conformance): loosen read-only view oracle off Proxy mechanics, re-triage",
          "timestamp": "2026-10-19T20:58:10-05:00",
          "tree_id": "25cbe10a1672b09da1179952a3e2303c55a827e6",
          "url": "https://github.com/directive-run/directive/commit/36ed15ce4c32375ba38019e00b28e9c69a9a977a"
        },
        "date": 1792461632041,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 151.84,
            "unit": "ns/op",
            "extra": "samples: 3292886, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 76.96,
            "unit": "ns/op",
            "extra": "samples: 6496852, rme: ±0.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 76.46,
            "unit": "ns/op",
            "extra": "samples: 6539724, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 129.32,
            "unit": "ns/op",
            "extra": "samples: 3866294, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 235.88,
            "unit": "ns/op",
            "extra": "samples: 2119692, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 77.64,
            "unit": "ns/op",
            "extra": "samples: 6439928, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 77.83,
            "unit": "ns/op",
            "extra": "samples: 6424063, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 539.31,
            "unit": "ns/op",
            "extra": "samples: 927110, rme: ±0.76%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 169.34,
            "unit": "ns/op",
            "extra": "samples: 2952617, rme: ±2.36%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1178.09,
            "unit": "ns/op",
            "extra": "samples: 424416, rme: ±0.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 367.18,
            "unit": "ns/op",
            "extra": "samples: 1361739, rme: ±0.62%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 1013.19,
            "unit": "ns/op",
            "extra": "samples: 493493, rme: ±1.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 87.25,
            "unit": "ns/op",
            "extra": "samples: 5730558, rme: ±0.14%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2401.09,
            "unit": "ns/op",
            "extra": "samples: 208239, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 336141.14,
            "unit": "ns/op",
            "extra": "samples: 1488, rme: ±1.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 80279.52,
            "unit": "ns/op",
            "extra": "samples: 6229, rme: ±1.16%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1125257.78,
            "unit": "ns/op",
            "extra": "samples: 445, rme: ±1.32%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 255137.61,
            "unit": "ns/op",
            "extra": "samples: 1960, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1130582.27,
            "unit": "ns/op",
            "extra": "samples: 443, rme: ±3.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 21641.58,
            "unit": "ns/op",
            "extra": "samples: 23104, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2256625.23,
            "unit": "ns/op",
            "extra": "samples: 222, rme: ±0.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1630.54,
            "unit": "ns/op",
            "extra": "samples: 306648, rme: ±1.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 181.05,
            "unit": "ns/op",
            "extra": "samples: 2761692, rme: ±0.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1180.62,
            "unit": "ns/op",
            "extra": "samples: 423508, rme: ±0.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 575.86,
            "unit": "ns/op",
            "extra": "samples: 868261, rme: ±0.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2817.94,
            "unit": "ns/op",
            "extra": "samples: 177435, rme: ±5.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 117.96,
            "unit": "ns/op",
            "extra": "samples: 4238761, rme: ±0.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2428.99,
            "unit": "ns/op",
            "extra": "samples: 205847, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 12581.7,
            "unit": "ns/op",
            "extra": "samples: 39741, rme: ±0.65%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3839.46,
            "unit": "ns/op",
            "extra": "samples: 130227, rme: ±1.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 54883.06,
            "unit": "ns/op",
            "extra": "samples: 9111, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 11452.7,
            "unit": "ns/op",
            "extra": "samples: 43658, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 45517.28,
            "unit": "ns/op",
            "extra": "samples: 10985, rme: ±1.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 929.46,
            "unit": "ns/op",
            "extra": "samples: 537945, rme: ±1.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 117736.71,
            "unit": "ns/op",
            "extra": "samples: 4249, rme: ±1.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 155044.94,
            "unit": "ns/op",
            "extra": "samples: 3225, rme: ±14.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 889.51,
            "unit": "ns/op",
            "extra": "samples: 562107, rme: ±1.04%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 260798.09,
            "unit": "ns/op",
            "extra": "samples: 1918, rme: ±4.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1232.09,
            "unit": "ns/op",
            "extra": "samples: 405815, rme: ±0.36%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 133727.07,
            "unit": "ns/op",
            "extra": "samples: 3739, rme: ±11.06%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 83.24,
            "unit": "ns/op",
            "extra": "samples: 6006884, rme: ±0.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 14182.25,
            "unit": "ns/op",
            "extra": "samples: 35257, rme: ±6.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3828.19,
            "unit": "ns/op",
            "extra": "samples: 130611, rme: ±1.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1431.41,
            "unit": "ns/op",
            "extra": "samples: 349307, rme: ±10.04%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 69.28,
            "unit": "ns/op",
            "extra": "samples: 7217591, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 11944.51,
            "unit": "ns/op",
            "extra": "samples: 42038, rme: ±9.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1539.93,
            "unit": "ns/op",
            "extra": "samples: 324690, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 645.24,
            "unit": "ns/op",
            "extra": "samples: 774908, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 970.07,
            "unit": "ns/op",
            "extra": "samples: 515428, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 101.6,
            "unit": "ns/op",
            "extra": "samples: 4921102, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1377.88,
            "unit": "ns/op",
            "extra": "samples: 362876, rme: ±2.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2371629.37,
            "unit": "ns/op",
            "extra": "samples: 211, rme: ±1.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 778563.16,
            "unit": "ns/op",
            "extra": "samples: 643, rme: ±2.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 12106807,
            "unit": "ns/op",
            "extra": "samples: 42, rme: ±1.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2230812.51,
            "unit": "ns/op",
            "extra": "samples: 225, rme: ±1.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 10274961.06,
            "unit": "ns/op",
            "extra": "samples: 49, rme: ±12.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 204268.09,
            "unit": "ns/op",
            "extra": "samples: 2448, rme: ±0.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 22907481.91,
            "unit": "ns/op",
            "extra": "samples: 22, rme: ±0.90%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 33076.25,
            "unit": "ns/op",
            "extra": "samples: 15117, rme: ±0.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 8090.24,
            "unit": "ns/op",
            "extra": "samples: 61803, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 117902.2,
            "unit": "ns/op",
            "extra": "samples: 4241, rme: ±0.96%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 27465.23,
            "unit": "ns/op",
            "extra": "samples: 18205, rme: ±0.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 112300.22,
            "unit": "ns/op",
            "extra": "samples: 4453, rme: ±1.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2629.44,
            "unit": "ns/op",
            "extra": "samples: 190155, rme: ±0.71%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 227471.97,
            "unit": "ns/op",
            "extra": "samples: 2199, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3514.87,
            "unit": "ns/op",
            "extra": "samples: 142253, rme: ±0.78%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1044.13,
            "unit": "ns/op",
            "extra": "samples: 478867, rme: ±0.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 202.11,
            "unit": "ns/op",
            "extra": "samples: 2473897, rme: ±0.38%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6745.87,
            "unit": "ns/op",
            "extra": "samples: 74120, rme: ±7.33%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 639.36,
            "unit": "ns/op",
            "extra": "samples: 782031, rme: ±0.59%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 160.62,
            "unit": "ns/op",
            "extra": "samples: 3112950, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 19453.94,
            "unit": "ns/op",
            "extra": "samples: 25702, rme: ±0.46%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 14995.97,
            "unit": "ns/op",
            "extra": "samples: 33343, rme: ±0.32%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1889.22,
            "unit": "ns/op",
            "extra": "samples: 264660, rme: ±0.77%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 10199.1,
            "unit": "ns/op",
            "extra": "samples: 49024, rme: ±0.75%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 47689.1,
            "unit": "ns/op",
            "extra": "samples: 10485, rme: ±2.62%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2701.52,
            "unit": "ns/op",
            "extra": "samples: 185082, rme: ±1.05%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 767.34,
            "unit": "ns/op",
            "extra": "samples: 651602, rme: ±1.19%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 808.62,
            "unit": "ns/op",
            "extra": "samples: 618337, rme: ±0.14%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 790.59,
            "unit": "ns/op",
            "extra": "samples: 632442, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 186861.54,
            "unit": "ns/op",
            "extra": "samples: 2676, rme: ±10.13%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 233650.1,
            "unit": "ns/op",
            "extra": "samples: 2140, rme: ±6.86%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 215678.46,
            "unit": "ns/op",
            "extra": "samples: 2338, rme: ±7.81%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 175880.1,
            "unit": "ns/op",
            "extra": "samples: 2843, rme: ±7.08%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 133079.07,
            "unit": "ns/op",
            "extra": "samples: 3797, rme: ±8.95%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 187061.33,
            "unit": "ns/op",
            "extra": "samples: 2673, rme: ±7.74%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 254094.82,
            "unit": "ns/op",
            "extra": "samples: 1968, rme: ±6.53%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 263941.23,
            "unit": "ns/op",
            "extra": "samples: 1895, rme: ±5.49%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 221103.12,
            "unit": "ns/op",
            "extra": "samples: 2262, rme: ±6.92%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1575894.6,
            "unit": "ns/op",
            "extra": "samples: 318, rme: ±7.59%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 1134156.2,
            "unit": "ns/op",
            "extra": "samples: 441, rme: ±6.71%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "56ef64e09ac24b9fef9648d0fd09f8f49b50bbf6",
          "message": "Triage last six Phase 1 mutation survivors (#198)\n\n* test(conformance): triage last six Phase 1 mutation survivors; pin namespaced non-reader snapshot skip\n\n* conformance: compare snapshot copies relative to a reader, not to zero",
          "timestamp": "2026-10-19T21:37:41-05:00",
          "tree_id": "407044bb4078824e7f3bdff33d12f95fadf4f117",
          "url": "https://github.com/directive-run/directive/commit/56ef64e09ac24b9fef9648d0fd09f8f49b50bbf6"
        },
        "date": 1792464000378,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 154.39,
            "unit": "ns/op",
            "extra": "samples: 3238535, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 77.6,
            "unit": "ns/op",
            "extra": "samples: 6443564, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 78.76,
            "unit": "ns/op",
            "extra": "samples: 6348464, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 121.99,
            "unit": "ns/op",
            "extra": "samples: 4098820, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 234.81,
            "unit": "ns/op",
            "extra": "samples: 2129371, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 78.25,
            "unit": "ns/op",
            "extra": "samples: 6389859, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 80.18,
            "unit": "ns/op",
            "extra": "samples: 6236019, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 562.88,
            "unit": "ns/op",
            "extra": "samples: 888288, rme: ±1.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 163.4,
            "unit": "ns/op",
            "extra": "samples: 3060301, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 1236.97,
            "unit": "ns/op",
            "extra": "samples: 404214, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 356.04,
            "unit": "ns/op",
            "extra": "samples: 1404340, rme: ±0.56%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 1081.26,
            "unit": "ns/op",
            "extra": "samples: 462425, rme: ±1.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 86.88,
            "unit": "ns/op",
            "extra": "samples: 5754743, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 2425.01,
            "unit": "ns/op",
            "extra": "samples: 206185, rme: ±0.90%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 316594.28,
            "unit": "ns/op",
            "extra": "samples: 1580, rme: ±0.66%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 77498.68,
            "unit": "ns/op",
            "extra": "samples: 6452, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 1140155.45,
            "unit": "ns/op",
            "extra": "samples: 439, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 265252.64,
            "unit": "ns/op",
            "extra": "samples: 1885, rme: ±0.52%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 1110910.08,
            "unit": "ns/op",
            "extra": "samples: 451, rme: ±0.75%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 22513.87,
            "unit": "ns/op",
            "extra": "samples: 22209, rme: ±1.22%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 2319468.84,
            "unit": "ns/op",
            "extra": "samples: 216, rme: ±1.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 1750.97,
            "unit": "ns/op",
            "extra": "samples: 285557, rme: ±0.38%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 179.67,
            "unit": "ns/op",
            "extra": "samples: 2782850, rme: ±1.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 1226.98,
            "unit": "ns/op",
            "extra": "samples: 407504, rme: ±0.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 623.67,
            "unit": "ns/op",
            "extra": "samples: 801702, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 2966.03,
            "unit": "ns/op",
            "extra": "samples: 168576, rme: ±5.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 118.42,
            "unit": "ns/op",
            "extra": "samples: 4222128, rme: ±0.13%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 2454.09,
            "unit": "ns/op",
            "extra": "samples: 203742, rme: ±1.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 13165.63,
            "unit": "ns/op",
            "extra": "samples: 37978, rme: ±0.34%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 3711.52,
            "unit": "ns/op",
            "extra": "samples: 134716, rme: ±0.62%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 56360.04,
            "unit": "ns/op",
            "extra": "samples: 8872, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 11365.82,
            "unit": "ns/op",
            "extra": "samples: 43992, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 46915.85,
            "unit": "ns/op",
            "extra": "samples: 10658, rme: ±2.03%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 877.43,
            "unit": "ns/op",
            "extra": "samples: 569843, rme: ±0.88%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 113972.71,
            "unit": "ns/op",
            "extra": "samples: 4388, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 134013.85,
            "unit": "ns/op",
            "extra": "samples: 3731, rme: ±12.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 868.1,
            "unit": "ns/op",
            "extra": "samples: 575973, rme: ±0.80%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 269419.06,
            "unit": "ns/op",
            "extra": "samples: 1856, rme: ±4.59%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 1235.34,
            "unit": "ns/op",
            "extra": "samples: 404746, rme: ±0.24%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 127783.32,
            "unit": "ns/op",
            "extra": "samples: 3913, rme: ±9.20%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 84.12,
            "unit": "ns/op",
            "extra": "samples: 5944223, rme: ±1.99%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 14126.84,
            "unit": "ns/op",
            "extra": "samples: 35394, rme: ±5.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 3980.04,
            "unit": "ns/op",
            "extra": "samples: 125669, rme: ±1.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 1528,
            "unit": "ns/op",
            "extra": "samples: 327225, rme: ±10.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 69.77,
            "unit": "ns/op",
            "extra": "samples: 7166584, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 12362.86,
            "unit": "ns/op",
            "extra": "samples: 40646, rme: ±9.91%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 1470.26,
            "unit": "ns/op",
            "extra": "samples: 340077, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 607.68,
            "unit": "ns/op",
            "extra": "samples: 822803, rme: ±0.12%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 971.54,
            "unit": "ns/op",
            "extra": "samples: 514650, rme: ±0.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 98.31,
            "unit": "ns/op",
            "extra": "samples: 5085850, rme: ±0.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 1356.2,
            "unit": "ns/op",
            "extra": "samples: 368678, rme: ±2.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 2607569.48,
            "unit": "ns/op",
            "extra": "samples: 192, rme: ±1.57%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 760839.46,
            "unit": "ns/op",
            "extra": "samples: 658, rme: ±2.25%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 12631941.32,
            "unit": "ns/op",
            "extra": "samples: 40, rme: ±1.35%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 2120249.9,
            "unit": "ns/op",
            "extra": "samples: 236, rme: ±1.64%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 9942489.49,
            "unit": "ns/op",
            "extra": "samples: 51, rme: ±12.84%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 205778.39,
            "unit": "ns/op",
            "extra": "samples: 2430, rme: ±1.02%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 23744107.77,
            "unit": "ns/op",
            "extra": "samples: 22, rme: ±0.62%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 33027.94,
            "unit": "ns/op",
            "extra": "samples: 15139, rme: ±1.04%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 7948.02,
            "unit": "ns/op",
            "extra": "samples: 62909, rme: ±0.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 119869.53,
            "unit": "ns/op",
            "extra": "samples: 4172, rme: ±0.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 26861.99,
            "unit": "ns/op",
            "extra": "samples: 18614, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 115314.77,
            "unit": "ns/op",
            "extra": "samples: 4336, rme: ±1.76%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 2666.88,
            "unit": "ns/op",
            "extra": "samples: 187485, rme: ±0.86%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 235905.31,
            "unit": "ns/op",
            "extra": "samples: 2120, rme: ±1.00%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 3569.43,
            "unit": "ns/op",
            "extra": "samples: 140079, rme: ±0.82%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 1084.58,
            "unit": "ns/op",
            "extra": "samples: 461007, rme: ±0.97%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 193.68,
            "unit": "ns/op",
            "extra": "samples: 2581528, rme: ±0.29%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 6801.41,
            "unit": "ns/op",
            "extra": "samples: 73881, rme: ±6.84%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 641.24,
            "unit": "ns/op",
            "extra": "samples: 779739, rme: ±0.59%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 171.43,
            "unit": "ns/op",
            "extra": "samples: 2916575, rme: ±0.11%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 18352.65,
            "unit": "ns/op",
            "extra": "samples: 27245, rme: ±0.22%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 15873.1,
            "unit": "ns/op",
            "extra": "samples: 31500, rme: ±0.25%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1935.2,
            "unit": "ns/op",
            "extra": "samples: 258372, rme: ±0.96%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 10834.59,
            "unit": "ns/op",
            "extra": "samples: 46149, rme: ±2.34%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 47239.36,
            "unit": "ns/op",
            "extra": "samples: 10585, rme: ±0.48%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 2722.17,
            "unit": "ns/op",
            "extra": "samples: 183678, rme: ±0.88%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 806.07,
            "unit": "ns/op",
            "extra": "samples: 620290, rme: ±0.13%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 801.15,
            "unit": "ns/op",
            "extra": "samples: 624106, rme: ±0.24%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 800.08,
            "unit": "ns/op",
            "extra": "samples: 624937, rme: ±0.12%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 189697.17,
            "unit": "ns/op",
            "extra": "samples: 2636, rme: ±10.84%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 231889.8,
            "unit": "ns/op",
            "extra": "samples: 2157, rme: ±6.38%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 219597.42,
            "unit": "ns/op",
            "extra": "samples: 2277, rme: ±7.00%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 182224.91,
            "unit": "ns/op",
            "extra": "samples: 2744, rme: ±7.55%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 137231.97,
            "unit": "ns/op",
            "extra": "samples: 3644, rme: ±8.81%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 196563.23,
            "unit": "ns/op",
            "extra": "samples: 2544, rme: ±7.53%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 262124.39,
            "unit": "ns/op",
            "extra": "samples: 1908, rme: ±6.64%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 275539.86,
            "unit": "ns/op",
            "extra": "samples: 1815, rme: ±6.14%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 227444.6,
            "unit": "ns/op",
            "extra": "samples: 2199, rme: ±6.81%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 1471810.12,
            "unit": "ns/op",
            "extra": "samples: 341, rme: ±7.24%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 1131228.54,
            "unit": "ns/op",
            "extra": "samples: 442, rme: ±6.60%"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jasonwcomes@gmail.com",
            "name": "Jason Comes",
            "username": "jasoncomes"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "eaf9b34d8b65789faaa5119a012af68b8f5619df",
          "message": "conformance: black-box test for self-waking effect chains\n\nAn effect that keeps waking itself is cut after a bounded number of passes with a warning and the system stays live; each follow-up pass runs on a later microtask. L4 rule; passes on 1.35.",
          "timestamp": "2026-10-21T00:57:21-05:00",
          "tree_id": "3043b13da2047be9562cead4e4fcdabd079a5eec",
          "url": "https://github.com/directive-run/directive/commit/eaf9b34d8b65789faaa5119a012af68b8f5619df"
        },
        "date": 1792562380153,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Directive",
            "value": 72.95,
            "unit": "ns/op",
            "extra": "samples: 6854371, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Zustand",
            "value": 43.86,
            "unit": "ns/op",
            "extra": "samples: 11400458, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Redux Toolkit",
            "value": 46.19,
            "unit": "ns/op",
            "extra": "samples: 10825372, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > MobX",
            "value": 61.04,
            "unit": "ns/op",
            "extra": "samples: 8191793, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Jotai",
            "value": 104.18,
            "unit": "ns/op",
            "extra": "samples: 4799412, rme: ±0.48%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > Preact Signals",
            "value": 43.56,
            "unit": "ns/op",
            "extra": "samples: 11478376, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Read > XState",
            "value": 43.66,
            "unit": "ns/op",
            "extra": "samples: 11451707, rme: ±0.17%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Directive",
            "value": 278.73,
            "unit": "ns/op",
            "extra": "samples: 1793875, rme: ±0.72%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Zustand",
            "value": 80.06,
            "unit": "ns/op",
            "extra": "samples: 6245042, rme: ±0.47%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Redux Toolkit",
            "value": 717.83,
            "unit": "ns/op",
            "extra": "samples: 696546, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > MobX",
            "value": 176.43,
            "unit": "ns/op",
            "extra": "samples: 2833939, rme: ±0.74%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Jotai",
            "value": 570.32,
            "unit": "ns/op",
            "extra": "samples: 876698, rme: ±0.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > Preact Signals",
            "value": 47.59,
            "unit": "ns/op",
            "extra": "samples: 10506046, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Single Write > XState",
            "value": 1337.84,
            "unit": "ns/op",
            "extra": "samples: 373737, rme: ±0.53%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Directive",
            "value": 153937.54,
            "unit": "ns/op",
            "extra": "samples: 3249, rme: ±0.92%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Zustand",
            "value": 42373.79,
            "unit": "ns/op",
            "extra": "samples: 11800, rme: ±0.56%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Redux Toolkit",
            "value": 657080.09,
            "unit": "ns/op",
            "extra": "samples: 761, rme: ±0.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > MobX",
            "value": 121483.17,
            "unit": "ns/op",
            "extra": "samples: 4116, rme: ±0.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Jotai",
            "value": 619344.71,
            "unit": "ns/op",
            "extra": "samples: 809, rme: ±9.28%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > Preact Signals",
            "value": 11809.84,
            "unit": "ns/op",
            "extra": "samples: 42338, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 1K Write+Read Cycles > XState",
            "value": 1271355.36,
            "unit": "ns/op",
            "extra": "samples: 394, rme: ±0.41%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Directive",
            "value": 882.25,
            "unit": "ns/op",
            "extra": "samples: 566735, rme: ±1.11%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Zustand",
            "value": 85.4,
            "unit": "ns/op",
            "extra": "samples: 5854892, rme: ±0.48%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Redux Toolkit",
            "value": 765.52,
            "unit": "ns/op",
            "extra": "samples: 653150, rme: ±0.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > MobX",
            "value": 315.18,
            "unit": "ns/op",
            "extra": "samples: 1586377, rme: ±0.27%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Jotai",
            "value": 1600.08,
            "unit": "ns/op",
            "extra": "samples: 312484, rme: ±5.95%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > Preact Signals",
            "value": 61.48,
            "unit": "ns/op",
            "extra": "samples: 8132631, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Derived Value (write + read computed) > XState",
            "value": 1343.86,
            "unit": "ns/op",
            "extra": "samples: 372063, rme: ±0.44%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Directive",
            "value": 5733.44,
            "unit": "ns/op",
            "extra": "samples: 87208, rme: ±0.50%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Zustand",
            "value": 1981.73,
            "unit": "ns/op",
            "extra": "samples: 252306, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Redux Toolkit",
            "value": 33228.5,
            "unit": "ns/op",
            "extra": "samples: 15048, rme: ±0.54%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > MobX",
            "value": 5190.75,
            "unit": "ns/op",
            "extra": "samples: 96326, rme: ±0.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Jotai",
            "value": 23491.53,
            "unit": "ns/op",
            "extra": "samples: 21285, rme: ±0.85%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > Preact Signals",
            "value": 561.86,
            "unit": "ns/op",
            "extra": "samples: 889902, rme: ±1.67%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 50 Writes + 1 Read (batch efficiency) > XState",
            "value": 66750.08,
            "unit": "ns/op",
            "extra": "samples: 7491, rme: ±1.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Directive",
            "value": 67899.91,
            "unit": "ns/op",
            "extra": "samples: 7364, rme: ±18.10%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Zustand",
            "value": 493.39,
            "unit": "ns/op",
            "extra": "samples: 1013397, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > MobX",
            "value": 61103.37,
            "unit": "ns/op",
            "extra": "samples: 8183, rme: ±1.87%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Subscribe + Notify (create store, 10 subs, 1 write) > Preact Signals",
            "value": 637.56,
            "unit": "ns/op",
            "extra": "samples: 784240, rme: ±0.19%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Directive",
            "value": 44019.31,
            "unit": "ns/op",
            "extra": "samples: 11434, rme: ±12.60%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Zustand",
            "value": 48.72,
            "unit": "ns/op",
            "extra": "samples: 10262762, rme: ±6.09%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Redux Toolkit",
            "value": 7212.22,
            "unit": "ns/op",
            "extra": "samples: 69327, rme: ±9.56%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > MobX",
            "value": 2045.43,
            "unit": "ns/op",
            "extra": "samples: 244448, rme: ±0.73%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Jotai",
            "value": 914.25,
            "unit": "ns/op",
            "extra": "samples: 546898, rme: ±8.48%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > Preact Signals",
            "value": 41.36,
            "unit": "ns/op",
            "extra": "samples: 12089342, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Store Creation (cold start) > XState",
            "value": 7041.25,
            "unit": "ns/op",
            "extra": "samples: 71207, rme: ±9.23%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Directive",
            "value": 754.9,
            "unit": "ns/op",
            "extra": "samples: 662341, rme: ±0.06%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Zustand",
            "value": 285.07,
            "unit": "ns/op",
            "extra": "samples: 1753934, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > MobX",
            "value": 545.87,
            "unit": "ns/op",
            "extra": "samples: 915974, rme: ±0.07%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Preact Signals",
            "value": 54.5,
            "unit": "ns/op",
            "extra": "samples: 9175040, rme: ±0.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Read 10 Keys > Jotai",
            "value": 745.49,
            "unit": "ns/op",
            "extra": "samples: 670700, rme: ±0.30%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Directive",
            "value": 1098282.33,
            "unit": "ns/op",
            "extra": "samples: 456, rme: ±1.08%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Zustand",
            "value": 379888.94,
            "unit": "ns/op",
            "extra": "samples: 1317, rme: ±0.40%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Redux Toolkit",
            "value": 6602155.39,
            "unit": "ns/op",
            "extra": "samples: 76, rme: ±0.43%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > MobX",
            "value": 952529.58,
            "unit": "ns/op",
            "extra": "samples: 525, rme: ±0.70%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Jotai",
            "value": 4844316.81,
            "unit": "ns/op",
            "extra": "samples: 104, rme: ±6.45%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > Preact Signals",
            "value": 107501.23,
            "unit": "ns/op",
            "extra": "samples: 4652, rme: ±0.63%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 10K Writes (raw throughput) > XState",
            "value": 13074527.44,
            "unit": "ns/op",
            "extra": "samples: 39, rme: ±0.91%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Directive",
            "value": 17060.75,
            "unit": "ns/op",
            "extra": "samples: 29308, rme: ±0.56%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Zustand",
            "value": 4355.59,
            "unit": "ns/op",
            "extra": "samples: 114795, rme: ±1.15%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Redux Toolkit",
            "value": 67527.34,
            "unit": "ns/op",
            "extra": "samples: 7405, rme: ±0.49%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > MobX",
            "value": 12069.14,
            "unit": "ns/op",
            "extra": "samples: 41428, rme: ±0.39%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Jotai",
            "value": 60569.38,
            "unit": "ns/op",
            "extra": "samples: 8255, rme: ±1.46%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > Preact Signals",
            "value": 1452.34,
            "unit": "ns/op",
            "extra": "samples: 344273, rme: ±0.51%"
          },
          {
            "name": "comparison.bench.ts > Comparison: Alternating Read/Write (100 each) > XState",
            "value": 132535.84,
            "unit": "ns/op",
            "extra": "samples: 3773, rme: ±1.77%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Directive",
            "value": 1951.6,
            "unit": "ns/op",
            "extra": "samples: 256200, rme: ±1.18%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > MobX",
            "value": 479.71,
            "unit": "ns/op",
            "extra": "samples: 1042299, rme: ±0.34%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Preact Signals",
            "value": 92.78,
            "unit": "ns/op",
            "extra": "samples: 5388964, rme: ±0.16%"
          },
          {
            "name": "comparison.bench.ts > Comparison: 3 Derived Values from 1 Source > Jotai",
            "value": 3722.36,
            "unit": "ns/op",
            "extra": "samples: 134324, rme: ±5.33%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact set",
            "value": 344.4,
            "unit": "ns/op",
            "extra": "samples: 1451811, rme: ±0.46%"
          },
          {
            "name": "core.bench.ts > Fact Mutations > single fact read",
            "value": 75.44,
            "unit": "ns/op",
            "extra": "samples: 6627428, rme: ±0.07%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 facts batched",
            "value": 9780.64,
            "unit": "ns/op",
            "extra": "samples: 51122, rme: ±0.44%"
          },
          {
            "name": "core.bench.ts > Fact Mutations – Batch > 100 fact reads via proxy",
            "value": 8633,
            "unit": "ns/op",
            "extra": "samples: 57918, rme: ±0.28%"
          },
          {
            "name": "core.bench.ts > Derivations > simple derivation (read after invalidate)",
            "value": 1099.3,
            "unit": "ns/op",
            "extra": "samples: 454835, rme: ±1.91%"
          },
          {
            "name": "core.bench.ts > Derivations > 10 chained derivations (read after invalidate)",
            "value": 5692.69,
            "unit": "ns/op",
            "extra": "samples: 87832, rme: ±1.12%"
          },
          {
            "name": "core.bench.ts > Derivations > 50 chained derivations (read after invalidate)",
            "value": 26927.49,
            "unit": "ns/op",
            "extra": "samples: 18569, rme: ±1.19%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation > invalidate 20 derivations (1 fact change)",
            "value": 1505.95,
            "unit": "ns/op",
            "extra": "samples: 332016, rme: ±0.89%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 20, unread",
            "value": 439.62,
            "unit": "ns/op",
            "extra": "samples: 1137342, rme: ±0.10%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > chain of 500, unread",
            "value": 431.45,
            "unit": "ns/op",
            "extra": "samples: 1158879, rme: ±0.09%"
          },
          {
            "name": "core.bench.ts > Derivation Invalidation – graph nothing reads back > 500 nodes / ~15k edges, unread",
            "value": 428.28,
            "unit": "ns/op",
            "extra": "samples: 1167454, rme: ±0.15%"
          },
          {
            "name": "core.bench.ts > Constraints > single constraint eval + reconcile",
            "value": 66428.37,
            "unit": "ns/op",
            "extra": "samples: 7565, rme: ±11.41%"
          },
          {
            "name": "core.bench.ts > Constraints > 10 constraints, 1 triggers",
            "value": 75878.33,
            "unit": "ns/op",
            "extra": "samples: 6590, rme: ±8.32%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > sync resolver (no Promise)",
            "value": 65896.4,
            "unit": "ns/op",
            "extra": "samples: 7588, rme: ±9.77%"
          },
          {
            "name": "core.bench.ts > Sync vs Async Resolvers > async resolver (returns Promise)",
            "value": 61258.18,
            "unit": "ns/op",
            "extra": "samples: 8163, rme: ±9.29%"
          },
          {
            "name": "core.bench.ts > Reconciliation > no-op reconcile (nothing changed)",
            "value": 42754.15,
            "unit": "ns/op",
            "extra": "samples: 11695, rme: ±11.30%"
          },
          {
            "name": "core.bench.ts > Reconciliation > minimal cycle (1 fact → 1 constraint → 1 resolver)",
            "value": 58938.91,
            "unit": "ns/op",
            "extra": "samples: 8501, rme: ±9.46%"
          },
          {
            "name": "core.bench.ts > Reconciliation > medium system (5 facts → 3 constraints → 3 resolvers → 5 derivations)",
            "value": 88876.88,
            "unit": "ns/op",
            "extra": "samples: 5647, rme: ±8.11%"
          },
          {
            "name": "core.bench.ts > Real-World: Traffic Light > full cycle: red → green → yellow → red",
            "value": 86073.93,
            "unit": "ns/op",
            "extra": "samples: 5811, rme: ±6.59%"
          },
          {
            "name": "core.bench.ts > Real-World: Auth Flow > login → token → profile chain",
            "value": 70713.81,
            "unit": "ns/op",
            "extra": "samples: 7071, rme: ±8.12%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, independent reader",
            "value": 636216.84,
            "unit": "ns/op",
            "extra": "samples: 786, rme: ±7.48%"
          },
          {
            "name": "frame-loop.bench.ts > Frame loop – crossModuleDeps reader > 60 frames, reader declares crossModuleDeps",
            "value": 484082.64,
            "unit": "ns/op",
            "extra": "samples: 1033, rme: ±6.71%"
          }
        ]
      }
    ]
  }
}