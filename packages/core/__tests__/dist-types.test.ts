// Regression coverage for a defect that is invisible to every test that runs
// against `src/`: the *emitted declarations* can lose type information the
// source never lost.
//
// `t.number().min(0)` returns a recursive chainable type. Declared inside the
// builder function it has no name the declaration emitter can reference, so the
// bundled `.d.ts` emitted the recursive return as `... & /*elided*/ any` — and an
// intersection with `any` is `any`. The effect was that *tightening* a fact with a
// validator silently erased its type, along with the type of every derivation,
// constraint and resolver that read it. Nothing warned, and no src-level test
// could see it, because the source types were correct all along.
//
// These tests typecheck a fixture against the built `dist/index.d.ts` exactly as a
// consumer does. If the dist is missing, run `pnpm --filter @directive-run/core build`.

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const distTypes = join(packageDir, "dist", "index.d.ts");
const repoRoot = join(packageDir, "..", "..");

let workDir: string;

/**
 * Typecheck `source` against the built declarations and return the diagnostics.
 *
 * Deliberately runs the real `tsc` rather than asserting with `expectTypeOf`:
 * the whole defect is that the *published* declarations differ from the source,
 * and a type assertion evaluated inside this package would read the source.
 */
async function diagnose(source: string): Promise<string> {
  const file = join(workDir, "fixture.ts");
  writeFileSync(file, source);
  try {
    await execFileAsync(
      process.execPath,
      [
        join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "--noEmit",
        "--strict",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        file,
      ],
      { cwd: workDir },
    );

    return "";
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };

    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
}

function fixture(factSchema: string): string {
  return `
import { createModule, createSystem, t } from ${JSON.stringify(distTypes.replace(/\.d\.ts$/, ".js"))};
const system = createSystem({
  module: createModule("m", {
    schema: { facts: { value: ${factSchema} } },
    init: (facts) => { facts.value = 0; },
  }),
});
const wrong: string = system.facts.value;
export { wrong };
`;
}

beforeAll(() => {
  if (!existsSync(distTypes)) {
    throw new Error(
      "dist/index.d.ts missing — run 'pnpm --filter @directive-run/core build' before this test",
    );
  }
  workDir = mkdtempSync(join(tmpdir(), "directive-dist-types-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("published declarations", () => {
  it("types a plain fact", async () => {
    // The control. If this ever stops reporting an error, the test below proves
    // nothing and the fixture itself is broken.
    const output = await diagnose(fixture("t.number()"));
    expect(output).toMatch(/is not assignable to type 'string'/);
  });

  it("keeps the fact's type when a validator is chained onto it", async () => {
    // The defect. A consumer who writes `.min(0)` must not lose the type they
    // were tightening.
    const output = await diagnose(fixture("t.number().min(0)"));
    expect(output).toMatch(/is not assignable to type 'string'/);
  });

  it("keeps the type through every chainable builder", async () => {
    // `number` was where this was found; all four builders declare their
    // chainable type the same way, so all four have to be pinned or the next one
    // regresses alone.
    for (const [schema, expected] of [
      ["t.string().minLength(1)", "string"],
      ["t.array<number>().nonEmpty()", "number[]"],
      ["t.object<{ a: number }>().hasKeys('a')", "{ a: number; }"],
    ] as const) {
      const source = `
import { createModule, createSystem, t } from ${JSON.stringify(distTypes.replace(/\.d\.ts$/, ".js"))};
const system = createSystem({
  module: createModule("m", { schema: { facts: { value: ${schema} } } }),
});
const wrong: symbol = system.facts.value;
export { wrong };
`;
      const output = await diagnose(source);
      expect(output, `${schema} lost its type in the published declarations`).toContain(
        expected,
      );
    }
  });
});
