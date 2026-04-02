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
import { signal, effect } from "@preact/signals-core";
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
