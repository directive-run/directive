/**
 * Head-to-Head Benchmark: Directive vs Zustand vs Redux vs MobX vs Jotai vs Signals vs XState
 *
 * All libraries perform identical operations on the same machine.
 * Run: pnpm bench
 */
import { bench, describe } from "vitest";
import { adapters } from "./lib";

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

describe("Comparison: Subscribe + Notify", () => {
  // Directive
  bench("Directive", () => {
    const { createModule, createSystem, t } = require("../../index");
    const mod = createModule("b", {
      schema: { facts: { count: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f: any) => { f.count = 0; },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    let notifyCount = 0;
    for (let i = 0; i < 10; i++) {
      sys.subscribe(() => { notifyCount++; });
    }
    sys.facts.count = 1;
    sys.destroy();
  });

  // Zustand
  bench("Zustand", () => {
    const { createStore } = require("zustand/vanilla");
    const store = createStore(() => ({ count: 0 }));
    let notifyCount = 0;
    for (let i = 0; i < 10; i++) {
      store.subscribe(() => { notifyCount++; });
    }
    store.setState({ count: 1 });
  });

  // MobX
  bench("MobX", () => {
    const { makeAutoObservable, autorun } = require("mobx");
    const store = makeAutoObservable({ count: 0 });
    let notifyCount = 0;
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      disposers.push(autorun(() => { void store.count; notifyCount++; }));
    }
    store.count = 1;
    for (const d of disposers) d();
  });

  // Preact Signals
  bench("Preact Signals", () => {
    const { signal, effect } = require("@preact/signals-core");
    const count = signal(0);
    let notifyCount = 0;
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      disposers.push(effect(() => { void count.value; notifyCount++; }));
    }
    count.value = 1;
    for (const d of disposers) d();
  });
});

// ============================================================================
// 7. Store Creation (cold start)
// ============================================================================

describe("Comparison: Store Creation", () => {
  bench("Directive", () => {
    const { createModule, createSystem, t } = require("../../index");
    const mod = createModule("b", {
      schema: { facts: { count: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f: any) => { f.count = 0; },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    sys.destroy();
  });

  bench("Zustand", () => {
    const { createStore } = require("zustand/vanilla");
    createStore(() => ({ count: 0 }));
  });

  bench("Redux Toolkit", () => {
    const { configureStore, createSlice } = require("@reduxjs/toolkit");
    const slice = createSlice({ name: "c", initialState: { count: 0 }, reducers: { set: (s: any, a: any) => { s.count = a.payload; } } });
    configureStore({ reducer: slice.reducer, middleware: (g: any) => g({ serializableCheck: false, immutableCheck: false }) });
  });

  bench("MobX", () => {
    const { makeAutoObservable } = require("mobx");
    makeAutoObservable({ count: 0 });
  });

  bench("Jotai", () => {
    const { atom, createStore } = require("jotai/vanilla");
    atom(0);
    createStore();
  });

  bench("Preact Signals", () => {
    const { signal } = require("@preact/signals-core");
    signal(0);
  });

  bench("XState", () => {
    const { createActor, setup, assign } = require("xstate");
    const machine = setup({ types: { context: {} as { count: number }, events: {} as { type: "SET"; value: number } } })
      .createMachine({ context: { count: 0 }, on: { SET: { actions: assign({ count: ({ event }: any) => event.value }) } } });
    const actor = createActor(machine);
    actor.start();
    actor.stop();
  });
});
