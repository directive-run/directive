// alien-signals. Own process, own adapter (no shared call sites with core-next).
import * as alien from "alien-signals";
import { emit, runAll } from "./runner.mjs";

function world() {
  return {
    signal(value) {
      const s = alien.signal(value);

      return { read: () => s(), write: (v) => s(v) };
    },
    computed(fn) {
      const c = alien.computed(fn);

      return { read: () => c() };
    },
    effect(fn) {
      return alien.effect(fn);
    },
    batch(fn) {
      alien.startBatch();
      try {
        fn();
      } finally {
        alien.endBatch();
      }
    },
  };
}

emit(runAll("alien-signals", world, process.env.BENCH_ONLY?.split(",")));
