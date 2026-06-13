---
"@directive-run/sandbox": minor
"@directive-run/core": patch
"@directive-run/lit": patch
"@directive-run/mcp": patch
---

Convergence round following the AE review of last cycle's fix batch. Closes the two HIGH issues + the four MAJOR items the review surfaced.

## sandbox — post-acquisition signal wiring + sanitizeStack export + expanded coverage

**Post-acquisition AbortSignal wiring.** The previous release plumbed `signal` only through the `acquireSlot` queue wait. After the slot acquired, the signal was dropped — a client that disconnected mid-execution still tied up the slot for the full `timeoutMs` (up to 10 s). Now the signal also fires `worker.terminate()` on the running worker so the slot frees immediately. The docstring's "released immediately on disconnect" contract is now accurate end-to-end.

**`sanitizeStack` is now a public export.** Consumers building custom error-routing (Sentry integrations, audit-log middleware) previously couldn't strip host filesystem paths from `SandboxResult.errors[]` before logging. The function is now exported from `@directive-run/sandbox` directly:

```ts
import { sanitizeStack } from "@directive-run/sandbox";
logger.error(sanitizeStack(result.errors.join("\n")));
```

**Extended path coverage.** The sanitizer now strips `/app/` (Heroku/Render/Docker), `/srv/` (Linux deploy), `/workspace/` (Codespaces/GitHub Actions), `/data/` (volume mounts), `/etc/` (configs), and `/root/` (root home) on top of the POSIX + Windows + UNC patterns. 7 new regression tests.

**`@example` block** added to `setMaxConcurrentWorkers`.

## core — `SourceDropReason` adoption completion

Two inline copies of the drop-reason union survived the previous round:

- `SystemInspection.sources[i].lastDropReason` (`types/system.ts`)
- `SourceDispatchResult.reason` (`core/sources.ts`)

Both now reference `SourceDropReason`. The four surfaces that report drops (inspect row, plugin hook, plugin manager emit, observation event) are finally unified — a new reason added to the shared type now propagates everywhere at compile time.

## lit — deprecated aliases as function wrappers

`export const createModule = createModuleController` and `export const useHistory = getHistory` swallowed the `@deprecated` JSDoc strikethrough in older VS Code, Vim+coc, and JetBrains < 2024.1. Both aliases are now thin function wrappers so the deprecation marker renders in every TS-aware editor.

## mcp — full JSDoc on `setMaxConcurrentLintWorkers`

The MCP cap setter's JSDoc was a 3-line summary; the sandbox sister had the full WHY (per-worker heap cost, multi-client burst scenario, `Infinity` to disable). Brought them to parity with an `@example` block.
