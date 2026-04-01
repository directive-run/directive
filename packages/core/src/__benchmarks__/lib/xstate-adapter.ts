import { createActor, setup, assign } from "xstate";
import type { BenchAdapter } from "./types";

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: "SET"; value: number },
  },
}).createMachine({
  context: { count: 0 },
  on: {
    SET: {
      actions: assign({ count: ({ event }) => event.value }),
    },
  },
});

export const xstateAdapter: BenchAdapter = {
  name: "XState",

  createCounter() {
    const actor = createActor(counterMachine);
    actor.start();
    return actor;
  },

  read(store) {
    return (store as any).getSnapshot().context.count;
  },

  write(store, value) {
    (store as any).send({ type: "SET", value });
  },

  createWithDerived() {
    // XState has no built-in derived/computed
    const actor = createActor(counterMachine);
    actor.start();
    return { actor, getDoubled: () => (actor as any).getSnapshot().context.count * 2 };
  },

  readDerived(store) {
    return (store as any).getDoubled();
  },

  writeDerived(store, value) {
    (store as any).actor.send({ type: "SET", value });
  },

  destroy(store) {
    const actor = (store as any).actor ?? store;
    actor.stop?.();
  },
};
