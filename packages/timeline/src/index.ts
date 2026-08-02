/**
 * @directive-run/timeline
 *
 * Time-travel test REPL — captures every lifecycle event from a Directive
 * system as a "frame," and renders the recorded timeline on demand
 * (typically when a test assertion fails).
 *
 * The substrate is Directive's `system.observe(observer)` API, which
 * already emits a fully-typed ObservationEvent stream covering fact
 * changes, constraint evaluations, requirement lifecycles, resolver
 * runs, derivations, and reconcile boundaries. This package adds:
 *
 *   1. A registry that holds recorded timelines keyed by name.
 *   2. A formatter that renders a timeline as a human-readable causal
 *      trace (with optional ANSI color).
 *   3. A vitest reporter (in `./reporter`) that, on test failure,
 *      auto-prints the matching timeline.
 *
 * The result: when `expect(sys.facts.x).toBe(true)` fails, you don't get
 * "expected false to be true" — you get the entire causal chain that led
 * to false, with each step timestamped and labeled.
 *
 * @see ../README.md for the full API and a worked example.
 */

import type { ObservationEvent } from "@directive-run/core";

/**
 * A single recorded frame. Mirrors `ObservationEvent` plus a monotonic
 * timestamp captured at record time.
 */
export interface TimelineFrame {
  /** Monotonic ms since timeline start. */
  ts: number;
  /** The raw observation event from `system.observe()`. */
  event: ObservationEvent;
}

/**
 * A complete recorded timeline.
 */
export interface Timeline {
  /** The name passed to `recordTimeline()` — used to look up by ID. */
  id: string;
  /** ms when recording started (Date.now()). */
  startedAtMs: number;
  /** All captured frames, in record order. */
  frames: TimelineFrame[];
  /** Calls to disable recording for this timeline. */
  stop: () => void;
}

/**
 * Minimal subset of System needed for recording. Avoids depending on the
 * full generic System type so this package can record any Directive
 * system without import gymnastics.
 */
export interface ObservableSystem {
  observe(observer: (event: ObservationEvent) => void): () => void;
}

/**
 * Global timeline registry. Keyed by user-supplied name. Vitest reporter
 * uses the test's full name as the key by convention; explicit users can
 * pick anything.
 *
 * Bounded to {@link DEFAULT_REGISTRY_CAP} entries; insertion past the cap
 * evicts the oldest entry (LRU by insertion order). Without this, long
 * test runs that record per-test without `afterEach(clearAllTimelines)`
 * would retain every ObservationEvent for the entire suite.
 */
const registry = new Map<string, Timeline>();

/**
 * Maximum number of timelines retained simultaneously. Tunable via
 * {@link setRegistryCap}. Older timelines are evicted in insertion order
 * when the cap is exceeded.
 */
const DEFAULT_REGISTRY_CAP = 500;
let registryCap = DEFAULT_REGISTRY_CAP;

/**
 * Adjust the registry's retention cap. The default of 500 covers most
 * test suites; raise it for runs that intentionally retain large
 * numbers of timelines (e.g. for batch analysis), or lower it under
 * memory pressure.
 */
export function setRegistryCap(cap: number): void {
  if (!Number.isFinite(cap) || cap < 1) {
    throw new Error("[timeline] registry cap must be a positive integer");
  }
  registryCap = Math.floor(cap);
  // Evict immediately if we're already over the new cap.
  while (registry.size > registryCap) {
    const oldestKey = registry.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = registry.get(oldestKey);
    if (oldest !== undefined) oldest.stop();
    registry.delete(oldestKey);
  }
}

function evictIfOverCap(): void {
  while (registry.size > registryCap) {
    const oldestKey = registry.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = registry.get(oldestKey);
    if (oldest !== undefined) oldest.stop();
    registry.delete(oldestKey);
  }
}

/**
 * Start recording lifecycle events from a Directive system into a named
 * timeline. The returned object's `stop()` halts recording; the timeline
 * remains in the registry until `clearTimeline(id)` runs.
 *
 * @example
 * ```ts
 * import { createSystem } from '@directive-run/core';
 * import { recordTimeline, formatTimeline } from '@directive-run/timeline';
 *
 * it('completes the load chain', async () => {
 *   const sys = createSystem({ module: createMyModule() });
 *   recordTimeline(sys, { id: 'load-chain' });
 *   sys.start();
 *   sys.events.LOAD();
 *   await flushAsync();
 *
 *   try {
 *     expect(sys.facts.status).toBe('ready');
 *   } catch (err) {
 *     console.log(formatTimeline(getTimeline('load-chain')));
 *     throw err;
 *   }
 * });
 * ```
 *
 * Idempotency: calling with the same `id` twice replaces the previous
 * recording. The `stop()` of the previous one is called before the new
 * recording begins.
 */
export function recordTimeline(
  system: ObservableSystem,
  opts: { id: string },
): Timeline {
  const existing = registry.get(opts.id);
  if (existing !== undefined) {
    existing.stop();
  }

  const startedAtMs = Date.now();
  const frames: TimelineFrame[] = [];
  let active = true;

  const unsubscribe = system.observe((event) => {
    if (!active) return;
    frames.push({ ts: Date.now() - startedAtMs, event });
  });

  const timeline: Timeline = {
    id: opts.id,
    startedAtMs,
    frames,
    stop: () => {
      if (!active) return;
      active = false;
      unsubscribe();
    },
  };

  registry.set(opts.id, timeline);
  evictIfOverCap();
  return timeline;
}

/**
 * Look up a recorded timeline by ID. Returns undefined if no timeline
 * with that ID has been recorded.
 */
export function getTimeline(id: string): Timeline | undefined {
  return registry.get(id);
}

/**
 * Drop a recorded timeline from the registry. Call this in test
 * `afterEach` to avoid memory leaks across long test runs.
 */
export function clearTimeline(id: string): void {
  const existing = registry.get(id);
  if (existing !== undefined) {
    existing.stop();
    registry.delete(id);
  }
}

/**
 * Drop ALL recorded timelines. Useful in test global setup.
 */
export function clearAllTimelines(): void {
  for (const t of registry.values()) {
    t.stop();
  }
  registry.clear();
}

