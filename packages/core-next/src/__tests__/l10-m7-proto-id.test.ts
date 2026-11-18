/**
 * Row (cd): the per-resolver run record is keyed by resolver id, so an id
 * that names an Object.prototype member ("toString") must get its own
 * record. Before the fix it found the built-in function, and one
 * unregister dropped every later "toString" resolver's writes, in this
 * system and in unrelated ones (the #424 correctness review, probe P1).
 */
import { expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;
const tick = () => new Promise((r) => setImmediate(r));
const host = () =>
  createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (f: Any) => {
      f.n = 1;
    },
  } as never);
const mod = (id: string, rid: string) => ({
  id,
  schema: { facts: { go: t.boolean() } },
  init: (f: Any) => {
    f.go = true;
  },
  constraints: { c: { when: (f: Any) => f.go, require: { type: "W" } } },
  resolvers: {
    [rid]: {
      requirement: "W",
      resolve: async (_r: Any, c: Any) => {
        c.facts.go = false;
      },
    },
  },
});

it("a resolver named toString keeps writing after an earlier one is retired", async () => {
  const s = createSystem({ module: host() } as never) as Any;
  s.start();
  s.registerModule(mod("w", "toString"));
  await tick();
  await tick();
  expect(s.facts.go).toBe(false);
  await s.unregisterModule("w");
  s.registerModule(mod("w2", "toString"));
  await tick();
  await tick();
  expect(s.facts.go).toBe(false);
  s.destroy();
  const s2 = createSystem({ module: host() } as never) as Any;
  s2.start();
  s2.registerModule(mod("w", "toString"));
  await tick();
  await tick();
  expect(s2.facts.go).toBe(false);
  s2.destroy();
});
