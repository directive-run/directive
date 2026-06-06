import { describe, expect, it } from "vitest";
import {
  MODULE_SECTIONS,
  type ModuleSection,
  SCAFFOLD_KINDS,
  generateModule,
  generateOrchestrator,
  requiredPackages,
  suggestFileNames,
  toCamelCase,
  validateModuleName,
} from "../src/index.js";

describe("validateModuleName", () => {
  it.each([
    ["traffic-light", true],
    ["a", true],
    ["x1", true],
    ["my-module-name", true],
    ["traffic_light", "must start with a lowercase letter"],
    ["TrafficLight", "must start with a lowercase letter"],
    ["1traffic", "must start with a lowercase letter"],
    ["traffic light", "must start with a lowercase letter"],
    ["../etc/passwd", "must start with a lowercase letter"],
    ["", "non-empty"],
  ])("validates %s as expected", (name, expected) => {
    const result = validateModuleName(name);
    if (expected === true) {
      expect(result).toBe(true);
    } else {
      expect(result).toMatch(expected as string);
    }
  });

  it("rejects names longer than 64 characters", () => {
    const longName = "a".repeat(65);
    expect(validateModuleName(longName)).toMatch(/64/);
  });

  it("accepts names exactly 64 characters", () => {
    const name = `a${"b".repeat(63)}`;
    expect(validateModuleName(name)).toBe(true);
  });

  it("does not throw on non-string input", () => {
    // @ts-expect-error — intentional bad input
    expect(validateModuleName(null)).toMatch(/non-empty/);
    // @ts-expect-error — intentional bad input
    expect(validateModuleName(123)).toMatch(/non-empty/);
  });
});

describe("toCamelCase", () => {
  it.each([
    ["traffic-light", "trafficLight"],
    ["one-two-three", "oneTwoThree"],
    ["single", "single"],
    ["a-b-c", "aBC"],
  ])("converts %s → %s", (kebab, expected) => {
    expect(toCamelCase(kebab)).toBe(expected);
  });
});

describe("suggestFileNames", () => {
  it("derives source + test filenames from a valid name", () => {
    expect(suggestFileNames("traffic-light", "module")).toEqual({
      sourceFileName: "traffic-light.ts",
      testFileName: "traffic-light.test.ts",
    });
  });

  it("throws on invalid names", () => {
    expect(() => suggestFileNames("../etc/passwd", "module")).toThrow();
  });
});

describe("requiredPackages", () => {
  it("module needs core only", () => {
    expect(requiredPackages("module")).toEqual(["@directive-run/core"]);
  });

  it("orchestrator needs core + ai", () => {
    expect(requiredPackages("orchestrator")).toEqual([
      "@directive-run/core",
      "@directive-run/ai",
    ]);
  });
});

describe("MODULE_SECTIONS / SCAFFOLD_KINDS", () => {
  it("MODULE_SECTIONS is frozen and exhaustive", () => {
    expect(MODULE_SECTIONS).toEqual([
      "derive",
      "events",
      "constraints",
      "resolvers",
      "effects",
    ]);
  });

  it("SCAFFOLD_KINDS includes module and orchestrator", () => {
    expect(SCAFFOLD_KINDS).toEqual(["module", "orchestrator"]);
  });
});

