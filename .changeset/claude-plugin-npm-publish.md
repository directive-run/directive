---
"@directive-run/claude-plugin": minor
---

Publish `@directive-run/claude-plugin` to npm alongside the Claude Code plugin marketplace install.

The Claude Code marketplace remains the canonical install for end users (`/plugin install directive@directive-plugins`). The npm install path is for tool authors who need the skill bundles programmatically — custom skill registries, doc pipelines, eval harnesses, and AI orchestrators that route Directive skills through their own layer.

New exports:

- `listSkills(): string[]` — all skill names, alphabetical.
- `getSkill(name): Skill | undefined` — manifest + supporting files for one skill.
- `getAllSkills(): Map<string, Skill>` — every skill, keyed by name.
- `getSkillFile(skillName, fileName): string | undefined` — one supporting file from a skill bundle.
- `clearCache(): void` — reset the in-memory skill cache.
- `Skill` interface: `{ name, manifest, files }`.

The package ships the pre-built `skills/` directory in the npm tarball. The API reads from that directory; no install-time generation. Adds tsup dual-build (ESM + CJS + `.d.ts`).