/**
 * Convenience wrapper: record around a synchronous or async block. The
 * timeline's `stop()` is called automatically when the block resolves
 * or throws (the timeline stays in the registry — call `clearTimeline`
 * if you need to GC it).
 *
 * @example
 * ```ts
 * await withTimeline('my-test', sys, async () => {
 *   sys.events.START();
 *   await flushAsync();
 *   expect(sys.facts.status).toBe('done');
 * });
 * ```
 */
export async function withTimeline<T>(
  id: string,
  system: ObservableSystem,
  fn: () => T | Promise<T>,
): Promise<T> {
  const timeline = recordTimeline(system, { id });
  try {
    return await fn();
  } finally {
    timeline.stop();
  }
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Options for rendering a timeline to text.
 */
export interface FormatOptions {
  /** Use ANSI color escapes. Default: true if running in a TTY-like env. */
  color?: boolean;
  /** Maximum number of frames to render. Default: 200. */
  maxFrames?: number;
  /** Frame kinds to include. Default: all. */
  include?: readonly ObservationEvent["type"][];
  /** Truncate fact-change values to this length. Default: 80. */
  valuePreviewLen?: number;
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const KIND_COLORS: Record<string, keyof typeof ANSI> = {
  "fact.change": "cyan",
  "constraint.evaluate": "yellow",
  "constraint.error": "red",
  "requirement.created": "blue",
  "requirement.met": "green",
  "requirement.canceled": "dim",
  "resolver.start": "magenta",
  "resolver.complete": "green",
  "resolver.error": "red",
  "effect.run": "blue",
  "effect.error": "red",
  "derivation.compute": "dim",
  "reconcile.start": "dim",
  "reconcile.end": "dim",
  "system.init": "dim",
  "system.start": "dim",
  "system.stop": "dim",
  "system.destroy": "dim",
  "source.attach": "magenta",
  "source.publish": "cyan",
  "source.detach": "magenta",
  "source.error": "red",
};

/**
 * Render a timeline to a human-readable, optionally-colored multi-line
 * string. Designed for CLI output (test failure dumps).
 *
 * @example
 * Sample output for a recording started AFTER `createSystem()` but
 * BEFORE `sys.start()` — `system.init` fires synchronously inside
 * `createSystem` and is missed by any subscriber registered later, so
 * it does not appear here:
 * ```
 * Timeline 'load-chain' — 11 frames over 23ms
 *   [+0.1ms] system.start
 *   [+0.1ms] reconcile.start
 *   [+0.2ms] fact.change status: 'idle' → 'loading'
 *   [+0.3ms] constraint.evaluate loadOnLoading active=true
 *   [+0.4ms] requirement.created LOAD_DATA
 *   [+0.5ms] resolver.start dataLoader (LOAD_DATA)
 *   [+12.3ms] resolver.complete dataLoader (12.3ms)
 *   [+12.4ms] fact.change items: [] → [{...3 items}]
 *   [+12.5ms] fact.change status: 'loading' → 'ready'
 *   [+12.6ms] derivation.compute isReady → true
 *   [+12.7ms] reconcile.end (1 resolver completed)
 * ```
 */
export function formatTimeline(
  timeline: Timeline | undefined,
  opts: FormatOptions = {},
): string {
  if (timeline === undefined) {
    return "(no timeline)";
  }

  const useColor = opts.color ?? defaultUseColor();
  const maxFrames = opts.maxFrames ?? 200;
  const include = opts.include;
  const previewLen = opts.valuePreviewLen ?? 80;

  const c = (color: keyof typeof ANSI, s: string): string =>
    useColor ? `${ANSI[color]}${s}${ANSI.reset}` : s;

  const lines: string[] = [];
  const filtered = include
    ? timeline.frames.filter((f) => include.includes(f.event.type))
    : timeline.frames;
  const totalDuration =
    timeline.frames.length > 0
      ? timeline.frames[timeline.frames.length - 1]!.ts
      : 0;

  lines.push(
    c(
      "bold",
      `Timeline '${timeline.id}' — ${filtered.length} frame${filtered.length === 1 ? "" : "s"} over ${formatDuration(totalDuration)}`,
    ),
  );

  const visible = filtered.slice(0, maxFrames);
  const truncated = filtered.length - visible.length;

  for (const frame of visible) {
    const ts = c("dim", `[+${formatDuration(frame.ts)}]`.padEnd(11));
    const kind = c(KIND_COLORS[frame.event.type] ?? "reset", frame.event.type);
    const detail = formatEventDetail(frame.event, previewLen, useColor);
    lines.push(`  ${ts} ${kind}${detail.length > 0 ? ` ${detail}` : ""}`);
  }

  if (truncated > 0) {
    lines.push(
      c(
        "dim",
        `  … (${truncated} more frame${truncated === 1 ? "" : "s"} elided; raise maxFrames to see all)`,
      ),
    );
  }

  return lines.join("\n");
}

function formatEventDetail(
  event: ObservationEvent,
  previewLen: number,
  useColor: boolean,
): string {
  const c = (color: keyof typeof ANSI, s: string): string =>
    useColor ? `${ANSI[color]}${s}${ANSI.reset}` : s;

  switch (event.type) {
    case "fact.change":
      return `${c("bold", event.key)}: ${preview(event.prev, previewLen)} → ${preview(event.next, previewLen)}`;
    case "constraint.evaluate":
      return `${event.id} active=${event.active}`;
    case "constraint.error":
      return `${event.id}: ${formatError(event.error)}`;
    case "requirement.created":
      return `${event.requirementType} (${event.id})`;
    case "requirement.met":
      return `${event.id} by ${event.byResolver}`;
    case "requirement.canceled":
      return event.id;
    case "resolver.start":
      return `${event.resolver} (${event.requirementId})`;
    case "resolver.complete":
      return `${event.resolver} (${formatDuration(event.duration)})`;
    case "resolver.error":
      return `${event.resolver}: ${formatError(event.error)}`;
    case "effect.run":
      return event.id;
    case "effect.error":
      return `${event.id}: ${formatError(event.error)}`;
    case "derivation.compute":
      return `${event.id} → ${preview(event.value, previewLen)}`;
    case "reconcile.end":
      return `(${event.resolversCompleted} completed${event.resolversCanceled > 0 ? `, ${event.resolversCanceled} canceled` : ""})`;
    case "source.attach":
      return `${c("bold", event.moduleId)}.${event.id}`;
    case "source.publish":
      return `${c("bold", event.moduleId)}.${event.id} → ${event.eventName}`;
    case "source.detach":
      return `${c("bold", event.moduleId)}.${event.id}`;
    case "source.error":
      return `${c("bold", event.moduleId)}.${event.id} [${event.phase}]: ${formatError(event.error)}`;
    default:
      return "";
  }
}

function preview(value: unknown, max: number): string {
  let str: string;
  if (value === null) str = "null";
  else if (value === undefined) str = "undefined";
  else if (typeof value === "string") str = JSON.stringify(value);
  else if (typeof value === "number" || typeof value === "boolean")
    str = String(value);
  else {
    try {
      str = JSON.stringify(value);
      if (Array.isArray(value)) {
        str = `[${value.length} item${value.length === 1 ? "" : "s"}]`;
      } else if (typeof value === "object") {
        const keys = Object.keys(value as object);
        if (keys.length > 3) {
          str = `{${keys.length} keys}`;
        }
      }
    } catch {
      str = "[unserializable]";
    }
  }
  if (str.length > max) {
    return `${str.slice(0, max - 1)}…`;
  }
  return str;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "[unserializable error]";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 100) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(0)}ms`;
}

function defaultUseColor(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return Boolean(process.stdout?.isTTY);
}

// ============================================================================
// Internal: registry access (used by reporter)
// ============================================================================

/**
 * Access the full registry. Used internally by the vitest reporter; not
 * recommended for application code (use the named API above instead).
 *
 * @internal
 */
export function _getRegistry(): ReadonlyMap<string, Timeline> {
  return registry;
}

// ============================================================================
// Serialization + replay (directive replay v0.1)
// ============================================================================

/**
 * Serialized timeline format. JSON-roundtrippable; suitable for posting
 * to a bug tracker, attaching to a Sentry event, or piping through a
 * CLI. Frame `event` objects are already JSON-safe per the
 * `ObservationEvent` contract.
 */
export interface SerializedTimeline {
  /** Schema version. Bumped on incompatible changes to the wire format. */
  version: 1;
  /** Identifier (test name, error ID, etc) carried for round-trip. */
  id: string;
  /** Wall-clock ms when recording started. */
  startedAtMs: number;
  /** Captured frames — `event.type` carries the discriminator. */
  frames: TimelineFrame[];
}

/**
 * Convert a recorded {@link Timeline} to its JSON-safe serialized form.
 * The result can be `JSON.stringify`'d directly.
 *
 * @example
 * ```ts
 * const t = recordTimeline(sys, { id: 'bug-123' });
 * sys.start();
 * // ... reproduce bug ...
 * const json = JSON.stringify(serializeTimeline(t));
 * await fetch('/bugs', { method: 'POST', body: json });
 * ```
 */
export function serializeTimeline(timeline: Timeline): SerializedTimeline {
  return {
    version: 1,
    id: timeline.id,
    startedAtMs: timeline.startedAtMs,
    frames: timeline.frames.map((f) => ({ ts: f.ts, event: f.event })),
  };
}

/**
 * Parse a serialized timeline back into the in-memory shape suitable for
 * {@link replayTimeline} or {@link formatTimeline}. Validates the
 * version + structural shape; throws on mismatch.
 */
export function deserializeTimeline(input: unknown): SerializedTimeline {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("[timeline] deserialize: expected object input");
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(
      `[timeline] deserialize: unsupported version ${String(obj.version)} (expected 1)`,
    );
  }
  if (typeof obj.id !== "string") {
    throw new TypeError("[timeline] deserialize: id must be a string");
  }
  if (typeof obj.startedAtMs !== "number") {
    throw new TypeError("[timeline] deserialize: startedAtMs must be a number");
  }
  if (!Array.isArray(obj.frames)) {
    throw new TypeError("[timeline] deserialize: frames must be an array");
  }
  // validate every frame is a structurally-sound object
  // before returning. Without this guard, untrusted input with
  // `frames: [null]` or `frames: [{event: null}]` slips through and
  // crashes the replay loop AND every matcher iteration with a
  // bare TypeError instead of a clean rejection. The documented use
  // case (prod-error JSON → replay) requires the input to be
  // by-design untrusted.
  const frames = obj.frames.map((f, i) => validateFrame(f, i));
  return {
    version: 1,
    id: obj.id,
    startedAtMs: obj.startedAtMs,
    frames,
  };
}

/**
 * Validate a single frame slot. Throws TypeError with a precise index
 * on malformed input. Returns the frame typed as `TimelineFrame`.
 *
 * @internal
 */
function validateFrame(raw: unknown, index: number): TimelineFrame {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError(
      `[timeline] deserialize: frames[${index}] must be an object`,
    );
  }
  const f = raw as { ts?: unknown; event?: unknown };
  if (typeof f.ts !== "number" || !Number.isFinite(f.ts)) {
    throw new TypeError(
      `[timeline] deserialize: frames[${index}].ts must be a finite number`,
    );
  }
  if (f.event === null || typeof f.event !== "object") {
    throw new TypeError(
      `[timeline] deserialize: frames[${index}].event must be an object`,
    );
  }
  const ev = f.event as { type?: unknown };
  if (typeof ev.type !== "string") {
    throw new TypeError(
      `[timeline] deserialize: frames[${index}].event.type must be a string`,
    );
  }
  return raw as TimelineFrame;
}

/**
 * Replay options. The minimum-viable surface is "no options" — replay
 * dispatches every recorded event through the supplied system.
 */
export interface ReplayOptions {
  /**
   * Skip frames whose event type doesn't have a corresponding
   * dispatchable surface (e.g. `system.init`, `reconcile.start`,
   * `derivation.compute` — all caused-by-effect, not dispatchable).
   * Default: true.
   */
  dispatchableOnly?: boolean;
  /**
   * @deprecated Use {@link ReplayOptions.dispatchableOnly} instead.
   * Kept for v0.1 compatibility — read as the inverse of
   * `dispatchableOnly`. The original name was unintuitive ("dispatchable: true"
   * read as "this thing IS dispatchable" rather than "filter to dispatchable
   * frames"). Removed in v1.0.
   */
  dispatchable?: boolean;
  /**
   * Maximum number of frames the replay loop will process before
   * stopping. Defaults to {@link DEFAULT_MAX_REPLAY_FRAMES}. Replay
   * of an unbounded prod-error JSON dump otherwise lets a malicious
   * input run an unbounded synchronous loop in a worker.
   */
  maxFrames?: number;
}

/** Default maxFrames cap on {@link replayTimeline}. */
export const DEFAULT_MAX_REPLAY_FRAMES = 100_000;

/**
 * Diagnostic result returned by {@link replayTimeline}. Lets callers
 * verify that the replay actually re-dispatched the events they
 * expected, instead of silently no-op'ing on a non-mutator system.
 */
export interface ReplayResult {
  /** Number of frames that produced a dispatch. */
  dispatched: number;
  /** Number of frames skipped (non-dispatchable or reconstruct returned null). */
  skipped: number;
  /** Number of frames truncated by `maxFrames` cap. */
  truncated: number;
}

/**
 * Minimal subset of System needed for replay — needs `dispatch` for
 * value events, NOT the typed `events.X` accessor. Replay treats
 * `fact.change` as a forward-write only when the consumer wires a
 * dispatch source for it (covered by the dispatchable filter).
 */
export interface ReplayableSystem {
  dispatch(event: { type: string; [key: string]: unknown }): void;
}

/**
 * Replay a serialized timeline against a fresh system.
 *
 * v0.1 scope (deliberately narrow):
 *
 *   - Walks frames in order. For each frame whose event type maps to a
 *     dispatchable surface, calls `system.dispatch(...)` with a
 *     reconstructed event payload.
 *   - "Dispatchable" today means events that originated from
 *     `sys.events.X(payload)` calls — recorded in the timeline as a
 *     dedicated `event.dispatch` ObservationEvent (planned). Until
 *     core emits `event.dispatch` events, this is a forward-compatible
 *     stub: `replayTimeline` reads MUTATE events from
 *     `@directive-run/mutator` shapes (where the mutator-specific
 *     event-handler reconstructs the dispatch from `pendingMutation`
 *     fact.change frames).
 *   - The system itself must be set up with the same module shape as
 *     the original recording. The replay does NOT reconstruct the
 *     system — that's the consumer's responsibility (test fixture).
 *
 * v0.2 scope (deferred):
 *
 *   - Auto-skip frames whose event types are causally derived
 *     (constraint.evaluate, derivation.compute, requirement.created)
 *     so replay only re-fires the original CAUSES.
 *   - Determinism gate: assert the replay's observed frame stream
 *     matches the input frames byte-for-byte.
 *   - Codegen: emit a vitest source file that drives this replay loop.
 *
 * @example
 * ```ts
 * const json = JSON.parse(prodErrorReportText);
 * const timeline = deserializeTimeline(json);
 * const sys = createSystem({ module: createSameModuleAsProd() });
 * sys.start();
 * await replayTimeline(timeline, sys);
 * // Now the test's assertions can run against the replayed system.
 * ```
 */
export async function replayTimeline(
  timeline: SerializedTimeline,
  system: ReplayableSystem,
  opts: ReplayOptions = {},
): Promise<ReplayResult> {
  // Both `dispatchableOnly` (preferred) and `dispatchable` (deprecated)
  // are accepted; preferred wins.
  const dispatchableOnly = opts.dispatchableOnly ?? opts.dispatchable ?? true;
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_REPLAY_FRAMES;
  let dispatched = 0;
  let skipped = 0;
  let processed = 0;
  for (const frame of timeline.frames) {
    if (processed >= maxFrames) {
      return {
        dispatched,
        skipped,
        truncated: timeline.frames.length - processed,
      };
    }
    processed++;
    if (!isDispatchable(frame.event)) {
      skipped++;
      if (dispatchableOnly) continue;
    }
    const reconstructed = reconstructDispatch(frame.event);
    if (reconstructed !== null) {
      system.dispatch(reconstructed);
      dispatched++;
    } else {
      skipped++;
    }
  }
  // Replay against a non-mutator timeline is the most-asked first-use
  // question — `dispatched: 0, skipped: N > 0` means the function found
  // events to re-dispatch but none of them matched the dispatch-driven
  // shape `isDispatchable()` recognises today. Without a dev signal,
  // callers think the function silently no-op'd. Emit once per call so
  // production replays don't spam.
  if (
    dispatched === 0 &&
    skipped > 0 &&
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production"
  ) {
    console.warn(
      `[Directive:timeline] replayTimeline dispatched 0 of ${skipped} candidate frames. Today \`isDispatchable()\` recognises mutator-shape \`pendingMutation\` writes only — non-mutator systems will not re-dispatch via replay yet. See packages/timeline/src/index.ts \`isDispatchable\` for the current set.`,
    );
  }
  return { dispatched, skipped, truncated: 0 };
}

