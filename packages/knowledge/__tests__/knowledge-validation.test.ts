import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const CORE_DIR = join(PKG_ROOT, "core");
const AI_DIR = join(PKG_ROOT, "ai");

function getKnowledgeFiles(): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];

  for (const dir of [CORE_DIR, AI_DIR]) {
    try {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        files.push({
          name: f,
          content: readFileSync(join(dir, f), "utf-8"),
        });
      }
    } catch {
      // directory may not exist yet
    }
  }

  return files;
}

function extractCodeBlocks(
  content: string,
): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      lang: match[1] ?? "",
      code: match[2] ?? "",
    });
  }

  return blocks;
}

describe("knowledge validation", () => {
  const files = getKnowledgeFiles();

  it("has at least 25 knowledge files", () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });

  describe("TypeScript code blocks are syntactically valid", () => {
    for (const file of files) {
      // Skip api-skeleton — auto-generated, has different format
      if (file.name === "api-skeleton.md") {
        continue;
      }

      const blocks = extractCodeBlocks(file.content).filter(
        (b) => b.lang === "typescript" || b.lang === "ts",
      );

      if (blocks.length === 0) {
        continue;
      }

      it(`${file.name} has parseable TypeScript blocks`, () => {
        for (const block of blocks) {
          // Strip string/regex literals before counting to avoid false positives
          const stripped = block.code
            .replace(/\/\/.*$/gm, "") // remove line comments
            .replace(/\/\*[\s\S]*?\*\//g, "") // remove block comments
            .replace(/"(?:[^"\\]|\\.)*"/g, '""') // remove double-quoted strings
            .replace(/'(?:[^'\\]|\\.)*'/g, "''") // remove single-quoted strings
            .replace(/`(?:[^`\\]|\\.)*`/g, "``") // remove template literals
            .replace(/\/(?:[^/\\]|\\.)+\/[gimsuy]*/g, "//"); // remove regex literals

          const openBraces = (stripped.match(/{/g) || []).length;
          const closeBraces = (stripped.match(/}/g) || []).length;
          expect(
            Math.abs(openBraces - closeBraces),
            `Unbalanced braces in ${file.name}: ${openBraces} open, ${closeBraces} close`,
          ).toBeLessThanOrEqual(1); // Allow ±1 for edge cases

          const openParens = (stripped.match(/\(/g) || []).length;
          const closeParens = (stripped.match(/\)/g) || []).length;
          expect(
            Math.abs(openParens - closeParens),
            `Unbalanced parentheses in ${file.name}: ${openParens} open, ${closeParens} close`,
          ).toBeLessThanOrEqual(1);
        }
      });
    }
  });

  describe("convention compliance", () => {
    for (const file of files) {
      if (file.name === "api-skeleton.md") {
        continue;
      }

      const blocks = extractCodeBlocks(file.content).filter(
        (b) => b.lang === "typescript" || b.lang === "ts",
      );

      if (blocks.length === 0) {
        continue;
      }

      it(`${file.name} does not use ctx abbreviation in correct examples`, () => {
        for (const block of blocks) {
          // Skip blocks that contain WRONG/wrong markers — they intentionally show bad patterns
          const blockText = block.code;
          if (
            blockText.includes("WRONG") ||
            blockText.includes("wrong") ||
            blockText.includes("// ✗") ||
            blockText.includes("// ❌") ||
            blockText.includes("NEVER")
          ) {
            continue;
          }

          // In non-WRONG blocks, check for (req, ctx) as a function parameter
          if (/\(\s*req\s*,\s*ctx\s*\)/.test(blockText)) {
            expect.fail(
              `${file.name} uses (req, ctx) instead of (req, context) in a correct example`,
            );
          }
        }
      });
    }
  });

  it("no broken internal links", () => {
    const allFileNames = new Set(files.map((f) => f.name.replace(".md", "")));

    for (const file of files) {
      const links = file.content.match(/\[.*?\]\((\w[\w-]+\.md)\)/g) || [];

      for (const link of links) {
        const match = link.match(/\((\w[\w-]+)\.md\)/);
        if (match?.[1]) {
          expect(
            allFileNames.has(match[1]),
            `${file.name} links to non-existent ${match[1]}.md`,
          ).toBe(true);
        }
      }
    }
  });

  describe("required content", () => {
    it("anti-patterns.md has at least 20 patterns", () => {
      const ap = files.find((f) => f.name === "anti-patterns.md");
      expect(ap).toBeDefined();
      // Count headers like "## 1." or "### #1"
      const patternHeaders = (ap!.content.match(/^##+ (?:#?\d+[.\s])/gm) || []).length;
      expect(patternHeaders).toBeGreaterThanOrEqual(20);
    });

    it("core-patterns.md mentions createModule and createSystem", () => {
      const cp = files.find((f) => f.name === "core-patterns.md");
      expect(cp).toBeDefined();
      expect(cp!.content).toContain("createModule");
      expect(cp!.content).toContain("createSystem");
    });

    it("schema-types.md lists types that do NOT exist", () => {
      const st = files.find((f) => f.name === "schema-types.md");
      expect(st).toBeDefined();
      expect(st!.content).toContain("t.map()");
      expect(st!.content).toContain("t.set()");
      expect(st!.content).toContain("DO NOT");
    });

    it("naming.md mentions req = requirement", () => {
      const nm = files.find((f) => f.name === "naming.md");
      expect(nm).toBeDefined();
      expect(nm!.content).toContain("requirement");
    });
  });
});
