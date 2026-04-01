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
