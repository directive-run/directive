/**
 * The growing shared document every persona reads and adds to.
 *
 * The in-memory transcript is the source of truth; the two files are a mirror
 * of it. That ordering is deliberate. The synthesizer reads {@link
 * Transcript.text}, not the markdown file, so there is no window in which a
 * flush has not landed yet and the closing document is written against a
 * transcript missing its last burst.
 *
 * **Why tokens are buffered.** A burst arrives as deltas, and the obvious thing
 * — append each delta to the file as it lands — is wrong the first time a call
 * is retried. `withRetry` re-invokes the runner, the provider replays the
 * response from the beginning, and the file ends up holding the abandoned
 * half-burst followed by the complete one, as a single run-on contribution that
 * every later persona then reads as context. So deltas accumulate in a pending
 * buffer that {@link Transcript.beginBurst} clears, and only
 * {@link Transcript.completeBurst} commits. A replay refills a buffer; it
 * cannot duplicate a burst, because a burst does not exist until it is whole.
 *
 * **Why there are two renderings.** {@link Transcript.text} is what the next
 * persona and the synthesizer read; the markdown file is what a person reads.
 * They are not the same string. The prompt-facing one fences each burst in a tag
 * carrying the run's marker, so a burst cannot write the structure that
 * separates turns and pass its own text off as the harness's; the file keeps the
 * plain heading, because that is the artefact and it should hold what the model
 * produced. Terminal escape sequences are likewise kept in the file and removed
 * on the way to a screen — see `./safety.js`.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createFenceToken, fence, resolveWithin } from "./safety.js";

// ============================================================================
// Records
// ============================================================================

/** One completed burst. Also the shape of one line in the JSONL sidecar. */
export interface BurstRecord {
  iteration: number;
  persona: string;
  text: string;
  costUsd: number;
  at: number;
}

export interface TranscriptOptions {
  /** Directory the two files are written into. Created if absent. */
  dir: string;
  /**
   * Names both files: `<runId>.md` and `<runId>.jsonl`.
   *
   * Both paths are resolved and asserted to be inside `dir` before anything is
   * written, and a run ID whose files already exist is refused. See the module
   * note.
   */
  runId: string;
  /** Injectable clock, so tests do not depend on wall time. */
  now?: () => number;
  /**
   * The run's fence marker.
   *
   * Generated when omitted, which is what every caller should do — it is an
   * option so a test can assert on a fixed fence rather than a random one.
   */
  fenceToken?: string;
}

