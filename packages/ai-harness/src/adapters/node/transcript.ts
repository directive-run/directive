/**
 * The filesystem behind the transcript seam.
 *
 * This is the only file in the package that writes anything anywhere, and
 * nothing in `../../core/` imports it. A chain is handed a
 * {@link TranscriptStore}; the command line hands it this one, a server hands it
 * whatever it keeps its artefacts in, and a test hands it nothing at all and
 * gets the in-memory default. The core does not know which it got.
 *
 * ## Why containment is asserted here and not upstream
 *
 * The preset schema already constrains an id to an identifier, and a run ID is
 * checked where it enters. This is the other half, and it is deliberately not
 * the same check: it resolves the final path and asks whether it is inside the
 * resolved output directory, which is an answer that does not depend on any
 * validator having run. A caller that builds a run ID some other way — a future
 * one, in a file that never read the schema — still cannot write outside `dir`.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveWithin } from "../../core/safety.js";
import {
  type Transcript,
  type TranscriptStore,
  createTranscript,
} from "../../core/transcript.js";

export interface FileTranscriptStoreOptions {
  /** Directory the artefacts are written into. Created if absent. */
  dir?: string;
}

/**
 * Artefacts on disk, under one directory.
 *
 * @example
 * ```typescript
 * const harness = createHarness(codeReviewPreset, {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   transcripts: createFileTranscriptStore({ dir: "./runs" }),
 * });
 * ```
 */
export function createFileTranscriptStore(
  options: FileTranscriptStoreOptions = {},
): TranscriptStore {
  const dir = options.dir ?? defaultTranscriptDir();

  return {
    open({ runId, fenceToken }): Transcript {
      const markdownPath = resolveWithin(dir, `${runId}.md`);
      const jsonlPath = resolveWithin(dir, `${runId}.jsonl`);

      // Reuse, refused rather than half-honoured.
      //
      // The markdown file is rewritten whole and the sidecar is appended to, so
      // a second run under one ID leaves the two describing different things: a
      // transcript holding the new run's turns beside a sidecar holding both
      // runs'. Neither file says which, and nothing errors.
      if (existsSync(markdownPath) || existsSync(jsonlPath)) {
        throw new Error(
          `[ai-harness] run ID "${runId}" already has a transcript in ${resolve(dir)}. A run writes ${runId}.md whole and appends to ${runId}.jsonl, so reusing the ID would leave the transcript holding one run and the sidecar holding two. Omit runId to get a fresh one, pass a different one, or move the existing pair aside.`,
        );
      }

      return createTranscript({
        runId,
        ...(fenceToken === undefined ? {} : { fenceToken }),
        sink: {
          markdownPath,
          jsonlPath,
          write: async (markdown, appended) => {
            await mkdir(dirname(markdownPath), { recursive: true });
            await writeFile(markdownPath, markdown, "utf8");

            if (appended.length > 0) {
              const lines = appended
                .map((record) => `${JSON.stringify(record)}\n`)
                .join("");
              await appendFile(jsonlPath, lines, "utf8");
            }
          },
        },
      });
    },

    async writeDocument(name, contents) {
      // Same containment assertion `open` makes, for the same reason: this is a
      // second place a run ID becomes a path, and it must not be a second place
      // that has to remember the rule.
      const path = resolveWithin(dir, name);

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");

      return path;
    },
  };
}

/** Where artefacts go when the caller does not name a directory. */
export function defaultTranscriptDir(): string {
  return join(process.cwd(), ".ai-harness");
}
