import { makeAutoObservable, computed } from "mobx";
import type { BenchAdapter } from "./types";

class CounterStore {
  count = 0;
  constructor() {
    makeAutoObservable(this);
  }
}

class CounterWithDerived {
  count = 0;
  constructor() {
    makeAutoObservable(this);
  }
  get doubled() {
    return this.count * 2;
  }
}

export const mobxAdapter: BenchAdapter = {
  name: "MobX",

  createCounter() {
    return new CounterStore();
  },

  read(store) {
    return (store as CounterStore).count;
  },

  write(store, value) {
    (store as CounterStore).count = value;
  },

  createWithDerived() {
    return new CounterWithDerived();
  },

  readDerived(store) {
    return (store as CounterWithDerived).doubled;
  },

  writeDerived(store, value) {
    (store as CounterWithDerived).count = value;
  },
};
