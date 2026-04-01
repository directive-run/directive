import { createStore } from "zustand/vanilla";
import type { BenchAdapter } from "./types";

export const zustandAdapter: BenchAdapter = {
  name: "Zustand",

  createCounter() {
    return createStore<{ count: number }>()(() => ({ count: 0 }));
  },

  read(store) {
    return (store as any).getState().count;
  },

  write(store, value) {
    (store as any).setState({ count: value });
  },

  createWithDerived() {
    // Zustand has no built-in derived/computed — use a selector pattern
    const store = createStore<{ count: number }>()(() => ({ count: 0 }));
    return { store, getDoubled: () => (store as any).getState().count * 2 };
  },

  readDerived(store) {
    return (store as any).getDoubled();
  },

  writeDerived(store, value) {
    (store as any).store.setState({ count: value });
  },
};