/**
 * Decide whether a recorded frame represents an event that can be
 * re-dispatched on a fresh system. Today this returns `true` only for
 * fact.change frames where the change pattern matches a known
 * dispatch-driven shape (notably mutator's `pendingMutation` writes
 * carrying `kind`/`payload`/`status`). The set will expand once core
 * adds first-class `event.dispatch` recording.
 */
function isDispatchable(event: ObservationEvent): boolean {
  if (event.type !== "fact.change") return false;
  if (event.key !== "pendingMutation") return false;
  const next = event.next;
  if (next === null || typeof next !== "object") return false;
  const maybeMutation = next as { kind?: unknown; status?: unknown };
  return (
    typeof maybeMutation.kind === "string" && maybeMutation.status === "pending"
  );
}

/**
 * Reconstruct a `dispatch`-shaped event from a recorded fact.change
 * frame. Returns null if the frame can't be cleanly mapped — the
 * caller's loop skips it.
 */
function reconstructDispatch(
  event: ObservationEvent,
): { type: string; [key: string]: unknown } | null {
  if (event.type !== "fact.change") return null;
  if (event.key !== "pendingMutation") return null;
  const next = event.next as Record<string, unknown> | null;
  if (next === null) return null;
  // spread BEFORE the type literal so an attacker-controlled
  // `next.type` from untrusted JSON cannot override the MUTATE
  // dispatch type.
  // Defense-in-depth: drop own `__proto__` / `constructor` /
  // `prototype` keys before the spread. JSON.parse already stores these
  // as own properties (no prototype slot manipulation), and a plain
  // spread does not perform `obj["__proto__"] = ...` assignment, so the
  // surface here is benign today — but downstream user handlers that
  // do `Object.assign(target, event.payload)` or `Object.create(...)`
  // could still be misled by a hostile timeline. Stripping at the
  // boundary is cheaper than auditing every consumer.
  const safe: Record<string, unknown> = {};
  for (const k of Object.keys(next)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      continue;
    }
    safe[k] = next[k];
  }
  return { ...safe, type: "MUTATE" };
}

