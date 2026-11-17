// The L10 gate's (ay) widening (GATE-9.md). The L10 fuzz adds fact keys a
// seed's facts never had: `zf` and `zw` in a dynamic case's module a, and
// `g0` and `g1` in the module a `module` step registers (diff/fuzz/model.ts,
// `extraModule`). `snapshot` names only the seed's facts, so a dynamic case's
// missing onSnapshot under row (ay) matched no entry. The widening is two
// classes of their own: `snapshotDynamic`, named only by the L10 twin of
// (ay)'s `requires` entry, and `snapshotDynamicFacts` (no registered
// module's facts), named only by the L10 unannounced twin; the L8 entries
// keep `snapshot`. These pin that a seed's
// value or any other name still fails the class, and that a missing
// registerModule snapshot in a navigatedPaused case with no paused record
// (the RFC's H1: a snapshot carries a registered module's facts) is covered
// by no entry.
import { describe, expect, it } from "vitest";
import { type Difference, compareContract } from "../compare.js";
import { LIKE } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  type Divergence,
  covers,
  readDivergences,
  stepOps,
} from "../scenario.js";

const DATE = { $date: "1970-01-01T00:00:00.000Z" };

/** A dynamic case's snapshot, as seed 1's case 1:all records it. */
const DYNAMIC: Json = {
  facts: { "a::f0": 0, "a::zf": 0, "a::zw": 0, "b::f1": 6, "b::when": DATE },
  id: 4,
  ordered: true,
  trigger: "facts-changed:b::f1",
};

/** A snapshot after registerModule: module z's facts beside module a's. */
const MODULE: Json = {
  facts: { "a::f0": 1, "z::g0": 1, "z::g1": 0 },
  id: 5,
  ordered: true,
  trigger: "facts-changed:z::g0,z::g1",
};

/** A seed-facts-only snapshot: `snapshot`'s, not this class's. */
const SEED: Json = {
  facts: { "a::f0": 1, "b::when": DATE },
  id: 3,
  ordered: true,
  trigger: "facts-changed:a::f0",
};

const with_ = (base: Json, over: Record<string, Json>): Json => ({
  ...(base as object),
  ...over,
});

describe("snapshotDynamic: the L10 fuzz's fact names, and no others", () => {
  it("accepts a dynamic case's snapshot and a registered module's, bare or namespaced", () => {
    expect(LIKE.snapshotDynamic?.(DYNAMIC)).toBe(true);
    expect(LIKE.snapshotDynamic?.(MODULE)).toBe(true);
    expect(
      LIKE.snapshotDynamic?.({
        facts: { f0: 0, zf: 1, zw: 0 },
        id: 2,
        ordered: true,
        trigger: "facts-changed:zf",
      }),
    ).toBe(true);
    expect(
      LIKE.snapshotDynamic?.(
        with_(MODULE, { trigger: "facts-changed:f0,f1,f2,zf,g0+2more" }),
      ),
    ).toBe(true);
  });

  it("rejects a seed's value, any other name, and a snapshot of seed facts only", () => {
    // A seed's value where a name goes, in the facts and in the label.
    expect(
      LIKE.snapshotDynamic?.(with_(DYNAMIC, { facts: { "a::zf": 0, "7": 1 } })),
    ).toBe(false);
    expect(
      LIKE.snapshotDynamic?.(with_(DYNAMIC, { trigger: "facts-changed:6" })),
    ).toBe(false);
    // Names the L10 fuzz does not give a fact: a third module fact, the
    // module's derivation, module a's reader, the effect, a stranger.
    for (const name of ["z::g2", "z::h0", "a::zin", "a::zq", "secret", "g"]) {
      expect(
        LIKE.snapshotDynamic?.(
          with_(MODULE, { facts: { "z::g0": 1, [name]: 0 } }),
        ),
      ).toBe(false);
      expect(
        LIKE.snapshotDynamic?.(
          with_(MODULE, { trigger: `facts-changed:z::g0,${name}` }),
        ),
      ).toBe(false);
    }
    // Two namespaces, or one with a digit, are not the model's.
    expect(
      LIKE.snapshotDynamic?.(with_(MODULE, { facts: { "a::z::g0": 1 } })),
    ).toBe(false);
    // `snapshot` names a seed-facts-only snapshot; this class does not.
    expect(LIKE.snapshotDynamic?.(SEED)).toBe(false);
    expect(LIKE.snapshot?.(SEED)).toBe(true);
    // The shape stays `snapshot`'s: an extra key, id 0, out of order.
    expect(LIKE.snapshotDynamic?.(with_(MODULE, { extra: 1 }))).toBe(false);
    expect(LIKE.snapshotDynamic?.(with_(MODULE, { id: 0 }))).toBe(false);
    expect(LIKE.snapshotDynamic?.(with_(MODULE, { ordered: false }))).toBe(
      false,
    );
  });

  it("snapshotDynamicFacts: a dynamic case's facts, never a registered module's", () => {
    expect(LIKE.snapshotDynamicFacts?.(DYNAMIC)).toBe(true);
    expect(LIKE.snapshotDynamicFacts?.(MODULE)).toBe(false);
    expect(
      LIKE.snapshotDynamicFacts?.(
        with_(DYNAMIC, { facts: { "a::zf": 0, "z::g1": 0 } }),
      ),
    ).toBe(false);
    expect(
      LIKE.snapshotDynamicFacts?.(
        with_(DYNAMIC, { trigger: "facts-changed:a::zf,z::g0" }),
      ),
    ).toBe(false);
    expect(LIKE.snapshotDynamicFacts?.(SEED)).toBe(false);
    expect(
      LIKE.snapshotDynamicFacts?.(
        with_(DYNAMIC, { facts: { "a::zf": 0, "a::zq": 0 } }),
      ),
    ).toBe(false);
  });

  it("dynamicDerivation: a static id, the pool's z0 and z1, and zin", () => {
    for (const id of ["d0", "a::d1", "z0", "z1", "a::zin", "zin"]) {
      expect(LIKE.dynamicDerivation?.(id)).toBe(true);
    }
    for (const id of ["z2", "h0", "z::h0", "zq", "r0", "c0", "d", "7"]) {
      expect(LIKE.dynamicDerivation?.(id)).toBe(false);
    }
  });

  it("leaves `snapshot` as it was: an L10 name fails it", () => {
    expect(LIKE.snapshot?.(DYNAMIC)).toBe(false);
    expect(LIKE.snapshot?.(MODULE)).toBe(false);
  });
});

