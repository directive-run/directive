# `@directive-run/scaffold`

Pure source-string generators for [Directive](https://directive.run) modules and orchestrators. Zero runtime dependencies. Shared substrate consumed by `@directive-run/cli` (its `directive new <name>` command writes the result to disk) and `@directive-run/mcp` (its `generate_module` MCP tool returns the result to the calling AI client without ever touching disk).

You probably don't depend on this package directly — it's the engine behind the user-facing scaffolding flows. Install it explicitly if you're building tooling that needs to programmatically generate Directive module skeletons.

## API

```typescript
import {
  generateModule,
  generateOrchestrator,
  validateModuleName,
  suggestFileNames,
  requiredPackages,
  toCamelCase,
  MODULE_SECTIONS,
  SCAFFOLD_KINDS,
  type ModuleSection,
  type ScaffoldKind,
} from "@directive-run/scaffold";

// Generate a full Directive module with every section
const source = generateModule("traffic-light");

// Generate a minimal module (schema + init only)
const minimal = generateModule("traffic-light", []);

// Pick which sections to include
const customized = generateModule("traffic-light", ["derive", "constraints", "resolvers"]);

// Generate an AI orchestrator module
const orch = generateOrchestrator("chat-agent");

// Validate a name before generating
const ok = validateModuleName("traffic-light"); // true | string

// Suggested file names
suggestFileNames("traffic-light", "module");
// → { sourceFileName: "traffic-light.ts", testFileName: "traffic-light.test.ts" }

// What the consumer needs to install
requiredPackages("orchestrator");
// → ["@directive-run/core", "@directive-run/ai"]
```

## Naming rule

Module names must match `/^[a-z][a-z0-9-]{0,63}$/` — start with a lowercase letter, contain only lowercase letters, digits, and hyphens, and be 64 characters or fewer. `validateModuleName(name)` returns `true` on success or a human-readable error string. All generator functions assert the same rule and throw `Error` on invalid input — important because the generated source embeds the name as a JavaScript identifier and a string literal.

## See also

- [`@directive-run/cli`](../cli) — `directive new <name>` writes the generated source to disk.
- [`@directive-run/mcp`](../mcp) — `generate_module` MCP tool returns the generated source to AI clients.
- [`@directive-run/core`](../core) — the runtime the generated modules import from.
