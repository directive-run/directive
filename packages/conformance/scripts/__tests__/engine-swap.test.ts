/**
 * The engine-identity self test catches a setup file that swaps the engine.
 *
 * Runs the self test under the real config with one extra setup file that
 * mocks `@directive-run/core` with the v1 release and wraps `createSystem`
 * (the attack a reviewer used), and once without it as the control.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const conformance = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vitest = join(conformance, "node_modules/.bin/vitest");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-swap-"));
  writeFileSync(
    join(dir, "swap.ts"),
    `import { vi } from "vitest";
vi.mock("@directive-run/core", async () => {
  const v1 = await import(${JSON.stringify(join(conformance, "node_modules/directive-v1/dist/development/index.js"))});
  return { ...v1, createSystem: (...args: unknown[]) => (v1.createSystem as (...a: unknown[]) => unknown)(...args) };
});
`,
  );
  for (const [name, extra] of [
    ["control.mjs", []],
    ["swapped.mjs", [join(dir, "swap.ts")]],
  ] as const) {
    writeFileSync(
      join(dir, name),
      `import base from ${JSON.stringify(join(conformance, "vitest.config.ts"))};
const extra = ${JSON.stringify(extra)};
export default {
  ...base,
  test: {
    ...base.test,
    projects: base.test.projects.map((p) =>
      p.test.name === "conformance:local"
        ? { ...p, test: { ...p.test, setupFiles: [...p.test.setupFiles, ...extra] } }
        : p,
    ),
  },
};
`,
    );
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(config: string) {
  return spawnSync(
    vitest,
    [
      "run",
      "--config",
      join(dir, config),
      "--project",
      "conformance:local",
      "self/engine-identity.test.ts",
    ],
    {
      cwd: conformance,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    },
  );
}

describe("engine identity under a swapped engine", () => {
  it("passes with the real setup (control)", () => {
    const result = run("control.mjs");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("fails when a setup file mocks core with another engine", () => {
    const result = run("swapped.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(
      /× engine identity \(local, development\) > @directive-run\/core is the unmocked module/,
    );
  });
});