// ────────────────────────────────────────────────────────────────────────────
// Bisect — git-bisect for timelines
// ────────────────────────────────────────────────────────────────────────────

/**
 * Async or sync factory that produces a fresh, started system suitable
 * for replay. Bisect calls this once per midpoint to get a hermetic
 * system; the previous midpoint's state must not leak into the next.
 *
 * The factory is responsible for `start()` — bisect will not call it.
 * If your factory returns a system already in started state (the
 * common pattern with `createSystem({ ... })` followed by `sys.start()`),
 * pass a closure that builds it fresh each time:
 *
 * @example
 * ```ts
 * const factory = () => {
 *   const sys = createSystem({ module: counterModule });
 *   sys.start();
 *   return sys;
 * };
 * ```
 */
export type BisectSystemFactory = () =>
  | ReplayableSystem
  | Promise<ReplayableSystem>;

/**
 * Oracle that decides pass/fail for a given replayed system. Return
 * `true` if the system is in a "good" state, `false` if "bad". May be
 * async (most matcher-based oracles are not, but resolver assertions
 * sometimes are).
 *
 * The oracle MUST be deterministic — bisection's correctness depends on
 * the same prefix length always producing the same verdict.
 *
 * Receives `unknown` rather than {@link ReplayableSystem} because the
 * caller's factory typically produces a richer System shape (with
 * `facts`, `inspect`, etc.) and the oracle needs access to those — the
 * narrow `ReplayableSystem` only exposes `dispatch`.
 */
