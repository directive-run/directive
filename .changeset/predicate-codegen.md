---
"@directive-run/core": minor
---

feat: predicate codegen — one predicate, three targets

Compile a `FactPredicate` to parameterized SQL, a MongoDB query, or a
PostgREST querystring. Same JSON spec, same semantics, three execution
sites — the end of dual-write hell for filter logic.

```ts
import {
  predicateToSQL,
  predicateToMongo,
  predicateToPostgrest,
  evaluatePredicate,
} from "@directive-run/core";

const adults = {
  age: { $gte: 18 },
  status: { $in: ["active", "pending"] },
};

evaluatePredicate(adults, user); // client (boolean)

predicateToSQL(adults, { table: "users" });
// → { sql: "SELECT * FROM users WHERE (age >= $1 AND status = ANY($2))",
//     where: "(age >= $1 AND status = ANY($2))",
//     params: [18, ["active", "pending"]] }

predicateToMongo(adults);
// → { age: { $gte: 18 }, status: { $in: ["active", "pending"] } }

predicateToPostgrest(adults, { mode: "raw" });
// → "age=gte.18&status=in.(active,pending)"
```

**Safe by construction.** Operand values never appear in the SQL string
– they always flow through the `params` array. Table and column
identifiers are validated against a strict regex
(`[A-Za-z_][A-Za-z0-9_]*`). LIKE wildcards (`%`, `_`) in
`$startsWith` / `$endsWith` / `$contains` operands are escaped
automatically with an explicit `ESCAPE '\'` clause for cross-database
determinism. Effects-only operators (`$changed`) are rejected.

**`$where` injection blocked on Mongo.** Field names starting with `$`
are refused — closes the predicate-as-RCE class for AI-generated
queries. Sub-document paths (`"user.role"`) require explicit
`allowDottedPaths: true`.

**Combinator-and-sibling-key rejection.** `{ $all: [aiPredicate],
tenant_id: req.user.id }` throws instead of silently dropping the
tenant check — closes the cross-tenant data-leak attack class. Nest
your conditions inside the combinator instead.

**Depth limit.** All three codegens enforce the same 64-level recursion
ceiling as `evaluatePredicate`, catching cyclic spec objects and DoS
attempts.

**Allowlisted keys** for AI/user-supplied predicates: pass `allowedKeys`
to reject any predicate key that isn't on the list. Three layers of
defense for LLM-emitted queries: type-system parse, allowlist check,
sibling-key rejection.

**Dialect support.** Default is Postgres-style `$1, $2` placeholders;
pass `placeholder: () => "?"` for MySQL/SQLite. `predicateToWhere`
returns just the WHERE clause body for embedding in
UPDATE/DELETE/COUNT/JOIN.

**$between is portable.** Decomposes to `$gte`+`$lte` in Mongo
(`{ age: { $gte: 18, $lte: 65 } }`) and PostgREST
(`age=gte.18&age=lte.65`), so a single predicate works across all three
targets.

What's not in v1 (deferred): JOINs (predicates describe rows, not
relationships), Mongo array-of-objects `$elemMatch`, ReDoS pattern
detection for `$matches` operands. See
`docs/concepts/predicate-codegen.md`.

Compounds with `@directive-run/query`, RFC-0004 data forms, R4.D
LLM-emit-predicate, and edge-runtime predicates (Cloudflare Workers).
