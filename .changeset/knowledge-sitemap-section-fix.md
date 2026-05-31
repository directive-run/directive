---
"@directive-run/knowledge": patch
---

Fix `parseNavigation` so the last section of `docsNavigation` no longer
gets misplaced under `aiNavigation` when the parser walks `navigation.ts`.

The parser switches `currentArray` when it sees `export const aiNavigation`
but did not flush the in-progress section into the old array first. The
next title-only line would then push the orphaned section into the wrong
bucket. In the published `sitemap.md`, that meant "Integration Guides"
appeared under `## AI` instead of `## Docs`. The regenerated sitemap now
places it correctly and surfaces the new "Composing all four" entry under
Packages.

Also adds 43 unit tests across the four generator scripts
(`build-skills`, `generate-sitemap`, `generate-api-skeleton`,
`extract-examples`), covering frontmatter parsing, nav walking,
kind-order rendering, DOM-stripping rules, and the `addHeader` formatter.
The pure helpers are now exported and each `main()` is gated on
`import.meta.url === \`file://${process.argv[1]}\`` so tests can import
the helpers without triggering script execution.
