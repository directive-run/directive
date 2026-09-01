import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * A frozen value stored in a fact must be readable.
 *
 * `Object.freeze` is the ordinary way to make a stored value immutable, and it is
 * the right thing to do with anything a fact holds — a frozen payload cannot be
 * mutated behind the store's back, which is exactly what the dev-mode nested
 * warning proxy exists to catch.
 *
 * But the proxy's `get` trap returns a wrapper, and a Proxy is required to return
 * the target's own value for a property that is non-configurable and
 * non-writable, which is what freezing makes every property. So reading a frozen
 * nested object throws a TypeError — in development only. Production, where the
 * wrapper is tree-shaken away, works.
 */
describe("frozen values in facts", () => {
  it("can be read back", () => {
    type Holder = { inner: { a: number } };
    const system = createSystem({
      module: createModule("holder", {
        schema: { facts: { held: t.object<Holder>() } },
        init: (facts) => {
          facts.held = { inner: Object.freeze({ a: 1 }) };
        },
      }),
    });
    system.start();

    expect(system.facts.held.inner.a).toBe(1);
  });

  it("can be read back when the whole tree is frozen", () => {
    type Holder = { list: readonly { id: string }[] };
    const system = createSystem({
      module: createModule("holder", {
        schema: { facts: { held: t.object<Holder>() } },
        init: (facts) => {
          facts.held = Object.freeze({
            list: Object.freeze([Object.freeze({ id: "a" })]),
          });
        },
      }),
    });
    system.start();

    expect(system.facts.held.list[0]?.id).toBe("a");
  });
});
