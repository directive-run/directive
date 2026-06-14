# `@directive-run/lint`

ts-morph-based static analysis for [Directive](https://directive.run) code. Rule registry + executable checks + autofixes. Consumed by `@directive-run/mcp` (its `review_source` and `fix_code` MCP tools) and by the future `directive doctor lint` CLI subcommand.

You probably don't depend on this package directly – it's the engine behind the agent-facing review tools. Install it explicitly if you're building static-analysis tooling for Directive codebases.

## API

```typescript
import {
  getRules,
  getRuleById,
  runRules,
  applyFix,
  type Finding,
  type RuleMetadata,
  type RunResult,
  type FixResult,
} from "@directive-run/lint";

// Metadata for every known rule, regardless of whether it has an
// executable check. v0.1.0 ships an empty registry; rules land in v0.2.0.
const rules = getRules();

// Lookup by id
const rule = getRuleById("no-single-line-if-return");

// Actually run the executable rules against a source string.
// ts-morph is loaded lazily – throws a structured error if not installed.
const result = await runRules(`
import { createModule } from "@directive-run/core";
export const x = createModule("x", { schema, init: () => {} });
`);

// Apply a mechanical fix for one finding
const fix = await applyFix(sourceString, result.findings[0]);
fix.ok;        // → true
fix.diff;      // → unified diff
fix.fixedSource;
```

## ts-morph is `optionalDependencies`

The package declares `ts-morph` as `optionalDependencies` so the read-only consumers (just listing rule metadata via `getRules`) don't pay the ~25 MB install cost. `runRules` and `applyFix` lazy-import ts-morph and throw with a clear remediation message if it's missing.

```
ts-morph is not installed. @directive-run/lint declares it as an
optionalDependencies. Install it explicitly to enable runRules /
applyFix: `npm install ts-morph`.
```

## Worker entry

For long-running parses, use the `./worker` subpath export with `worker_threads`:

```typescript
import { Worker } from "node:worker_threads";

const worker = new Worker(require.resolve("@directive-run/lint/worker"));
worker.postMessage({ kind: "run", source });
worker.on("message", ({ ok, result, error }) => { /* … */ });

// terminate() after a budget – synchronous ts-morph cannot be aborted
// any other way
setTimeout(() => worker.terminate(), 5000);
```

The MCP server uses this pattern to bound `review_source` parse cost.

## See also

- [`@directive-run/mcp`](../mcp) – exposes `review_source`, `fix_code`, `list_review_rules`, `get_review_rule` MCP tools that wrap this package.
- [`@directive-run/knowledge`](../knowledge) – anti-pattern markdown sources (`packages/knowledge/core/anti-patterns.md`); rule IDs in this package match knowledge's parsed anti-pattern IDs.
- [`@directive-run/core`](../core) – `doctor` namespace for runtime constraint checks (different scope: runtime, not source).
