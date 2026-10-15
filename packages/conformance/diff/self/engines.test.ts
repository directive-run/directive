/**
 * The differential harness compares what it claims to compare: two distinct
 * engines (the published 1.35.0 and the workspace source), a fresh instance
 * of each for every run, and every plugin hook.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coreEntries, v1PackageDir } from "../../lib/core-entries.js";
import { type EngineHandle, engines } from "../engines.js";
import { PLUGIN_HOOKS } from "../hooks.js";
import { createRecorder } from "../record.js";

const root = resolve(import.meta.dirname, "../..");

function pinnedVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  return (pkg.devDependencies["directive-v1"] as string).replace(
    /^npm:@directive-run\/core@/,
    "",
  );
}

describe("differential engines", () => {
  it("loads the published reference and the workspace source", () => {
    const [v1, local] = engines() as [EngineHandle, EngineHandle];
    const pkg = JSON.parse(
      readFileSync(join(v1PackageDir, "package.json"), "utf8"),
    );

    expect(v1.name).toBe("v1");
    expect(v1.file.startsWith(`${v1PackageDir}/`)).toBe(true);
    expect(pkg.version).toBe(pinnedVersion());
    expect(local.name).toBe("local");
    expect(local.file).toBe(coreEntries().find((e) => e.subpath === ".")?.file);
  });

  it("gives every run a fresh, distinct instance of each engine", async () => {
    const [v1, local] = engines() as [EngineHandle, EngineHandle];
    const a = await v1.load();
    const b = await v1.load();
    const c = await local.load();
    const d = await local.load();

    expect(typeof a.createSystem).toBe("function");
    expect(a.createSystem).not.toBe(b.createSystem);
    expect(c.createSystem).not.toBe(d.createSystem);
    expect(a.createSystem).not.toBe(c.createSystem);
  });

  it("records every plugin hook", () => {
    const { plugin } = createRecorder();
    const hooks = Object.keys(plugin).filter((k) => k !== "name");

    expect(hooks).toEqual([...PLUGIN_HOOKS]);
    expect(new Set(hooks).size).toBe(PLUGIN_HOOKS.length);
  });
});
