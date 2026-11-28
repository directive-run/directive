/**
 * core-next's built public API, at the layers it has built, is 1.35's: the
 * gate in contracts/lib/next-surface.ts, and proof that each rule bites.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRepoRoot, nextPackageDir } from "../lib/core-entries.js";
import { harnessFiles } from "../lib/harness.js";
import { LAYERS, type Layer, layerIndex } from "../lib/layers.js";
import {
  type Drift,
  type Unshipped,
  checkNextSurface,
  currentLayer,
  describeDrift,
  exportLayers,
  readDrift,
  readUnshipped,
  withoutBundlerRenames,
} from "./lib/next-surface.js";
import { type ApiChange, type Surface, extractSurface } from "./lib/surface.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const here = join(conformanceRoot, "contracts");
const frozen: Surface = JSON.parse(
  readFileSync(join(here, "api-surface.json"), "utf8"),
);
const changes: ApiChange[] = JSON.parse(
  readFileSync(join(here, "api-changes.json"), "utf8"),
).changes;
const next = extractSurface(nextPackageDir());
const current = currentLayer(conformanceRoot);
const layers = exportLayers(defaultRepoRoot, frozen, Object.keys(frozen));
const unshipped = readUnshipped(conformanceRoot);
const drift = readDrift(conformanceRoot);
const copy = (s: Surface): Surface => JSON.parse(JSON.stringify(s));
const gate = (
  s: Surface,
  options: {
    current?: typeof current;
    changes?: ApiChange[];
    unshipped?: Unshipped;
    drift?: Drift;
    frozen?: Surface;
    layers?: typeof layers;
  } = {},
) =>
  checkNextSurface(
    options.frozen ?? frozen,
    s,
    options.changes ?? changes,
    options.current === undefined ? current : options.current,
    options.layers ?? layers,
    options.unshipped ?? unshipped,
    options.drift ?? drift,
  );
const baseline = gate(next);
const layerOf = (key: string, from: typeof layers = layers) =>
  from.get(key)?.layer as Layer;
/** The failure for a name core-next ships at an unbuilt layer, dropped. */
const dropped = (key: string, from: typeof layers = layers) =>
  `core-next ${key} (missing): 1.35 exports it and contracts/next-unshipped.json does not list it (layer ${layerOf(key, from)}, unbuilt at current ${current}): a name core-next ships may not be dropped`;
/**
 * The stock "unshipped" name: the first name (sorted) next-unshipped.json
 * lists above `current`, with its entry and layer read from the list, so the
 * self-tests that need one move on as engine slices ship names. When nothing
 * is listed above `current` (every name shipped) the stock is made up: a name
 * 1.35 never had, injected into the frozen surface, the layer table and the
 * list the cases check, at the newest layer. The rule is exercised either way
 * and no case skips.
 */
const realStockKey = Object.keys(unshipped)
  .filter(
    (k) => layerIndex(unshipped[k] as Layer) > layerIndex(current as Layer),
  )
  .sort()[0];
const stock = (() => {
  const synthetic = realStockKey === undefined;
  const key = realStockKey ?? "./internals madeUpStockName";
  const [entry = "", name = ""] = key.split(" ");
  const layer = (unshipped[key] ?? LAYERS[LAYERS.length - 1]) as Layer;
  const world = {
    frozen: frozen as Surface,
    layers,
    unshipped: unshipped as Unshipped,
  };
  if (synthetic) {
    const f = copy(frozen);
    f[entry] = { ...f[entry], [name]: "function madeUpStockName(): void" };
    const l = new Map(layers);
    l.set(key, { layer, module: "made-up" } as never);
    world.frozen = f;
    world.layers = l;
    world.unshipped = { ...unshipped, [key]: layer };
  }
  /** A layer above `current` that is not the stock's, for the misplaced case. */
  const wrong = LAYERS.find(
    (l) => l !== layer && layerIndex(l) > layerIndex(current as Layer),
  );
  const baseline = gate(next, world);

  return { key, entry, name, layer, wrong, world, baseline };
})();
const stockKey = stock.key;
const signedRemoval: ApiChange = {
  entry: ".",
  name: "createSystem",
  change: "removed",
  engine: "next",
  reason: "test",
  approvedBy: "jason",
  date: "2026-11-03",
};

