/**
 * Type contracts (contracts/types/check.ts) compiled against 1.35.0's and the
 * workspace's built declarations, and proof that each one can fail.
 */

import { describe, expect, it } from "vitest";
import { compileTypeContracts } from "./lib/types.js";

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
});
