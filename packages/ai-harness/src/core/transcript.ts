/**
 * The growing shared document every persona reads and adds to.
 *
 * The in-memory transcript is the source of truth; whatever a store mirrors it
 * to is a copy. That ordering is deliberate. The synthesizer reads
 * {@link Transcript.text}, not the mirror, so there is no window in which a
 * flush has not landed yet and the closing document is written against a
 * transcript missing its last turn.
 *
 * **Nothing here touches a disk.** A {@link Transcript} renders; a
 * {@link TranscriptSink} writes; a {@link TranscriptStore} hands out one of each
 * per run. The filesystem implementation lives in `../adapters/node/transcript.js`
 * and is supplied by whoever wants files — the command line does. That is what
 * lets a chain run to completion in a process with no filesystem, which is the
 * shape a server surface needs and the shape a test can assert.
 *
 * **Why tokens are buffered.** A turn arrives as deltas, and the obvious thing
 * — append each delta as it lands — is wrong the first time a call is retried.
 * `withRetry` re-invokes the runner, the provider replays the response from the
 * beginning, and the transcript ends up holding the abandoned half-turn followed
 * by the complete one, as a single run-on contribution that every later persona
 * then reads as context. So deltas accumulate in a pending buffer that
 * {@link Transcript.beginTurn} clears, and only {@link Transcript.completeTurn}
 * commits. A replay refills a buffer; it cannot duplicate a turn, because a turn
 * does not exist until it is whole.
 *
 * **Why there are two renderings.** {@link Transcript.text} is what the next
 * persona and the synthesizer read; the markdown is what a person reads. They
 * are not the same string. The prompt-facing one fences each turn in a tag
 * carrying the run's marker, so a turn cannot write the structure that separates
 * turns and pass its own text off as the harness's; the markdown keeps the plain
 * heading, because that is the artefact and it should hold what the model
 * produced. Terminal escape sequences are likewise kept in the artefact and
 * removed on the way to a screen — see `./safety.js`.
 *
 * @module
 */

import { createFenceToken, fence } from "./safety.js";

// ============================================================================
// Records
// ============================================================================

/** One completed turn. Also the shape of one line in the JSONL sidecar. */
export interface TurnRecord {
  iteration: number;
  persona: string;
  text: string;
  costUsd: number;
  at: number;
}

// ============================================================================
// The seam
// ============================================================================

/**
 * Where a transcript's two renderings go when it flushes.
 *
 * The whole of the harness's output side, in three members. A transcript
 * decides *what* the bytes are; a sink decides *where* they land and is the only
 * thing in the package that has to know whether that is a file, an object store,
 * or nothing at all.
 */
export interface TranscriptSink {
  /**
   * Where the human-readable rendering lands.
   *
   * Reported on `chain:complete` and on a run's result, so it is whatever an
   * operator should be told. A filesystem sink puts an absolute path here; a
   * sink that keeps the run in memory puts something that says so.
   */
  readonly markdownPath: string;
  /** Where the machine-readable sidecar lands, one line per turn. */
  readonly jsonlPath: string;
  /**
   * Mirror the transcript.
   *
   * `markdown` is the whole document every time — a rewrite cannot accumulate a
   * partial write. `appended` is only the records the sink has not been given
   * yet, because the sidecar is append-only. A sink that resolves without
   * writing has not lost anything: the transcript is still whole in memory.
   */
  write(markdown: string, appended: readonly TurnRecord[]): Promise<void>;
}

/** What {@link TranscriptStore.open} needs to name a run. */
export interface OpenTranscriptOptions {
  /** Names the run, and its two artefacts. */
  runId: string;
  /**
   * The run's fence marker.
   *
   * Generated when omitted, which is what every caller should do — it is an
   * option so a test can assert on a fixed fence rather than a random one.
   */
  fenceToken?: string;
}

