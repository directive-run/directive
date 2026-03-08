import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TMP_DIR = join(import.meta.dirname, ".tmp-lib-test");

function setupTmpDir() {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
  mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupTmpDir() {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// detect.ts — detectTools
// ---------------------------------------------------------------------------

describe("detectTools", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("returns empty array for directory with no signal files", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    const result = detectTools(TMP_DIR);

    expect(result).toEqual([]);
  });

  it("detects Cursor via .cursor directory", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    mkdirSync(join(TMP_DIR, ".cursor"));
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cursor");
    expect(result[0].name).toBe("Cursor");
    expect(result[0].outputPath).toBe(join(TMP_DIR, ".cursorrules"));
  });

  it("detects Cursor via .cursorrules file", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    writeFileSync(join(TMP_DIR, ".cursorrules"), "");
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cursor");
  });

  it("detects Claude Code via .claude directory", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    mkdirSync(join(TMP_DIR, ".claude"));
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("claude");
    expect(result[0].name).toBe("Claude Code");
    expect(result[0].outputPath).toBe(join(TMP_DIR, ".claude/CLAUDE.md"));
  });

  it("detects GitHub Copilot via .github directory", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    mkdirSync(join(TMP_DIR, ".github"));
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("copilot");
    expect(result[0].name).toBe("GitHub Copilot");
    expect(result[0].outputPath).toBe(
      join(TMP_DIR, ".github/copilot-instructions.md"),
    );
  });

  it("detects Windsurf via .windsurfrules file", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    writeFileSync(join(TMP_DIR, ".windsurfrules"), "");
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("windsurf");
    expect(result[0].name).toBe("Windsurf");
    expect(result[0].outputPath).toBe(join(TMP_DIR, ".windsurfrules"));
  });

  it("detects Cline via .clinerules file", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    writeFileSync(join(TMP_DIR, ".clinerules"), "");
    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cline");
    expect(result[0].name).toBe("Cline");
    expect(result[0].outputPath).toBe(join(TMP_DIR, ".clinerules"));
  });

  it("detects multiple tools simultaneously", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    mkdirSync(join(TMP_DIR, ".cursor"));
    mkdirSync(join(TMP_DIR, ".claude"));
    mkdirSync(join(TMP_DIR, ".github"));
    writeFileSync(join(TMP_DIR, ".windsurfrules"), "");
    writeFileSync(join(TMP_DIR, ".clinerules"), "");

    const result = detectTools(TMP_DIR);

    expect(result).toHaveLength(5);
    const ids = result.map((t) => t.id);
    expect(ids).toContain("cursor");
    expect(ids).toContain("claude");
    expect(ids).toContain("copilot");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("cline");
  });

  it("does not double-detect when both .cursor dir and .cursorrules exist", async () => {
    const { detectTools } = await import("../src/lib/detect.js");

    mkdirSync(join(TMP_DIR, ".cursor"));
    writeFileSync(join(TMP_DIR, ".cursorrules"), "");

    const result = detectTools(TMP_DIR);

    // Should still be 1 — the tool matches on first signal hit
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("cursor");
  });
});

// ---------------------------------------------------------------------------
// detect.ts — getToolConfig
// ---------------------------------------------------------------------------

describe("getToolConfig", () => {
  it("returns config for cursor", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    const config = getToolConfig("cursor");

    expect(config.id).toBe("cursor");
    expect(config.name).toBe("Cursor");
    expect(config.signals).toContain(".cursor");
    expect(config.outputPath).toBe(".cursorrules");
  });

  it("returns config for claude", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    const config = getToolConfig("claude");

    expect(config.id).toBe("claude");
    expect(config.name).toBe("Claude Code");
    expect(config.outputPath).toBe(".claude/CLAUDE.md");
  });

  it("returns config for copilot", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    const config = getToolConfig("copilot");

    expect(config.id).toBe("copilot");
    expect(config.name).toBe("GitHub Copilot");
  });

  it("returns config for windsurf", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    const config = getToolConfig("windsurf");

    expect(config.id).toBe("windsurf");
    expect(config.name).toBe("Windsurf");
  });

  it("returns config for cline", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    const config = getToolConfig("cline");

    expect(config.id).toBe("cline");
    expect(config.name).toBe("Cline");
  });

  it("throws for unknown tool ID", async () => {
    const { getToolConfig } = await import("../src/lib/detect.js");

    expect(() => getToolConfig("unknown" as any)).toThrow("Unknown tool");
  });
});

// ---------------------------------------------------------------------------
// detect.ts — getAllToolIds
// ---------------------------------------------------------------------------

