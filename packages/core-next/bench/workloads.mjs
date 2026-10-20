/**
 * The ONE source of workload code for the fair harness. Every library entry
 * (entry-ours.mjs, entry-alien.mjs) imports this file, but each runs in its own
 * Node process, so no call site is ever shared or megamorphic across libraries.
 *
 * A workload takes a world (signal/computed/effect/batch adapter) and returns a
 * step function; one step is one update.
 */
function busy() {
  let a = 0;
  for (let i = 0; i < 100; i++) {
    a++;
  }
  if (a < 0) {
    throw new Error("unreachable");
  }
}

export const workloads = {
  // A chain of 50 computeds, one effect at the end.
  deep(w) {
    const head = w.signal(0);
    let current = head;
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
    const mids = [];
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
    const levels = [];
    let current = head;
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
    const splits = heads.map((_, i) => w.computed(() => mux.read()[i]));
    for (const s of splits) {
      w.effect(() => {
        s.read();
      });
    }
    let i = 0;

    return () => {
      i++;
      heads[i % 100].write(i);
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

// Building and tearing down: 100 signal -> computed -> effect triples.
workloads.createAndDispose = (w) => () => {
  const disposers = [];
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
};
