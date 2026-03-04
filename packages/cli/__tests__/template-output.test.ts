import { describe, expect, it } from "vitest";
import { getTemplate, generateLlmsTxt } from "../src/index.js";

describe("template output", () => {
  describe("size limits", () => {
    it("cursor output is under 10KB", () => {
      const content = getTemplate("cursor");
      expect(content.length).toBeLessThan(10 * 1024);
    });

    it("claude output is under 40KB", () => {
      const content = getTemplate("claude");
      expect(content.length).toBeLessThan(40 * 1024);
    });

    it("copilot output is under 15KB", () => {
      const content = getTemplate("copilot");
      expect(content.length).toBeLessThan(15 * 1024);
    });

    it("windsurf output is under 15KB", () => {
      const content = getTemplate("windsurf");
      expect(content.length).toBeLessThan(15 * 1024);
    });

    it("cline output is under 15KB", () => {
      const content = getTemplate("cline");
      expect(content.length).toBeLessThan(15 * 1024);
    });

    it("llms.txt has no practical size limit (but is non-trivial)", () => {
      const content = generateLlmsTxt();
      expect(content.length).toBeGreaterThan(50 * 1024);
    });
  });

  describe("required sections", () => {
    const REQUIRED_SECTIONS_ALL = [
      "createModule",
      "createSystem",
      "schema",
      "t.string",
      "t.number",
      "anti-pattern",
      "facts.self",
      "(req, context)",
    ];

    for (const toolId of [
      "cursor",
      "claude",
      "copilot",
      "windsurf",
      "cline",
    ] as const) {
      it(`${toolId} contains all required sections`, () => {
        const content = getTemplate(toolId).toLowerCase();
        for (const section of REQUIRED_SECTIONS_ALL) {
          expect(content).toContain(section.toLowerCase());
        }
      });
    }

    it("llms.txt contains all required sections", () => {
      const content = generateLlmsTxt().toLowerCase();
      for (const section of REQUIRED_SECTIONS_ALL) {
        expect(content).toContain(section.toLowerCase());
      }
    });
  });

  describe("no template artifacts", () => {
    for (const toolId of [
      "cursor",
      "claude",
      "copilot",
      "windsurf",
      "cline",
    ] as const) {
      it(`${toolId} has no {{ artifacts`, () => {
        const content = getTemplate(toolId);
        expect(content).not.toContain("{{");
        expect(content).not.toContain("}}");
      });

      it(`${toolId} has no template artifact values`, () => {
        const content = getTemplate(toolId);
        // Check for template variable artifacts (not TypeScript "undefined" type)
        expect(content).not.toMatch(/\$\{undefined\}/);
        expect(content).not.toContain("[object Object]");
        expect(content).not.toContain("null\n\n## "); // null in place of content
      });

      it(`${toolId} has no empty sections`, () => {
        const content = getTemplate(toolId);
        // Check for consecutive headings (## Foo\n\n## Bar — means Foo is empty)
        expect(content).not.toMatch(/^## .+\n\n+## /m);
      });
    }
  });

  describe("anti-patterns coverage", () => {
    it("cursor includes top 10 anti-patterns", () => {
      const content = getTemplate("cursor");
      expect(content.toLowerCase()).toContain("flat schema");
      expect(content).toContain("facts.self");
      expect(content).toContain("(req, ctx)");
    });

    it("claude includes all 36 anti-patterns", () => {
      const content = getTemplate("claude");
      // Core anti-patterns (1-20)
      expect(content.toLowerCase()).toContain("flat schema");
      expect(content).toContain("facts.self");
      expect(content).toContain("t.map()");
      expect(content).toContain("crossModuleDeps");
      // AI anti-patterns (21-36)
      expect(content).toContain("factsSchema");
      expect(content).toContain("GuardrailError");
      expect(content).toContain("autoManage");
    });

    it("llms.txt includes all 36 anti-patterns", () => {
      const content = generateLlmsTxt();
      expect(content.toLowerCase()).toContain("flat schema");
      expect(content).toContain("GuardrailError");
    });
  });

  describe("naming conventions present", () => {
    for (const toolId of ["cursor", "claude", "copilot"] as const) {
      it(`${toolId} mentions req = requirement`, () => {
        const content = getTemplate(toolId);
        expect(content).toContain("req");
        expect(content).toContain("requirement");
      });

      it(`${toolId} mentions context not ctx`, () => {
        const content = getTemplate(toolId);
        expect(content).toContain("context");
        // Check it warns against ctx
        expect(content).toContain("ctx");
      });
    }
  });
});
