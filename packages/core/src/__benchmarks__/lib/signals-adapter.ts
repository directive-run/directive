import { signal, computed } from "@preact/signals-core";
import type { BenchAdapter } from "./types";

export const signalsAdapter: BenchAdapter = {
  name: "Preact Signals",

  createCounter() {
    return signal(0);
  },

  read(store) {
    return (store as any).value;
  },

  write(store, value) {
    (store as any).value = value;
  },

  createWithDerived() {
    const count = signal(0);
    const doubled = computed(() => count.value * 2);
    return { count, doubled };
  },

  readDerived(store) {
    return (store as any).doubled.value;
  },

  writeDerived(store, value) {
    (store as any).count.value = value;
  },
};
