window.BENCHMARK_DATA = {
  "lastUpdate": 1792349191301,
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
      }
    ]
  }
}