/**
 * Somewhere a run's artefacts can go.
 *
 * One abstraction for both writers the package has. `open` covers a chain's
 * transcript and sidecar; `writeDocument` covers the one standalone artefact — a
 * composition's combined document — which used to be a second, separate call to
 * `writeFile` sitting next to this one and knowing nothing about it.
 */
export interface TranscriptStore {
  /** A transcript for one run. */
  open(options: OpenTranscriptOptions): Transcript;
  /**
   * Write a standalone document under this store.
   *
   * @param name - The artefact's file name, e.g. `run-123.md`.
   * @returns Where it landed, for reporting.
   */
  writeDocument(name: string, contents: string): Promise<string>;
}

// ============================================================================
// Transcript
// ============================================================================

export interface Transcript {
  /** Where the human-readable rendering lands. From the sink. */
  readonly markdownPath: string;
  /** Where the machine-readable sidecar lands, one line per turn. */
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
  /** Discard whatever the current turn has delivered so far. */
  beginTurn(): void;
  /** Accumulate one provider delta into the current turn. */
  appendToken(token: string): void;
  /** What the current turn has delivered so far. */
  pending(): string;
  /**
   * Commit a turn.
   *
   * `text` wins when it is non-empty — the runner's returned output is the
   * provider's own account of what it produced, and the delta buffer is a
   * reconstruction. The buffer stands in for a runner that streamed but
   * returned nothing.
   */
  completeTurn(record: Omit<TurnRecord, "text"> & { text: string }): TurnRecord;
  /** Every committed turn, oldest first. */
  turns(): readonly TurnRecord[];
  /**
   * The whole transcript as the personas and the synthesizer see it.
   *
   * Fenced, unlike the markdown rendering. See the module note on the two.
   */
  text(): string;
  /** The whole transcript as a person reads it. What a sink is handed. */
  markdown(): string;
  /** Attach the closing document. */
  setSynthesis(text: string): void;
  /** The closing document, or `""`. */
  synthesis(): string;
  /**
   * Mirror the transcript through the sink.
   *
   * Idempotent, and safe to call more often than there is news. Flushes are
   * serialized, so two overlapping ones cannot interleave the sidecar's appends,
   * and the append bookkeeping only advances once the sink has resolved —
   * advancing first would drop records permanently on a failed write, because
   * the next flush would consider them already mirrored.
   */
  flush(): Promise<void>;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * One turn, as it appears in the markdown rendering.
 *
 * A heading and the text, unaltered. The artefact is read by people, diffed, and
 * pasted elsewhere, so it holds what the model produced — including escape
 * sequences, which are only dangerous when a terminal interprets them and are
 * neutralized there instead.
 */
function renderMarkdownTurn(record: TurnRecord): string {
  return `## ${record.iteration + 1}. ${record.persona}\n\n${record.text}\n`;
}

/**
 * One turn, as the next persona reads it.
 *
 * The other rendering, and the reason there are two. Every turn is context for
 * every later persona and for the synthesizer, so a turn that wrote a heading
 * of its own used to arrive downstream as though the harness had written it —
 * a turn could fabricate the structure that separates turns, and could
 * therefore fabricate a turn. Here each one is fenced in a tag carrying the
 * run's marker, with the marker stripped from the body, so it cannot close its
 * own fence or open a convincing one.
 */
function renderFencedTurn(record: TurnRecord, token: string): string {
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

/**
 * A transcript over a sink.
 *
 * Called by a {@link TranscriptStore}, which is what a caller reaches for. It is
 * exported because a caller with exactly one place to put exactly one run's
 * output has no use for a store.
 */
export function createTranscript(
  options: OpenTranscriptOptions & { sink: TranscriptSink },
): Transcript {
  const { runId, sink } = options;
  const fenceToken = options.fenceToken ?? createFenceToken();

  let input = "";
  const committed: TurnRecord[] = [];
  let pendingText = "";
  let synthesisText = "";
  /** How many records the sink already holds. The only append bookkeeping. */
  let mirroredRecords = 0;
  /** Serializes flushes so two overlapping ones cannot interleave appends. */
  let flushChain: Promise<void> = Promise.resolve();

  function renderMarkdown(): string {
    const header = `# ${runId}\n\n**Input:** ${input}\n`;
    const body = committed.map(renderMarkdownTurn).join("\n");
    const closing =
      synthesisText === "" ? "" : `\n---\n\n# Synthesis\n\n${synthesisText}\n`;

    return `${header}\n${body}${closing}`;
  }

  async function mirror(): Promise<void> {
    const appended = committed.slice(mirroredRecords);

    await sink.write(renderMarkdown(), appended);
    // Advanced only after the sink resolves. Advancing first would drop the
    // records permanently on a failed write — the next flush would consider
    // them already mirrored.
    mirroredRecords += appended.length;
  }

  return {
    markdownPath: sink.markdownPath,
    jsonlPath: sink.jsonlPath,
    fenceToken,

    setInput(value) {
      input = value;
    },

    beginTurn() {
      pendingText = "";
    },

    appendToken(token) {
      pendingText += token;
    },

    pending() {
      return pendingText;
    },

    completeTurn(record) {
      const text = record.text !== "" ? record.text : pendingText;
      const committedRecord: TurnRecord = {
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

    turns() {
      return committed;
    },

    text() {
      if (committed.length === 0) {
        return "";
      }

      return committed
        .map((record) => renderFencedTurn(record, fenceToken))
        .join("\n\n");
    },

    markdown() {
      return renderMarkdown();
    },

    setSynthesis(text) {
      synthesisText = text;
    },

    synthesis() {
      return synthesisText;
    },

    flush() {
      flushChain = flushChain.then(mirror, mirror);

      return flushChain;
    },
  };
}

// ============================================================================
// The in-memory store
// ============================================================================

/** A store that keeps everything written, for tests and for surfaces with no disk. */
export interface MemoryTranscriptStore extends TranscriptStore {
  /**
   * Everything mirrored so far, keyed by artefact name.
   *
   * A transcript contributes `<runId>.md` and `<runId>.jsonl`; a standalone
   * document contributes its own name. Empty until something flushes, which is
   * the same thing a filesystem store would say.
   */
  documents(): ReadonlyMap<string, string>;
}

/**
 * The default store: renders everything, writes nothing anywhere.
 *
 * A chain against this makes no filesystem call at all, which is what a server
 * surface needs and what the package defaults to. Files are opt-in — see
 * `createFileTranscriptStore` in `../adapters/node/transcript.js`, which the
 * command line supplies.
 */
export function createMemoryTranscriptStore(): MemoryTranscriptStore {
  const documents = new Map<string, string>();

  return {
    open({ runId, fenceToken }) {
      const markdownName = `${runId}.md`;
      const jsonlName = `${runId}.jsonl`;

      return createTranscript({
        runId,
        ...(fenceToken === undefined ? {} : { fenceToken }),
        sink: {
          markdownPath: memoryLocation(markdownName),
          jsonlPath: memoryLocation(jsonlName),
          write: async (markdown, appended) => {
            documents.set(markdownName, markdown);
            const lines = appended
              .map((record) => `${JSON.stringify(record)}\n`)
              .join("");
            documents.set(jsonlName, (documents.get(jsonlName) ?? "") + lines);
          },
        },
      });
    },

    async writeDocument(name, contents) {
      documents.set(name, contents);

      return memoryLocation(name);
    },

    documents() {
      return documents;
    },
  };
}

/**
 * What a memory store reports as a location.
 *
 * Not a path, and says so. An operator told `./runs/x.md` goes and opens it; one
 * told this asks where the transcript went, which is the correct question when
 * nothing was written down.
 */
function memoryLocation(name: string): string {
  return `memory://${name}`;
}

// ============================================================================
// Run IDs
// ============================================================================

/** A run ID with enough entropy that two runs a millisecond apart do not collide. */
export function createRunId(now: () => number = Date.now): string {
  return `run-${now()}-${Math.random().toString(36).slice(2, 8)}`;
}
