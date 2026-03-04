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
  debug: { timeTravel: true, maxSnapshots: 200, runHistory: true },
  plugins: [devtoolsPlugin({ name: "time-machine" })],
});
system.start();

const tt = system.debug!;

// ============================================================================
// DOM References
// ============================================================================

const canvasEl = document.getElementById("tm-canvas") as HTMLCanvasElement;
const ctx = canvasEl.getContext("2d")!;
const colorPicker = document.getElementById("tm-color") as HTMLInputElement;
const brushSlider = document.getElementById(
  "tm-brush-size",
) as HTMLInputElement;
const brushVal = document.getElementById("tm-brush-val")!;
const undoBtn = document.getElementById("tm-undo") as HTMLButtonElement;
const redoBtn = document.getElementById("tm-redo") as HTMLButtonElement;
const replayBtn = document.getElementById("tm-replay") as HTMLButtonElement;
const clearBtn = document.getElementById("tm-clear") as HTMLButtonElement;
const snapshotSlider = document.getElementById(
  "tm-snapshot-slider",
) as HTMLInputElement;
const snapshotInfo = document.getElementById("tm-snapshot-info")!;
const exportBtn = document.getElementById("tm-export") as HTMLButtonElement;
const importBtn = document.getElementById("tm-import") as HTMLButtonElement;
const exportArea = document.getElementById(
  "tm-export-area",
) as HTMLTextAreaElement;
const beginChangesetBtn = document.getElementById(
  "tm-begin-changeset",
) as HTMLButtonElement;
const endChangesetBtn = document.getElementById(
  "tm-end-changeset",
) as HTMLButtonElement;
const changesetStatus = document.getElementById("tm-changeset-status")!;

// Timeline
const timelineEl = document.getElementById("tm-timeline")!;

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
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

function render(): void {
  drawCanvas();

  const canUndo = tt.currentIndex > 0;
  const canRedo = tt.currentIndex < tt.snapshots.length - 1;

  // Buttons
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;

  // Snapshot slider
  snapshotSlider.max = String(Math.max(0, tt.snapshots.length - 1));
  snapshotSlider.value = String(tt.currentIndex);
  snapshotInfo.textContent = `${tt.currentIndex} / ${tt.snapshots.length - 1}`;

  // Changeset status
  const isActive = system.facts.changesetActive as boolean;
  changesetStatus.textContent = isActive ? "Recording..." : "Inactive";
  changesetStatus.className = `tm-changeset-status ${isActive ? "active" : ""}`;
  beginChangesetBtn.disabled = isActive;
  endChangesetBtn.disabled = !isActive;

  // Slider label
  brushVal.textContent = `${system.facts.brushSize}px`;

  // Timeline
  if (timeline.length === 0) {
    timelineEl.innerHTML =
      '<div class="tm-timeline-empty">Events appear after drawing</div>';
  } else {
    timelineEl.innerHTML = "";
    for (const entry of timeline) {
      const el = document.createElement("div");
      el.className = `tm-timeline-entry ${entry.type}`;

      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      el.innerHTML = `
        <span class="tm-timeline-time">${timeStr}</span>
        <span class="tm-timeline-event">${escapeHtml(entry.event)}</span>
        <span class="tm-timeline-detail">${escapeHtml(entry.detail)}</span>
      `;

      timelineEl.appendChild(el);
    }
  }
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
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;

  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY),
  };
}

canvasEl.addEventListener("pointerdown", (e) => {
  isDrawing = true;
  canvasEl.setPointerCapture(e.pointerId);
  const { x, y } = canvasCoords(e);
  system.events.addStroke({ x, y });
  addTimeline("stroke", `(${x}, ${y}) ${system.facts.currentColor}`, "stroke");
});

canvasEl.addEventListener("pointermove", (e) => {
  if (!isDrawing) {
    return;
  }

  const { x, y } = canvasCoords(e);
  system.events.addStroke({ x, y });
});

canvasEl.addEventListener("pointerup", () => {
  isDrawing = false;
});

canvasEl.addEventListener("pointerleave", () => {
  isDrawing = false;
});

// ============================================================================
// Controls
// ============================================================================

colorPicker.addEventListener("input", () => {
  system.events.setColor({ value: colorPicker.value });
});

brushSlider.addEventListener("input", () => {
  system.events.setBrushSize({ value: Number(brushSlider.value) });
});

undoBtn.addEventListener("click", () => {
  tt.goBack();
  addTimeline("undo", `→ snapshot #${tt.currentIndex}`, "undo");
  render();
});

redoBtn.addEventListener("click", () => {
  tt.goForward();
  addTimeline("redo", `→ snapshot #${tt.currentIndex}`, "redo");
  render();
});

replayBtn.addEventListener("click", async () => {
  addTimeline("replay", `replaying ${tt.snapshots.length} snapshots`, "replay");
  await tt.replay();
  render();
});

clearBtn.addEventListener("click", () => {
  system.events.clearCanvas();
  addTimeline("stroke", "canvas cleared", "stroke");
});

snapshotSlider.addEventListener("input", () => {
  const idx = Number(snapshotSlider.value);
  if (idx >= 0 && idx < tt.snapshots.length) {
    tt.goTo(tt.snapshots[idx]!.id);
    addTimeline("goto", `→ snapshot #${idx}`, "goto");
    render();
  }
});

exportBtn.addEventListener("click", () => {
  const data = tt.export();
  exportArea.value = data;
  addTimeline("export", `${tt.snapshots.length} snapshots`, "export");
  render();
});

importBtn.addEventListener("click", () => {
  const data = exportArea.value.trim();
  if (!data) {
    return;
  }

  try {
    tt.import(data);
    addTimeline("import", "snapshots restored", "import");
    render();
  } catch (err) {
    addTimeline(
      "import",
      `error: ${err instanceof Error ? err.message : String(err)}`,
      "import",
    );
    render();
  }
});

beginChangesetBtn.addEventListener("click", () => {
  tt.beginChangeset("drawing-group");
  system.facts.changesetActive = true;
  system.facts.changesetLabel = "drawing-group";
  addTimeline("changeset", "started", "changeset");
  render();
});

endChangesetBtn.addEventListener("click", () => {
  tt.endChangeset();
  system.facts.changesetActive = false;
  system.facts.changesetLabel = "";
  addTimeline("changeset", "ended", "changeset");
  render();
});

// ============================================================================
// Initial Render
// ============================================================================

render();
document.body.setAttribute("data-time-machine-ready", "true");
