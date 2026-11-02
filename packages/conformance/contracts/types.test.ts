/**
 * Type contracts (contracts/types/check.ts) compiled against 1.35.0's and the
 * workspace's built declarations, and against core-next's as a third engine;
 * the Aperture lab's files against core-next's; and proof that each one can
 * fail.
 */

import { describe, expect, it } from "vitest";
import { compileAperture, compileTypeContracts } from "./lib/types.js";

/** core-next's SystemInspection with a changed `unmet` signature. */
const readonlyUnmet = (file: string, text: string) =>
  file.endsWith(".d.ts")
    ? text.replace(
        "interface SystemInspection {\n    unmet: RequirementWithId[];",
        "interface SystemInspection {\n    unmet: readonly RequirementWithId[];",
      )
    : text;

describe("type contracts", () => {
  it("compile against 1.35.0's and the workspace's built declarations", () => {
    expect(compileTypeContracts()).toBe("");
  });

  it("a renamed hook in the frozen list fails to compile", () => {
    const out = compileTypeContracts((file, text) =>
      file === "frozen.ts"
        ? text.replace('"onFactsBatch"', '"onFactBatch"')
        : text,
    );
    expect(out).toMatch(/check\.ts.*error TS2344/);
  });

  it("a dropped observation kind fails to compile", () => {
    const out = compileTypeContracts((file, text) =>
      file === "frozen.ts" ? text.replace('  "effect.run",\n', "") : text,
    );
    expect(out).toMatch(/check\.ts.*error TS2344/);
  });

  it("a different inspect() shape or SystemLike fails to compile", () => {
    const out = compileTypeContracts((file, text) =>
      file === "check.ts"
        ? text
            .replace(
              "Equal<SystemInspection, SystemInspectionV1>",
              'Equal<SystemInspection, Omit<SystemInspectionV1, "unmet">>',
            )
            .replace(
              "SystemLikeV1[] = [",
              "Array<SystemLikeV1 & { notInV1: true }> = [",
            )
        : text,
    );
    expect(out).toMatch(/error TS2344/);
    expect(out).toMatch(/error TS2322/);
  });

  it("compile against core-next's built declarations (a third engine)", () => {
    expect(compileTypeContracts(undefined, "next")).toBe("");
  });

  it("a changed signature in core-next's declarations fails check.ts", () => {
    const out = compileTypeContracts(undefined, "next", readonlyUnmet);
    expect(out).toMatch(/check\.ts\(\d+,\d+\): error TS2322/);
    expect(out).toMatch(/inspect\(\)\.unmet/);
    // The workspace engine alone (the check before core-next was added)
    // never sees core-next's declarations.
    expect(compileTypeContracts()).toBe("");
  });

  it("the Aperture lab's three files compile against core-next's declarations", () => {
    expect(compileAperture()).toBe("");
  });

  it("a type the lab imports, gone from core-next, fails the Aperture check", () => {
    const out = compileAperture((file, text) =>
      file === "index.d.ts" ? text.replace("as as SourcePublish, ", "") : text,
    );
    expect(out).toMatch(/scene\.ts\(\d+,\d+\): error TS\d+: .*SourcePublish/);
  });
});
