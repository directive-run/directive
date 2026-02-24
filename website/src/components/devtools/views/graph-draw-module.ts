// @ts-nocheck
/**
 * Graph Drawing Directive Module
 *
 * Manages freehand drawing state for the Graph tab in DevTools.
 * Facts hold completed strokes, draw mode, color, and size.
 * Derivations compute strokeCount, hasStrokes, canUndo.
 * Events handle all mutations cleanly.
 *
 * In-progress strokes (60fps pointer events) stay in React refs
 * for performance — only committed strokes live here.
 */
import { createModule, t } from '@directive-run/core'

export interface Stroke {
  points: number[][] // Raw [x, y] in flow coordinates
  color: string
  size: number
}

export const graphDraw = createModule('graph-draw', {
  schema: {
    facts: {
      drawMode: t.boolean(),
      strokes: t.array<Stroke>(),
      strokeColor: t.string(),
      strokeSize: t.number(),
    },
    derivations: {
      strokeCount: t.number(),
      hasStrokes: t.boolean(),
      canUndo: t.boolean(),
    },
    events: {
      toggleDraw: {},
      addStroke: { stroke: t.object<Stroke>() },
      undoStroke: {},
      clearStrokes: {},
      setColor: { color: t.string() },
      setSize: { size: t.number() },
    },
  },

  init: (facts) => {
    facts.drawMode = false
    facts.strokes = []
    facts.strokeColor = '#f59e0b'
    facts.strokeSize = 4
  },

  derive: {
    strokeCount: (facts) => facts.strokes.length,
    hasStrokes: (facts) => facts.strokes.length > 0,
    canUndo: (facts) => facts.strokes.length > 0,
  },

  events: {
    toggleDraw: (facts) => {
      facts.drawMode = !facts.drawMode
    },
    addStroke: (facts, { stroke }) => {
      facts.strokes = [...facts.strokes, stroke]
    },
    undoStroke: (facts) => {
      facts.strokes = facts.strokes.slice(0, -1)
    },
    clearStrokes: (facts) => {
      facts.strokes = []
    },
    setColor: (facts, { color }) => {
      facts.strokeColor = color
    },
    setSize: (facts, { size }) => {
      facts.strokeSize = size
    },
  },
})
