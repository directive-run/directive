import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");
const PLUGIN_JSON = join(PKG_ROOT, ".claude-plugin", "plugin.json");

function getSkillDirs(): string[] {
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    return {};
  }

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      fm[key] = value;
    }
  }

  return fm;
}

describe("plugin structure", () => {
  it("plugin.json exists and is valid", () => {
    expect(existsSync(PLUGIN_JSON)).toBe(true);
    const content = JSON.parse(readFileSync(PLUGIN_JSON, "utf-8"));
    expect(content.name).toBe("directive");
    expect(content.description).toBeTruthy();
    expect(content.skills_dir).toBeTruthy();
  });

  it("has at least 9 skill directories", () => {
    const skills = getSkillDirs();
    expect(skills.length).toBeGreaterThanOrEqual(9);
  });

  describe("each skill has valid SKILL.md", () => {
    const skills = getSkillDirs();

    for (const skill of skills) {
      describe(skill, () => {
        const skillMdPath = join(SKILLS_DIR, skill, "SKILL.md");

        it("has SKILL.md", () => {
          expect(existsSync(skillMdPath)).toBe(true);
        });

        it("has valid YAML frontmatter", () => {
          const content = readFileSync(skillMdPath, "utf-8");
          const fm = parseFrontmatter(content);
          expect(fm.name, `${skill} missing name in frontmatter`).toBeTruthy();
          expect(fm.description, `${skill} missing description in frontmatter`).toBeTruthy();
        });

        it("name matches directory", () => {
          const content = readFileSync(skillMdPath, "utf-8");
          const fm = parseFrontmatter(content);
          expect(fm.name).toBe(skill);
        });

        it("name uses gerund form", () => {
          // All skill names should start with a gerund (ends in -ing)
          const firstWord = skill.split("-")[0];
          expect(
            firstWord?.endsWith("ing"),
            `${skill}: first word "${firstWord}" should be gerund (ending in -ing)`,
          ).toBe(true);
        });

        it("description is under 1024 characters", () => {
          const content = readFileSync(skillMdPath, "utf-8");
          const fm = parseFrontmatter(content);
          expect(
            fm.description!.length,
            `${skill} description is ${fm.description!.length} chars (max 1024)`,
          ).toBeLessThanOrEqual(1024);
        });

        it("SKILL.md is under 500 lines", () => {
          const content = readFileSync(skillMdPath, "utf-8");
          const lineCount = content.split("\n").length;
          expect(
            lineCount,
            `${skill}/SKILL.md is ${lineCount} lines (max 500)`,
          ).toBeLessThanOrEqual(500);
        });
      });
    }
  });
});
