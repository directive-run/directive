---
"@directive-run/knowledge": minor
---

Knowledge data APIs — structured anti-pattern, migration, and composition data shipping in the published tarball.

**New JSON assets:**

- `compositions.json` — 42-edge graph covering every `@directive-run/*` package with one-line reasons. Powers `@directive-run/mcp`'s `get_composable_packages` tool.
- `migration.json` — structured concept maps + step lists + before/after exemplars for migrating to Directive from Redux, Zustand, XState, MobX, Jotai, Recoil. Powers `get_migration_pattern`.

**New parsers + exports:**

- `getAntiPatterns()` / `getAntiPatternById(id)` — structured parse of `core/anti-patterns.md`. Returns `{ id, severity, category, title, badExample, goodExample, explanation }`.
- `getCompositions()` / `getCompositionsFor(pkg)` / `getReverseCompositionsFor(pkg)` — flat list, outgoing edges, incoming edges.
- `getMigrationSources()` / `getMigrationPattern(source)` / `getMigrationPatterns()` plus the `MIGRATION_SOURCES` constant.

All loaders are lazy + cached + return frozen arrays. `clearXxxCache()` helpers for tests / watch mode. Data files ship in the tarball via the `files` array.
