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
  REF_PREFIX,
  type Surface,
  checkSurface,
  diffSurface,
  extractSurface,
  pendingApprovals,
} from "./lib/surface.js";

const here = join(defaultRepoRoot, "packages/conformance/contracts");
const frozen: Surface = JSON.parse(
  readFileSync(join(here, "api-surface.json"), "utf8"),
);
const changes: ApiChange[] = JSON.parse(
  readFileSync(join(here, "api-changes.json"), "utf8"),
).changes;
const removal = (extra: Partial<ApiChange> = {}) =>
  ({
    entry: ".",
    name: "createSystem",
    change: "removed",
    reason: "test",
    approvedBy: "jason",
    date: "2026-10-17",
    ...extra,
  }) as ApiChange;
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
    const pending = pendingApprovals(changes);
    if (pending.length > 0) {
      console.info(`[contracts] pending approvals: ${pending.join("; ")}`);
    }
    expect(checkSurface(frozen, local, changes)).toEqual([]);
  });

  it("the snapshot is deterministic: keys are sorted", () => {
    for (const names of Object.values(frozen)) {
      const keys = Object.keys(names);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it("referenced-but-unexported types are in the snapshot", () => {
    const refs = Object.keys(frozen["."] ?? {}).filter((k) =>
      k.startsWith(REF_PREFIX),
    );
    for (const name of ["AuditEntryBase", "FactOrigin", "Brand"]) {
      expect(refs.some((k) => k.endsWith(`:${name}`))).toBe(true);
    }
  });

  it("changing an unexported type an export refers to fails the check", () => {
    const tampered = copy(local);
    const key = Object.keys(tampered["."] ?? {}).find((k) =>
      k.endsWith(":AuditEntryBase"),
    ) as string;
    const decls = tampered["."] as Record<string, string>;
    expect(decls[key]).toContain("readonly prevHash: string | null");
    decls[key] = (decls[key] as string).replace(
      "readonly prevHash: string | null",
      "prevHash?: number",
    );
    expect(checkSurface(frozen, tampered, changes)).toEqual([
      `public API . ${key} (changed) differs from the 1.35 snapshot and is not in contracts/api-changes.json`,
    ]);
  });

  it("an unlisted addition fails; a pending-gate one passes", () => {
    const added = copy(local);
    (added["."] as Record<string, string>).BrandNewThing = "TypeAlias x";
    expect(checkSurface(frozen, added, changes)).toEqual([
      "public API . BrandNewThing (added) is new since 1.35 and is not listed in contracts/api-changes.json",
    ]);
    const listed: ApiChange = {
      kind: "add",
      export: ". BrandNewThing",
      reason: "test",
      approvedBy: null,
      status: "pending-gate",
    };
    expect(checkSurface(frozen, added, [...changes, listed])).toEqual([]);
    expect(
      checkSurface(frozen, added, [
        ...changes,
        { ...listed, status: undefined },
      ]),
    ).toEqual([
      "api-changes.json: . BrandNewThing (added) has no approvedBy and is not pending-gate",
    ]);
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
    const approved = removal();
    expect(checkSurface(frozen, tampered, [approved, ...changes])).toEqual([]);
    expect(
      checkSurface(frozen, tampered, [removal({ approvedBy: "" }), ...changes]),
    ).toEqual(["api-changes.json: . createSystem (removed) has no approvedBy"]);
    expect(checkSurface(frozen, local, [approved, ...changes])).toEqual([
      "api-changes.json: . createSystem (removed) is stale (no such difference)",
    ]);
  });
});
