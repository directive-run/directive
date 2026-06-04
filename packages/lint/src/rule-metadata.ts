/**
 * Hand-maintained metadata mirror of every executable rule. Kept
 * separate from `./rules.ts` because the rule files have value
 * imports from `ts-morph` — having `registry.ts` reach the rule
 * graph statically forces every consumer of `getRules()` to pay
 * the ts-morph load (~25 MB), even read-only ones like the MCP
 * `list_review_rules` tool.
 *
 * The `__tests__/api.test.ts` "metadata array matches executable
 * rules" test verifies these stay in sync with the actual rule
 * implementations in `./rules/*.ts`.
 */

import type { RuleMetadata } from "./types.js";

export const RULE_METADATA: readonly RuleMetadata[] = Object.freeze([
  {
    id: "no-single-line-if-return",
    severity: "warning",
    category: "naming",
    title: "if (cond) return X; without braces",
    explanation:
      "Directive code uses braces on every if-return. Single-line return without braces is a common Directive style violation that hides further logic and bites refactors.",
    badExample: 'if (facts.phase === "ready") return "go";',
    goodExample: 'if (facts.phase === "ready") {\n  return "go";\n}',
    executable: true,
    fixable: true,
  },
  {
    id: "module-missing-facts-schema",
    severity: "error",
    category: "schema",
    title: "Flat schema — missing `facts` wrapper",
    explanation:
      "Every createModule schema must nest facts under `schema.facts`. Top-level keys without the wrapper register no facts at all — the module loads, runs, and silently has nothing to observe, which is the #1 cause of new-module bug reports.",
    badExample: 'createModule("x", {\n  schema: { phase: t.string() },\n});',
    goodExample:
      'createModule("x", {\n  schema: { facts: { phase: t.string() } },\n});',
    executable: true,
    fixable: false,
  },
  {
    id: "resolver-not-async",
    severity: "warning",
    category: "resolver",
    title: "Resolver `resolve` is not async",
    explanation:
      "Directive resolvers are expected to be async functions. A non-async resolver that returns a Promise still works at runtime but loses helpful stack traces and reads as imperative TS instead of Directive style.",
    badExample:
      'resolvers: {\n  fetchUser: {\n    requirement: "FETCH_USER",\n    resolve: (req, ctx) => doWork(req),\n  },\n}',
    goodExample:
      'resolvers: {\n  fetchUser: {\n    requirement: "FETCH_USER",\n    resolve: async (req, ctx) => doWork(req),\n  },\n}',
    executable: true,
    fixable: true,
  },
  {
    id: "derivation-uses-imported-state",
    severity: "warning",
    category: "derivation",
    title: "Derivation reads from outside the facts proxy",
    explanation:
      "Derivations must be pure functions of facts (and optionally derived). Reading module-scoped variables, top-level imports, or process state breaks reactivity — the derivation will silently never re-fire when the outside value changes.",
    badExample:
      "let salesTax = 0.08; // mutable outside\nconst derived = { total: (facts) => facts.subtotal * (1 + salesTax) };",
    goodExample:
      "const SALES_TAX = 0.08; // const literal is fine\nconst derived = { total: (facts) => facts.subtotal * (1 + SALES_TAX) };",
    executable: true,
    fixable: false,
  },
  {
    id: "effect-mutates-facts",
    severity: "error",
    category: "effect",
    title: "Effect mutates facts",
    explanation:
      "Effects are observers, not mutators. Writing to facts inside an effect re-enters the reconciliation cycle and creates infinite loops. Move the mutation into a constraint + resolver or into an event handler.",
    badExample:
      "effects: {\n  bumpCount: {\n    run: (facts) => {\n      facts.count += 1;\n    },\n  },\n}",
    goodExample:
      "events: {\n  bumpCount: (facts) => {\n    facts.count += 1;\n  },\n}",
    executable: true,
    fixable: false,
  },
  {
    id: "useState-alongside-facts",
    severity: "warning",
    category: "react",
    title: "React useState alongside Directive useFact",
    explanation:
      "A React component using both useState and useFact for the same domain is almost always wrong: the local React state and the Directive fact will drift, and the LLM will struggle to reason about which is the source of truth. Pick one — usually useFact.",
    badExample:
      'function Counter() {\n  const count = useFact("count");\n  const [localCount, setLocalCount] = useState(0);\n}',
    goodExample:
      'function Counter() {\n  const count = useFact("count");\n  const { increment } = useEvents();\n}',
    executable: true,
    fixable: false,
  },
  {
    id: "constraint-without-when-or-require",
    severity: "error",
    category: "constraint",
    title: "Constraint missing `when` or `require`",
    explanation:
      "Every constraint needs both `when` (the predicate) and `require` (the requirement to emit). Constraints missing either silently never fire and are the second most common bug in fresh module code.",
    badExample: "constraints: {\n  needsData: { when: (facts) => facts.x },\n}",
    goodExample:
      'constraints: {\n  needsData: {\n    when: (facts) => facts.x,\n    require: { type: "FETCH" },\n  },\n}',
    executable: true,
    fixable: false,
  },
  {
    id: "resolver-naming-mismatch",
    severity: "info",
    category: "resolver",
    title: "Resolver key does not match its requirement (informational)",
    explanation:
      "A common stylistic convention names the resolver key as the camelCase version of the requirement type it handles (e.g. `fetchUser` for `FETCH_USER`). This is informational only — no canonical Directive doc requires it — but matching names make grep + dev-tools navigation faster and reduce 'why isn't my resolver firing?' confusion when there are many requirements. Disable via `ruleFilter` if your project uses semantic keys instead.",
    badExample:
      'resolvers: {\n  processItem: {\n    requirement: "FETCH_USER",\n    resolve: async (req, ctx) => fetchUser(req.id),\n  },\n}',
    goodExample:
      'resolvers: {\n  fetchUser: {\n    requirement: "FETCH_USER",\n    resolve: async (req, ctx) => fetchUser(req.id),\n  },\n}',
    executable: true,
    fixable: false,
  },
  {
    id: "module-name-not-kebab",
    severity: "warning",
    category: "naming",
    title: "Module name is not kebab-case",
    explanation:
      'Directive module names are kebab-case by convention. `createModule("trafficLight", …)` will work at runtime but breaks the namespace-key convention every other Directive surface assumes.',
    badExample: 'createModule("trafficLight", { schema, init });',
    goodExample: 'createModule("traffic-light", { schema, init });',
    executable: true,
    fixable: true,
  },
  {
    id: "imperative-task-in-effect",
    severity: "error",
    category: "effect",
    title: "Imperative timer or listener inside effect",
    explanation:
      "Effects in Directive are reactive responses to fact changes, not imperative schedulers. Calling setInterval / setTimeout / addEventListener inside an effect leaks across reconciliation cycles and is a constraint or resolver in disguise.",
    badExample:
      "effects: {\n  ping: {\n    run: (facts) => {\n      setInterval(() => sendPing(), 1000);\n    },\n  },\n}",
    goodExample:
      '// Model the timing as a fact change:\n// constraints: { tick: { when: (facts) => facts.now > facts.lastPing + 1000, require: { type: "PING" } } }',
    executable: true,
    fixable: false,
  },
]);