export type BisectAssertion = (system: unknown) => boolean | Promise<boolean>;

/**
 * Tunables for {@link bisectTimeline}. All fields are optional — sane
 * defaults keep the v0.1 surface tiny.
 */
export interface BisectOptions {
  /**
   * Per-replay frame cap, forwarded to {@link replayTimeline}. Defaults
   * to {@link DEFAULT_MAX_REPLAY_FRAMES}. Bisect ignores truncation
   * here because each midpoint replays a *prefix*, not the full
   * timeline — truncation should never fire under normal use.
   */
  maxFrames?: number;
  /**
   * If true (default), bisect runs the full-timeline replay TWICE
   * before searching and refuses to bisect if the two runs produce
   * different oracle verdicts. Non-deterministic timelines silently
   * mislead bisection — the midpoint search picks an arbitrary
   * direction at each step. This is the #1 failure mode for
   * bisection.
   *
   * Disable only if you know the timeline is deterministic but the
   * oracle has unrelated nondeterminism you've measured to be
   * tolerable.
   */
  determinismCheck?: boolean;
  /**
   * Mirrors {@link ReplayOptions.dispatchableOnly}. Defaults to true.
   */
  dispatchableOnly?: boolean;
}

/**
 * Discriminator on {@link BisectResult.kind}. Lets consumers `switch`
 * over the four mutually-exclusive outcomes without juggling three
 * booleans plus an optional index.
 *
 * - `'found'` — bisect located the first failing frame. `firstFailingFrameIndex`
 *   and `firstFailingFrame` are set.
 * - `'no-failure'` — assertion passes even after replaying every frame; nothing
 *   to bisect. The caller probably has the wrong `bad.json` or the wrong oracle.
 * - `'fails-on-empty'` — assertion fails on a system with ZERO frames replayed
 *   (the bug is in initialization, not any specific frame).
 * - `'non-deterministic'` — two full-timeline replays produced different oracle
 *   verdicts, so {@link BisectOptions.determinismCheck} refused to bisect.
 */
export type BisectResultKind =
  | "found"
  | "no-failure"
  | "fails-on-empty"
  | "non-deterministic";

/**
 * Outcome of {@link bisectTimeline}.
 *
 * Prefer the {@link BisectResult.kind} discriminator over the legacy
 * boolean fields for type-narrowed access — the booleans are kept
 * populated for back-compat with the v0.2 surface.
 *
 * @example
 * ```ts
 * const result = await bisectTimeline(timeline, factory, oracle);
 * switch (result.kind) {
 *   case 'found':
 *     console.log(`first failing frame: #${result.firstFailingFrameIndex!}`);
 *     break;
 *   case 'no-failure':
 *     console.log('oracle never fails — wrong bad.json?');
 *     break;
 *   case 'fails-on-empty':
 *     console.log('bug is in initialization');
 *     break;
 *   case 'non-deterministic':
 *     console.log('determinism gate refused to bisect');
 *     break;
 * }
 * ```
 */
export interface BisectResult {
  /**
   * Discriminator for the four mutually-exclusive outcomes. Prefer
   * this over the legacy boolean fields.
   */
  kind: BisectResultKind;
  /**
   * 0-based index into `timeline.frames` of the first frame whose
   * inclusion in the replay prefix flips the assertion from passing
   * to failing. Set when `kind === 'found'`; undefined otherwise.
   */
  firstFailingFrameIndex?: number;
  /**
   * The frame at {@link BisectResult.firstFailingFrameIndex}, copied
   * for convenience so callers don't have to re-index. Set when
   * `kind === 'found'`; undefined otherwise.
   */
  firstFailingFrame?: TimelineFrame;
  /**
   * Number of midpoints evaluated. O(log N) where N = frame count.
   */
  iterations: number;
  /**
   * @deprecated Prefer {@link BisectResult.kind} === `'no-failure'`.
   * Kept for back-compat with the v0.2 surface.
   */
  noFailureFound: boolean;
  /**
   * @deprecated Prefer {@link BisectResult.kind} === `'fails-on-empty'`.
   * Kept for back-compat with the v0.2 surface.
   */
  failsOnEmptyReplay: boolean;
  /**
   * @deprecated Prefer {@link BisectResult.kind} === `'non-deterministic'`.
   * Kept for back-compat with the v0.2 surface.
   */
  nonDeterministic: boolean;
}