describe("only the L10 (ay) twin names snapshotDynamic", () => {
  const all = readDivergences();
  const TWIN = "l10-fuzz-ay-hook-onSnapshot-missing";
  const UNANNOUNCED = "l10-fuzz-ay-hook-onSnapshot-missing-unannounced";
  const L8 = "l8-fuzz-ay-hook-onSnapshot-missing";

  it("is the L8 requires entry's twin, with the class swapped", () => {
    const naming = all.filter((e) =>
      JSON.stringify(e.bound ?? {}).includes('"snapshotDynamic"'),
    );
    expect(naming.map((e) => e.id)).toEqual([TWIN]);
    const twin = naming[0] as Divergence;
    const l8 = all.find((e) => e.id === L8) as Divergence;
    const strip = (e: Divergence) => {
      const { id, reason, date, bound, ...rest } = e;
      return rest;
    };
    expect(strip(twin)).toEqual(strip(l8));
    expect(twin.ends).toBe(true);
    expect(twin.when).toEqual(["navigatedPaused"]);
    expect(twin.requires).toEqual(l8.requires);
    expect(twin.reason).toContain(
      '"Approve all as recommended (Recommended)", 2026-11-10',
    );
    expect(twin.reason).toContain("on the owner's instruction");
  });

  it("the unannounced twin is the L8 one with snapshotDynamicFacts, and alone names it", () => {
    const naming = all.filter((e) =>
      JSON.stringify(e.bound ?? {}).includes('"snapshotDynamicFacts"'),
    );
    expect(naming.map((e) => e.id)).toEqual([UNANNOUNCED]);
    const l8 = all.find(
      (e) => e.id === "l8-fuzz-ay-hook-onSnapshot-missing-unannounced",
    ) as Divergence;
    const strip = (e: Divergence) => {
      const { id, reason, date, bound, ...rest } = e;
      return rest;
    };
    expect(strip(naming[0] as Divergence)).toEqual(strip(l8));
    expect((naming[0] as Divergence).requires).toBeUndefined();
  });

  /**
   * Steps 0 to 2: a pause, a navigation, a write. With `paused`, the history
   * record of step 1 reads paused false on 1.35 and true on 2.0, (ay)'s own
   * mark; 1.35 takes the snapshot in step 2 and 2.0 does not.
   */
  function traces(snapshot: Json, paused: boolean) {
    const build = (engine: "v1" | "v2") => {
      const out: TraceEntry[] = [];
      for (const [i, op] of ["pause", "back", "set"].entries()) {
        out.push({ k: "step", i, step: { op } } as TraceEntry);
        if (i === 1 && paused) {
          out.push({
            k: "external",
            data: [
              "history",
              {
                changes: 2,
                ids: [1, 2],
                index: 0,
                length: 2,
                ordered: true,
                paused: engine === "v2",
              },
            ],
          } as TraceEntry);
        }
        if (i === 2 && engine === "v1") {
          out.push({
            k: "hook",
            hook: "onSnapshot",
            args: [snapshot],
          } as TraceEntry);
        }
        out.push({ k: "async", i } as TraceEntry);
      }

      return out;
    };

    return { ref: build("v1"), cand: build("v2") };
  }
  const coveredBy = (snapshot: Json, paused: boolean) => {
    const { ref, cand } = traces(snapshot, paused);
    const ds: Difference[] = compareContract(ref, cand, "v2");
    const missing = ds.find(
      (d) => d.kind === "onSnapshot" && d.op === "missing",
    ) as Difference;
    expect(missing).toBeDefined();

    return all
      .filter((e) =>
        covers(e, "fuzz", missing, ["navigatedPaused"], stepOps(ref), ds),
      )
      .map((e) => e.id);
  };

  it("a missing registerModule snapshot after a paused navigation is (ay)'s, by the twin", () => {
    expect(coveredBy(MODULE, true)).toEqual([TWIN]);
    expect(coveredBy(DYNAMIC, true)).toEqual([TWIN, UNANNOUNCED]);
  });

  it("with no paused record, a missing registerModule snapshot in a navigatedPaused case still fails", () => {
    // The unannounced twins have no `requires`. The L8 one keeps
    // `snapshot` and the L10 one `snapshotDynamicFacts`, so a snapshot that
    // carries module z's facts is outside both.
    expect(coveredBy(MODULE, false)).toEqual([]);
    expect(coveredBy(DYNAMIC, false)).toEqual([UNANNOUNCED]);
    // A seed-facts-only snapshot is still the unannounced twin's.
    expect(coveredBy(SEED, false)).toEqual([
      "l8-fuzz-ay-hook-onSnapshot-missing-unannounced",
    ]);
  });
});
