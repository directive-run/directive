---
title: DevTools Plugin
description: Debug Directive systems with a console API, event tracing, and an optional floating panel — all from a single plugin.
---

The devtools plugin exposes your system to the browser console via `window.__DIRECTIVE__` and optionally renders a floating debug panel that shows facts, derivations, requirements, and events in real time. {% .lead %}

---

## Basic Usage

```typescript
import { devtoolsPlugin } from '@directive-run/core/plugins';

// Attaches your system to window.__DIRECTIVE__ for browser console access
const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin()],
});

system.start();
```

When the system initializes, you'll see a styled console message:

```text
[Directive Devtools] System "default" initialized. Access via window.__DIRECTIVE__
```

---

## Floating Panel

Enable a visual debug panel that floats over your app during development:

```typescript
devtoolsPlugin({
  panel: true,
  trace: true,        // Also show event log in the panel
  position: 'bottom-right',
})
```

The panel shows:

- **Status** — "Settled" (green) or "Working..." (yellow)
- **Facts** — Live key/value table, updates on every fact change
- **Derivations** — Key/value table, re-reads after each reconciliation
- **Inflight** — Currently executing resolvers
- **Unmet** — Requirements waiting for a resolver
- **Performance** — Reconcile count/avg, per-resolver stats, effect run/error counts (sorted by total time)
- **Dependency Graph** — Live SVG showing facts &rarr; derivations &rarr; constraints &rarr; requirements &rarr; resolvers
- **Timeline** — Flamechart-style waterfall showing resolver execution timing with swim lanes per resolver
- **Time-Travel** — Undo/redo buttons (when `debug: { timeTravel: true }`)
- **Events** — Scrollable event log with timestamps (when `trace: true`)
- **Record & Replay** — Capture sessions and export as JSON

The panel is automatically removed in production builds and when `typeof window === "undefined"` (SSR). Press **Escape** to close.

{% callout type="note" title="Framework-agnostic" %}
The floating panel uses vanilla DOM — no React, Vue, or other framework dependency. It works in any app that uses `@directive-run/core`.
{% /callout %}

---

## Options

```typescript
devtoolsPlugin({
  name: 'my-app',           // Identify this system in multi-system pages
  trace: true,              // Record timestamped events for every lifecycle hook
  panel: true,              // Show floating debug panel (dev mode only)
  position: 'bottom-right', // Panel position
  defaultOpen: false,       // Start panel collapsed
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"default"` | Identifier for this system in the devtools registry |
| `trace` | `boolean` | `false` | When enabled, records timestamped events for every lifecycle hook |
| `maxEvents` | `number` | `1000` | Maximum number of events to store (oldest are dropped when the limit is reached) |
| `panel` | `boolean` | `false` | Show a floating debug panel (dev mode + browser only) |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Panel corner position |
| `defaultOpen` | `boolean` | `false` | Whether the panel starts expanded |

---

## Console API

The plugin creates a `window.__DIRECTIVE__` global with these methods:

### `__DIRECTIVE__.systems`

The underlying `Map` of all registered systems. Each entry contains the system instance, recorded events, and configuration.

### `__DIRECTIVE__.getSystem(name?)`

Returns the system instance by name. If no name is provided, returns the first registered system.

```javascript
// Browser console
const system = __DIRECTIVE__.getSystem('my-app');

// You get back the real system instance –full API access
system.read('count');        // Read a fact
system.start();              // Start the engine
```

### `__DIRECTIVE__.getSystems()`

Returns an array of all registered system names.

```javascript
// List all systems registered on this page
__DIRECTIVE__.getSystems();
// ["my-app", "auth-module"]
```

### `__DIRECTIVE__.inspect(name?)`

Returns the full inspection data for a system –facts, derivations, constraints, requirements, and resolver status. If no name is provided, inspects the first registered system.

```javascript
// Get a full snapshot of constraints, requirements, and resolver status
__DIRECTIVE__.inspect('my-app');
// { unmet: [...], inflight: [...], constraints: [...], resolvers: { ... } }
```

### `__DIRECTIVE__.getEvents(name?)`

Returns the recorded event array for a system. Requires `trace: true` to have data.

```javascript
// Retrieve the recorded event timeline (only populated when trace: true)
__DIRECTIVE__.getEvents('my-app');
// [{ timestamp: 1707300000000, type: "fact.set", data: { key: "count", value: 1, prev: 0 } }, ...]
```

### `__DIRECTIVE__.explain(requirementId, name?)`

Returns the human-readable explanation for a requirement, or `null` if the requirement is not found. Useful for understanding why a resolver was triggered.

