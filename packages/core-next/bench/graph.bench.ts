/**
 * The core-next graph against alien-signals, on js-reactivity-benchmark-style
 * workloads (the "kairo" set plus create/dispose and a batched write burst).
 *
 * Both libraries run the same workload code through a small adapter, the way
 * js-reactivity-benchmark does it; the adapter call costs the same for each.
 * Every graph is built once in setup; each bench iteration is one update.
 *
 * Run: `pnpm --filter @directive-run/core-next bench`. Ratios:
 * `node packages/core-next/scripts/bench-ratio.mjs <vitest --outputJson file>`.
 */
import * as alien from "alien-signals";
import { bench, describe } from "vitest";
import { createGraph } from "../src/graph.js";

interface Readable<T> {
  read(): T;
}
interface Writable<T> extends Readable<T> {
  write(value: T): void;
}
interface Framework {
  name: string;
  /** A fresh, empty reactive world (ours: a new graph). */
  world(): World;
}
interface World {
  signal<T>(value: T): Writable<T>;
  computed<T>(fn: () => T): Readable<T>;
  effect(fn: () => void): () => void;
  batch(fn: () => void): void;
}

const ours: Framework = {
  name: "core-next",
  world() {
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
  },
};

const alienSignals: Framework = {
  name: "alien-signals",
  world() {
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
  },
};

const frameworks = [ours, alienSignals];

function busy(): void {
  let a = 0;
  for (let i = 0; i < 100; i++) {
    a++;
  }
  if (a < 0) {
    throw new Error("unreachable");
  }
}

type Workload = (w: World) => () => void;

const workloads: Record<string, Workload> = {
  // A chain of 50 computeds, one effect at the end.
  deep(w) {
    const head = w.signal(0);
    let current: Readable<number> = head;
    for (let i = 0; i < 50; i++) {
      const prev = current;
      current = w.computed(() => prev.read() + 1);
    }
    const tail = current;
    w.effect(() => {
      tail.read();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // One signal, 50 independent two-computed branches, each with an effect.
  broad(w) {
    const head = w.signal(0);
    for (let i = 0; i < 50; i++) {
      const a = w.computed(() => head.read() + i);
      const b = w.computed(() => a.read() + 1);
      w.effect(() => {
        b.read();
      });
    }
    let i = 0;

    return () => head.write(++i);
  },
  // One signal fans out to 5 computeds joined by one sum.
  diamond(w) {
    const head = w.signal(0);
    const mids: Readable<number>[] = [];
    for (let i = 0; i < 5; i++) {
      mids.push(w.computed(() => head.read() + 1));
    }
    const sum = w.computed(() => mids.reduce((s, m) => s + m.read(), 0));
    w.effect(() => {
      sum.read();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // A 10-long chain whose every level also feeds one sum.
  triangle(w) {
    const head = w.signal(0);
    const levels: Readable<number>[] = [];
    let current: Readable<number> = head;
    for (let i = 0; i < 10; i++) {
      const prev = current;
      current = w.computed(() => prev.read() + 1);
      levels.push(current);
    }
    const sum = w.computed(() => levels.reduce((s, l) => s + l.read(), 0));
    w.effect(() => {
      sum.read();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // 100 signals merged into one object, split back into 100 computeds.
  mux(w) {
    const heads = Array.from({ length: 100 }, () => w.signal(0));
    const mux = w.computed(() => heads.map((h) => h.read()));
    const splits = heads.map((_, i) => w.computed(() => mux.read()[i]!));
    for (const s of splits) {
      w.effect(() => {
        s.read();
      });
    }
    let i = 0;

    return () => {
      i++;
      heads[i % 100]!.write(i);
    };
  },
  // One computed reads the same signal 30 times.
  repeatedObservers(w) {
    const head = w.signal(0);
    const sum = w.computed(() => {
      let s = 0;
      for (let i = 0; i < 30; i++) {
        s += head.read();
      }

      return s;
    });
    w.effect(() => {
      sum.read();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // The dependency set flips between two computeds on every write.
  unstable(w) {
    const head = w.signal(0);
    const double = w.computed(() => head.read() * 2);
    const inverse = w.computed(() => -head.read());
    const current = w.computed(() => {
      let result = 0;
      for (let i = 0; i < 20; i++) {
        result += head.read() % 2 ? double.read() : inverse.read();
      }

      return result;
    });
    w.effect(() => {
      current.read();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // A computed that always returns 0 must stop propagation below it.
  avoidable(w) {
    const head = w.signal(0);
    const c1 = w.computed(() => head.read());
    const c2 = w.computed(() => {
      c1.read();

      return 0;
    });
    const c3 = w.computed(() => {
      busy();

      return c2.read() + 1;
    });
    const c4 = w.computed(() => c3.read() + 2);
    const c5 = w.computed(() => c4.read() + 3);
    w.effect(() => {
      c5.read();
      busy();
    });
    let i = 0;

    return () => head.write(++i);
  },
  // 1,000 signals, each with an effect; all written in one batch.
  batchedWrites(w) {
    const signals = Array.from({ length: 1000 }, () => w.signal(0));
    for (const s of signals) {
      w.effect(() => {
        s.read();
      });
    }
    let i = 0;

    return () => {
      i++;
      w.batch(() => {
        for (const s of signals) {
          s.write(i);
        }
      });
    };
  },
};

for (const [name, workload] of Object.entries(workloads)) {
  describe(name, () => {
    for (const fw of frameworks) {
      const step = workload(fw.world());
      bench(fw.name, step);
    }
  });
}

// Building and tearing down: 100 signal -> computed -> effect triples.
describe("createAndDispose", () => {
  for (const fw of frameworks) {
    const w = fw.world();
    bench(fw.name, () => {
      const disposers: Array<() => void> = [];
      for (let i = 0; i < 100; i++) {
        const s = w.signal(i);
        const c = w.computed(() => s.read() + 1);
        disposers.push(
          w.effect(() => {
            c.read();
          }),
        );
      }
      for (const d of disposers) {
        d();
      }
    });
  }
});
