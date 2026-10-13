// @ts-nocheck
/**
 * Frame loop: a module that reads another through `crossModuleDeps`.
 *
 * A canvas-style loop. One module writes its frame facts on every tick; a
 * second module reads the first through `crossModuleDeps`, in effects that
 * declare their own `deps`. Those effects must not wake on the frame writes,
 * and declaring the dependency must not make a frame slower than the same
 * loop with an independent second module.
 *
 * Run: pnpm bench
 */
import { bench, describe } from "vitest";
import { createModule, createSystem, t } from "../../src/index";

const sceneSchema = {
  facts: {
    x: t.number(),
    motion: t.object(),
    focus: t.object(),
    params: t.object(),
    reduced: t.boolean(),
    awake: t.boolean(),
  },
  derivations: { moving: t.boolean() },
  events: { tick: { now: t.number() } },
};

let sink = 0;

function buildFrameSystem(withDeps: boolean) {
  const scene = createModule("scene", {
    schema: sceneSchema,
    init: (f) => {
      f.x = 0;
      f.motion = {};
      f.focus = {};
      f.params = { a: 1 };
      f.reduced = false;
      f.awake = true;
    },
    derive: { moving: (f) => f.awake && !f.reduced },
    events: {
      tick: (f, { now }) => {
        f.x = now;
        f.motion = { t: now, eye: now * 2 };
        f.focus = { lit: now % 7 };
        f.awake = true;
      },
    },
    effects: {
      draw: {
        run: (f, _prev, derived) => {
          sink += f.x + (derived.moving ? 1 : 0);
        },
      },
    },
    sources: { frames: { active: (f) => f.awake, attach: () => () => {} } },
  });

  const notesDef = {
    schema: {
      facts: { notes: t.array(), submission: t.object().nullable() },
    },
    init: (f) => {
      f.notes = [];
      f.submission = null;
    },
    effects: {
      notes: {
        deps: ["notes"],
        run: (f) => {
          sink += withDeps
            ? f.self.notes.length + f.scene.params.a
            : f.notes.length;
        },
      },
      submission: {
        deps: ["submission"],
        run: (f) => {
          const own = withDeps ? f.self.submission : f.submission;
          sink += (own ? 1 : 0) + (withDeps && f.scene.reduced ? 1 : 0);
        },
      },
    },
  };
  if (withDeps) {
    notesDef.crossModuleDeps = { scene: sceneSchema };
  }

  const system = createSystem({
    modules: { scene, notes: createModule("notes", notesDef) },
  });
  system.start();

  return system;
}

describe("Frame loop – crossModuleDeps reader", () => {
  for (const withDeps of [false, true]) {
    const system = buildFrameSystem(withDeps);
    let now = 0;
    bench(
      withDeps
        ? "60 frames, reader declares crossModuleDeps"
        : "60 frames, independent reader",
      async () => {
        for (let i = 0; i < 60; i++) {
          system.events.scene.tick({ now: ++now });
          await system.settle();
        }
      },
    );
  }
});