```javascript
__DIRECTIVE__.explain('req-abc123', 'my-app');
// "Constraint 'needsAuth' requires FETCH_TOKEN because facts.token is null"
```

### `__DIRECTIVE__.exportSession(name?)`

Exports the recorded events (and any recording snapshots) as a JSON string. Returns `null` if the system is not found.

```javascript
const json = __DIRECTIVE__.exportSession('my-app');
// Download or save for later analysis
```

### `__DIRECTIVE__.importSession(json, name?)`

Imports a previously exported session, replacing the current event buffer. Returns `true` on success, `false` on invalid input. Payloads over 10 MB are rejected. Events are validated and sanitized before import.

```javascript
const success = __DIRECTIVE__.importSession(json, 'my-app');
```

### `__DIRECTIVE__.clearEvents(name?)`

Clears all recorded events for a system. Useful for resetting the trace buffer during long debugging sessions.

```javascript
__DIRECTIVE__.clearEvents('my-app');
```

---

## Event Tracing

When `trace: true`, the plugin records a timestamped event for every lifecycle hook. Events are stored in a circular buffer capped at `maxEvents` entries (default: 1000). When the limit is reached, the oldest events are dropped in O(1) time.

Each event has the shape:

```typescript
{ timestamp: number; type: string; data: unknown }
```

### Recorded Event Types

| Event Type | When | Data |
|-----------|------|------|
| `init` | System initializes | `{}` |
| `start` | Engine starts | `{}` |
| `stop` | Engine stops | `{}` |
| `destroy` | System is destroyed | `{}` |
| `fact.set` | A fact value changes | `{ key, value, prev }` |
| `fact.delete` | A fact key is deleted | `{ key, prev }` |
| `facts.batch` | A batch of fact changes commits | `{ changes }` |
| `derivation.compute` | A derivation is recomputed | `{ id, value, deps }` |
| `derivation.invalidate` | A derivation is marked stale | `{ id }` |
| `reconcile.start` | Reconciliation loop begins | `{}` |
| `reconcile.end` | Reconciliation loop completes | Result object |
| `constraint.evaluate` | A constraint is evaluated | `{ id, active }` |
| `constraint.error` | A constraint throws | `{ id, error }` |
| `requirement.created` | A new requirement is raised | `{ id, type }` |
| `requirement.met` | A requirement is fulfilled | `{ id, byResolver }` |
| `requirement.canceled` | A requirement is canceled | `{ id }` |
| `resolver.start` | A resolver begins executing | `{ resolver, requirementId }` |
| `resolver.complete` | A resolver finishes | `{ resolver, requirementId, duration }` |
| `resolver.error` | A resolver throws | `{ resolver, requirementId, error }` |
| `resolver.retry` | A resolver retries | `{ resolver, requirementId, attempt }` |
| `resolver.cancel` | A resolver is canceled | `{ resolver, requirementId }` |
| `effect.run` | An effect runs | `{ id }` |
| `effect.error` | An effect throws | `{ id, error }` |
| `error` | An error boundary catches an error | `{ source, sourceId, message }` |
| `error.recovery` | An error boundary recovers | `{ source, sourceId, strategy }` |
| `timetravel.snapshot` | A time-travel snapshot is taken | `{ id, trigger }` |
| `timetravel.jump` | Time-travel jumps to a snapshot | `{ from, to }` |

---

## Multiple Systems

Use the `name` option to distinguish systems when running more than one:

```typescript
// Give each system a unique name so they don't collide in the devtools registry
const auth = createSystem({
  module: authModule,
  plugins: [devtoolsPlugin({ name: 'auth' })],
});
auth.start();

// Enable tracing only on the system you're actively debugging
const dashboard = createSystem({
  module: dashboardModule,
  plugins: [devtoolsPlugin({ name: 'dashboard', trace: true, panel: true })],
});
dashboard.start();
```

```javascript
// Browser console –both systems are accessible by name
__DIRECTIVE__.getSystems();
// ["auth", "dashboard"]

__DIRECTIVE__.inspect('auth');
__DIRECTIVE__.getEvents('dashboard');
```

When a system is destroyed, it is automatically removed from the devtools registry and the floating panel (if enabled) is removed from the DOM.

---

## Production

### Conditional Inclusion

Strip devtools from production builds:

```typescript
const plugins = [];

// Devtools add a global object and event recording –exclude from production
if (process.env.NODE_ENV === 'development') {
  plugins.push(devtoolsPlugin({ name: 'my-app', trace: true, panel: true }));
}

const system = createSystem({
  module: myModule,
  plugins,
});

system.start();
```

