/**
 * The engine-identity self test catches a setup file that swaps the engine.
 *
 * Runs the self test under the real config with one extra setup file that
 * mocks `@directive-run/core` with the v1 release and wraps `createSystem`
 * (the attack a reviewer used), and once without it as the control.
 */

import { spawn } from "node:child_process";
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

/**
 * Async on purpose: a synchronous spawn blocks this worker's event loop for
 * the whole child run, and vitest's worker RPC times out behind it.
 */
function run(
  config: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done, failed) => {
    const child = spawn(
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
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", failed);
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

describe("engine identity under a swapped engine", () => {
  it("passes with the real setup (control)", async () => {
    const result = await run("control.mjs");
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("fails when a setup file mocks core with another engine", async () => {
    const result = await run("swapped.mjs");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(
      /× engine identity \(local, development\) > @directive-run\/core is the unmocked module/,
    );
  });
});
