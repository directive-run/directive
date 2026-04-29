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
 * would retain every ObservationEvent for the entire suite. (R1 sec M3.)
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
  include?: ReadonlyArray<ObservationEvent["type"]>;
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
      c("dim", `  … (${truncated} more frame${truncated === 1 ? "" : "s"} elided; raise maxFrames to see all)`),
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
// Serialization + replay (R1.A — directive replay v0.1)
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
  return {
    version: 1,
    id: obj.id,
    startedAtMs: obj.startedAtMs,
    frames: obj.frames as TimelineFrame[],
  };
}

/**
 * Replay options. The minimum-viable surface is "no options" — replay
 * dispatches every recorded event through the supplied system. Future
 * additions: payload-substitution hooks, frame filters, dry-run mode.
 */
export interface ReplayOptions {
  /**
   * If true, skip frames whose event type doesn't have a corresponding
   * dispatchable surface (e.g. `system.init`, `reconcile.start`,
   * `derivation.compute` — all of these are caused-by-effect, not
   * dispatchable). Default: true. Set false for diagnostic replays
   * that just want to walk the event stream without re-executing.
   */
  dispatchable?: boolean;
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
): Promise<void> {
  const dispatchableOnly = opts.dispatchable ?? true;
  for (const frame of timeline.frames) {
    if (!isDispatchable(frame.event)) {
      if (dispatchableOnly) continue;
    }
    const dispatched = reconstructDispatch(frame.event);
    if (dispatched !== null) {
      system.dispatch(dispatched);
    }
  }
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
    typeof maybeMutation.kind === "string" &&
    maybeMutation.status === "pending"
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
  // Mutator's MUTATE event payload IS the pendingMutation fact value.
  return { type: "MUTATE", ...next };
}
