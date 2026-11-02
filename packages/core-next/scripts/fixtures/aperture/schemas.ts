import { t } from "@directive-run/core";
import type { CanvasElements } from "../../canvas";
import type { Motion } from "../../scene/motion";
import type { NoteCard } from "../../scene/noteCard";
import type { NoteFocus } from "../../scene/noteFocus";
import type { Note, NotePlacement, NotesStore } from "../../scene/notes/store";
import { PALETTES, type PaletteName, type Params } from "../../scene/params";
import type { Ripples } from "../../scene/ripples";
import type { BootState } from "../../scene/timeline";
import type { View } from "../../scene/view";

// Schemas live apart from their modules so a module can declare another as a dependency

// The outside world each module may touch; passed in so modules stay plain definitions
export interface ApertureDeps {
  el: CanvasElements;
  view: View;
  card: NoteCard;
  store: NotesStore;
  initialParams: Params;
  // late-bound to the composed system, for DOM callbacks that answer with an event
  live: { landed(x: number, y: number): void; noteLanded(id: string): void };
}

// every palette the scene defines, so a new one never needs listing twice
const PALETTE = Object.keys(PALETTES) as [PaletteName, ...PaletteName[]];

// a status line request; `at` lets the announcer pick the newest across modules
export interface Caption {
  text: string;
  at: number;
}

export interface Draft {
  name: string;
  message: string;
  honeypot: string;
  placement: NotePlacement;
  target: { x: number; y: number; widthPx: number };
}

export interface Submission {
  seq: number;
  ok: boolean;
  noteId: string;
  reason: string;
  target: Draft["target"];
}

// Everything one frame reads. A module's boundary is what one event handler must see at once,
// and the frame handler needs all of this together.
export const sceneSchema = {
  facts: {
    // what the browser reports
    reducedMotion: t.boolean(),
    tabVisible: t.boolean(),
    onScreen: t.boolean(),
    exit: t.number(),
    viewportSeq: t.number(),
    tilt: t.object<{ active: boolean; x: number; y: number }>(),
    // what the visitor chose
    route: t.string(),
    paused: t.boolean(),
    params: t.object<Params>(),
    contactOpen: t.boolean(),
    palette: t.enum(...PALETTE),
    konamiStep: t.number(),
    typedTail: t.string(),
    // requests for one-off DOM actions, compared with the previous value by effects
    focusHomeSeq: t.number(),
    leaveRoomSeq: t.number(),
    // what moves between frames
    lastNow: t.number(),
    dt: t.number(),
    awake: t.boolean(),
    motion: t.object<Motion>(),
    boot: t.object<BootState>(),
    bootAt: t.number(),
    bootDone: t.boolean(),
    ripples: t.object<Ripples>(),
    noteFocus: t.object<NoteFocus>(),
    pointer: t.object<{ x: number; y: number; hasMoved: boolean; lastMoveAt: number; held: boolean }>(),
    spotlight: t.object<{ id: string; until: number }>(),
    arrivedRoom: t.string(),
    homeInert: t.boolean(),
    fps: t.number(),
    caption: t.object<Caption>(),
  },
  derivations: {
    moving: t.boolean(),
  },
  events: {
    tick: { now: t.number() },
    pointerMoved: { x: t.number(), y: t.number(), speed: t.number() },
    pointerHeld: {},
    pointerReleased: { click: t.boolean() },
    keyPressed: { key: t.string(), typing: t.boolean(), column: t.number(), row: t.number() },
    routeChanged: { route: t.string() },
    tabVisibility: { visible: t.boolean() },
    onScreenChanged: { onScreen: t.boolean() },
    reducedMotionChanged: { reduced: t.boolean() },
    scrolled: { exit: t.number() },
    resized: {},
    tiltRead: { x: t.number(), y: t.number() },
    togglePause: {},
    setParams: { params: t.object<Partial<Params>>() },
    setPalette: { palette: t.enum(...PALETTE) },
    replayBoot: { at: t.number() },
    closeContact: {},
    landed: { x: t.number(), y: t.number() },
    noteLanded: { id: t.string(), at: t.number() },
    wake: { at: t.number() },
  },
  requirements: {},
};

// The guestbook: what's visible, what's being submitted
export const notesSchema = {
  facts: {
    notes: t.array<Note>(),
    draft: t.object<Draft>().nullable(),
    submission: t.object<Submission>().nullable(),
    caption: t.object<Caption>(),
  },
  derivations: {},
  events: {
    submitNote: { draft: t.object<Draft>() },
    notesChanged: { notes: t.array<Note>() },
  },
  requirements: {
    SUBMIT_NOTE: { draft: t.object<Draft>() },
  },
};

// The status line: owns nothing, derives the newest caption from the other modules
export const announcerSchema = {
  facts: {},
  derivations: { latest: t.object<Caption>() },
  events: {},
  requirements: {},
};
