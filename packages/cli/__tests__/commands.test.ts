import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TMP_DIR = join(import.meta.dirname, ".tmp-test");

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
// init command
// ---------------------------------------------------------------------------

describe("init command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("creates counter template files with --no-interactive", async () => {
    const { initCommand } = await import("../src/commands/init.js");

    await initCommand(["--no-interactive", "--dir", TMP_DIR]);

    expect(existsSync(join(TMP_DIR, "src/my-module.ts"))).toBe(true);
    expect(existsSync(join(TMP_DIR, "src/main.ts"))).toBe(true);

    const moduleContent = readFileSync(
      join(TMP_DIR, "src/my-module.ts"),
      "utf-8",
    );
    expect(moduleContent).toContain("createModule");
    expect(moduleContent).toContain("t.number()");
    expect(moduleContent).toContain("t.string()");
    expect(moduleContent).toContain('export const myModule = createModule("my-module"');
  });

  it("creates auth-flow template files", async () => {
    const { initCommand } = await import("../src/commands/init.js");

    await initCommand([
      "--no-interactive",
      "--template",
      "auth-flow",
      "--dir",
      TMP_DIR,
    ]);

    expect(existsSync(join(TMP_DIR, "src/my-module.ts"))).toBe(true);

    const moduleContent = readFileSync(
      join(TMP_DIR, "src/my-module.ts"),
      "utf-8",
    );
    expect(moduleContent).toContain("constraints");
    expect(moduleContent).toContain("resolvers");
    expect(moduleContent).toContain("LOGIN");
    expect(moduleContent).toContain("retry");
  });

  it("creates ai-orchestrator template files", async () => {
    const { initCommand } = await import("../src/commands/init.js");

    await initCommand([
      "--no-interactive",
      "--template",
      "ai-orchestrator",
      "--dir",
      TMP_DIR,
    ]);

    expect(existsSync(join(TMP_DIR, "src/my-module.ts"))).toBe(true);

    const moduleContent = readFileSync(
      join(TMP_DIR, "src/my-module.ts"),
      "utf-8",
    );
    expect(moduleContent).toContain("@directive-run/ai");
    expect(moduleContent).toContain("createAgentMemory");
    expect(moduleContent).toContain("RUN_AGENT");
  });

  it("skips existing files", async () => {
    const { initCommand } = await import("../src/commands/init.js");

    // Pre-create a file
    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    writeFileSync(join(TMP_DIR, "src/my-module.ts"), "existing content");

    await initCommand(["--no-interactive", "--dir", TMP_DIR]);

    // Should not overwrite
    const content = readFileSync(
      join(TMP_DIR, "src/my-module.ts"),
      "utf-8",
    );
    expect(content).toBe("existing content");
  });
});

// ---------------------------------------------------------------------------
// new module command
// ---------------------------------------------------------------------------

