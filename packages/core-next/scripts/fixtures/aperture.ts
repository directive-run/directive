// The "aperture" size fixture: the real Aperture lab app (A5 in
// docs/rfc-l6-snapshots.md). aperture/schemas.ts, aperture/modules/scene.ts
// and aperture/modules/notes.ts are the lab's three Directive files
// (~/Desktop/directive-size-plan/research/deep-dx/lab/src/implementations/
// directive/), copied verbatim: edit them only by copying the lab again.
// This file is the lab's system setup (its index.ts:15-21) and its call order
// (initialize at index.ts:78, start at :79), with none of its page code.
//
// Left out, on purpose:
// - the shared page code (`../../scene/*`, the same in all six of the lab's
//   implementations): scripts/size.mjs marks it external, so only the import
//   statements are measured;
// - devtools.ts (a lil-gui panel over `system.history` and `inspect()`):
//   history is development-only in the lab (`import.meta.env.DEV`), so a
//   production build has none and the panel returns at once. The fixture is
//   the app as a production user ships it.
//
// `@directive-run/core/plugins` is 1.35's plugins/persistence.ts on both
// engines until core-next has its own (L6b), so the two numbers compare.
// The lab pins a local 1.35 tarball, so compare this fixture with itself on
// the two engines, never with the lab's own chunk numbers.
import { createSystem } from "@directive-run/core";
import { persistencePlugin } from "@directive-run/core/plugins";
import {
  createAnnouncerModule,
  createNotesModule,
} from "./aperture/modules/notes";
import { createSceneModule } from "./aperture/modules/scene";
import type { ApertureDeps } from "./aperture/schemas";

declare const deps: ApertureDeps;

const system = createSystem({
  modules: {
    scene: createSceneModule(deps),
    notes: createNotesModule(deps),
    announcer: createAnnouncerModule(deps),
  },
  plugins: [
    persistencePlugin({
      storage: localStorage,
      key: "canvas-lab:directive",
      include: ["scene::palette"],
    }),
  ],
  history: undefined,
} as any);
system.initialize();
system.start();
(system.events as any).scene.wake({ at: 0 });
(globalThis as any).__out = [
  system.facts,
  system.derive,
  () => system.destroy(),
];
