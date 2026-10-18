# Package consolidation for 2.0 (decisions)

Approved decisions (C2 package consolidation, plus the Directive AI plan).
**Nothing moves now.** Every change below happens at the 2.0 beta, together
with a codemod that rewrites imports. No re-export shims are left behind.

## Where things go

| Today | At 2.0 |
| --- | --- |
| `@directive-run/mutator` | `@directive-run/core/mutations` |
| `@directive-run/optimistic` | `@directive-run/core/mutations` |
| `@directive-run/timeline` | `@directive-run/core/testing` |
| `@directive-run/scaffold` | `@directive-run/cli` |
| migration utils | `@directive-run/cli` |
| predicate compilers | `@directive-run/core/predicate` |
| `@directive-run/query`, `el`, `mcp` | stay separate, but join the fixed version group |

Retired packages get one final release with a deprecation notice that points
at the new home. The codemod rewrites imports from the old names.

## From the Directive AI plan (also at 2.0)

- `devtools-ai-bridge` moves to `@directive-run/ai/devtools`.
- `circuit-breaker` becomes its own core import.
- `token-usage` becomes internal (no longer a public export).
- No re-export shims for any of these.

## Check against the repo (2026-10-18)

All packages named above exist in `packages/`: mutator, optimistic, timeline,
scaffold, query, el, mcp. Notes on the rest:

- `devtools-ai-bridge`, `circuit-breaker` and `token-usage` are not packages.
  They are plugin files in `packages/core/src/plugins/`
  (`devtools-ai-bridge.ts`, `circuit-breaker.ts`, `token-usage.ts`).
- "Migration utils" today live in core (`packages/core/src/utils/migration.ts`,
  public as `@directive-run/core/migration`), not in a separate package.
- "Predicate compilers" today are `predicate-to-sql.ts`, `predicate-to-mongo.ts`,
  `predicate-to-pgrest.ts`, `predicate-describe.ts` and `predicate-hash.ts` in
  `packages/core/src/core/`. A `predicate` entry also exists in `@directive-run/ai`.
- The fixed version group in `.changeset/config.json` today holds core, react,
  vue, svelte, solid, lit, ai, cli, knowledge and claude-plugin. `query`, `el`
  and `mcp` are not in it yet.
