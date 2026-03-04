import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, "..", "examples");
const EXAMPLES_ROOT = join(__dirname, "..", "..", "..", "examples");

function getExtractedExamples(): string[] {
  try {
    return readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(".ts", ""));
  } catch {
    return [];
  }
}

describe("example sync", () => {
  const extractedNames = getExtractedExamples();

  it("has at least 30 extracted examples", () => {
    expect(extractedNames.length).toBeGreaterThanOrEqual(30);
  });

  it("extracted examples are non-empty", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      expect(
        content.length,
        `${name}.ts is empty`,
      ).toBeGreaterThan(100);
    }
  });

  it("extracted examples contain Directive-related code", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      const hasModule = content.includes("createModule");
      const hasSystem = content.includes("createSystem");
      const hasOrchestrator = content.includes("createAgentOrchestrator") ||
        content.includes("createMultiAgentOrchestrator") ||
        content.includes("createCheckersAI");
      const importsDirective = content.includes("@directive-run/");
      const importsLocal = content.includes("import") && content.includes("system");
      expect(
        hasModule || hasSystem || hasOrchestrator || importsDirective || importsLocal,
        `${name}.ts doesn't contain module/system/orchestrator code or directive imports`,
      ).toBe(true);
    }
  });

  it("stripped examples have no document.querySelector references", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes("DOM wiring stripped")) {
        continue; // pure module files may legitimately use browser APIs
      }
      expect(
        content,
        `${name}.ts still contains document.querySelector`,
      ).not.toContain("document.querySelector");
    }
  });

  it("extracted examples have header comments", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      expect(
        content,
        `${name}.ts missing header comment`,
      ).toContain("// Example:");
    }
  });

  it("stripped examples have no innerHTML assignments", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes("DOM wiring stripped")) {
        continue;
      }
      expect(
        content,
        `${name}.ts still contains .innerHTML assignment`,
      ).not.toMatch(/\.innerHTML\s*[+=]/);
    }
  });

  it("stripped examples have no document.getElementById calls", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes("DOM wiring stripped")) {
        continue;
      }
      expect(
        content,
        `${name}.ts still contains document.getElementById`,
      ).not.toMatch(/document\s*\.?\s*getElementById/);
    }
  });

  it("header comment distinguishes pure vs stripped", () => {
    let hasPure = false;
    let hasStripped = false;
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      if (content.includes("Pure module file")) {
        hasPure = true;
      }
      if (content.includes("DOM wiring stripped")) {
        hasStripped = true;
      }
    }
    expect(hasPure, "should have at least one pure example").toBe(true);
    expect(hasStripped, "should have at least one stripped example").toBe(true);
  });

  it("no consecutive triple blank lines", () => {
    for (const name of extractedNames) {
      const filePath = join(EXAMPLES_DIR, `${name}.ts`);
      const content = readFileSync(filePath, "utf-8");
      expect(
        content,
        `${name}.ts has 3+ consecutive blank lines`,
      ).not.toMatch(/\n\n\n\n/);
    }
  });
});
