// Regression coverage for the gap that shipped 0.3.0 broken: vitest runs
// against `src/`, which esbuild's transform handles CJS↔ESM interop for,
// so a named import from a CJS-only dep (`lz-string`) passed every src
// test BUT crashed Claude Desktop the moment Node's ESM loader tried to
// import the published `dist/cli.js` at handshake time.
//
// These tests exercise the *built* artifacts the same way Node does in
// production. If the dist is missing, run `pnpm build` first.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

describe("published dist artifacts", () => {
  it("dist/index.js loads as ESM with no native CJS interop errors", async () => {
    const distIndex = join(distDir, "index.js");
    if (!existsSync(distIndex)) {
      throw new Error(
        "dist/index.js missing — run 'pnpm --filter @directive-run/mcp build' before this test",
      );
    }
    // Dynamic import goes through Node's real ESM loader (not vitest's
    // transform), so a stray `import { foo } from 'cjs-only'` will throw
    // SyntaxError here the same way it does in production.
    const mod = await import(pathToFileURL(distIndex).href);
    expect(typeof mod.createDirectiveServer).toBe("function");
    expect(typeof mod.startSseServer).toBe("function");
  });

  it("dist/cli.js boots in a real Node process (--help exits 0)", async () => {
    const distCli = join(distDir, "cli.js");
    if (!existsSync(distCli)) {
      throw new Error(
        "dist/cli.js missing — run 'pnpm --filter @directive-run/mcp build' before this test",
      );
    }
    // The CLI calls main() at top-level; --help is the cheapest branch
    // that exercises ESM module linking without starting stdio/SSE.
    // A CJS↔ESM mismatch surfaces before main() ever runs.
    const { stdout } = await execFileAsync(process.execPath, [
      distCli,
      "--help",
    ]);
    expect(stdout).toMatch(/directive-mcp/i);
    expect(stdout).toMatch(/Usage:/);
  });
});
