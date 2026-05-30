---
"@directive-run/claude-plugin": patch
---

Move per-skill knowledge-file and example mappings into each template's
YAML frontmatter. Adding a knowledge file now means editing the
knowledge package and the matching template; previously a third edit
to a `SKILL_MAP` constant in the build script was also required, which
made it easy for the three sources to drift.

The build script now discovers skills by scanning `templates/*.md` and
reads `knowledgeFiles: [...]` and `examples: [...]` arrays from each
template's frontmatter. The build-only fields are stripped from the
`SKILL.md` that ships in each skill directory, so the published view
Claude reads is unchanged. Generated skill content is byte-identical
to the prior implementation.
