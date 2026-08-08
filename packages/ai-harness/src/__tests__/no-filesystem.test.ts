/**
 * A chain that runs without a filesystem.
 *
 * The core used to construct its writer itself: `node:fs/promises` imported into
 * `core/transcript.ts`, `process.cwd()` for the destination, and a second,
 * separate `writeFile` in `core/composition.ts` for the combined document.
 * Nothing could be substituted for either, which is what both stub surfaces
 * named as their blocker — a server wants object storage or a per-run temporary
 * directory, and neither is reachable through a hard-coded `writeFile`.
 *
 * So the assertion here is not "the in-memory store works". It is that **every**
 * filesystem call is gone from the path a chain takes: `node:fs` and
 * `node:fs/promises` are replaced wholesale with functions that throw, and a
 * chain and a composition are both run to completion against them. A single
 * surviving write anywhere under `core/` fails this file.
 */

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Both factories are hoisted above every import, so each builds its own
// refusals rather than closing over a helper that does not exist yet.
vi.mock("node:fs", () => {
  const refuse = (name: string) => () => {
    throw new Error(`[test] ${name} — a chain reached the filesystem`);
  };

  return {
    existsSync: refuse("existsSync"),
    readFileSync: refuse("readFileSync"),
    writeFileSync: refuse("writeFileSync"),
    mkdirSync: refuse("mkdirSync"),
  };
});

vi.mock("node:fs/promises", () => {
  const refuse = (name: string) => () => {
    throw new Error(`[test] ${name} — a chain reached the filesystem`);
  };

  return {
    readFile: refuse("readFile"),
    writeFile: refuse("writeFile"),
    appendFile: refuse("appendFile"),
    mkdir: refuse("mkdir"),
    mkdtemp: refuse("mkdtemp"),
    rm: refuse("rm"),
  };
});

import { createFileTranscriptStore } from "../adapters/node/transcript.js";
import { runComposition } from "../core/composition.js";
import { createMockRunner } from "../core/mock-runner.js";
import { createHarnessSystem } from "../core/system.js";
import {
  type MemoryTranscriptStore,
  createMemoryTranscriptStore,
} from "../core/transcript.js";
import { cannedResponses, testPreset } from "./fixtures.js";

describe("a chain with nowhere to write", () => {
  let store: MemoryTranscriptStore;

  beforeEach(() => {
    store = createMemoryTranscriptStore();
  });

  it("would notice if a chain did reach one", () => {
    // The refusals above have teeth: the filesystem store trips them on the
    // first call. Without this, a core that quietly stopped writing anything at
    // all would pass every assertion below.
    expect(() =>
      createFileTranscriptStore({ dir: "/tmp/never" }).open({ runId: "x" }),
    ).toThrow(/reached the filesystem/);
  });

  it("runs to completion, and the artefacts are whole", async () => {
    const harness = createHarnessSystem(
      testPreset({ maxIterations: 3, budgetUsd: 5 }),
      {
        runner: createMockRunner({ responses: cannedResponses() }),
        transcripts: store,
        runId: "offline",
        retry: { maxRetries: 0 },
      },
    );

    const result = await harness.run("the input");
    harness.system.destroy();

    expect(result.phase).toBe("complete");
    expect(result.stopReason).toBe("max-iterations");
    expect(result.iterations).toBe(3);
    expect(result.synthesis).toContain("SYNTHESIS");

    // The transcript is not a stub that swallowed everything: it holds the same
    // document a filesystem store would have written.
    const markdown = store.documents().get("offline.md") ?? "";
    expect(markdown).toContain("**Input:** the input");
    expect(markdown).toContain("## 3. gamma");
    expect(markdown).toContain("# Synthesis");
    expect(store.documents().get("offline.jsonl")?.trim().split("\n")).toEqual(
      expect.arrayContaining([expect.stringContaining("alpha")]),
    );

    // And it says where it went, rather than reporting a path nothing is at.
    expect(result.transcriptPath).toBe("memory://offline.md");
  });

  it("defaults to keeping the run in memory when no store is named", async () => {
    const harness = createHarnessSystem(
      testPreset({ maxIterations: 2, budgetUsd: 5 }),
      {
        runner: createMockRunner({ responses: cannedResponses() }),
        runId: "defaulted",
        retry: { maxRetries: 0 },
      },
    );

    const result = await harness.run("the input");
    harness.system.destroy();

    expect(result.phase).toBe("complete");
    expect(result.transcriptPath).toBe("memory://defaulted.md");
  });

  it("composes several presets, combined document included", async () => {
    const presets = [
      testPreset({ id: "first", maxIterations: 2, budgetUsd: 5 }),
      testPreset({ id: "second", maxIterations: 2, budgetUsd: 5 }),
    ];

    const result = await runComposition(presets, "the subject", {
      runner: createMockRunner({ responses: cannedResponses() }),
      transcripts: store,
      runId: "composed",
      retry: { maxRetries: 0 },
    });

    expect(result.steps).toHaveLength(2);
    expect(result.combinedPath).toBe("memory://composed.md");

    // The combined document went through the same store the transcripts did,
    // which is the point — it used to be a second writer with its own opinion
    // about where things go.
    const combined = store.documents().get("composed.md") ?? "";
    expect(combined).toContain("## 1. first");
    expect(combined).toContain("## 2. second");
    expect(store.documents().has("composed-1-first.md")).toBe(true);
    expect(store.documents().has("composed-2-second.jsonl")).toBe(true);
  });
});

/**
 * The mocks above prove a chain makes no filesystem *call*. This proves the
 * library entry does not *load* one.
 *
 * They are different failures. A module that imports `node:fs` and never calls
 * it passes every assertion in this file and still cannot be loaded on a
 * runtime without a filesystem — the import is resolved before a line of it
 * runs. That is what a static re-export of the filesystem store from the
 * package entry did: `import { runHarness } from "@sizls/ai-harness"` pulled in
 * `node:fs` whether or not anything asked for a file.
 *
 * Read from source rather than from `dist`, so the rule holds without a build
 * having happened, and so a violation is named with the file that introduced it.
 */
describe("nothing on the library entry's path imports a builtin", () => {
  const CORE_DIRS = ["core", "presets"];
  const STATIC_NODE_IMPORT = /^\s*import\s[^;]*?from\s+["']node:[^"']+["']/m;

  it("keeps node: imports out of the runtime-agnostic half", async () => {
    const { readdir, readFile } =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const src = join(import.meta.dirname, "..");
    const offenders: string[] = [];

    for (const dir of [".", ...CORE_DIRS]) {
      const base = join(src, dir);
      for (const entry of await readdir(base, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          continue;
        }
        // `node.ts` is the subpath export that exists to hold exactly this,
        // and `cli.ts` is a binary with a `#!/usr/bin/env node` on line one.
        if (
          dir === "." &&
          (entry.name === "node.ts" || entry.name === "cli.ts")
        ) {
          continue;
        }
        const contents = await readFile(join(base, entry.name), "utf8");
        if (STATIC_NODE_IMPORT.test(contents)) {
          offenders.push(`${dir}/${entry.name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
