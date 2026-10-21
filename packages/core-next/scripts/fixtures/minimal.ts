// The "minimal" size fixture: one module with one fact and one derivation,
// a system, and a subscriber. scripts/size.mjs bundles it against core-next
// and against packages/core (1.35), so the two numbers are like for like.
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: {
    facts: { count: t.number() },
    derivations: { doubled: t.number() },
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
});

const system = createSystem({ module: counter });
system.start();
system.subscribe(["doubled"], () => {
  console.log(system.read("doubled"));
});
system.facts.count = 1;
