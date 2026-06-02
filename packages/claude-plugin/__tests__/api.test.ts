import { beforeEach, describe, expect, it } from "vitest";
import {
  type Skill,
  clearCache,
  getAllSkills,
  getSkill,
  getSkillFile,
  listSkills,
} from "../src/index.js";

describe("programmatic API", () => {
  beforeEach(() => {
    clearCache();
  });

  describe("listSkills()", () => {
    it("returns at least 9 skills", () => {
      const skills = listSkills();
      expect(skills.length).toBeGreaterThanOrEqual(9);
    });

    it("returns names in alphabetical order", () => {
      const skills = listSkills();
      const sorted = [...skills].sort();
      expect(skills).toEqual(sorted);
    });

    it("includes the canonical skill names", () => {
      const skills = listSkills();
      expect(skills).toContain("building-ai-orchestrators");
      expect(skills).toContain("building-directive-systems");
      expect(skills).toContain("scaffolding-directive-modules");
    });
  });

  describe("getSkill()", () => {
    it("returns a Skill for a known name", () => {
      const skill = getSkill("building-ai-orchestrators");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("building-ai-orchestrators");
      expect(skill!.manifest).toContain("---");
      expect(skill!.manifest.length).toBeGreaterThan(100);
    });

    it("returns undefined for an unknown skill name", () => {
      expect(getSkill("not-a-real-skill")).toBeUndefined();
    });

    it("populates supporting files map", () => {
      const skill = getSkill("building-ai-orchestrators")!;
      expect(skill.files.size).toBeGreaterThan(0);
      for (const [name, content] of skill.files) {
        expect(name).not.toMatch(/\.md$/);
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it("does not put SKILL.md in the files map", () => {
      const skill = getSkill("building-ai-orchestrators")!;
      expect(skill.files.has("SKILL")).toBe(false);
    });
  });

  describe("getAllSkills()", () => {
    it("returns every listed skill", () => {
      const all = getAllSkills();
      const names = listSkills();
      expect(all.size).toBe(names.length);
      for (const name of names) {
        expect(all.has(name)).toBe(true);
      }
    });

    it("returns a defensive copy", () => {
      const a = getAllSkills();
      a.clear();
      const b = getAllSkills();
      expect(b.size).toBeGreaterThan(0);
    });
  });

  describe("getSkillFile()", () => {
    it("returns content for a known skill + file", () => {
      const skill = getSkill("building-ai-orchestrators")!;
      const firstFileName = Array.from(skill.files.keys())[0];
      expect(firstFileName).toBeDefined();
      const content = getSkillFile("building-ai-orchestrators", firstFileName!);
      expect(content).toBe(skill.files.get(firstFileName!));
    });

    it("returns undefined for unknown skill", () => {
      expect(getSkillFile("not-real", "anything")).toBeUndefined();
    });

    it("returns undefined for unknown file inside a real skill", () => {
      expect(
        getSkillFile("building-ai-orchestrators", "does-not-exist"),
      ).toBeUndefined();
    });
  });

  describe("Skill type", () => {
    it("has the expected shape", () => {
      const skill: Skill | undefined = getSkill("building-ai-orchestrators");
      expect(skill).toBeDefined();
      expect(typeof skill!.name).toBe("string");
      expect(typeof skill!.manifest).toBe("string");
      expect(skill!.files).toBeInstanceOf(Map);
    });
  });
});
