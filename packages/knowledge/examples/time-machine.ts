// Example: time-machine
// Source: examples/time-machine/src/module.ts
// Pure module file — no DOM wiring

/**
 * Time Machine — Directive Module
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

export interface Stroke {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

export interface TimelineEntry {
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
// Timeline (external mutable array, same pattern as fraud-analysis)
// ============================================================================

export const timeline: TimelineEntry[] = [];

export function addTimeline(
  event: string,
  detail: string,
  type: TimelineEntry["type"],
): void {
  timeline.unshift({ time: Date.now(), event, detail, type });
  if (timeline.length > 50) {
    timeline.length = 50;
  }
}

// ============================================================================
// Schema
// ============================================================================

export const schema = {
  facts: {
    strokes: t.array<Stroke>(),
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

export const system = createSystem({
  module: canvasModule,
  debug: { timeTravel: true, maxSnapshots: 200, runHistory: true },
  plugins: [devtoolsPlugin({ name: "time-machine" })],
});
