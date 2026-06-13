---
"@directive-run/sandbox": minor
---

Per-process worker cap, AbortSignal plumbing, DNS-rebinding narrowing, and host-path leak coverage.

**New: `setMaxConcurrentWorkers(n)`.** Caps the per-process worker pool. Each worker reserves ~32 MB of heap + a thread; without a cap, a burst from many distinct IPs (each within any per-IP rate limit) can each spawn their own worker and OOM the host. Calls beyond the cap queue FIFO. Defaults to `navigator.hardwareConcurrency` (falls back to 4). Pass `Infinity` to disable.

**New: `signal` on `RunInSandboxInput`.** Pipe your HTTP request's `AbortSignal` (Next.js, Express, etc. all expose one) through to `runInSandbox`. A client that disconnects mid-flight releases its worker slot immediately. Without this, abandoned callers leak phantom waiters into the queue and the pool eventually deadlocks at saturation.

**DNS-rebinding narrowing.** `checkResolvedAddresses` now pre-resolves the hostname via `dns.lookup({ all: true })` and rejects when any returned address lands in a private range. The bare hostname check missed this entirely. The TOCTOU is narrowed (Node's fetch resolves a second time at socket-connect; an attacker with a 0-TTL record can still rotate between checks) — full closure requires an `undici.Agent` with a custom `connect.lookup` and is tracked as a follow-on.

**Host-filesystem-path sanitization.** Worker error reports now strip POSIX (`/Users/<name>/`, `/home/<name>/`, `/private/var/`, `/var/task/`, `/tmp/`, `/opt/`, `/usr/local/`) AND Windows + UNC (`C:\Users\<name>\`, `D:\a\_work\…`, `\\server\share\…`) paths before crossing the worker→host→client boundary. Without this, every sandboxed exception leaks the host environment's filesystem layout — fingerprintable by any sandbox client.

**`/api/sandbox` consumers**: add `signal: request.signal` to your `runInSandbox(...)` call and `setMaxConcurrentWorkers(N)` at module-init to pick up the slot-leak defence end-to-end.
