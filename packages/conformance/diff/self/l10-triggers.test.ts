// The L10 gate's triggers (GATE-9.md): an `ends` entry must say `when`, so
// the two L10b `ends` entries name the spec feature their row needs. Each is
// checked with the nearest spec that lacks it.
import { describe, expect, it } from "vitest";
import { type FuzzSpec, specTriggers } from "../fuzz/model.js";
import { readDivergences } from "../scenario.js";

/** One module with one fact, a dynamic case without readers, no steps. */
const BASE: FuzzSpec = {
  modules: [
    {
      facts: 1,
      date: false,
      derivations: [],
      events: [{ target: 0, add: false }],
      constraints: [],
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: false,
  trace: false,
  steps: [],
  batch: null,
  dynamic: { readers: false },
} as unknown as FuzzSpec;

const has = (name: string, more: Partial<FuzzSpec>) =>
  specTriggers({ ...BASE, ...more }).includes(name as never);

const define = (
  action: "register" | "assign" | "unregister" | "call",
  kind: "derive" | "constraints" | "resolvers" | "effects",
  variant: number,
) =>
  ({
    op: "define",
    action,
    kind,
    id: 2,
    variant,
    deferred: false,
  }) as FuzzSpec["steps"][number];

describe("the L10 triggers", () => {
  it("(bm) dynamicReaders: a dynamic case with readers, so `zin` and `zgate` ask about z0", () => {
    expect(has("dynamicReaders", { dynamic: { readers: true } })).toBe(true);
    expect(has("dynamicReaders", { dynamic: { readers: false } })).toBe(false);
    expect(has("dynamicReaders", { dynamic: undefined })).toBe(false);
  });

  it("(bl) assignObject: an assign of a derivation in the object form", () => {
    expect(
      has("assignObject", { steps: [define("assign", "derive", 3)] }),
    ).toBe(true);
    // register with the object form works on 1.35; another variant is a
    // function; another kind's variant 3 is not a derivation.
    expect(
      has("assignObject", { steps: [define("register", "derive", 3)] }),
    ).toBe(false);
    expect(
      has("assignObject", { steps: [define("assign", "derive", 2)] }),
    ).toBe(false);
    expect(
      has("assignObject", { steps: [define("assign", "constraints", 3)] }),
    ).toBe(false);
  });

  it("(bm) readerNameReturns: module z's d0 replaces a's, leaves, and is registered again", () => {
    const reg = (variant: number) =>
      ({
        op: "module",
        action: "register",
        variant,
      }) as FuzzSpec["steps"][number];
    const unreg = {
      op: "module",
      action: "unregister",
      variant: 0,
    } as FuzzSpec["steps"][number];
    // The define pool's id 0 is module a's static `d0`.
    const again = {
      ...define("register", "derive", 0),
      id: 0,
    } as FuzzSpec["steps"][number];
    expect(has("readerNameReturns", { steps: [reg(3), unreg, again] })).toBe(
      true,
    );
    expect(has("readerNameReturns", { steps: [reg(1), unreg, reg(3)] })).toBe(
      true,
    );
    // An even variant has no d0; no unregister leaves d0 in place; nothing
    // registers it again; another id; a two-module case has no M2 d0.
    expect(has("readerNameReturns", { steps: [reg(2), unreg, again] })).toBe(
      false,
    );
    expect(has("readerNameReturns", { steps: [reg(3), again] })).toBe(false);
    expect(has("readerNameReturns", { steps: [reg(3), unreg] })).toBe(false);
    expect(
      has("readerNameReturns", {
        steps: [
          reg(3),
          unreg,
          { ...again, id: 2 } as FuzzSpec["steps"][number],
        ],
      }),
    ).toBe(false);
    expect(
      has("readerNameReturns", {
        steps: [reg(3), unreg, again],
        modules: [...BASE.modules, ...BASE.modules],
      }),
    ).toBe(false);
  });

  it("each L10b `ends` entry names its row's trigger", () => {
    const when = (id: string) =>
      readDivergences().find((e) => e.id === id)?.when;
    expect(when("l10b-fuzz-bm-hook-onDerivationInvalidate-extra-zin")).toEqual([
      "dynamicReaders",
    ]);
    expect(
      when("l10b-fuzz-bl-hook-onError-missing-def-is-not-a-function"),
    ).toEqual(["assignObject"]);
    expect(
      when("l10-fuzz-bm-hook-onDerivationInvalidate-extra-name-returns"),
    ).toEqual(["readerNameReturns"]);
  });
});
