// The "two-module" size fixture: the minimal app split into two namespaced
// modules, one reading the other through crossModuleDeps. scripts/size.mjs
// bundles it against core-next and against packages/core (1.35).
import { createModule, createSystem, t } from "@directive-run/core";

const counterSchema = {
  facts: { count: t.number() },
  derivations: { doubled: t.number() },
};
const counter = createModule("counter", {
  schema: counterSchema,
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
});
const label = createModule("label", {
  schema: { facts: { prefix: t.string() }, derivations: { text: t.string() } },
  crossModuleDeps: { counter: counterSchema },
  init: (facts) => {
    facts.prefix = "count";
  },
  derive: {
    text: (facts: any) => `${facts.self.prefix}: ${facts.counter.count}`,
  },
} as any);

const system = createSystem({ modules: { counter, label } });
system.start();
system.subscribe(["label.text"], () => {
  console.log(system.read("label.text"));
});
system.facts.counter.count = 1;
