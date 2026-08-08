/**
 * `@sizls/ai-harness/node` — the parts that need a filesystem.
 *
 * A separate entry point rather than a named export from the package root,
 * because a static re-export is not conditional: anything importing
 * `@sizls/ai-harness` for `runHarness` would import `node:fs` with it, and a
 * chain does not otherwise touch a disk. The core is deliberately runtime-
 * agnostic — it writes through a `TranscriptStore` and defaults to the
 * in-memory one — and that claim only survives if the filesystem is behind a
 * door someone has to open.
 *
 * ```typescript
 * import { runHarness, codeReviewPreset } from "@sizls/ai-harness";
 * import { createFileTranscriptStore } from "@sizls/ai-harness/node";
 * ```
 *
 * @module
 */

export {
  createFileTranscriptStore,
  defaultTranscriptDir,
  resolveWithin,
  type FileTranscriptStoreOptions,
} from "./adapters/node/transcript.js";
