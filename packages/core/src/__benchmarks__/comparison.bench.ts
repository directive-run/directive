// @ts-nocheck
/**
 * Head-to-Head Benchmark: Directive vs Zustand vs Redux vs MobX vs Jotai vs Signals vs XState
 *
 * All libraries perform identical operations on the same machine.
 * Run: pnpm bench
 */
import { bench, describe } from "vitest";
import { adapters } from "./lib";
import { createModule, createSystem, t } from "../../src/index";
import { createStore as createZustandStore } from "zustand/vanilla";
import { makeAutoObservable, autorun } from "mobx";
import { signal, effect, computed } from "@preact/signals-core";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { atom, createStore as createJotaiStore } from "jotai/vanilla";
import { createActor, setup, assign } from "xstate";

// ============================================================================
// 1. Single Read
// ============================================================================

describe("Comparison: Single Read", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();
    adapter.write(store, 42); // Pre-populate

    bench(adapter.name, () => {
      adapter.read(store);
    });
  }
});

// ============================================================================
// 2. Single Write
// ============================================================================

describe("Comparison: Single Write", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();
    let i = 0;

    bench(adapter.name, () => {
      adapter.write(store, i++);
    });
  }
});

// ============================================================================
// 3. Write + Read Cycle (1,000 iterations)
// ============================================================================

describe("Comparison: 1K Write+Read Cycles", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();

    bench(adapter.name, () => {
      for (let i = 0; i < 1000; i++) {
        adapter.write(store, i);
        adapter.read(store);
      }
    });
  }
});

// ============================================================================
// 4. Derived/Computed Value (write + read derived)
// ============================================================================

describe("Comparison: Derived Value (write + read computed)", () => {
  for (const adapter of adapters) {
    const store = adapter.createWithDerived();
    let i = 0;

    bench(adapter.name, () => {
      adapter.writeDerived(store, i++);
      adapter.readDerived(store);
    });
  }
});

// ============================================================================
// 5. Batch Update (50 writes, then read)
// ============================================================================

describe("Comparison: 50 Writes + 1 Read (batch efficiency)", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();

    bench(adapter.name, () => {
      for (let i = 0; i < 50; i++) {
        adapter.write(store, i);
      }
      adapter.read(store);
    });
  }
});

// ============================================================================
// 6. Subscribe + Notify (10 subscribers, 1 write)
// ============================================================================