describe("new module command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("generates a full module with all sections", async () => {
    const { newModuleCommand } = await import("../src/commands/new.js");

    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    await newModuleCommand("my-feature", ["--dir", TMP_DIR]);

    const filePath = join(TMP_DIR, "src/my-feature.ts");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("createModule");
    expect(content).toContain("myFeature");
    expect(content).toContain("derive:");
    expect(content).toContain("events:");
    expect(content).toContain("constraints:");
    expect(content).toContain("resolvers:");
    expect(content).toContain("effects:");
  });

  it("generates a minimal module with --minimal", async () => {
    const { newModuleCommand } = await import("../src/commands/new.js");

    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    await newModuleCommand("bare", ["--minimal", "--dir", TMP_DIR]);

    const content = readFileSync(join(TMP_DIR, "src/bare.ts"), "utf-8");
    expect(content).toContain("createModule");
    expect(content).toContain("init:");
    expect(content).not.toContain("derive:");
    expect(content).not.toContain("constraints:");
  });

  it("generates module with specific sections via --with", async () => {
    const { newModuleCommand } = await import("../src/commands/new.js");

    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    await newModuleCommand("partial", [
      "--with",
      "derive,events",
      "--dir",
      TMP_DIR,
    ]);

    const content = readFileSync(join(TMP_DIR, "src/partial.ts"), "utf-8");
    expect(content).toContain("derive:");
    expect(content).toContain("events:");
    expect(content).not.toContain("constraints:");
    expect(content).not.toContain("resolvers:");
    expect(content).not.toContain("effects:");
  });

  it("exits if file already exists", async () => {
    const { newModuleCommand } = await import("../src/commands/new.js");

    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    writeFileSync(join(TMP_DIR, "src/dupe.ts"), "existing");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await newModuleCommand("dupe", ["--dir", TMP_DIR]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("rejects invalid module names", async () => {
    const { newModuleCommand } = await import("../src/commands/new.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await newModuleCommand("InvalidName", ["--dir", TMP_DIR]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// new orchestrator command
// ---------------------------------------------------------------------------

describe("new orchestrator command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("generates an orchestrator file", async () => {
    const { newOrchestratorCommand } = await import("../src/commands/new.js");

    mkdirSync(join(TMP_DIR, "src"), { recursive: true });
    await newOrchestratorCommand("my-agent", ["--dir", TMP_DIR]);

    const filePath = join(TMP_DIR, "src/my-agent.ts");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("@directive-run/ai");
    expect(content).toContain("createAgentOrchestrator");
    expect(content).toContain("createAgentMemory");
    expect(content).toContain("createSlidingWindowStrategy");
    expect(content).toContain("createSystem");
    expect(content).toContain("myAgent");
  });
});

// ---------------------------------------------------------------------------
// doctor command
// ---------------------------------------------------------------------------

describe("doctor command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("runs without errors on an empty directory", async () => {
    const { doctorCommand } = await import("../src/commands/doctor.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await doctorCommand(["--dir", TMP_DIR]);

    // Should exit(1) because no package.json → core not installed
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("passes when project is properly set up", async () => {
    const { doctorCommand } = await import("../src/commands/doctor.js");

    // Create a minimal valid project
    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({
        dependencies: { "@directive-run/core": "^0.1.0" },
      }),
    );
    writeFileSync(
      join(TMP_DIR, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          moduleResolution: "bundler",
        },
      }),
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await doctorCommand(["--dir", TMP_DIR]);

    // Should not exit with error
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("detects missing strict mode", async () => {
    const { doctorCommand } = await import("../src/commands/doctor.js");

    writeFileSync(
      join(TMP_DIR, "package.json"),
      JSON.stringify({
        dependencies: { "@directive-run/core": "^0.1.0" },
      }),
    );
    writeFileSync(
      join(TMP_DIR, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
        },
      }),
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await doctorCommand(["--dir", TMP_DIR]);

    // Should fail because strict is not enabled
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

describe("loadSystem", () => {
  it("throws for non-existent file", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    await expect(
      loadSystem("/nonexistent/path/file.ts"),
    ).rejects.toThrow("File not found");
  });

  it("throws for file without system export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    // Create a temp JS file that doesn't export a system
    const tmpFile = join(TMP_DIR, "no-system.mjs");
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(tmpFile, "export const foo = 42;\n");

    await expect(loadSystem(tmpFile)).rejects.toThrow(
      "No Directive system found",
    );

    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("loads a mock system from default export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    // Create a temp JS file that exports a mock system
    mkdirSync(TMP_DIR, { recursive: true });
    const tmpFile = join(TMP_DIR, "mock-system.mjs");
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

    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("loads a mock system from named export", async () => {
    const { loadSystem } = await import("../src/lib/loader.js");

    mkdirSync(TMP_DIR, { recursive: true });
    const tmpFile = join(TMP_DIR, "named-system.mjs");
    writeFileSync(
      tmpFile,
      `export const system = {
  facts: {},
  inspect: () => ({}),
  start: () => {},
  stop: () => {},
};
`,
    );

    const sys = await loadSystem(tmpFile);
    expect(sys).toBeDefined();
    expect(typeof sys.inspect).toBe("function");

    rmSync(TMP_DIR, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// examples list command
// ---------------------------------------------------------------------------

describe("examples list command", () => {
  it("lists examples without error", async () => {
    const { examplesListCommand } = await import(
      "../src/commands/examples.js"
    );

    // Should not throw
    await examplesListCommand([]);
  });

  it("filters examples by name", async () => {
    const { examplesListCommand } = await import(
      "../src/commands/examples.js"
    );

    // Should not throw
    await examplesListCommand(["--filter", "counter"]);
  });
});

// ---------------------------------------------------------------------------
// examples copy command
// ---------------------------------------------------------------------------

describe("examples copy command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("copies a known example", async () => {
    const { examplesCopyCommand } = await import(
      "../src/commands/examples.js"
    );

    await examplesCopyCommand("counter", ["--dest", TMP_DIR]);

    const filePath = join(TMP_DIR, "counter.ts");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("@directive-run/core");
  });

  it("exits if example not found", async () => {
    const { examplesCopyCommand } = await import(
      "../src/commands/examples.js"
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await examplesCopyCommand("nonexistent-example-xyz", [
      "--dest",
      TMP_DIR,
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("exits if target file already exists", async () => {
    const { examplesCopyCommand } = await import(
      "../src/commands/examples.js"
    );

    writeFileSync(join(TMP_DIR, "counter.ts"), "existing");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await examplesCopyCommand("counter", ["--dest", TMP_DIR]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ai-rules update + check commands
// ---------------------------------------------------------------------------

describe("ai-rules update command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("reports nothing when no rule files exist", async () => {
    const { aiRulesUpdateCommand } = await import(
      "../src/commands/ai-rules.js"
    );

    // Should not throw — just logs "no files found"
    await aiRulesUpdateCommand(["--dir", TMP_DIR]);
  });
});

describe("ai-rules check command", () => {
  beforeEach(setupTmpDir);
  afterEach(cleanupTmpDir);

  it("reports nothing when no rule files exist", async () => {
    const { aiRulesCheckCommand } = await import(
      "../src/commands/ai-rules.js"
    );

    // Should not throw or exit
    await aiRulesCheckCommand(["--dir", TMP_DIR]);
  });

  it("detects stale rules", async () => {
    const { aiRulesCheckCommand } = await import(
      "../src/commands/ai-rules.js"
    );
    const { SECTION_START, SECTION_END } = await import(
      "../src/lib/constants.js"
    );

    // Create a stale rules file
    writeFileSync(
      join(TMP_DIR, ".cursorrules"),
      `${SECTION_START}\nold stale content\n${SECTION_END}`,
    );

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await aiRulesCheckCommand(["--dir", TMP_DIR]);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// inspect command
// ---------------------------------------------------------------------------

describe("inspect command", () => {
  it("throws when given a non-existent file", async () => {
    const { inspectCommand } = await import("../src/commands/inspect.js");

    await expect(
      inspectCommand(["nonexistent-file.ts"]),
    ).rejects.toThrow("File not found");
  });
});

// ---------------------------------------------------------------------------
// explain command
// ---------------------------------------------------------------------------

describe("explain command", () => {
  it("throws when given a non-existent file", async () => {
    const { explainCommand } = await import("../src/commands/explain.js");

    await expect(
      explainCommand(["nonexistent-file.ts"]),
    ).rejects.toThrow("File not found");
  });
});

// ---------------------------------------------------------------------------
// graph command
// ---------------------------------------------------------------------------

describe("graph command", () => {
  it("throws when given a non-existent file", async () => {
    const { graphCommand } = await import("../src/commands/graph.js");

    await expect(
      graphCommand(["nonexistent-file.ts"]),
    ).rejects.toThrow("File not found");
  });
});
