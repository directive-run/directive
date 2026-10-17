/**
 * Golden files written by 1.35.0: the workspace reads them as 1.35.0 does
 * and writes the same bytes, and 1.35.0 reads what the workspace writes.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultRepoRoot } from "../lib/core-entries.js";
import { type Engine, checkGoldens, loadEngine } from "./lib/golden.js";

const goldenDir = join(
  defaultRepoRoot,
  "packages/conformance/contracts/golden",
);
let v1: Engine;
let local: Engine;
let scratch: string;

beforeAll(async () => {
  v1 = await loadEngine("v1");
  local = await loadEngine("local");
  scratch = mkdtempSync(join(tmpdir(), "contracts-golden-"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("golden files", () => {
  it("are 1.35.0's, and round-trip between 1.35.0 and the workspace", async () => {
    expect(await checkGoldens(goldenDir, v1, local)).toEqual([]);
  });

  it("a changed byte in any golden fails the check", async () => {
    const dir = join(scratch, "bytes");
    cpSync(goldenDir, dir, { recursive: true });
    const edit = (file: string, from: string, to: string) => {
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
    };
    edit("history-export.golden", '"currentIndex":', '"currentIndex": ');
    edit("persistence-saved.golden", '"count":2', '"count":3');
    edit("signed-snapshot.golden", '"signature":"a', '"signature":"b');
    edit("audit-ledger.golden", '"seq":1,', '"seq":7,');
    const failures = await checkGoldens(dir, v1, local);
    for (const f of [
      "history-export.golden",
      "persistence-saved.golden",
      "signed-snapshot.golden",
      "audit-ledger.golden",
    ]) {
      expect(failures).toContain(`golden ${f} is not what 1.35.0 writes`);
    }
  });

  it("an engine that reads a golden differently fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: { ...local.core, verifySnapshotSignature: async () => false },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures.join("\n")).toMatch(
      /the workspace reads 1\.35\.0's signed differently/,
    );
  });

  it("an engine that writes a golden differently fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: {
        ...local.core,
        signSnapshot: async (s: object, secret: string) => ({
          ...(await local.core.signSnapshot(s, secret)),
          algorithm: "hmac-sha512",
        }),
      },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures).toContain(
      "the workspace writes a different signed-snapshot.golden than 1.35.0",
    );
    expect(failures.join("\n")).toMatch(
      /1\.35\.0 reads the workspace's signed differently/,
    );
  });
});
