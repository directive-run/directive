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
 * ## Why the path check is not the whole of containment
 *
 * Resolving a path and comparing prefixes is an answer about the *name*. It is
 * not an answer about what is at that name, and a symlink is the difference:
 * a link sitting at `<dir>/<runId>.md` and pointing anywhere at all resolves
 * inside `dir` by every lexical measure, and every ordinary write follows it.
 * A dangling one is worse, because it is also invisible to an existence check —
 * `existsSync` follows the link, finds nothing, and reports the name free.
 *
 * So the name check stays and creation is exclusive. `O_CREAT | O_EXCL` refuses
 * a name that is already taken by anything, a symlink included and a dangling
 * symlink especially, and it does it in the same call that creates the file
 * rather than in a check somebody could act on a moment later. The friendly
 * "this run ID is already used" message is raised from the failure rather than
 * from a look-ahead, so what refuses the write is what performs it.
 *
 * @module
 */

import { closeSync, mkdirSync, openSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  type Transcript,
  type TranscriptStore,
  createTranscript,
  renderSidecarLine,
} from "../../core/transcript.js";

export interface FileTranscriptStoreOptions {
  /** Directory the artefacts are written into. Created if absent. */
  dir?: string;
}

/**
 * Resolve a name inside a directory, or refuse.
 *
 * The independent half of the file-write fix. It asks the only question that
 * matters at a write — *is this path inside that directory* — and answers it
 * from the resolved forms of both, so it holds for an absolute name, a name
 * full of `..`, a symlink-free relative directory, and anything a future caller
 * assembles without knowing this rule exists.
 *
 * Lives here rather than beside the other boundary checks in `core/safety.js`,
 * because it is the only one of them that needs `node:path`, and the core is
 * where the package's claim to run without a filesystem is kept. Containment of
 * a filesystem path belongs with the filesystem.
 *
 * A name is a name and not a path. One carrying a separator would resolve
 * inside `dir` while passing through a directory component this function
 * cannot vouch for — `<dir>/elsewhere/x.md` where `elsewhere` is a link — so
 * the doc below is enforced rather than assumed.
 *
 * @param dir - The directory the file must live in. Resolved against the
 *   process's working directory when relative.
 * @param name - The filename. Not a path — a name containing a separator, or
 *   one that resolves anywhere other than directly inside `dir`, is refused
 *   rather than normalized.
 */
export function resolveWithin(dir: string, name: string): string {
  const base = resolve(dir);
  const candidate = resolve(base, name);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;

  if (!candidate.startsWith(prefix)) {
    throw new Error(
      `[ai-harness] refusing to write ${JSON.stringify(name)}: it resolves to ${JSON.stringify(candidate)}, which is outside the output directory ${JSON.stringify(base)}. Run identifiers name files inside the output directory and nothing else — pass a plain name, or point the output directory where the file should go.`,
    );
  }

  if (name.includes("/") || name.includes("\\")) {
    throw new Error(
      `[ai-harness] refusing to write ${JSON.stringify(name)}: it is a path rather than a name. It lands inside the output directory ${JSON.stringify(base)} but reaches it through a directory this store did not create and cannot vouch for — a link there would take the write somewhere else entirely. Pass a plain name, or point the output directory at the subdirectory.`,
    );
  }

  return candidate;
}

/**
 * Take a name, or refuse because something already has it.
 *
 * The reuse guard and the containment guard in one call, because they are the
 * same question asked of the filesystem rather than of a string. `wx` is
 * `O_CREAT | O_EXCL`: it creates the file or fails, it never opens what is
 * already there, and it does not follow a symlink sitting at the name — which
 * is the case a look-then-write misses entirely, since an existence check
 * follows a dangling link and reports the name free.
 */
function claim(path: string, runId: string, dir: string): void {
  try {
    closeSync(openSync(path, "wx"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }

    throw new Error(
      `[ai-harness] run ID "${runId}" already has a transcript in ${resolve(dir)}. A run writes ${runId}.md whole and appends to ${runId}.jsonl, so reusing the ID would leave the transcript holding one run and the sidecar holding two. Omit runId to get a fresh one, pass a different one, or move the existing pair aside.`,
    );
  }
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
      //
      // Both names are taken here rather than at the first write, so opening a
      // transcript reserves the pair — and so the reservation is the same
      // operation as the refusal. See `claim`.
      mkdirSync(resolve(dir), { recursive: true });
      claim(markdownPath, runId, dir);
      claim(jsonlPath, runId, dir);

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
              // Through the shared renderer, so the sidecar has one shape and
              // not one per sink — see `renderSidecarLine`.
              const lines = appended.map(renderSidecarLine).join("");
              await appendFile(jsonlPath, lines, "utf8");
            }
          },
        },
      });
    },

    async writeDocument(name, contents) {
      // Same containment assertion `open` makes, for the same reason: this is a
      // second place a run ID becomes a path, and it must not be a second place
      // that has to remember the rule. Exclusive for the same reason too — a
      // document is written once, and a name already taken by a link is a name
      // this store must not write through.
      const path = resolveWithin(dir, name);

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, { encoding: "utf8", flag: "wx" });

      return path;
    },
  };
}

/** Where artefacts go when the caller does not name a directory. */
export function defaultTranscriptDir(): string {
  return join(process.cwd(), ".ai-harness");
}
