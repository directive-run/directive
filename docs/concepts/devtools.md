---
title: devtoolsPlugin
description: Browser devtools integration – window.__DIRECTIVE__ inspect API plus an optional floating debug panel with facts, derivations, constraints, requirements, perf, timeline, time-travel, and session record/replay.
---

# `devtoolsPlugin` – browser devtools, plus a floating panel

> Exposes every running Directive system to `window.__DIRECTIVE__` so
> you can `inspect()` from the console, and – when `panel: true` – drops
> a live, dark-themed debug panel into the page with the same view the
> AE reviewers ship to production-readiness reviews.

## What it does

Mounts a singleton `window.__DIRECTIVE__` API the first time any
`devtoolsPlugin` initializes, then registers the current system under a
`name` so multiple systems can be inspected side-by-side. Every engine
hook lands a `TraceEvent` in a bounded circular buffer, fans out to
any subscribers, and (when the panel is on) schedules a coalesced
`requestAnimationFrame` repaint of the panel's tables.

The panel renders:

- **Facts & derivations** tables with live flash-on-change.
- **Constraints** section with the per-clause `whenExplain` tree –
  same data the [`whenExplain` panel](./when-explain-panel.md) doc covers.
- **Inflight / unmet** requirements lists.
- **Perf metrics** – reconcile time, resolver latency p99, resolver
  stats (count/totalMs/errors).
- **Dependency graph** SVG – facts → derivations → constraints →
  requirements → resolvers.
- **Timeline / flamechart** of resolver execution.
- **Time-travel controls** – undo, redo, snapshot index.
- **Event log** (when `trace: true`) and **record & replay** buttons.

## When to use

- Local dev – the panel beats `console.log` for understanding *why* a
  requirement fired.
- Debugging a clause-level `when:` regression – the Constraints section
  pinpoints which clause is failing and shows the actual value.
- Profiling a slow reconcile – the perf section and timeline together
  identify which resolver is the long pole.
- Reproducing customer bugs – record a session, export the JSON, attach
  it to the ticket; reimport on your machine via `importSession()`.
- Multi-system pages – give each system a distinct `name` and switch
  between them via `__DIRECTIVE__.getSystem(name)`.

## Quick start

```ts
import { createSystem } from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

const system = createSystem({
  module: trafficLight,
  plugins: [
    devtoolsPlugin({
      name: "traffic",
      panel: true,
      trace: true,
      position: "bottom-right",
      defaultOpen: false,
    }),
  ],
});

system.start();

// In the browser console:
// __DIRECTIVE__.inspect("traffic")
// __DIRECTIVE__.getEvents("traffic")
// __DIRECTIVE__.exportSession("traffic")
```

## Options

| Field         | Default          | Description |
| ------------- | ---------------- | ----------- |
| `name`        | `"default"`      | Name registered in `__DIRECTIVE__.systems`. Pass distinct names when more than one system runs in the same page. |
| `trace`       | `false`          | When `true`, every event is pushed into the circular buffer so `__DIRECTIVE__.getEvents()` and `exportSession()` return them. Subscribers fire regardless. |
| `maxEvents`   | `1000`           | Circular-buffer capacity for trace events. Floored at 1; non-finite values fall back to the default with a dev warning. |
| `panel`       | `false`          | Mount the floating debug panel. Requires `window` and `document`; in production builds (`NODE_ENV === "production"` or Vite `MODE === "production"`) the panel is suppressed even when `true`. |
| `position`    | `"bottom-right"` | Panel anchor. One of `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"`. |
| `defaultOpen` | `false`          | Start the panel expanded. When `false`, the toggle button shows and the body is hidden until clicked. |

## How it works

On `onInit`, the plugin lazily creates `window.__DIRECTIVE__` (a single
non-writable global, configurable only in dev mode for test cleanup),
registers a `DevtoolsState` entry under `name`, and – if
`shouldCreatePanel` – calls `createPanel()` to build the DOM.

Every hook does three things:

1. `addEvent(type, data)` – push into the circular buffer (if `trace`),
   fan out to subscribers (always).
2. `recordEvent(type, data)` – append to the recording buffer if a
   record session is active (capped at 10k events / 100 snapshots).
3. Mark a dirty bit and call `schedulePanelUpdate(bits)` so the next
   `rAF` flushes the affected sections in one paint.

Pending fact, constraint, and derivation updates coalesce per frame –
a batch that flips 50 constraints repaints once.

Imported sessions are sanitized: payloads over 10MB are rejected,
events with `__proto__` / `constructor` / `prototype` types are
filtered, and only known fields (`timestamp`, `type`, `data`) are
copied. The global itself defends against prototype pollution.

## Window API

```ts
window.__DIRECTIVE__ = {
  systems: Map<string, DevtoolsState>;
  getSystem(name?): System | null;
  getSystems(): string[];
  inspect(name?): unknown;
  getEvents(name?): TraceEvent[];
  explain(requirementId, name?): string | null;
  exportSession(name?): string | null;
  importSession(json, name?): boolean;
  clearEvents(name?): void;
  subscribe(callback, systemName?): () => void;
};
```

`subscribe()` returns an unsubscribe function. If the system isn't
registered yet, the callback attaches as soon as one appears (polled
every 100 ms for up to 10 s).

## Footguns

- **The panel is dev-only by design.** `isDevMode()` checks
  `process.env.NODE_ENV` and Vite's `import.meta.env.MODE`. In
  production builds the panel never renders even with `panel: true` –
  but the `__DIRECTIVE__` global *does* still mount. If you don't want
  that, gate the whole plugin behind your build flag.
- **`trace: false` still feeds subscribers.** The circular buffer is
  the only thing `trace` controls. `subscribe()` callbacks fire on
  every event regardless. Subscribers that misbehave (throw) are
  swallowed so they can't crash the plugin.
- **Multiple systems must use distinct `name`s.** Two systems with the
  same `name` will overwrite each other in `__DIRECTIVE__.systems`.
  Default `"default"` is fine for single-system apps; pick stable
  names otherwise.
- **`exportSession()` includes raw event payloads.** Fact values land in
  the export verbatim. If your facts hold PII, sanitize before sharing
  the JSON or use [`createAuditLedger`](./audit-ledger.md) for a
  redaction-aware persistence path.
- **Imported sessions are size-capped at 10MB.** Larger payloads silently
  fail (`importSession` returns `false`). Split and re-import if needed.
- **The panel adds DOM.** Run it inside the iframe / shadow root of
  your app shell if you don't want it to fight your CSS.
- **`window.__DIRECTIVE__` is non-writable in production builds.** Tests
  that need to swap it should call `Object.defineProperty` in a
  `beforeEach` – the descriptor is `configurable: true` only in dev
  mode.

## See also

- [`whenExplain` panel](./when-explain-panel.md) – the Constraints
  section in detail.
- [`loggingPlugin`](./logging.md) – same events, in stdout.
- [`performancePlugin`](./performance.md) – perf metrics as a
  programmatic snapshot rather than a panel section.
- [`createAuditLedger`](./audit-ledger.md) – tamper-evident persistence
  with PII redaction.
- [`emitDevToolsEvent`](https://github.com/directive-run/directive/blob/main/packages/core/src/plugins/devtools-ai-bridge.ts)
  – emit AI agent events into the devtools event stream.
