import { createModule, createSystem, t } from "../../index";
import type { BenchAdapter } from "./types";

export const directiveAdapter: BenchAdapter = {
  name: "Directive",

  createCounter() {
    const mod = createModule("bench", {
      schema: { facts: { count: t.number() }, derivations: {}, events: {}, requirements: {} },
      init: (f) => { f.count = 0; },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    return sys;
  },

  read(store) {
    return (store as any).facts.count;
  },

  write(store, value) {
    (store as any).facts.count = value;
  },

  createWithDerived() {
    const mod = createModule("bench", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
        events: {},
        requirements: {},
      },
      init: (f) => { f.count = 0; },
      derive: { doubled: (f) => (f.count as number) * 2 },
    });
    const sys = createSystem({ module: mod });
    sys.start();
    return sys;
  },

  readDerived(store) {
    return (store as any).read("doubled");
  },

  writeDerived(store, value) {
    (store as any).facts.count = value;
  },

  destroy(store) {
    (store as any).destroy();
  },
};
