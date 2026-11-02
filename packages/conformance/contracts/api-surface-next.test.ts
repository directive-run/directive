/**
 * core-next's built public API, at the layers it has built, is 1.35's: the
 * gate in contracts/lib/next-surface.ts, and proof that each rule bites.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRepoRoot, nextPackageDir } from "../lib/core-entries.js";
import { type Layer, layerIndex } from "../lib/layers.js";
import {
  checkNextSurface,
  currentLayer,
  describeDrift,
  exportLayers,
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
const layers = exportLayers(defaultRepoRoot, frozen, Object.keys(next));
const copy = (s: Surface): Surface => JSON.parse(JSON.stringify(s));
const gate = (
  s: Surface,
  options: { current?: typeof current; changes?: ApiChange[] } = {},
) =>
  checkNextSurface(
    frozen,
    s,
    options.changes ?? changes,
    options.current === undefined ? current : options.current,
    layers,
  );
const baseline = gate(next);
const signedRemoval: ApiChange = {
  entry: ".",
  name: "createSystem",
  change: "removed",
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
        `[contracts] core-next signature drift (reported): ${describeDrift(d)}`,
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

  it("a missing unbuilt-layer export is accepted, and fails once its layer is built", () => {
    expect(next["."]?.doctor).toBeUndefined();
    expect(layers.get(". doctor")?.layer).toBe("L11");
    expect(baseline.unbuilt).toContainEqual({
      entry: ".",
      name: "doctor",
      layer: "L11",
    });
    expect(baseline.failures.some((f) => f.includes(" . doctor "))).toBe(false);
    expect(gate(next, { current: "L11" }).failures).toContain(
      "core-next . doctor (missing): 1.35 exports it and its layer L11 is built (current L11)",
    );
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
      checkNextSurface(frozen, tampered, changes, current, unplaced).failures,
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

  it("signature drift is reported, not failed; bundler $N renames are not drift", () => {
    expect(withoutBundlerRenames("f<S extends Schema$1>(): Facts$12<S>")).toBe(
      "f<S extends Schema>(): Facts<S>",
    );
    const tampered = copy(next);
    (tampered["."] as Record<string, string>).createSystem += " ";
    const result = gate(tampered);
    expect(result.failures).toEqual(baseline.failures);
    expect(result.drift.map((d) => `${d.entry} ${d.name}`)).toContain(
      ". createSystem",
    );
    expect(baseline.drift.map((d) => `${d.entry} ${d.name}`)).not.toContain(
      ". createSystem",
    );
  });
});
