/**
 * Generate Cursor rules (<10KB).
 * Handcrafted condensed content — core patterns, top 10 anti-patterns, naming, 1 mini example.
 */
export function generateCursorRules(): string {
  return `# Directive — AI Coding Rules

> Constraint-driven runtime for TypeScript. \`npm install @directive-run/core\`
> Full reference: https://directive.run/llms.txt

## Schema Shape (CRITICAL)

\`\`\`typescript
import { createModule, createSystem, t } from "@directive-run/core";

const myModule = createModule("name", {
  schema: {
    facts: { count: t.number(), items: t.array<string>() },
    derivations: { total: "number" },
    events: { increment: "void", addItem: "string" },
    requirements: { FETCH_DATA: { url: "string" } },
  },
  init: (facts) => { facts.count = 0; facts.items = []; },
  derive: {
    total: (facts) => facts.items.length + facts.count,
  },
  events: {
    increment: (facts) => { facts.count += 1; },
    addItem: (facts, item) => { facts.items = [...facts.items, item]; },
  },
  constraints: {
    fetchWhenReady: {
      when: (facts) => facts.count > 0 && facts.items.length === 0,
      require: (facts) => ({ type: "FETCH_DATA", url: "/api/items" }),
    },
  },
  resolvers: {
    fetchData: {
      requirement: "FETCH_DATA",
      resolve: async (req, context) => {
        const data = await fetch(req.url).then(r => r.json());
        context.facts.items = data;
      },
    },
  },
});

const system = createSystem({ module: myModule });
await system.settle();
\`\`\`

## Top 10 Anti-Patterns

| # | WRONG | CORRECT |
|---|-------|---------|
| 1 | \`facts.profile as ResourceState<Profile>\` | Remove cast — schema provides types |
| 2 | \`{ phase: t.string() }\` flat schema | \`schema: { facts: { phase: t.string() } }\` |
| 3 | \`facts.items\` in multi-module | \`facts.self.items\` |
| 4 | \`t.map()\`, \`t.set()\`, \`t.promise()\` | Don't exist. Use \`t.object<Map<K,V>>()\` |
| 5 | \`(req, ctx)\` in resolver | \`(req, context)\` — never abbreviate |
| 6 | \`createModule("n", { phase: t.string() })\` | Must wrap: \`schema: { facts: { ... } }\` |
| 7 | \`system.dispatch('login', {...})\` | \`system.events.login({...})\` |
| 8 | \`facts.items.push(item)\` | \`facts.items = [...facts.items, item]\` |
| 9 | \`useDirective(system)\` | \`useSelector(system, s => s.facts.count)\` |
| 10 | \`facts['auth::status']\` | \`facts.auth.status\` dot notation |

## Naming

- \`req\` = requirement (not request). Parameter: \`(req, context)\`
- \`derive\` / derivations — never "computed" or "selectors"
- Resolvers return \`void\` — mutate \`context.facts\` instead
- Always use braces for returns: \`if (x) { return y; }\`
- Multi-module: \`facts.self.fieldName\` for own module facts
- Events: \`system.events.eventName(payload)\` — not \`system.dispatch()\`
- Import from main: \`import { createModule } from '@directive-run/core'\`

## Schema Types That Exist

\`t.string<T>()\`, \`t.number()\`, \`t.boolean()\`, \`t.array<T>()\`, \`t.object<T>()\`,
\`t.enum("a","b")\`, \`t.literal(value)\`, \`t.nullable(inner)\`, \`t.optional(inner)\`, \`t.union(...)\`

Chainable: \`.default()\`, \`.validate()\`, \`.transform()\`, \`.brand<>()\`, \`.refine()\`

**DO NOT USE** (hallucinations): \`t.map()\`, \`t.set()\`, \`t.date()\`, \`t.tuple()\`, \`t.record()\`, \`t.promise()\`, \`t.any()\`

## Key Pattern: Constraint → Requirement → Resolver

When the user wants "do X when Y": create THREE things:
1. **Constraint**: \`when: (facts) => Y_condition\` → \`require: { type: "DO_X" }\`
2. **Resolver**: handles "DO_X", calls API, sets \`context.facts\`
3. They are **decoupled**. Constraint declares need, resolver fulfills it.
`;
}
