// The smallest real app: one module, one fact, one event, one effect.
// What a consumer pays for "hello world" in production.
import { createModule, createSystem, t } from "@directive-run/core";

const counter = createModule("counter", {
  schema: { facts: { n: t.number() }, events: { inc: {} } },
  init: (facts) => {
    facts.n = 0;
  },
  events: {
    inc: (facts) => {
      facts.n += 1;
    },
  },
  effects: {
    render: {
      deps: ["n"],
      run: (facts) => {
        document.title = String(facts.n);
      },
    },
  },
});

const system = createSystem({ module: counter });
system.start();
system.events.inc();
