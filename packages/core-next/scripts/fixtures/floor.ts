// The "floor" size fixture: the minimal fixture's app built from core-next's
// internal entry points with no optional part (no effects manager, plugins,
// observe, inspect or validation) and only the one schema builder it uses.
// What a beta minimal app could cost once those become opt-ins.
// scripts/size.mjs bundles it like the minimal fixture, core-next only.
import { createModule, createSystemCore } from "../../src/api/core.ts";
import { number } from "../../src/api/schema/number.ts";

const counter = createModule("counter", {
  schema: {
    facts: { count: number() },
    derivations: { doubled: number() },
  },
  init: (facts) => {
    facts.count = 0;
  },
  derive: {
    doubled: (facts) => facts.count * 2,
  },
});

const system = createSystemCore({ module: counter });
system.start();
system.subscribe(["doubled"], () => {
  console.log(system.read("doubled"));
});
system.facts.count = 1;