### SSR Safety

The plugin is safe to use in server-side rendering. When `typeof window === "undefined"`, all devtools methods return no-op values –no errors, no global mutations. The floating panel is never created on the server. You don't need to conditionally import it for SSR.

---

## Performance Section

When `panel: true`, the panel includes a collapsible **Performance** section that tracks:

- **Reconcile count** and average duration
- **Per-resolver stats** — call count, average duration, error count (sorted by total time)
- **Effect stats** — run count and error count

Stats are collected from lifecycle hooks and update in real time after each reconciliation.

---

## Time-Travel Controls

When the system has `debug: { timeTravel: true }`, the panel renders **Time-Travel** controls:

- **Back / Forward** buttons with snapshot count display
- **Position indicator** — shows current index / total snapshots
- Buttons are disabled when there's nowhere to navigate

No extra configuration — the panel detects `system.debug` and shows the controls automatically.

---

## Dependency Graph

The panel includes a collapsible **Dependency Graph** section that renders an SVG directed graph showing the full system topology across five columns:

- **Facts** (column 1) — all fact keys, pulsing when recently changed
- **Derivations** (column 2) — all derivation keys with tracked fact dependencies, pulsing on recompute
- **Constraints** (column 3) — all constraints, active ones highlighted, inactive ones dimmed
- **Requirements** (column 4) — color-coded: red for unmet, yellow for inflight
- **Resolvers** (column 5) — all resolvers, active ones highlighted, idle ones dimmed

Dashed arrows connect related nodes across columns. The diagram updates after each reconciliation and uses brief animations to highlight recent activity. The SVG is responsive via `viewBox` and scales to fit the panel width.

---

## Timeline

The panel includes a collapsible **Timeline** section that renders a flamechart-style waterfall of resolver execution:

- **Swim lanes** — one row per resolver, labeled on the left
- **Horizontal bars** — each bar represents a single resolver execution, width proportional to duration
- **Color coding** — each resolver gets a distinct color; error bars are red
- **Inflight indicators** — dashed outline bars for resolvers currently executing
- **Time axis** — millisecond markers along the top with gridlines
- **Tooltips** — hover any bar to see resolver name and duration

The timeline captures the last 200 resolver executions and updates in real time. It is useful for identifying slow resolvers, spotting overlapping executions, and understanding the resolution waterfall.

---

## Record & Replay

The panel includes **Record** and **Export** buttons at the bottom:

- **Record** — Click to start capturing events and fact snapshots. Click again to stop. While recording, the button turns red.
- **Export** — Downloads the recorded session (or the current trace buffer if no recording was made) as a JSON file.

You can also use the console API:

```javascript
// Export the current session as JSON
const json = __DIRECTIVE__.exportSession('my-app');

// Import a previously exported session
__DIRECTIVE__.importSession(json, 'my-app');
```

The exported JSON includes a version field, system name, timestamp, all recorded events, and any fact snapshots captured during recording.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+D` (Windows/Linux) or `Cmd+Shift+D` (Mac) | Toggle panel open/closed |
| `Escape` | Close panel |

{% callout type="warning" title="Shortcut conflicts" %}
`Ctrl+Shift+D` / `Cmd+Shift+D` may conflict with browser bookmark shortcuts. If you experience conflicts, use the toggle button or `Escape` to close the panel instead.
{% /callout %}

---

## Usage with React

Add the devtools plugin when creating your system -- no React-specific component needed:

```tsx
import { devtoolsPlugin } from '@directive-run/core/plugins';

const system = createSystem({
  module: myModule,
  plugins: [devtoolsPlugin({ panel: true, trace: true, position: 'bottom-right' })],
});

system.start();
```

The floating panel is framework-agnostic (vanilla DOM), so it works the same way in React, Vue, Svelte, or any other framework. It includes performance stats, time-travel controls, a flow diagram, and event tracing.

---

## Visual Debugging

For richer debugging beyond the console and floating panel:

- **[AI DevTools](/ai/devtools)** — 8-view visual debugger for multi-agent orchestration (Timeline, Flamechart, DAG, Health, Cost, Breakpoints, State, Compare). Connects via WebSocket.
- **[DevTools Live](/devtools)** — Try the visual debugger in your browser right now — no installation required.

---

## Next Steps

- [Logging](/docs/plugins/logging) – Console output
- [Time-Travel](/docs/advanced/time-travel) – Snapshot debugging
- [Plugin Overview](/docs/plugins/overview) – All plugins
- [DevTools Live](/devtools) – Interactive visual debugger
