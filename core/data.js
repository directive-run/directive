window.BENCHMARK_DATA = {
  "lastUpdate": 1792372029312,
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
      }
    ]
  }
}