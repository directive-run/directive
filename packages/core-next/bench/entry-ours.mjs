// core-next, from the BUILT dist (what ships, mangled). Own process, own adapter.
import { createGraph } from "../dist/index.js";
import { emit, runAll } from "./runner.mjs";

function world() {
  const g = createGraph();

  return {
    signal(value) {
      const n = g.signal(value);

      return { read: () => g.read(n), write: (v) => g.write(n, v) };
    },
    computed(fn) {
      const n = g.computed(fn);

      return { read: () => g.read(n) };
    },
    effect(fn) {
      const n = g.effect(fn);

      return () => g.dispose(n);
    },
    batch(fn) {
      g.batch(fn);
    },
  };
}

emit(runAll("core-next", world, process.env.BENCH_ONLY?.split(",")));
