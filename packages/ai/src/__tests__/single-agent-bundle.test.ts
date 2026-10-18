/**
 * A single-agent consumer must not pay for multi-agent code.
 *
 * Bundles a tiny app that imports only `createAgentOrchestrator` from the
 * package source (minified, tree-shaken, core external) and checks that text
 * unique to multi-agent-orchestrator.ts is absent. The control case imports
 * `createMultiAgentOrchestrator` and must contain it, which proves the markers
 * would be caught if multi-agent code leaked into the single-agent path.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../index.ts");

// Strings that appear only in multi-agent-orchestrator.ts and survive minification.
const MULTI_AGENT_MARKERS = [
  "[Directive MultiAgent] Orchestrator has been destroyed",
  "[Directive MultiAgent] Invalid approval configuration",
];

async function bundle(importName: string): Promise<string> {
  const result = await build({
    stdin: {
      contents: `import { ${importName} } from ${JSON.stringify(entry)};\nglobalThis.__used = ${importName};`,
      resolveDir: here,
      loader: "ts",
    },
    bundle: true,
    write: false,
    minify: true,
    treeShaking: true,
    format: "esm",
    platform: "neutral",
    external: ["@directive-run/core", "@directive-run/core/*", "node:*", "ws"],
    logLevel: "silent",
  });

  return result.outputFiles[0]!.text;
}

describe("single-agent bundle", () => {
  it("contains no multi-agent orchestrator code", async () => {
    const out = await bundle("createAgentOrchestrator");

    expect(out.length).toBeGreaterThan(1000);
    for (const marker of MULTI_AGENT_MARKERS) {
      expect(out, marker).not.toContain(marker);
    }
  });

  it("control: the multi-agent import does include the markers", async () => {
    const out = await bundle("createMultiAgentOrchestrator");

    for (const marker of MULTI_AGENT_MARKERS) {
      expect(out, marker).toContain(marker);
    }
  });
});
