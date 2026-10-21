// Ported from packages/core/src/core/__tests__/blackbox-listeners.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

// Black-box pins for listener timing, through the public API only: a
// listener added while a notify runs waits for the next write, and
// derivation subscribers and watchers keep hearing writes after destroy().

// biome-ignore lint/suspicious/noExplicitAny: the system is driven dynamically on purpose
type Any = any;

function build() {
  const mod = createModule("m", {
    schema: {
      facts: { a: t.number() },
      derivations: { d: t.number() },
      events: {},
      requirements: {},
    },
    init: (f: Any) => {
      f.a = 0;
    },
    derive: { d: (f: Any) => f.a * 2 },
  });
  const system = createSystem({ module: mod } as Any) as Any;
  system.start();

  return system;
}

describe("listener timing", () => {
  it("a fact listener added during a notify fires only on the next write", () => {
    const system = build();
    const store = system.facts.$store;
    const log: string[] = [];
    const off = store.subscribe(["a"], () => {
      log.push("first");
      off();
      store.subscribe(["a"], () => log.push("late"));
    });
    system.facts.a = 1;
    expect(log).toEqual(["first"]);
    system.facts.a = 2;
    expect(log).toEqual(["first", "late"]);
    system.destroy();
  });

  it("a derivation subscriber added during a notify fires only on the next change", () => {
    const system = build();
    const log: string[] = [];
    system.read("d");
    const off = system.subscribe(["d"], () => {
      log.push("first");
      off();
      system.subscribe(["d"], () => log.push("late"));
    });
    system.facts.a = 1;
    expect(log).toEqual(["first"]);
    system.read("d");
    system.facts.a = 2;
    expect(log).toEqual(["first", "late"]);
    system.destroy();
  });

  it("derivation subscribe and watch still fire for writes after destroy", () => {
    const system = build();
    const heard: number[] = [];
    const watched: Array<[number, number]> = [];
    system.subscribe(["d"], () => heard.push(system.read("d")));
    system.watch("d", (next: number, prev: number) =>
      watched.push([next, prev]),
    );
    system.read("d");
    system.destroy();
    system.facts.a = 3;
    expect(heard).toEqual([6]);
    expect(watched).toEqual([[6, 0]]);
  });
});
