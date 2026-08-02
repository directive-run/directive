// End-to-end gate added after 0.3.0/0.3.1 shipped a playground tool
// whose URLs booted broken module-only code in StackBlitz. Closes that class of regression: assert that a
// generate_module → playground_link composition produces a URL whose
// decoded payload contains BOTH a library-shape module (createModule +
// schema) AND a runner (createSystem + system.start), so a future
// change that drops the runner shape, breaks the multi-file encoding,
// or regresses generate_module's paired output FAILS here before npm.
//
// Decoder is duplicated from directive-docs's PlaygroundClient so this
// test exercises the exact bytes a browser would receive. If the docs
// route's decoder drifts, the smoke test in dist-smoke.test.ts catches
// that side; this catches the encoder.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decompressFromEncodedURIComponent } from "lz-string";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectiveServer } from "../src/server.js";

interface PlaygroundFile {
  path: string;
  source: string;
}

interface CallToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function parseDirectiveData<T>(result: CallToolResult): T {
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const match = text.match(/<directive-data>\n([\s\S]*?)\n<\/directive-data>/);
  if (!match) {
    throw new Error(
      `response did not contain a <directive-data> block: ${text}`,
    );
  }
  return JSON.parse(match[1]!) as T;
}

function decodeFilesFromUrl(url: string): PlaygroundFile[] {
  const idx = url.indexOf("#");
  expect(idx).toBeGreaterThan(-1);
  const params = new URLSearchParams(url.slice(idx + 1));
  const encoded = params.get("files");
  expect(encoded).not.toBeNull();
  const decoded = decompressFromEncodedURIComponent(encoded ?? "");
  expect(decoded).toBeTruthy();
  const parsed = JSON.parse(decoded) as PlaygroundFile[];
  expect(Array.isArray(parsed)).toBe(true);
  return parsed;
}

describe("generate_module → playground_link composition", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = createDirectiveServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "e2e", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("produces a URL whose payload contains BOTH the module AND a runner", async () => {
    const generated = await client.callTool({
      name: "generate_module",
      arguments: {
        name: "counter",
        kind: "module",
        sections: ["events", "constraints", "resolvers"],
      },
    });
    const scaffold = parseDirectiveData<{
      moduleSource: string;
      runnerSource: string;
      suggestedFilenames: { module: string; runner: string };
      runnable: boolean;
    }>(generated as CallToolResult);

    // generate_module's contract: paired output, non-null runner for
    // library-shape modules.
    expect(scaffold.runnable).toBe(false);
    expect(scaffold.runnerSource).toBeTruthy();
    expect(scaffold.moduleSource).toContain("createModule(");
    expect(scaffold.runnerSource).toContain("createSystem(");
    expect(scaffold.runnerSource).toContain("system.start()");

    // playground_link with the paired files.
    const link = await client.callTool({
      name: "playground_link",
      arguments: {
        files: [
          {
            path: scaffold.suggestedFilenames.module,
            source: scaffold.moduleSource,
          },
          {
            path: scaffold.suggestedFilenames.runner,
            source: scaffold.runnerSource,
          },
        ],
        title: "Counter demo",
      },
    });
    const payload = parseDirectiveData<{
      url: string;
      fileCount: number;
      mode: string;
    }>(link as CallToolResult);

    expect(payload.fileCount).toBe(2);
    expect(payload.mode).toBe("preview");

    // The class of regression we're guarding against: a URL that
    // decodes to module-only content with no runner.
    const files = decodeFilesFromUrl(payload.url);
    expect(files).toHaveLength(2);

    const allSource = files.map((f) => f.source).join("\n");
    expect(allSource).toContain("createModule(");
    expect(allSource).toContain("createSystem(");
    expect(allSource).toContain("system.start()");

    // Runner should be at the main.ts path so tsx picks it up.
    const main = files.find((f) => f.path.endsWith("main.ts"));
    expect(main).toBeTruthy();
    expect(main?.source).toContain("system.start()");
  });

  it("instant mode routes the same payload via /run instead of /playground", async () => {
    const generated = await client.callTool({
      name: "generate_module",
      arguments: { name: "counter", kind: "module" },
    });
    const scaffold = parseDirectiveData<{
      moduleSource: string;
      runnerSource: string;
      suggestedFilenames: { module: string; runner: string };
    }>(generated as CallToolResult);

    const link = await client.callTool({
      name: "playground_link",
      arguments: {
        files: [
          {
            path: scaffold.suggestedFilenames.module,
            source: scaffold.moduleSource,
          },
          {
            path: scaffold.suggestedFilenames.runner,
            source: scaffold.runnerSource,
          },
        ],
        mode: "instant",
      },
    });
    const payload = parseDirectiveData<{ url: string; mode: string }>(
      link as CallToolResult,
    );

    expect(payload.url.startsWith("https://directive.run/run#")).toBe(true);
    expect(payload.mode).toBe("instant");

    // Same multi-file invariant — runner is still in the payload.
    const files = decodeFilesFromUrl(payload.url);
    const main = files.find((f) => f.path.endsWith("main.ts"));
    expect(main?.source).toContain("system.start()");
  });

  it("single-source mode (from get_example / fix_code) still works", async () => {
    // No paired output — just a hand-rolled runnable snippet.
    const link = await client.callTool({
      name: "playground_link",
      arguments: {
        source:
          'import { createSystem } from "@directive-run/core";\nconsole.log("hi");\n',
        title: "Quick check",
      },
    });
    const payload = parseDirectiveData<{
      url: string;
      fileCount: number;
    }>(link as CallToolResult);

    expect(payload.fileCount).toBe(1);
    expect(payload.url).toContain("src=");
    expect(payload.url).not.toContain("files=");
  });
});