/**
 * Replay the first `prefixLen` frames of `timeline` against a fresh
 * system from `factory`, then evaluate `assertion`. Internal helper —
 * exported for tests, not part of the public API contract.
 *
 * @internal
 */
async function _bisectStep(
  timeline: SerializedTimeline,
  prefixLen: number,
  factory: BisectSystemFactory,
  assertion: BisectAssertion,
  replayOpts: ReplayOptions,
): Promise<boolean> {
  const sys = await factory();
  const prefix: SerializedTimeline = {
    version: 1,
    id: timeline.id,
    startedAtMs: timeline.startedAtMs,
    frames: timeline.frames.slice(0, prefixLen),
  };
  await replayTimeline(prefix, sys, replayOpts);
  // Oracle receives the rich system from the factory, not the narrow
  // ReplayableSystem — production oracles need `facts`, `inspect`,
  // etc., none of which live on ReplayableSystem.
  return assertion(sys);
}

/**
 * Binary-search a timeline for the smallest prefix whose replay flips
 * a user-supplied assertion from passing to failing — git-bisect, but
 * over recorded ObservationEvent frames instead of git commits.
 *
 * @example
 * ```ts
 * const json = JSON.parse(prodCrashReport.timelineJson);
 * const bad = deserializeTimeline(json);
 * const result = await bisectTimeline(
 *   bad,
 *   () => {
 *     const sys = createSystem({ module: counterModule });
 *     sys.start();
 *     return sys;
 *   },
 *   (sys) => (sys as any).facts.score >= 0,
 * );
 * console.log(`first failing frame: #${result.firstFailingFrameIndex}`);
 * ```
 *
 * Algorithm (assertion convention: `true` = pass, `false` = fail):
 *
 *   1. Optional determinism gate — replay the full timeline twice; if
 *      the assertion verdict differs, return early with
 *      `nonDeterministic: true`.
 *   2. Probe the empty prefix (`[]`). If the assertion already fails,
 *      the bug is in initialization — `failsOnEmptyReplay: true`.
 *   3. Probe the full prefix. If the assertion passes, there's
 *      nothing to bisect — `noFailureFound: true`.
 *   4. Binary search [lo=0, hi=frames.length]. Invariant: assertion
 *      passes at lo, fails at hi. Each midpoint replays from a fresh
 *      system. Continue until hi - lo === 1.
 *   5. Return frame index `lo` (the smallest prefix that triggers
 *      failure has length `hi`; the trigger frame is at index `lo`).
 *
 * Cost: O(log N) replays, each replaying up to N frames, so the
 * worst-case work is O(N log N). For a 10k-frame timeline that's ~14
 * replays of ~5k frames each — fast in practice.
 */