describe("core-next public API surface", () => {
  it("core-next's built API is 1.35's at every built layer, except signed changes", () => {
    console.info(
      `[contracts] core-next (current ${current}): entries not shipped yet: ${baseline.unshipped.join(", ") || "none"}; 1.35 names missing at unbuilt layers: ${baseline.unbuilt.length}`,
    );
    for (const d of baseline.drift) {
      console.info(
        `[contracts] core-next signature drift (listed in next-drift.json): ${describeDrift(d)}`,
      );
    }
    expect(baseline.failures).toEqual([]);
  });

  it("a built-layer export removed from core-next fails (a type and a value)", () => {
    const tampered = copy(next);
    for (const name of ["ObservationEvent", "createSystem"]) {
      const placed = layers.get(`. ${name}`)?.layer;
      expect(placed).toBeDefined();
      expect(layerIndex(placed as Layer)).toBeLessThanOrEqual(
        layerIndex(current as Layer),
      );
      delete tampered["."]?.[name];
    }
    const failures = gate(tampered).failures;
    expect(failures).toContain(
      `core-next . ObservationEvent (missing): 1.35 exports it and its layer ${layers.get(". ObservationEvent")?.layer} is built (current ${current})`,
    );
    expect(failures).toContain(
      `core-next . createSystem (missing): 1.35 exports it and its layer L0 is built (current ${current})`,
    );
    expect(failures.length).toBe(baseline.failures.length + 2);
  });

  it(`a missing unbuilt-layer export is accepted, and fails once its layer is built (stock ${stockKey})`, () => {
    const { key, entry, name, layer, world } = stock;
    expect(layerIndex(layer)).toBeGreaterThan(layerIndex(current as Layer));
    expect(next[entry]?.[name]).toBeUndefined();
    expect(world.frozen[entry]?.[name]).toBeDefined();
    expect(world.layers.get(key)?.layer).toBe(layer);
    expect(stock.baseline.unbuilt).toContainEqual({ entry, name, layer });
    expect(stock.baseline.failures.some((f) => f.includes(` ${key} `))).toBe(
      false,
    );
    expect(gate(next, { ...world, current: layer }).failures).toContain(
      `core-next ${key} (missing): contracts/next-unshipped.json lists it at ${layer}, but layer ${layer} is built (current ${layer})`,
    );
  });

  // The guard lets an engine PR remove names from next-unshipped.json
  // (Jason, 2026-11-17); this gate is what catches a false removal.
  it(`a name removed from next-unshipped.json that core-next does not ship fails (stock ${stockKey})`, () => {
    const { key, entry, name, world } = stock;
    expect(next[entry]?.[name]).toBeUndefined();
    const { [key]: _, ...removed } = world.unshipped;
    expect(gate(next, { ...world, unshipped: removed }).failures).toEqual([
      dropped(key, world.layers),
    ]);
  });

  it("a missing export the layer tables do not place fails", () => {
    const tampered = copy(next);
    delete tampered["."]?.createSystem;
    const unplaced = new Map(layers);
    unplaced.set(". createSystem", {
      module: "core/system.ts",
      layer: undefined,
    });
    expect(
      checkNextSurface(
        frozen,
        tampered,
        changes,
        current,
        unplaced,
        unshipped,
        drift,
      ).failures,
    ).toContain(
      "core-next . createSystem (missing): no layer for it (declared in core/system.ts); add it to NAME_LAYERS or MODULE_LAYERS in lib/layers.ts",
    );
  });

  it("a signed removal covers a missing built-layer export", () => {
    const tampered = copy(next);
    delete tampered["."]?.createSystem;
    expect(
      gate(tampered, { changes: [signedRemoval, ...changes] }).failures,
    ).toEqual(baseline.failures);
    expect(
      gate(tampered, {
        changes: [{ ...signedRemoval, approvedBy: "" }, ...changes],
      }).failures.length,
    ).toBe(baseline.failures.length + 1);
  });

  it("the owner's 13 signed /internals removals each cover one missing built-layer name", () => {
    const removals = changes.filter(
      (c): c is Extract<ApiChange, { change: string }> =>
        "change" in c && c.change === "removed",
    );
    expect(removals.map((c) => c.name).sort()).toEqual(
      [
        "createConstraintsManager",
        "createDerivationsManager",
        "createEngine",
        "createErrorBoundaryManager",
        "createPluginManager",
        "createResolversManager",
        "createRetryLaterManager",
        "createSourcesManager",
        "getCurrentDeps",
        "isTracking",
        "trackAccess",
        "withTracking",
        "withoutTracking",
      ].sort(),
    );
    for (const c of removals) {
      expect(c.entry).toBe("./internals");
      expect(c.engine).toBe("next");
      expect(next["./internals"]?.[c.name]).toBeUndefined();
      expect(frozen["./internals"]?.[c.name]).toBeDefined();
      const message = `core-next ./internals ${c.name} (missing): 1.35 exports it and its layer ${layers.get(`./internals ${c.name}`)?.layer} is built (current ${current})`;
      // Unsigned, or not listed at all, the name fails; signed, it passes.
      for (const without of [
        changes.map((x) => (x === c ? { ...c, approvedBy: "" } : x)),
        changes.filter((x) => x !== c),
      ]) {
        expect(gate(next, { changes: without }).failures).toEqual([message]);
      }
    }
    expect(baseline.failures).toEqual([]);
  });

  it("next-unshipped.json is exactly the names core-next lacks, and is in the harness lock", () => {
    expect(baseline.unshipped).toEqual([]);
    const listed = Object.keys(unshipped).sort();
    expect(baseline.unbuilt.map((u) => `${u.entry} ${u.name}`).sort()).toEqual(
      listed,
    );
    const perLayer: Record<string, number> = {};
    for (const layer of Object.values(unshipped)) {
      perLayer[layer] = (perLayer[layer] ?? 0) + 1;
    }
    // Tighten-only: an engine PR removes a name when it ships it (owner,
    // 2026-11-17: "Route B: approve the rule (Recommended)"), so each
    // layer's count may fall, never rise past the list as it stood then.
    const ceiling: Record<string, number> = { L8: 2, L11: 33, L12: 11, L13: 1 };
    for (const [layer, count] of Object.entries(perLayer)) {
      expect(count, layer).toBeLessThanOrEqual(ceiling[layer] ?? 0);
    }
    expect(harnessFiles(conformanceRoot)).toContain(
      "contracts/next-unshipped.json",
    );
  });

  // Self-tests 1 and 2: before next-unshipped.json, the layer rule accepted
  // any missing name above `current`, so these drops passed silently.
  it("a name core-next ships at an unbuilt layer may not be dropped (/testing, stub entries)", () => {
    /** A name `entry` ships, 1.35 has, at a layer above `current`. */
    const shippedUnbuilt = (entry: string) =>
      `${entry} ${Object.keys(next[entry] ?? {}).find(
        (n) =>
          !n.startsWith("#ref:") &&
          n in (frozen[entry] ?? {}) &&
          layerIndex(layerOf(`${entry} ${n}`)) > layerIndex(current as Layer),
      )}`;
    for (const key of [
      // Each is a name above `current`. From L12 every name core-next ships
      // at the root and /plugins is built (the plugins are L12), so neither
      // has one left to drop; /testing and the stub entries still do.
      "./testing CoverageReport",
      shippedUnbuilt("./worker"),
    ]) {
      const [entry = "", name = ""] = key.split(" ");
      expect(next[entry]?.[name]).toBeDefined();
      expect(layerIndex(layerOf(key))).toBeGreaterThan(
        layerIndex(current as Layer),
      );
      const tampered = copy(next);
      delete tampered[entry]?.[name];
      const result = gate(tampered);
      expect(result.failures).toEqual([dropped(key)]);
      expect(result.unbuilt).toEqual(baseline.unbuilt);
    }
    // An entry core-next stops shipping is a drop of each of its names.
    const noWorker = copy(next);
    delete noWorker["./worker"];
    const workerNames = Object.keys(frozen["./worker"] ?? {}).filter(
      (n) => !n.startsWith("#ref:"),
    );
    expect(gate(noWorker).failures).toHaveLength(workerNames.length);
  });

  // Self-tests 1 and 2 at the root and /plugins. From L12 neither ships a
  // name above `current` (the plugins are L12), so each is judged one layer
  // below the newest layer its entry ships (gate run 3: a skip here fails
  // the census): dropping a name at that layer must fail as unbuilt there.
  // Once the entry ships a name above `current`, that name is used instead.
  const dropsUnbuilt = (entry: string) => {
    const shipped = Object.keys(next[entry] ?? {}).filter(
      (n) => !n.startsWith("#ref:") && n in (frozen[entry] ?? {}),
    );
    const above = shipped.find(
      (n) =>
        layerIndex(layerOf(`${entry} ${n}`)) > layerIndex(current as Layer),
    );
    const name =
      above ??
      [...shipped].sort(
        (x, y) =>
          layerIndex(layerOf(`${entry} ${y}`)) -
          layerIndex(layerOf(`${entry} ${x}`)),
      )[0];
    expect(name).toBeDefined();
    const key = `${entry} ${name}`;
    const layer = layerOf(key);
    const at = (
      above === undefined ? LAYERS[layerIndex(layer) - 1] : current
    ) as Layer;
    expect(layerIndex(layer)).toBeGreaterThan(layerIndex(at));
    const tampered = copy(next);
    delete tampered[entry]?.[name as string];
    expect(gate(tampered, { current: at }).failures).toEqual([
      `core-next ${key} (missing): 1.35 exports it and contracts/next-unshipped.json does not list it (layer ${layer}, unbuilt at current ${at}): a name core-next ships may not be dropped`,
    ]);
  };
  it("a name core-next ships at an unbuilt layer may not be dropped (root)", () =>
    dropsUnbuilt("."));
  it("a name core-next ships at an unbuilt layer may not be dropped (/plugins)", () =>
    dropsUnbuilt("./plugins"));

  // Self-test 3, and the list's other rules.
  it("a stale, built-layer, misplaced or unknown next-unshipped.json entry fails", () => {
    expect(
      gate(next, {
        unshipped: { ...unshipped, "./plugins loggingPlugin": "L11" },
      }).failures,
    ).toEqual([
      "contracts/next-unshipped.json: ./plugins loggingPlugin is stale: core-next ships it (remove it from next-unshipped.json)",
    ]);
    const tampered = copy(next);
    delete tampered["."]?.createSystem;
    expect(
      gate(tampered, { unshipped: { ...unshipped, ". createSystem": "L0" } })
        .failures,
    ).toEqual([
      `core-next . createSystem (missing): contracts/next-unshipped.json lists it at L0, but layer L0 is built (current ${current})`,
    ]);
    expect(
      gate(next, { unshipped: { ...unshipped, ". noSuchName": "L11" } })
        .failures,
    ).toEqual([
      "contracts/next-unshipped.json: . noSuchName is not a 1.35 name",
    ]);
  });

  it(`a next-unshipped.json entry listed at the wrong unbuilt layer fails (stock ${stockKey})`, () => {
    const { key, layer, world } = stock;
    // From L12 the stock's layer (L13) is the only one above `current`, so
    // the case is judged one layer down, where the layer below the stock's
    // is still unbuilt and so a wrong unbuilt layer to list it at.
    const at =
      stock.wrong === undefined
        ? (LAYERS[layerIndex(current as Layer) - 1] as Layer)
        : (current as Layer);
    const wrong =
      stock.wrong ??
      LAYERS.find((l) => l !== layer && layerIndex(l) > layerIndex(at));
    expect(wrong).toBeDefined();
    expect(
      gate(next, {
        ...world,
        current: at,
        unshipped: { ...world.unshipped, [key]: wrong as Layer },
      }).failures,
    ).toEqual([
      `contracts/next-unshipped.json: ${key} is listed at ${wrong}, but lib/layers.ts places it at ${layer}`,
    ]);
  });

  // Self-test 5.
  it('a signed engine "next" removal of a name core-next exports fails as stale', () => {
    expect(next["."]?.createSystem).toBeDefined();
    expect(
      gate(next, { changes: [signedRemoval, ...changes] }).failures,
    ).toEqual([
      'api-changes.json: . createSystem (removed, engine "next") is stale: core-next exports . createSystem',
    ]);
    expect(
      gate(next, {
        changes: [{ ...signedRemoval, change: "changed" }, ...changes],
      }).failures,
    ).toEqual([
      'api-changes.json: . createSystem (changed, engine "next"): only a removal may carry engine "next"',
      'api-changes.json: . createSystem (changed, engine "next") is stale: core-next exports . createSystem',
    ]);
  });

  it("an added public name fails unless a signed addition covers it", () => {
    expect(next["./plugins"]?.ClobberSummaryEvent).toBeDefined();
    expect(
      baseline.failures.some((f) => f.includes("ClobberSummaryEvent")),
    ).toBe(false);
    const added = copy(next);
    (added["."] as Record<string, string>).BrandNewThing = "TypeAlias x";
    const message =
      "core-next . BrandNewThing (added): 1.35 does not export it and no signed contracts/api-changes.json addition covers it";
    expect(gate(added).failures).toContain(message);
    const listed: ApiChange = {
      kind: "add",
      export: ". BrandNewThing",
      reason: "test",
      approvedBy: null,
      status: "pending-gate",
    };
    expect(gate(added, { changes: [...changes, listed] }).failures).toContain(
      message,
    );
    expect(
      gate(added, {
        changes: [
          ...changes,
          { ...listed, approvedBy: "jason", status: undefined },
        ],
      }).failures,
    ).toEqual(baseline.failures);
  });

  it("next-drift.json is exactly the names whose signatures drift, each with a reason, and is in the harness lock", () => {
    expect(Object.keys(drift).sort()).toEqual(
      baseline.drift.map((d) => `${d.entry} ${d.name}`).sort(),
    );
    for (const [key, reason] of Object.entries(drift)) {
      expect(reason.trim(), key).not.toBe("");
    }
    expect(harnessFiles(conformanceRoot)).toContain(
      "contracts/next-drift.json",
    );
  });

  // Self-test (b): before next-drift.json, drift was reported and never failed.
  it("a signature drift next-drift.json does not list fails; bundler $N renames are not drift", () => {
    expect(withoutBundlerRenames("f<S extends Schema$1>(): Facts$12<S>")).toBe(
      "f<S extends Schema>(): Facts<S>",
    );
    const v1 = (frozen["."] as Record<string, string>).createSystem as string;
    const tampered = copy(next);
    (tampered["."] as Record<string, string>).createSystem += "\n// drift";
    const result = gate(tampered);
    expect(result.failures).toEqual([
      `core-next . createSystem (drift): its declaration differs from 1.35's and contracts/next-drift.json does not list it: ${describeDrift(
        {
          entry: ".",
          name: "createSystem",
          v1,
          next: (tampered["."] as Record<string, string>)
            .createSystem as string,
        },
      )}`,
    ]);
    expect(result.drift.map((d) => `${d.entry} ${d.name}`)).toContain(
      ". createSystem",
    );
    expect(baseline.drift.map((d) => `${d.entry} ${d.name}`)).not.toContain(
      ". createSystem",
    );
    // Listed, the same drift passes.
    expect(
      gate(tampered, { drift: { ...drift, ". createSystem": "test" } })
        .failures,
    ).toEqual([]);
    // A bundler rename of a type name is not drift.
    const renamed = copy(next);
    const decl = (renamed["."] as Record<string, string>)
      .createSystem as string;
    expect(decl).toMatch(/\b(ModuleSchema|ModulesMap)\b/);
    (renamed["."] as Record<string, string>).createSystem = decl.replace(
      /\b(ModuleSchema|ModulesMap)\b/g,
      "$1$$9",
    );
    expect((renamed["."] as Record<string, string>).createSystem).not.toBe(
      decl,
    );
    expect(gate(renamed)).toEqual(baseline);
  });

  // Self-test (c).
  it("a next-drift.json entry that no longer drifts, is not a shared name or has no reason fails", () => {
    const fixed = copy(next);
    (fixed["./internals"] as Record<string, string>).createFacts = (
      frozen["./internals"] as Record<string, string>
    ).createFacts as string;
    const stale = (key: string) =>
      `contracts/next-drift.json: ${key} is stale: core-next's declaration matches 1.35's (remove it from next-drift.json)`;
    const fixedResult = gate(fixed);
    expect(fixedResult.failures).toEqual([stale("./internals createFacts")]);
    expect(fixedResult.drift.map((d) => `${d.entry} ${d.name}`)).not.toContain(
      "./internals createFacts",
    );
    // A listed name that never drifted is stale too.
    expect(
      gate(next, { drift: { ...drift, ". createSystem": "test" } }).failures,
    ).toEqual([stale(". createSystem")]);
    expect(
      gate(next, { drift: { ...drift, ". noSuchName": "test" } }).failures,
    ).toEqual([
      "contracts/next-drift.json: . noSuchName is not a name both 1.35 and core-next export",
    ]);
    expect(
      gate(next, { drift: { ...drift, ". RequirementSet": " " } }).failures,
    ).toEqual(["contracts/next-drift.json: . RequirementSet has no reason"]);
  });

  // Self-test (a): `current: null` used to mean "nothing built", so every
  // name core-next lacks passed as unbuilt and the gate checked nothing.
  it('a "current" that is not a layer fails, naming the field, and nothing else is checked', () => {
    expect(baseline.failures).toEqual([]);
    for (const bad of [null, undefined, "L99", "", 6]) {
      const result = checkNextSurface(
        frozen,
        next,
        changes,
        bad as Layer | null,
        layers,
        unshipped,
        drift,
      );
      expect(result.failures, String(bad)).toEqual([
        `layers.rules.json: "current" is ${JSON.stringify(bad ?? null)}, not a layer (L0 to L13): set it to the highest layer core-next has built, since without one the gate cannot tell built names from unbuilt ones`,
      ]);
    }
    expect(gate(next, { current: null }).failures).toHaveLength(1);
    expect(gate(next, { current: "L0" }).failures).toEqual([]);
  });

  it("every 1.35 export is placed in a layer, the distributable-snapshot types at L12", () => {
    expect([...layers].filter(([, v]) => !v.layer).map(([key]) => key)).toEqual(
      [],
    );
    for (const name of [
      "isSignedSnapshot",
      "DistributableSnapshotLike",
      "SignedSnapshot",
      "SnapshotDiff",
      "SnapshotDiffEntry",
    ]) {
      expect(layers.get(`. ${name}`)?.layer, name).toBe("L12");
    }
  });
});