describe("getAllToolIds", () => {
  it("returns all 5 tool IDs", async () => {
    const { getAllToolIds } = await import("../src/lib/detect.js");

    const ids = getAllToolIds();

    expect(ids).toHaveLength(5);
    expect(ids).toContain("cursor");
    expect(ids).toContain("claude");
    expect(ids).toContain("copilot");
    expect(ids).toContain("windsurf");
    expect(ids).toContain("cline");
  });

  it("returns a fresh array each call", async () => {
    const { getAllToolIds } = await import("../src/lib/detect.js");

    const a = getAllToolIds();
    const b = getAllToolIds();

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// monorepo.ts — detectMonorepo
// ---------------------------------------------------------------------------

describe("detectMonorepo", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("returns isMonorepo: false for a directory tree with no signals", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    // Use /tmp to avoid walking up into the actual project's monorepo root
    const isolatedDir = join("/tmp", ".directive-monorepo-test-plain");
    mkdirSync(isolatedDir, { recursive: true });

    try {
      const result = detectMonorepo(isolatedDir);

      // /tmp is not a monorepo, but detectMonorepo walks up — if it finds
      // nothing before hitting filesystem root, isMonorepo should be false
      expect(result.isMonorepo).toBe(false);
      expect(result.rootDir).toBe(isolatedDir);
      expect(result.tool).toBeUndefined();
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it("detects pnpm workspace", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    writeFileSync(join(TMP_DIR, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

    const result = detectMonorepo(TMP_DIR);

    expect(result.isMonorepo).toBe(true);
    expect(result.rootDir).toBe(TMP_DIR);
    expect(result.tool).toBe("pnpm");
  });

  it("detects turbo", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    writeFileSync(join(TMP_DIR, "turbo.json"), JSON.stringify({ pipeline: {} }));

    const result = detectMonorepo(TMP_DIR);

    expect(result.isMonorepo).toBe(true);
    expect(result.rootDir).toBe(TMP_DIR);
    expect(result.tool).toBe("turbo");
  });

  it("detects npm workspaces from package.json", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );

    const result = detectMonorepo(TMP_DIR);

    expect(result.isMonorepo).toBe(true);
    expect(result.rootDir).toBe(TMP_DIR);
    expect(result.tool).toBe("npm");
  });

  it("detects yarn workspaces when yarn.lock present", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    writeFileSync(join(TMP_DIR, "yarn.lock"), "");

    const result = detectMonorepo(TMP_DIR);

    expect(result.isMonorepo).toBe(true);
    expect(result.rootDir).toBe(TMP_DIR);
    expect(result.tool).toBe("yarn");
  });

  it("walks up directory tree to find monorepo root", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    // Create monorepo signal at root
    writeFileSync(join(TMP_DIR, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

    // Create nested child directory
    const childDir = join(TMP_DIR, "packages", "my-pkg");
    mkdirSync(childDir, { recursive: true });

    const result = detectMonorepo(childDir);

    expect(result.isMonorepo).toBe(true);
    expect(result.rootDir).toBe(TMP_DIR);
    expect(result.tool).toBe("pnpm");
  });

  it("prefers pnpm-workspace.yaml over package.json workspaces", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    writeFileSync(join(TMP_DIR, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );

    const result = detectMonorepo(TMP_DIR);

    expect(result.tool).toBe("pnpm");
  });

  it("ignores malformed package.json and continues walking up", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    // Use an isolated /tmp dir so walking up doesn't find real monorepo signals
    const isolatedDir = join("/tmp", ".directive-monorepo-test-malformed");
    mkdirSync(isolatedDir, { recursive: true });

    try {
      writeFileSync(join(isolatedDir, "package.json"), "NOT VALID JSON{{");

      const result = detectMonorepo(isolatedDir);

      // Should not crash — malformed JSON is caught and skipped
      expect(result.isMonorepo).toBe(false);
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it("returns startDir as rootDir when not a monorepo", async () => {
    const { detectMonorepo } = await import("../src/lib/monorepo.js");

    // Use an isolated /tmp dir so walking up doesn't find real monorepo signals
    const isolatedDir = join("/tmp", ".directive-monorepo-test-noroot", "some", "nested", "dir");
    mkdirSync(isolatedDir, { recursive: true });

    try {
      const result = detectMonorepo(isolatedDir);

      expect(result.isMonorepo).toBe(false);
      expect(result.rootDir).toBe(isolatedDir);
    } finally {
      rmSync(join("/tmp", ".directive-monorepo-test-noroot"), { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// merge.ts — mergeSection
// ---------------------------------------------------------------------------

describe("mergeSection", () => {
  it("appends section to content without existing markers", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_START, SECTION_END } = await import(
      "../src/lib/constants.js"
    );

    const result = mergeSection("# My Rules", "Directive content");

    expect(result).toContain("# My Rules");
    expect(result).toContain(SECTION_START);
    expect(result).toContain("Directive content");
    expect(result).toContain(SECTION_END);
  });

  it("replaces content between existing markers", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_START, SECTION_END } = await import(
      "../src/lib/constants.js"
    );

    const existing = `Before\n${SECTION_START}\nold stuff\n${SECTION_END}\nAfter`;
    const result = mergeSection(existing, "new stuff");

    expect(result).toContain("Before");
    expect(result).toContain("new stuff");
    expect(result).toContain("After");
    expect(result).not.toContain("old stuff");
  });

  it("uses double newline separator when content does not end with newline", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_START } = await import("../src/lib/constants.js");

    const result = mergeSection("no trailing newline", "section");

    // Should have \n\n before the section start
    const idx = result.indexOf(SECTION_START);
    const before = result.slice(0, idx);
    expect(before).toBe("no trailing newline\n\n");
  });

  it("uses single newline separator when content ends with newline", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_START } = await import("../src/lib/constants.js");

    const result = mergeSection("trailing newline\n", "section");

    const idx = result.indexOf(SECTION_START);
    const before = result.slice(0, idx);
    expect(before).toBe("trailing newline\n\n");
  });

  it("preserves content before and after markers on replace", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_START, SECTION_END } = await import(
      "../src/lib/constants.js"
    );

    const existing = `Header\nLine2\n${SECTION_START}\nold\n${SECTION_END}\nFooter\nEnd`;
    const result = mergeSection(existing, "replaced");

    expect(result).toMatch(/^Header\nLine2\n/);
    expect(result).toMatch(/\nFooter\nEnd$/);
    expect(result).toContain("replaced");
    expect(result).not.toContain("old");
  });

  it("appends trailing newline after section on fresh append", async () => {
    const { mergeSection } = await import("../src/lib/merge.js");
    const { SECTION_END } = await import("../src/lib/constants.js");

    const result = mergeSection("start", "body");

    expect(result).toMatch(new RegExp(`${SECTION_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n$`));
  });
});

// ---------------------------------------------------------------------------
// merge.ts — hasDirectiveSection
// ---------------------------------------------------------------------------

describe("hasDirectiveSection", () => {
  it("returns true when both markers are present", async () => {
    const { hasDirectiveSection } = await import("../src/lib/merge.js");
    const { SECTION_START, SECTION_END } = await import(
      "../src/lib/constants.js"
    );

    const content = `stuff\n${SECTION_START}\ncontent\n${SECTION_END}\nmore`;

    expect(hasDirectiveSection(content)).toBe(true);
  });

  it("returns false when no markers present", async () => {
    const { hasDirectiveSection } = await import("../src/lib/merge.js");

    expect(hasDirectiveSection("just some text")).toBe(false);
  });

  it("returns false when only start marker present", async () => {
    const { hasDirectiveSection } = await import("../src/lib/merge.js");
    const { SECTION_START } = await import("../src/lib/constants.js");

    expect(hasDirectiveSection(`text\n${SECTION_START}\nmore`)).toBe(false);
  });

  it("returns false when only end marker present", async () => {
    const { hasDirectiveSection } = await import("../src/lib/merge.js");
    const { SECTION_END } = await import("../src/lib/constants.js");

    expect(hasDirectiveSection(`text\n${SECTION_END}\nmore`)).toBe(false);
  });

  it("returns false for empty string", async () => {
    const { hasDirectiveSection } = await import("../src/lib/merge.js");

    expect(hasDirectiveSection("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loader.ts — loadSystem
// ---------------------------------------------------------------------------

describe("loadSystem", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("throws for non-existent file", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    await expect(
      loadSystem(join(TMP_DIR, "does-not-exist.ts")),
    ).rejects.toThrow("File not found");
  });

  it("throws for file without system export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    const tmpFile = join(TMP_DIR, "no-system.mjs");
    writeFileSync(tmpFile, "export const x = 1;\n");

    await expect(loadSystem(tmpFile)).rejects.toThrow(
      "No Directive system found",
    );
  });

  it("loads a system from default export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    const tmpFile = join(TMP_DIR, "default-sys.mjs");
    writeFileSync(
      tmpFile,
      `const system = {
  facts: {},
  inspect: () => ({}),
  start: () => {},
  stop: () => {},
};
export default system;
`,
    );

    const sys = await loadSystem(tmpFile);

    expect(sys).toBeDefined();
    expect(typeof sys.inspect).toBe("function");
    expect(typeof sys.start).toBe("function");
    expect(typeof sys.stop).toBe("function");
    expect(sys.facts).toBeDefined();
  });

  it("loads a system from named system export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    const tmpFile = join(TMP_DIR, "named-sys.mjs");
    writeFileSync(
      tmpFile,
      `export const system = {
  facts: { count: 0 },
  inspect: () => ({ count: 0 }),
  start: () => {},
  stop: () => {},
};
`,
    );

    const sys = await loadSystem(tmpFile);

    expect(sys).toBeDefined();
    expect(typeof sys.inspect).toBe("function");
  });

  it("loads a system from any export that matches duck-type", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    const tmpFile = join(TMP_DIR, "any-export-sys.mjs");
    writeFileSync(
      tmpFile,
      `export const myCustomSystem = {
  facts: {},
  inspect: () => ({}),
  start: () => {},
  stop: () => {},
};
`,
    );

    const sys = await loadSystem(tmpFile);

    expect(sys).toBeDefined();
    expect(typeof sys.start).toBe("function");
  });

  it("rejects objects missing required methods", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    const tmpFile = join(TMP_DIR, "partial-sys.mjs");
    writeFileSync(
      tmpFile,
      `export default { facts: {}, inspect: () => ({}) };
`,
    );

    await expect(loadSystem(tmpFile)).rejects.toThrow(
      "No Directive system found",
    );
  });
});
