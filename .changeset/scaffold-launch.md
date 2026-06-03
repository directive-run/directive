---
"@directive-run/scaffold": minor
---

`@directive-run/scaffold@0.1.0` — pure source-string generators for Directive modules and orchestrators, extracted from `@directive-run/cli`.

Zero runtime dependencies. Pure functions in, source strings out. Consumed by `@directive-run/cli` (its `directive new <name>` command writes the result to disk) and `@directive-run/mcp` (its `generate_module` MCP tool returns the result to the calling AI client without ever touching disk).

Exports: `generateModule(name, sections[])`, `generateOrchestrator(name)`, `validateModuleName(name)`, `suggestFileNames(name, kind)`, `requiredPackages(kind)`, `toCamelCase(name)`, `MODULE_SECTIONS`, `SCAFFOLD_KINDS`, plus `ModuleSection` and `ScaffoldKind` types.

Naming rule centralized: every entry point validates against `/^[a-z][a-z0-9-]{0,63}$/` and throws on invalid input, eliminating the regex-duplication that lived in CLI command files.
