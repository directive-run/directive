import { atom, createStore } from "jotai/vanilla";
import type { BenchAdapter } from "./types";

export const jotaiAdapter: BenchAdapter = {
  name: "Jotai",

  createCounter() {
    const countAtom = atom(0);
    const store = createStore();
    return { store, countAtom };
  },

  read(s) {
    const { store, countAtom } = s as any;
    return store.get(countAtom);
  },

  write(s, value) {
    const { store, countAtom } = s as any;
    store.set(countAtom, value);
  },

  createWithDerived() {
    const countAtom = atom(0);
    const doubledAtom = atom((get) => get(countAtom) * 2);
    const store = createStore();
    return { store, countAtom, doubledAtom };
  },

  readDerived(s) {
    const { store, doubledAtom } = s as any;
    return store.get(doubledAtom);
  },

  writeDerived(s, value) {
    const { store, countAtom } = s as any;
    store.set(countAtom, value);
  },
};
