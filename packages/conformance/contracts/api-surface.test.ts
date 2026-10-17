/**
 * The public API of every entry point is the 1.35 snapshot, read from built
 * declarations, except changes Jason approved in api-changes.json.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRepoRoot, v1PackageDir } from "../lib/core-entries.js";
import {
  type ApiChange,
  type Surface,
  checkSurface,
  diffSurface,
  extractSurface,
} from "./lib/surface.js";

const here = join(defaultRepoRoot, "packages/conformance/contracts");
const frozen: Surface = JSON.parse(
  readFileSync(join(here, "api-surface.json"), "utf8"),
);
const changes: ApiChange[] = JSON.parse(
  readFileSync(join(here, "api-changes.json"), "utf8"),
).changes;
const local = extractSurface(join(defaultRepoRoot, "packages/core"));
const copy = (s: Surface): Surface => JSON.parse(JSON.stringify(s));

describe("public API surface", () => {
  it("the snapshot is exactly what 1.35.0 ships", () => {
    expect(extractSurface(v1PackageDir)).toEqual(frozen);
  });

  it("the workspace's built API matches the snapshot, except approved changes", () => {
    const added = diffSurface(frozen, local).filter(
      (d) => d.change === "added",
    );
    if (added.length > 0) {
      console.info(
        `[contracts] exports added since 1.35 (2.0 must keep these too): ${added.map((d) => `${d.entry} ${d.name}`).join(", ")}`,
      );
    }
    expect(checkSurface(frozen, local, changes)).toEqual([]);
  });

  it("a removed export fails the check", () => {
    const tampered = copy(local);
    delete tampered["."]?.createSystem;
    expect(checkSurface(frozen, tampered, changes)).toEqual([
      "public API . createSystem (removed) differs from the 1.35 snapshot and is not in contracts/api-changes.json",
    ]);
  });

  it("a changed declaration or a removed entry point fails the check", () => {
    const tampered = copy(local);
    (tampered["./plugins"] as Record<string, string>).persistencePlugin += " ";
    delete tampered["./migration"];
    const failures = checkSurface(frozen, tampered, changes);
    expect(failures).toContain(
      "public API ./plugins persistencePlugin (changed) differs from the 1.35 snapshot and is not in contracts/api-changes.json",
    );
    expect(failures.filter((f) => f.includes("./migration "))).toHaveLength(
      Object.keys(frozen["./migration"] ?? {}).length,
    );
  });

  it("an approved change passes; an unsigned or stale entry fails", () => {
    const tampered = copy(local);
    delete tampered["."]?.createSystem;
    const approved: ApiChange = {
      entry: ".",
      name: "createSystem",
      change: "removed",
      reason: "test",
      approvedBy: "jason",
      date: "2026-10-17",
    };
    expect(checkSurface(frozen, tampered, [approved])).toEqual([]);
    expect(
      checkSurface(frozen, tampered, [{ ...approved, approvedBy: "" }]),
    ).toEqual(["api-changes.json: . createSystem (removed) has no approvedBy"]);
    expect(checkSurface(frozen, local, [approved])).toEqual([
      "api-changes.json: . createSystem (removed) is stale (no such difference)",
    ]);
  });
});
