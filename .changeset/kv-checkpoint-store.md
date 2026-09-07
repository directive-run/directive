---
"@directive-run/ai": minor
---

Add `KvCheckpointStore` — a checkpoint store that survives the process.

`InMemoryCheckpointStore` is a `Map`, so every checkpoint dies with the
isolate that made it. That is the right default for a test and useless
for the case checkpoints exist for: a long multi-agent run that is
interrupted and resumed later, possibly on a different machine.

It takes a structural `CheckpointKv` (`get` / `put` / `delete`) rather
than a platform SDK, so `@directive-run/ai` still has no Cloudflare,
Deno or Node storage dependency. Cloudflare's `KVNamespace` satisfies
the interface as-is; anything else adapts in a few lines.

FIFO eviction, time-based retention and `preserveLabeled` match
`InMemoryCheckpointStore` exactly, so the two are swappable.