describe("generateModule", () => {
  it("throws on invalid names", () => {
    expect(() => generateModule("../etc/passwd")).toThrow();
    expect(() => generateModule("UPPER")).toThrow();
    expect(() => generateModule("")).toThrow();
  });

  it("produces output containing the camelCase export name", () => {
    const { moduleSource } = generateModule("traffic-light");
    expect(moduleSource).toContain("export const trafficLight = createModule(");
    expect(moduleSource).toContain(`"traffic-light"`);
  });

  it("imports from @directive-run/core", () => {
    expect(generateModule("x").moduleSource).toMatch(
      /import \{[^}]*\} from "@directive-run\/core"/,
    );
  });

  it("with all sections, includes every section block", () => {
    const { moduleSource } = generateModule("x", MODULE_SECTIONS);
    expect(moduleSource).toContain("derive:");
    expect(moduleSource).toContain("events:");
    expect(moduleSource).toContain("constraints:");
    expect(moduleSource).toContain("resolvers:");
    expect(moduleSource).toContain("effects:");
  });

  it("with empty sections, includes only schema + init", () => {
    const { moduleSource } = generateModule("x", []);
    expect(moduleSource).toContain("schema");
    expect(moduleSource).toContain("init:");
    expect(moduleSource).not.toContain("derive:");
    expect(moduleSource).not.toContain("events:");
    expect(moduleSource).not.toContain("constraints:");
    expect(moduleSource).not.toContain("resolvers:");
    expect(moduleSource).not.toContain("effects:");
  });

  it.each<ModuleSection>([
    "derive",
    "events",
    "constraints",
    "resolvers",
    "effects",
  ])("includes only the %s section when requested", (section) => {
    const { moduleSource } = generateModule("x", [section]);
    expect(moduleSource).toContain(`${section}:`);
    for (const other of MODULE_SECTIONS) {
      if (other !== section) {
        expect(moduleSource).not.toContain(`\n  ${other}: {`);
      }
    }
  });

  it("constraints alone still emits the requirements block in schema", () => {
    const { moduleSource } = generateModule("x", ["constraints"]);
    expect(moduleSource).toContain("requirements:");
  });

  it("resolvers alone still emits the requirements block in schema", () => {
    const { moduleSource } = generateModule("x", ["resolvers"]);
    expect(moduleSource).toContain("requirements:");
  });

  it("returns a non-null runner driver for plain library output", () => {
    const result = generateModule("counter", ["events"]);
    expect(result.runnable).toBe(false);
    expect(result.runnerSource).not.toBeNull();
    expect(result.runnerSource).toContain('from "@directive-run/core"');
    expect(result.runnerSource).toContain('from "./counter.js"');
    expect(result.runnerSource).toContain("createSystem({ module: counter })");
    expect(result.runnerSource).toContain("system.start()");
    expect(result.runnerSource).toContain("await system.settle()");
  });

  it("suggests conventional filenames for module + runner pair", () => {
    const { suggestedFilenames } = generateModule("traffic-light");
    expect(suggestedFilenames).toEqual({
      module: "traffic-light.ts",
      runner: "main.ts",
    });
  });

  it("emits a dispatch call for every detected event key", () => {
    const { runnerSource } = generateModule("x", ["events"]);
    expect(runnerSource).toContain("system.events.setStatus({})");
  });

  it("emits a no-events comment when the module has no events section", () => {
    const { runnerSource } = generateModule("x", []);
    expect(runnerSource).toContain("No events detected");
    expect(runnerSource).not.toContain("system.events.");
  });
});

describe("generateOrchestrator", () => {
  it("throws on invalid names", () => {
    expect(() => generateOrchestrator("../etc/passwd")).toThrow();
    expect(() => generateOrchestrator("UPPER")).toThrow();
  });

  it("produces the camelCase export name and kebab module id", () => {
    const { moduleSource } = generateOrchestrator("chat-agent");
    expect(moduleSource).toContain("export const chatAgent = createModule(");
    expect(moduleSource).toContain(`"chat-agent"`);
  });

  it("imports from core and ai", () => {
    const { moduleSource } = generateOrchestrator("x");
    expect(moduleSource).toMatch(
      /import \{[^}]*\} from "@directive-run\/core"/,
    );
    expect(moduleSource).toMatch(
      /import \{[\s\S]*?\} from "@directive-run\/ai"/,
    );
  });

  it("includes the AgentStatus type and the RUN_AGENT requirement", () => {
    const { moduleSource } = generateOrchestrator("x");
    expect(moduleSource).toContain("AgentStatus");
    expect(moduleSource).toContain(`"RUN_AGENT"`);
    expect(moduleSource).toContain("requestRun");
    expect(moduleSource).toContain("memory");
  });

  it("returns a non-null runner driver despite the library exporting a system", () => {
    // The orchestrator template includes `export const system = createSystem(...)`
    // but does NOT call `.start()`, so it's still library shape and needs the
    // runner to actually demo behavior.
    const result = generateOrchestrator("chat-agent");
    expect(result.runnable).toBe(false);
    expect(result.runnerSource).not.toBeNull();
    expect(result.runnerSource).toContain('from "./chat-agent.js"');
    expect(result.runnerSource).toContain("system.start()");
  });
});

describe("generateRunner", () => {
  it("returns a no-op comment when the input already calls system.start()", async () => {
    const { generateRunner } = await import("../src/index.js");
    const out = generateRunner(
      "const system = createSystem({}); system.start();",
    );
    expect(out).toContain("already creates its own system");
  });

  it("falls back to generic binding names when regex extraction fails", async () => {
    const { generateRunner } = await import("../src/index.js");
    const out = generateRunner("// no createModule here");
    expect(out).toContain('import { myModule } from "./module.js"');
  });
});
