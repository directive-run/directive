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
    const src = generateModule("traffic-light");
    expect(src).toContain("export const trafficLight = createModule(");
    expect(src).toContain(`"traffic-light"`);
  });

  it("imports from @directive-run/core", () => {
    expect(generateModule("x")).toMatch(
      /import \{[^}]*\} from "@directive-run\/core"/,
    );
  });

  it("with all sections, includes every section block", () => {
    const src = generateModule("x", MODULE_SECTIONS);
    expect(src).toContain("derive:");
    expect(src).toContain("events:");
    expect(src).toContain("constraints:");
    expect(src).toContain("resolvers:");
    expect(src).toContain("effects:");
  });

  it("with empty sections, includes only schema + init", () => {
    const src = generateModule("x", []);
    expect(src).toContain("schema");
    expect(src).toContain("init:");
    expect(src).not.toContain("derive:");
    expect(src).not.toContain("events:");
    expect(src).not.toContain("constraints:");
    expect(src).not.toContain("resolvers:");
    expect(src).not.toContain("effects:");
  });

  it.each<ModuleSection>([
    "derive",
    "events",
    "constraints",
    "resolvers",
    "effects",
  ])("includes only the %s section when requested", (section) => {
    const src = generateModule("x", [section]);
    expect(src).toContain(`${section}:`);
    for (const other of MODULE_SECTIONS) {
      if (other !== section) {
        expect(src).not.toContain(`\n  ${other}: {`);
      }
    }
  });

  it("constraints alone still emits the requirements block in schema", () => {
    const src = generateModule("x", ["constraints"]);
    expect(src).toContain("requirements:");
  });

  it("resolvers alone still emits the requirements block in schema", () => {
    const src = generateModule("x", ["resolvers"]);
    expect(src).toContain("requirements:");
  });
});

describe("generateOrchestrator", () => {
  it("throws on invalid names", () => {
    expect(() => generateOrchestrator("../etc/passwd")).toThrow();
    expect(() => generateOrchestrator("UPPER")).toThrow();
  });

  it("produces the camelCase export name and kebab module id", () => {
    const src = generateOrchestrator("chat-agent");
    expect(src).toContain("export const chatAgent = createModule(");
    expect(src).toContain(`"chat-agent"`);
  });

  it("imports from core and ai", () => {
    const src = generateOrchestrator("x");
    expect(src).toMatch(/import \{[^}]*\} from "@directive-run\/core"/);
    expect(src).toMatch(/import \{[\s\S]*?\} from "@directive-run\/ai"/);
  });

  it("includes the AgentStatus type and the RUN_AGENT requirement", () => {
    const src = generateOrchestrator("x");
    expect(src).toContain("AgentStatus");
    expect(src).toContain(`"RUN_AGENT"`);
    expect(src).toContain("requestRun");
    expect(src).toContain("memory");
  });
});