export interface Transcript {
  /** Absolute path of the human-readable transcript. */
  readonly markdownPath: string;
  /** Absolute path of the machine-readable sidecar, one line per burst. */
  readonly jsonlPath: string;
  /**
   * This run's fence marker.
   *
   * Held by the transcript because the transcript is what fences the turns, and
   * everything else quoted into a prompt has to be stripped of the same marker
   * to keep the fence unforgeable.
   */
  readonly fenceToken: string;
  /** Record the chain's input, for the markdown header. */
  setInput(input: string): void;
  /** Discard whatever the current burst has delivered so far. */
  beginBurst(): void;
  /** Accumulate one provider delta into the current burst. */
  appendToken(token: string): void;
  /** What the current burst has delivered so far. */
  pending(): string;
  /**
   * Commit a burst.
   *
   * `text` wins when it is non-empty — the runner's returned output is the
   * provider's own account of what it produced, and the delta buffer is a
   * reconstruction. The buffer stands in for a runner that streamed but
   * returned nothing.
   */
  completeBurst(
    record: Omit<BurstRecord, "text"> & { text: string },
  ): BurstRecord;
  /** Every committed burst, oldest first. */
  bursts(): readonly BurstRecord[];
  /**
   * The whole transcript as the personas and the synthesizer see it.
   *
   * Fenced, unlike the markdown file. See the module note on the two renderings.
   */
  text(): string;
  /** Attach the closing document. */
  setSynthesis(text: string): void;
  /** The closing document, or `""`. */
  synthesis(): string;
  /**
   * Mirror the in-memory transcript to disk.
   *
   * Idempotent, and safe to call more often than there is news. The markdown
   * file is rewritten whole, so it cannot accumulate a partial write. The JSONL
   * sidecar is append-only and remembers how many lines it has written, so
   * calling `flush()` twice with no burst in between appends nothing.
   */
  flush(): Promise<void>;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * One burst, as it appears in the markdown file.
 *
 * A heading and the text, unaltered. The file is the artefact — it is read by
 * people, diffed, and pasted elsewhere — so it holds what the model produced,
 * including escape sequences, which are only dangerous when a terminal
 * interprets them and are neutralized there instead.
 */
function renderBurst(record: BurstRecord): string {
  return `## ${record.iteration + 1}. ${record.persona}\n\n${record.text}\n`;
}

/**
 * One burst, as the next persona reads it.
 *
 * The other rendering, and the reason there are two. Every burst is context for
 * every later persona and for the synthesizer, so a burst that wrote a heading
 * of its own used to arrive downstream as though the harness had written it —
 * a burst could fabricate the structure that separates turns, and could
 * therefore fabricate a turn. Here each one is fenced in a tag carrying the
 * run's marker, with the marker stripped from the body, so it cannot close its
 * own fence or open a convincing one.
 */
function renderTurn(record: BurstRecord, token: string): string {
  return fence(
    "turn",
    token,
    { index: record.iteration + 1, speaker: record.persona },
    record.text,
  );
}

// ============================================================================
// Factory
// ============================================================================

export function createTranscript(options: TranscriptOptions): Transcript {
  const { dir, runId } = options;

  // Containment, asserted here rather than trusted from upstream.
  //
  // The preset schema already constrains an id to an identifier, and the run ID
  // is checked where it enters. This is the other half, and it is deliberately
  // not the same check: it resolves the final path and asks whether it is
  // inside the resolved output directory, which is an answer that does not
  // depend on any validator having run. A caller that builds a run ID some
  // other way — a future one, in a file that never read the schema — still
  // cannot write outside `dir`.
  const markdownPath = resolveWithin(dir, `${runId}.md`);
  const jsonlPath = resolveWithin(dir, `${runId}.jsonl`);
  const fenceToken = options.fenceToken ?? createFenceToken();

  // Reuse, refused rather than half-honoured.
  //
  // The markdown file is rewritten whole and the sidecar is appended to, so a
  // second run under one ID leaves the two describing different things: a
  // transcript holding the new run's bursts beside a sidecar holding both runs'.
  // Neither file says which, and nothing errors.
  if (existsSync(markdownPath) || existsSync(jsonlPath)) {
    throw new Error(
      `[ai-harness] run ID "${runId}" already has a transcript in ${resolve(dir)}. A run writes ${runId}.md whole and appends to ${runId}.jsonl, so reusing the ID would leave the transcript holding one run and the sidecar holding two. Omit runId to get a fresh one, pass a different one, or move the existing pair aside.`,
    );
  }

  let input = "";
  const committed: BurstRecord[] = [];
  let pendingText = "";
  let synthesisText = "";
  /** How many records the sidecar already holds. The only append bookkeeping. */
  let sidecarLines = 0;
  /** Serializes flushes so two overlapping ones cannot interleave appends. */
  let flushChain: Promise<void> = Promise.resolve();

  function renderMarkdown(): string {
    const header = `# ${runId}\n\n**Input:** ${input}\n`;
    const body = committed.map(renderBurst).join("\n");
    const closing =
      synthesisText === "" ? "" : `\n---\n\n# Synthesis\n\n${synthesisText}\n`;

    return `${header}\n${body}${closing}`;
  }

  async function writeBoth(): Promise<void> {
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, renderMarkdown(), "utf8");

    const unwritten = committed.slice(sidecarLines);
    if (unwritten.length > 0) {
      const lines = unwritten
        .map((record) => `${JSON.stringify(record)}\n`)
        .join("");
      await appendFile(jsonlPath, lines, "utf8");
      // Advanced only after the append resolves. Advancing first would drop the
      // lines permanently on a failed write — the next flush would consider
      // them already mirrored.
      sidecarLines += unwritten.length;
    }
  }

  return {
    markdownPath,
    jsonlPath,
    fenceToken,

    setInput(value) {
      input = value;
    },

    beginBurst() {
      pendingText = "";
    },

    appendToken(token) {
      pendingText += token;
    },

    pending() {
      return pendingText;
    },

    completeBurst(record) {
      const text = record.text !== "" ? record.text : pendingText;
      const committedRecord: BurstRecord = {
        iteration: record.iteration,
        persona: record.persona,
        text,
        costUsd: record.costUsd,
        at: record.at,
      };

      committed.push(committedRecord);
      pendingText = "";

      return committedRecord;
    },

    bursts() {
      return committed;
    },

    text() {
      if (committed.length === 0) {
        return "";
      }

      return committed
        .map((record) => renderTurn(record, fenceToken))
        .join("\n\n");
    },

    setSynthesis(text) {
      synthesisText = text;
    },

    synthesis() {
      return synthesisText;
    },

    flush() {
      flushChain = flushChain.then(writeBoth, writeBoth);

      return flushChain;
    },
  };
}

/** Default transcript directory when the caller does not name one. */
export function defaultTranscriptDir(): string {
  return join(process.cwd(), ".ai-harness");
}

/** A run ID with enough entropy that two runs a millisecond apart do not collide. */
export function createRunId(now: () => number = Date.now): string {
  return `run-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}
