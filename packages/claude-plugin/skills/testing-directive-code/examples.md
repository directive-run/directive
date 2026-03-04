# Examples

> Auto-generated from extracted examples. Do not edit manually.

## time-machine

```typescript
// Example: time-machine
// Source: examples/time-machine/src/main.ts
// Extracted for AI rules — DOM wiring stripped

/**
 * Time Machine — Time-Travel Debugging
 *
 * Drawing canvas where each stroke is a fact mutation. Full time-travel:
 * undo/redo, export/import JSON, replay animation, changesets, snapshot slider.
 */

import {
  type ModuleSchema,
  createModule,
  createSystem,
  t,
} from "@directive-run/core";
import { devtoolsPlugin } from "@directive-run/core/plugins";

// ============================================================================
// Types
// ============================================================================

interface Stroke {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

interface TimelineEntry {
  time: number;
  event: string;
  detail: string;
  type:
    | "stroke"
    | "undo"
    | "redo"
    | "changeset"
    | "export"
    | "import"
    | "replay"
    | "goto";
}

// ============================================================================
// Timeline
// ============================================================================

const timeline: TimelineEntry[] = [];

function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
) {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

// ============================================================================
// Schema
// ============================================================================

const schema = {
  facts: {
    strokes: t.object<Stroke[]>(),
    currentColor: t.string(),
    brushSize: t.number(),
    changesetActive: t.boolean(),
    changesetLabel: t.string(),
  },
  derivations: {
    strokeCount: t.number(),
    canUndo: t.boolean(),
    canRedo: t.boolean(),
    currentIndex: t.number(),
    totalSnapshots: t.number(),
  },
  events: {
    addStroke: { x: t.number(), y: t.number() },
    setColor: { value: t.string() },
    setBrushSize: { value: t.number() },
    clearCanvas: {},
  },
  requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Module
// ============================================================================

const canvasModule = createModule("canvas", {
  schema,

  init: (facts) => {
    facts.strokes = [];
    facts.currentColor = "#5ba3a3";
    facts.brushSize = 12;
    facts.changesetActive = false;
    facts.changesetLabel = "";
  },

  derive: {
    strokeCount: (facts) => facts.strokes.length,
    // These will be updated from the time-travel manager
    canUndo: () => false,
    canRedo: () => false,
    currentIndex: () => 0,
    totalSnapshots: () => 0,
  },

  events: {
    addStroke: (facts, { x, y }) => {
      const stroke: Stroke = {
        id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x,
        y,
        color: facts.currentColor,
        size: facts.brushSize,
      };
      facts.strokes = [...facts.strokes, stroke];
    },
    setColor: (facts, { value }) => {
      facts.currentColor = value;
    },
    setBrushSize: (facts, { value }) => {
      facts.brushSize = value;
    },
    clearCanvas: (facts) => {
      facts.strokes = [];
    },
  },
});

// ============================================================================
// System with Time-Travel
// ============================================================================

const system = createSystem({
  module: canvasModule,
  debug: { timeTravel: true, maxSnapshots: 200 },
  plugins: [devtoolsPlugin({ name: "time-machine" })],
});
system.start();

const tt = system.debug!;

// ============================================================================
// DOM References
// ============================================================================

const ctx = canvasEl.getContext("2d")!;
  "tm-brush-size",
  "tm-snapshot-slider",
  "tm-export-area",
  "tm-begin-changeset",
  "tm-end-changeset",

// Timeline

// ============================================================================
// Canvas Rendering
// ============================================================================

function drawCanvas(): void {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

  const strokes = system.facts.strokes as Stroke[];
  for (const stroke of strokes) {
    ctx.beginPath();
    ctx.arc(stroke.x, stroke.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
  }
}

// ============================================================================
// Render
// ============================================================================

function escapeHtml(text: string): string {

  return div.innerHTML;
}


// ============================================================================
// Subscribe
// ============================================================================

const allKeys = [...Object.keys(schema.facts)];
system.subscribe(allKeys, render);

// ============================================================================
// Canvas Interaction (pointer events for mouse + touch)
// ============================================================================

let isDrawing = false;

function canvasCoords(e: PointerEvent): { x: number; y: number } {
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;

  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY),
  };
}


// ============================================================================
// Controls
// ============================================================================


// ============================================================================
// Initial Render
// ============================================================================

render();
```
