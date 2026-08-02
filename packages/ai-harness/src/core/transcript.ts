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
 * @module
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  /** Names both files: `<runId>.md` and `<runId>.jsonl`. */
  runId: string;
  /** Injectable clock, so tests do not depend on wall time. */
  now?: () => number;
}

export interface Transcript {
  /** Absolute path of the human-readable transcript. */
  readonly markdownPath: string;
  /** Absolute path of the machine-readable sidecar, one line per burst. */
  readonly jsonlPath: string;
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
  /** The whole transcript as the personas and the synthesizer see it. */
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

/** One burst, as it appears in the markdown file and in prompt context. */
function renderBurst(record: BurstRecord): string {
  return `## ${record.iteration + 1}. ${record.persona}\n\n${record.text}\n`;
}

// ============================================================================
// Factory
// ============================================================================

export function createTranscript(options: TranscriptOptions): Transcript {
  const { dir, runId } = options;

  const markdownPath = join(dir, `${runId}.md`);
  const jsonlPath = join(dir, `${runId}.jsonl`);

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

      return committed.map(renderBurst).join("\n");
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