export async function bisectTimeline(
  timeline: SerializedTimeline,
  factory: BisectSystemFactory,
  assertion: BisectAssertion,
  opts: BisectOptions = {},
): Promise<BisectResult> {
  const determinismCheck = opts.determinismCheck ?? true;
  const replayOpts: ReplayOptions = {
    maxFrames: opts.maxFrames,
    dispatchableOnly: opts.dispatchableOnly,
  };
  const N = timeline.frames.length;

  let iterations = 0;

  // Step 1: determinism gate.
  if (determinismCheck) {
    const v1 = await _bisectStep(timeline, N, factory, assertion, replayOpts);
    const v2 = await _bisectStep(timeline, N, factory, assertion, replayOpts);
    iterations += 2;
    if (v1 !== v2) {
      return {
        kind: "non-deterministic",
        iterations,
        noFailureFound: false,
        failsOnEmptyReplay: false,
        nonDeterministic: true,
      };
    }
    // v1 is now the canonical full-replay verdict; reuse below.
    if (v1 === true) {
      return {
        kind: "no-failure",
        iterations,
        noFailureFound: true,
        failsOnEmptyReplay: false,
        nonDeterministic: false,
      };
    }
  } else {
    const fullPasses = await _bisectStep(
      timeline,
      N,
      factory,
      assertion,
      replayOpts,
    );
    iterations += 1;
    if (fullPasses) {
      return {
        kind: "no-failure",
        iterations,
        noFailureFound: true,
        failsOnEmptyReplay: false,
        nonDeterministic: false,
      };
    }
  }

  // Step 2: empty-prefix probe.
  const emptyPasses = await _bisectStep(
    timeline,
    0,
    factory,
    assertion,
    replayOpts,
  );
  iterations += 1;
  if (!emptyPasses) {
    return {
      kind: "fails-on-empty",
      iterations,
      noFailureFound: false,
      failsOnEmptyReplay: true,
      nonDeterministic: false,
    };
  }

  // Step 3: binary search. Invariant: assertion passes at lo, fails at hi.
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    const passes = await _bisectStep(
      timeline,
      mid,
      factory,
      assertion,
      replayOpts,
    );
    iterations += 1;
    if (passes) lo = mid;
    else hi = mid;
  }

  // The smallest failing prefix has length `hi` (== lo + 1). The
  // frame whose inclusion flips the verdict is at index `lo` (0-based).
  return {
    kind: "found",
    firstFailingFrameIndex: lo,
    firstFailingFrame: timeline.frames[lo],
    iterations,
    noFailureFound: false,
    failsOnEmptyReplay: false,
    nonDeterministic: false,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Diff — semantic causal-graph diff between two timelines
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-id count delta between two timelines, used for several
 * categories on {@link TimelineDiff}. Identifies a category bucket
 * (constraint id, mutation kind, resolver name) and reports how many
 * times the matching event appeared on each side.
 */
export interface CountDelta {
  /** Category-specific identifier (constraint id / mutation kind / resolver name). */
  id: string;
  /** Occurrences on the "a" timeline. */
  aCount: number;
  /** Occurrences on the "b" timeline. */
  bCount: number;
  /** `bCount - aCount`. Positive = more in b; negative = more in a. */
  delta: number;
}

/**
 * Resolver-run delta — three count axes per resolver name.
 */
export interface ResolverRunDelta {
  /** Resolver name. */
  resolver: string;
  aStarts: number;
  bStarts: number;
  aCompletes: number;
  bCompletes: number;
  aErrors: number;
  bErrors: number;
}

/**
 * One error that appeared on one side but not the other (or differs
 * structurally between sides). v0.1 reports new errors only — error
 * shape differences across both sides count as "new on b" if the
 * frame index differs, since pinpointing a structural change inside
 * the same error string is matcher-territory.
 */
export interface ErrorDelta {
  /** Which timeline carried the error. */
  side: "a" | "b";
  /** Event type. */
  kind: "constraint.error" | "resolver.error" | "effect.error";
  /** Identifier (constraint id, resolver name, effect id). */
  id: string;
  /** Raw error value as recorded. */
  error: unknown;
  /** 0-based frame index in the originating timeline. */
  frameIndex: number;
}

/**
 * Result of {@link diffTimelines}. Pure data — no formatting, no
 * sorting opinions baked in beyond category-level conventions
 * documented per field.
 */
export interface TimelineDiff {
  /** `b.frames.length - a.frames.length`. */
  frameCountDelta: number;
  /** Frame counts. */
  aFrameCount: number;
  bFrameCount: number;
  /**
   * Per-constraint evaluation count delta. Includes only constraints
   * whose count differs between sides (delta !== 0). Sorted by
   * descending |delta| for at-a-glance readability.
   */
  constraintFires: CountDelta[];
  /**
   * Per-mutation-kind dispatch count delta. Mutations are surfaced
   * via fact.change frames carrying `pendingMutation` writes —
   * matches `replayTimeline`'s dispatchable filter. Includes only
   * differing kinds.
   */
  mutations: CountDelta[];
  /** Per-resolver run delta. Includes only resolvers whose any-axis count differs. */
  resolverRuns: ResolverRunDelta[];
  /**
   * Errors that appeared on only one side of the diff. Two errors
   * with the same `(kind, id)` tuple at corresponding frame positions
   * are NOT reported — that's a "same shape" outcome. v0.1 surfaces
   * pure additions/removals only.
   */
  newErrors: ErrorDelta[];
  /**
   * True when no category surfaced any difference. Useful as a fast
   * "are these timelines semantically identical" check (much cheaper
   * than a JSON deep-compare on the frames).
   */
  identical: boolean;
}

/**
 * Pull a discriminator field off an event. Used to bucket frames by
 * (event.type, secondary key). Returns null if the type doesn't carry
 * that secondary key.
 */
function eventBucketKey(
  ev: ObservationEvent,
):
  | { kind: "constraint"; id: string }
  | { kind: "mutation"; mutationKind: string }
  | { kind: "resolver-start"; resolver: string }
  | { kind: "resolver-complete"; resolver: string }
  | { kind: "resolver-error"; resolver: string; error: unknown }
  | { kind: "constraint-error"; id: string; error: unknown }
  | { kind: "effect-error"; id: string; error: unknown }
  | null {
  switch (ev.type) {
    case "constraint.evaluate":
      return { kind: "constraint", id: (ev as { id: string }).id };
    case "fact.change": {
      // Mutation-shaped fact.change: pendingMutation transitioning to a
      // pending dispatch. Mirrors isDispatchable() so the diff stays
      // aligned with replay semantics.
      const e = ev as {
        key: string;
        next: unknown;
      };
      if (e.key !== "pendingMutation") return null;
      const next = e.next as Record<string, unknown> | null;
      if (next === null) return null;
      const k = next.kind;
      if (typeof k !== "string") return null;
      if (next.status !== "pending") return null;
      return { kind: "mutation", mutationKind: k };
    }
    case "resolver.start":
      return {
        kind: "resolver-start",
        resolver: (ev as { resolver: string }).resolver,
      };
    case "resolver.complete":
      return {
        kind: "resolver-complete",
        resolver: (ev as { resolver: string }).resolver,
      };
    case "resolver.error":
      return {
        kind: "resolver-error",
        resolver: (ev as { resolver: string }).resolver,
        error: (ev as { error: unknown }).error,
      };
    case "constraint.error":
      return {
        kind: "constraint-error",
        id: (ev as { id: string }).id,
        error: (ev as { error: unknown }).error,
      };
    case "effect.error":
      return {
        kind: "effect-error",
        id: (ev as { id: string }).id,
        error: (ev as { error: unknown }).error,
      };
    default:
      return null;
  }
}

interface BucketedCounts {
  constraintFires: Map<string, number>;
  mutations: Map<string, number>;
  resolverStarts: Map<string, number>;
  resolverCompletes: Map<string, number>;
  resolverErrors: Map<string, number>;
  errors: ErrorDelta[];
}

function bucketCounts(
  side: "a" | "b",
  frames: TimelineFrame[],
): BucketedCounts {
  const out: BucketedCounts = {
    constraintFires: new Map(),
    mutations: new Map(),
    resolverStarts: new Map(),
    resolverCompletes: new Map(),
    resolverErrors: new Map(),
    errors: [],
  };
  frames.forEach((frame, i) => {
    const bucket = eventBucketKey(frame.event);
    if (bucket === null) return;
    switch (bucket.kind) {
      case "constraint":
        out.constraintFires.set(
          bucket.id,
          (out.constraintFires.get(bucket.id) ?? 0) + 1,
        );
        break;
      case "mutation":
        out.mutations.set(
          bucket.mutationKind,
          (out.mutations.get(bucket.mutationKind) ?? 0) + 1,
        );
        break;
      case "resolver-start":
        out.resolverStarts.set(
          bucket.resolver,
          (out.resolverStarts.get(bucket.resolver) ?? 0) + 1,
        );
        break;
      case "resolver-complete":
        out.resolverCompletes.set(
          bucket.resolver,
          (out.resolverCompletes.get(bucket.resolver) ?? 0) + 1,
        );
        break;
      case "resolver-error":
        out.resolverErrors.set(
          bucket.resolver,
          (out.resolverErrors.get(bucket.resolver) ?? 0) + 1,
        );
        out.errors.push({
          side,
          kind: "resolver.error",
          id: bucket.resolver,
          error: bucket.error,
          frameIndex: i,
        });
        break;
      case "constraint-error":
        out.errors.push({
          side,
          kind: "constraint.error",
          id: bucket.id,
          error: bucket.error,
          frameIndex: i,
        });
        break;
      case "effect-error":
        out.errors.push({
          side,
          kind: "effect.error",
          id: bucket.id,
          error: bucket.error,
          frameIndex: i,
        });
        break;
    }
  });
  return out;
}

/**
 * Build a {@link CountDelta} list from two same-keyed maps. Includes
 * only entries with a non-zero delta. Sorted by descending |delta| so
 * the biggest divergences surface first.
 */
function deltaListFromMaps(
  aMap: Map<string, number>,
  bMap: Map<string, number>,
): CountDelta[] {
  const ids = new Set<string>([...aMap.keys(), ...bMap.keys()]);
  const out: CountDelta[] = [];
  for (const id of ids) {
    const aCount = aMap.get(id) ?? 0;
    const bCount = bMap.get(id) ?? 0;
    if (aCount === bCount) continue;
    out.push({ id, aCount, bCount, delta: bCount - aCount });
  }
  out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return out;
}

/**
 * Diff two serialized timelines as a structured causal-graph report.
 *
 * The diff vocabulary mirrors {@link "@directive-run/timeline/matchers"}'s
 * matcher surface inverted into reporters:
 *
 *   - `toFireConstraint(id, count)` ←→ `constraintFires` deltas
 *   - `toMutate(kind)`              ←→ `mutations` deltas
 *   - `toResolveWithinMs(resolver)` ←→ `resolverRuns` deltas
 *   - constraint/resolver/effect errors → `newErrors`
 *
 * For each category, only entries that DIFFER between sides are
 * included — categories where both timelines look identical are
 * elided so the output is focused.
 *
 * @example
 * ```ts
 * const a = deserializeTimeline(JSON.parse(goodJson));
 * const b = deserializeTimeline(JSON.parse(badJson));
 * const diff = diffTimelines(a, b);
 *
 * if (diff.identical) {
 *   console.log("timelines are semantically identical");
 * } else {
 *   for (const c of diff.constraintFires) {
 *     console.log(`constraint '${c.id}': ${c.aCount} → ${c.bCount} (${c.delta > 0 ? '+' : ''}${c.delta})`);
 *   }
 * }
 * ```
 *
 * v0.2 considerations (deferred):
 *   - Cascade-edge diff: `(constraint, resolver)` edge tuples that
 *     appear in b but not a.
 *   - Mermaid sequence diagram emitter for the IDE/PR-review surface.
 *   - Ordered diff: pinpoint the FIRST frame where divergence appears
 *     (interaction with bisect — they share the prefix-replay
 *     primitive).
 */
export function diffTimelines(
  a: SerializedTimeline,
  b: SerializedTimeline,
): TimelineDiff {
  const ab = bucketCounts("a", a.frames);
  const bb = bucketCounts("b", b.frames);

  const constraintFires = deltaListFromMaps(
    ab.constraintFires,
    bb.constraintFires,
  );
  const mutations = deltaListFromMaps(ab.mutations, bb.mutations);

  // Resolver runs: combine three count maps per resolver into one row.
  const resolverNames = new Set<string>([
    ...ab.resolverStarts.keys(),
    ...bb.resolverStarts.keys(),
    ...ab.resolverCompletes.keys(),
    ...bb.resolverCompletes.keys(),
    ...ab.resolverErrors.keys(),
    ...bb.resolverErrors.keys(),
  ]);
  const resolverRuns: ResolverRunDelta[] = [];
  for (const name of resolverNames) {
    const aStarts = ab.resolverStarts.get(name) ?? 0;
    const bStarts = bb.resolverStarts.get(name) ?? 0;
    const aCompletes = ab.resolverCompletes.get(name) ?? 0;
    const bCompletes = bb.resolverCompletes.get(name) ?? 0;
    const aErrors = ab.resolverErrors.get(name) ?? 0;
    const bErrors = bb.resolverErrors.get(name) ?? 0;
    if (
      aStarts === bStarts &&
      aCompletes === bCompletes &&
      aErrors === bErrors
    ) {
      continue;
    }
    resolverRuns.push({
      resolver: name,
      aStarts,
      bStarts,
      aCompletes,
      bCompletes,
      aErrors,
      bErrors,
    });
  }
  resolverRuns.sort((x, y) => x.resolver.localeCompare(y.resolver));

  // Errors: surface entries on each side that have no structural twin
  // on the other side. Key on (kind, id, errorJson)
  // ONLY; including frameIndex caused false positives when unrelated
  // count deltas earlier in the timeline shifted error indices,
  // making the same logical error appear as both a-only AND b-only.
  // The "first occurrence index" is preserved on the surviving
  // ErrorDelta entries so consumers can still locate them.
  const errorKey = (e: ErrorDelta): string =>
    `${e.kind}::${e.id}::${safeStringify(e.error)}`;
  const aKeys = new Set(ab.errors.map(errorKey));
  const bKeys = new Set(bb.errors.map(errorKey));
  const newErrors: ErrorDelta[] = [
    ...ab.errors.filter((e) => !bKeys.has(errorKey(e))),
    ...bb.errors.filter((e) => !aKeys.has(errorKey(e))),
  ];

  const identical =
    a.frames.length === b.frames.length &&
    constraintFires.length === 0 &&
    mutations.length === 0 &&
    resolverRuns.length === 0 &&
    newErrors.length === 0;

  return {
    frameCountDelta: b.frames.length - a.frames.length,
    aFrameCount: a.frames.length,
    bFrameCount: b.frames.length,
    constraintFires,
    mutations,
    resolverRuns,
    newErrors,
    identical,
  };
}

/**
 * Stringify a value defensively — used for diffing error shapes where
 * the value may include circular refs, BigInts, or non-JSON-able
 * payloads. Falls back to a typeof-only marker.
 */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) =>
      typeof val === "bigint" ? `${val.toString()}n` : val,
    );
  } catch {
    return `[unstringifiable ${typeof v}]`;
  }
}
