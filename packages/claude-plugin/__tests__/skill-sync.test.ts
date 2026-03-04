import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");
const KNOWLEDGE_PKG = join(PKG_ROOT, "..", "knowledge");
const KNOWLEDGE_ROOT = KNOWLEDGE_PKG;
const CORE_DIR = join(KNOWLEDGE_PKG, "core");
const AI_DIR = join(KNOWLEDGE_PKG, "ai");

function getAllKnowledgeFiles(): string[] {
  const files: string[] = [];

  for (const dir of [KNOWLEDGE_ROOT, CORE_DIR, AI_DIR]) {
    try {
      for (const f of readdirSync(dir).filter(
        (f) => f.endsWith(".md") && f !== "README.md",
      )) {
        files.push(f.replace(".md", ""));
      }
    } catch {
      // directory may not exist
    }
  }

  return files;
}

function getSkillDirs(): string[] {
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function getSkillSupportFiles(skillName: string): string[] {
  const skillDir = join(SKILLS_DIR, skillName);

  return readdirSync(skillDir)
    .filter((f) => f.endsWith(".md") && f !== "SKILL.md" && f !== "examples.md")
    .map((f) => f.replace(".md", ""));
}

describe("skill sync", () => {
  it("every knowledge file appears in at least one skill", () => {
    const allKnowledge = getAllKnowledgeFiles();
    const skills = getSkillDirs();

    // Collect all knowledge files referenced across all skills
    const referenced = new Set<string>();
    for (const skill of skills) {
      for (const file of getSkillSupportFiles(skill)) {
        referenced.add(file);
      }
    }

    for (const knowledge of allKnowledge) {
      expect(
        referenced.has(knowledge),
        `Knowledge file "${knowledge}.md" is not included in any skill`,
      ).toBe(true);
    }
  });

  describe("supporting files match source", () => {
    const skills = getSkillDirs();

    for (const skill of skills) {
      const supportFiles = getSkillSupportFiles(skill);

      for (const file of supportFiles) {
        it(`${skill}/${file}.md matches source knowledge`, () => {
          const skillPath = join(SKILLS_DIR, skill, `${file}.md`);
          const skillContent = readFileSync(skillPath, "utf-8");

          // Find the source file (check root, core, then ai)
          const rootPath = join(KNOWLEDGE_ROOT, `${file}.md`);
          const corePath = join(CORE_DIR, `${file}.md`);
          const aiPath = join(AI_DIR, `${file}.md`);
          const sourcePath = existsSync(rootPath)
            ? rootPath
            : existsSync(corePath)
              ? corePath
              : aiPath;

          expect(
            existsSync(sourcePath),
            `Source knowledge file for ${file}.md not found`,
          ).toBe(true);

          const sourceContent = readFileSync(sourcePath, "utf-8");
          expect(
            skillContent,
            `${skill}/${file}.md does not match source`,
          ).toBe(sourceContent);
        });
      }
    }
  });
});
