/**
 * MIGRATION_FEEDBACK item 10 investigation:
 *
 * "Setting `f.x = null` where `f.x: t.string().nullable()` sometimes
 * made `f.x !== null` evaluate true downstream (B-Cycle-9 derivation
 * oddity). Worked around by relying on `status` fact instead of the
 * nullable check."
 *
 * This test exercises every nullable assignment / read shape we can
 * think of. If item 10 is real and present in 1.2.x, one of these
 * tests will fail.
 */

import { describe, expect, it } from "vitest";
import { createSystem } from "../system.js";
import { createModule } from "../module.js";
import { t } from "../schema-builders.js";

describe("nullable() equality — item 10 reproduction", () => {
  it("explicit null assignment makes facts.x === null", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { x: t.string().nullable() },
          events: { CLEAR: {} },
        },
        init: (f) => {
          f.x = "hello";
        },
        events: {
          CLEAR: (f) => {
            f.x = null;
          },
        },
      }),
    });
    sys.start();
    expect(sys.facts.x).toBe("hello");
    sys.events.CLEAR();
    expect(sys.facts.x).toBe(null);
    expect(sys.facts.x === null).toBe(true);
    expect(sys.facts.x !== null).toBe(false);
    sys.destroy();
  });

  it("derivation that reads nullable fact narrows correctly after null assignment", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { x: t.string().nullable() },
          derivations: { hasValue: t.boolean(), len: t.number() },
          events: { SET: { value: t.string() }, CLEAR: {} },
        },
        init: (f) => {
          f.x = null;
        },
        derive: {
          hasValue: (f) => f.x !== null,
          len: (f) => (f.x === null ? 0 : f.x.length),
        },
        events: {
          SET: (f, { value }) => {
            f.x = value;
          },
          CLEAR: (f) => {
            f.x = null;
          },
        },
      }),
    });
    sys.start();

    expect(sys.derive.hasValue).toBe(false);
    expect(sys.derive.len).toBe(0);

    sys.events.SET({ value: "abc" });
    expect(sys.derive.hasValue).toBe(true);
    expect(sys.derive.len).toBe(3);

    sys.events.CLEAR();
    expect(sys.derive.hasValue).toBe(false);
    expect(sys.derive.len).toBe(0);

    sys.destroy();
  });

  it("nullable object fact: null assignment after set makes equality work", () => {
    interface Item {
      id: string;
      name: string;
    }
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { selected: t.object<Item>().nullable() },
          derivations: { hasSelected: t.boolean() },
          events: {
            SELECT: { item: t.object<Item>() },
            DESELECT: {},
          },
        },
        init: (f) => {
          f.selected = null;
        },
        derive: {
          hasSelected: (f) => f.selected !== null,
        },
        events: {
          SELECT: (f, { item }) => {
            f.selected = item;
          },
          DESELECT: (f) => {
            f.selected = null;
          },
        },
      }),
    });
    sys.start();

    expect(sys.facts.selected).toBe(null);
    expect(sys.derive.hasSelected).toBe(false);

    sys.events.SELECT({ item: { id: "1", name: "first" } });
    expect(sys.derive.hasSelected).toBe(true);
    expect(sys.facts.selected).not.toBe(null);

    sys.events.DESELECT();
    expect(sys.facts.selected).toBe(null);
    expect(sys.derive.hasSelected).toBe(false);

    sys.destroy();
  });

  it("rapid set/clear/set cycle keeps equality consistent", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { x: t.string().nullable() },
          derivations: { state: t.string<"empty" | "filled">() },
          events: {
            SET: { value: t.string() },
            CLEAR: {},
          },
        },
        init: (f) => {
          f.x = null;
        },
        derive: {
          state: (f) => (f.x === null ? "empty" : "filled"),
        },
        events: {
          SET: (f, { value }) => {
            f.x = value;
          },
          CLEAR: (f) => {
            f.x = null;
          },
        },
      }),
    });
    sys.start();

    for (let i = 0; i < 20; i++) {
      sys.events.SET({ value: `val-${i}` });
      expect(sys.derive.state).toBe("filled");
      expect(sys.facts.x).toBe(`val-${i}`);
      sys.events.CLEAR();
      expect(sys.derive.state).toBe("empty");
      expect(sys.facts.x).toBe(null);
    }

    sys.destroy();
  });

  it("nullable array fact: empty vs null vs populated distinguishes correctly", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { items: t.array<string>().nullable() },
          derivations: {
            isNull: t.boolean(),
            isEmptyArray: t.boolean(),
          },
          events: {
            SET_NULL: {},
            SET_EMPTY: {},
            SET_ITEMS: { items: t.array<string>() },
          },
        },
        init: (f) => {
          f.items = null;
        },
        derive: {
          isNull: (f) => f.items === null,
          isEmptyArray: (f) =>
            Array.isArray(f.items) && f.items.length === 0,
        },
        events: {
          SET_NULL: (f) => {
            f.items = null;
          },
          SET_EMPTY: (f) => {
            f.items = [];
          },
          SET_ITEMS: (f, { items }) => {
            f.items = items;
          },
        },
      }),
    });
    sys.start();

    expect(sys.derive.isNull).toBe(true);
    expect(sys.derive.isEmptyArray).toBe(false);

    sys.events.SET_EMPTY();
    expect(sys.derive.isNull).toBe(false);
    expect(sys.derive.isEmptyArray).toBe(true);

    sys.events.SET_ITEMS({ items: ["a", "b"] });
    expect(sys.derive.isNull).toBe(false);
    expect(sys.derive.isEmptyArray).toBe(false);

    sys.events.SET_NULL();
    expect(sys.derive.isNull).toBe(true);
    expect(sys.derive.isEmptyArray).toBe(false);

    sys.destroy();
  });

  it("nullable on init (no explicit null assignment) reads as null", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: { x: t.string().nullable() },
        },
        init: (f) => {
          f.x = null;
        },
      }),
    });
    sys.start();
    expect(sys.facts.x).toBe(null);
    expect(sys.facts.x === null).toBe(true);
    sys.destroy();
  });

  it("derivation reading two nullable facts via &&/|| compose correctly", () => {
    const sys = createSystem({
      module: createModule("m", {
        schema: {
          facts: {
            a: t.string().nullable(),
            b: t.string().nullable(),
          },
          derivations: {
            both: t.boolean(),
            either: t.boolean(),
            neither: t.boolean(),
          },
          events: {
            SET_A: { v: t.string() },
            SET_B: { v: t.string() },
            CLEAR_A: {},
            CLEAR_B: {},
          },
        },
        init: (f) => {
          f.a = null;
          f.b = null;
        },
        derive: {
          both: (f) => f.a !== null && f.b !== null,
          either: (f) => f.a !== null || f.b !== null,
          neither: (f) => f.a === null && f.b === null,
        },
        events: {
          SET_A: (f, { v }) => {
            f.a = v;
          },
          SET_B: (f, { v }) => {
            f.b = v;
          },
          CLEAR_A: (f) => {
            f.a = null;
          },
          CLEAR_B: (f) => {
            f.b = null;
          },
        },
      }),
    });
    sys.start();

    expect(sys.derive.both).toBe(false);
    expect(sys.derive.either).toBe(false);
    expect(sys.derive.neither).toBe(true);

    sys.events.SET_A({ v: "x" });
    expect(sys.derive.both).toBe(false);
    expect(sys.derive.either).toBe(true);
    expect(sys.derive.neither).toBe(false);

    sys.events.SET_B({ v: "y" });
    expect(sys.derive.both).toBe(true);
    expect(sys.derive.either).toBe(true);
    expect(sys.derive.neither).toBe(false);

    sys.events.CLEAR_A();
    expect(sys.derive.both).toBe(false);
    expect(sys.derive.either).toBe(true);
    expect(sys.derive.neither).toBe(false);

    sys.events.CLEAR_B();
    expect(sys.derive.both).toBe(false);
    expect(sys.derive.either).toBe(false);
    expect(sys.derive.neither).toBe(true);

    sys.destroy();
  });
});
