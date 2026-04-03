---
"@directive-run/core": patch
---

Add head-to-head benchmark suite comparing Directive against Zustand, Redux Toolkit, MobX, Jotai, Preact Signals, and XState

- 11 comparison scenarios: single read/write, 1K cycles, derived values, batch writes, 10K throughput, multi-key read, alternating R/W, 3 derived values, subscribe+notify, store creation
- 7 adapter modules wrapping each library into a common BenchAdapter interface
- Run with `pnpm bench`