describe("Comparison: Subscribe + Notify (create store, 10 subs, 1 write)", () => {
  bench("Directive", () => {
    const mod = createModule("b", {
      schema: { facts: { count: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => { f.count = 0; },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    let n = 0;
    for (let i = 0; i < 10; i++) sys.subscribe(() => { n++; });
    sys.facts.count = 1;
    sys.destroy();
  });

  bench("Zustand", () => {
    const store = createZustandStore<{ count: number }>()(() => ({ count: 0 }));
    let n = 0;
    for (let i = 0; i < 10; i++) store.subscribe(() => { n++; });
    store.setState({ count: 1 });
  });

  bench("MobX", () => {
    const store = makeAutoObservable({ count: 0 });
    let n = 0;
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) disposers.push(autorun(() => { void store.count; n++; }));
    store.count = 1;
    for (const d of disposers) d();
  });

  bench("Preact Signals", () => {
    const count = signal(0);
    let n = 0;
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) disposers.push(effect(() => { void count.value; n++; }));
    count.value = 1;
    for (const d of disposers) d();
  });
});

// ============================================================================
// 7. Store Creation (cold start)
// ============================================================================

describe("Comparison: Store Creation (cold start)", () => {
  bench("Directive", () => {
    const mod = createModule("b", {
      schema: { facts: { count: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => { f.count = 0; },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.destroy();
  });

  bench("Zustand", () => {
    createZustandStore<{ count: number }>()(() => ({ count: 0 }));
  });

  bench("Redux Toolkit", () => {
    const slice = createSlice({ name: "c", initialState: { count: 0 }, reducers: { set: (s, a: { payload: number }) => { s.count = a.payload; } } });
    configureStore({ reducer: slice.reducer, middleware: (g) => g({ serializableCheck: false, immutableCheck: false }) });
  });

  bench("MobX", () => {
    makeAutoObservable({ count: 0 });
  });

  bench("Jotai", () => {
    atom(0);
    createJotaiStore();
  });

  bench("Preact Signals", () => {
    signal(0);
  });

  bench("XState", () => {
    const machine = setup({
      types: { context: {} as { count: number }, events: {} as { type: "SET"; value: number } },
    }).createMachine({
      context: { count: 0 },
      on: { SET: { actions: assign({ count: ({ event }) => event.value }) } },
    });
    const actor = createActor(machine);
    actor.start();
    actor.stop();
  });
});

// ============================================================================
// 8. Read 10 Different Keys (multi-key access)
// ============================================================================

describe("Comparison: Read 10 Keys", () => {
  // Directive
  (() => {
    const facts: Record<string, any> = {};
    const schema: Record<string, any> = {};
    for (let i = 0; i < 10; i++) { facts[`k${i}`] = i; schema[`k${i}`] = { _type: 0 }; }
    const mod = createModule("mk", { schema: { facts: schema, derivations: {}, events: {}, requirements: {} }, init: (f) => { for (let i = 0; i < 10; i++) f[`k${i}`] = i; } });
    const sys = createSystem({ module: mod }); sys.start();
    bench("Directive", () => { let s = 0; for (let i = 0; i < 10; i++) s += sys.facts[`k${i}`]; });
  })();

  // Zustand
  (() => {
    const init: Record<string, number> = {};
    for (let i = 0; i < 10; i++) init[`k${i}`] = i;
    const store = createZustandStore()(() => init);
    bench("Zustand", () => { let s = 0; const st = store.getState(); for (let i = 0; i < 10; i++) s += st[`k${i}`]; });
  })();

  // MobX
  (() => {
    const store = makeAutoObservable({ k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 });
    bench("MobX", () => { let s = 0; for (let i = 0; i < 10; i++) s += store[`k${i}`]; });
  })();

  // Preact Signals
  (() => {
    const sigs = Array.from({ length: 10 }, (_, i) => signal(i));
    bench("Preact Signals", () => { let s = 0; for (let i = 0; i < 10; i++) s += sigs[i].value; });
  })();

  // Jotai
  (() => {
    const atoms = Array.from({ length: 10 }, (_, i) => atom(i));
    const store = createJotaiStore();
    bench("Jotai", () => { let s = 0; for (let i = 0; i < 10; i++) s += store.get(atoms[i]); });
  })();
});

// ============================================================================
// 9. Rapid Fire: 10K Writes (throughput under load)
// ============================================================================

describe("Comparison: 10K Writes (raw throughput)", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();
    bench(adapter.name, () => {
      for (let i = 0; i < 10_000; i++) {
        adapter.write(store, i);
      }
    });
  }
});

// ============================================================================
// 10. Alternating Read/Write (realistic app pattern)
// ============================================================================

describe("Comparison: Alternating Read/Write (100 each)", () => {
  for (const adapter of adapters) {
    const store = adapter.createCounter();
    bench(adapter.name, () => {
      for (let i = 0; i < 100; i++) {
        adapter.write(store, i);
        adapter.read(store);
      }
    });
  }
});

// ============================================================================
// 11. Multiple Derived Values (3 computeds from same source)
// ============================================================================

describe("Comparison: 3 Derived Values from 1 Source", () => {
  // Directive
  (() => {
    const mod = createModule("md", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number(), tripled: t.number(), squared: t.number() },
        events: {}, requirements: {},
      },
      init: (f) => { f.count = 1; },
      derive: {
        doubled: (f) => f.count * 2,
        tripled: (f) => f.count * 3,
        squared: (f) => f.count * f.count,
      },
    });
    const sys = createSystem({ module: mod }); sys.start();
    let i = 0;
    bench("Directive", () => { sys.facts.count = ++i; sys.read("doubled"); sys.read("tripled"); sys.read("squared"); });
  })();

  // MobX
  (() => {
    class Store {
      count = 1;
      constructor() { makeAutoObservable(this); }
      get doubled() { return this.count * 2; }
      get tripled() { return this.count * 3; }
      get squared() { return this.count * this.count; }
    }
    const store = new Store();
    let i = 0;
    bench("MobX", () => { store.count = ++i; void store.doubled; void store.tripled; void store.squared; });
  })();

  // Preact Signals
  (() => {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    const tripled = computed(() => count.value * 3);
    const squared = computed(() => count.value * count.value);
    let i = 0;
    bench("Preact Signals", () => { count.value = ++i; doubled.value; tripled.value; squared.value; });
  })();

  // Jotai
  (() => {
    const countAtom = atom(1);
    const doubledAtom = atom((get) => get(countAtom) * 2);
    const tripledAtom = atom((get) => get(countAtom) * 3);
    const squaredAtom = atom((get) => get(countAtom) * get(countAtom));
    const store = createJotaiStore();
    let i = 0;
    bench("Jotai", () => { store.set(countAtom, ++i); store.get(doubledAtom); store.get(tripledAtom); store.get(squaredAtom); });
  })();
});
