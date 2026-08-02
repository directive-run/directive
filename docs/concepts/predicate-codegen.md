# Predicate codegen – one predicate, three targets

> Compile a `FactPredicate` to SQL, MongoDB, or PostgREST. Same JSON, same
> semantics, three execution sites. The end of dual-write hell.

## The problem

Every full-stack app suffers the same dual-write tax:

```ts
// 1. Write a WHERE clause for the API
const adultsSQL = "SELECT * FROM users WHERE age >= 18 AND status IN ('active', 'pending')";

// 2. Write the same logic in TypeScript for the client filter
const isAdult = (u: User) => u.age >= 18 && ["active", "pending"].includes(u.status);

// 3. Write it again as a Zod refinement for validation
const adultSchema = z.object({ age: z.number().min(18), status: z.enum(["active", "pending"]) });
```

Three places. Three drift surfaces. Three bugs waiting to happen.

## The solution

Directive's `FactPredicate` is a *data form* – a JSON object describing
"what must be true." Because the operator set (`$eq`, `$gte`, `$in`,
`$matches`, `$between`, `$contains`, `$all` / `$any` / `$not`) is a
proper subset of every modern query language, the *same* predicate can
be:

- **evaluated on the client** by the Directive runtime;
- **compiled to parameterized SQL** for a Postgres / MySQL / SQLite driver;
- **compiled to a Mongo query object** for the Node driver;
- **compiled to a PostgREST querystring** for fetch / edge runtimes.

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

// Client
evaluatePredicate(adults, user); // boolean

// Server (Postgres)
predicateToSQL(adults, { table: "users" });
// → {
//     sql: "SELECT * FROM users WHERE (age >= $1 AND status = ANY($2))",
//     where: "(age >= $1 AND status = ANY($2))",
//     params: [18, ["active", "pending"]],
//   }

// Server (MongoDB)
predicateToMongo(adults);
// → { age: { $gte: 18 }, status: { $in: ["active", "pending"] } }

// Edge (PostgREST)
predicateToPostgrest(adults);
// → "age=gte.18&status=in.%28active%2Cpending%29"
```

## `predicateToSQL`

```ts
predicateToSQL(predicate, options): { sql, where, params }
```

| Option         | Type                                    | Default       |
| -------------- | --------------------------------------- | ------------- |
| `table`        | `string`                                | required      |
| `allowedKeys?` | `readonly string[]`                     | none (any)    |
| `select?`      | `"*"` \| `string` \| `readonly string[]` | `"*"`         |
| `placeholder?` | `(i: number) => string`                 | `i => "$"+i`  |

### Returns

- `sql` – the full `SELECT … FROM table WHERE …` statement.
- `where` – just the `WHERE` clause body (no leading `WHERE`).
- `params` – values in `$1`, `$2`, … order, for the driver's parameter array.

### Use `predicateToWhere` for non-SELECT queries

```ts
const { where, params } = predicateToWhere({ age: { $gte: 18 } });

await db.query(
  `UPDATE users SET tier = 'adult' WHERE ${where}`,
  params,
);
```

### Dialect support

Default is Postgres-style `$1`, `$2`. For MySQL / SQLite, pass a
placeholder generator:

```ts
predicateToSQL(adults, { table: "users", placeholder: () => "?" });
```

### Operator mapping

| Predicate                       | SQL                                          |
| ------------------------------- | -------------------------------------------- |
| `{ x: 5 }` (bare value)         | `x = $1`                                     |
| `{ x: { $eq: 5 } }`             | `x = $1`                                     |
| `{ x: { $ne: 5 } }`             | `x <> $1`                                    |
| `{ x: { $gt: 5 } }`             | `x > $1`                                     |
| `{ x: { $gte: 5 } }`            | `x >= $1`                                    |
| `{ x: { $lt: 5 } }`             | `x < $1`                                     |
| `{ x: { $lte: 5 } }`            | `x <= $1`                                    |
| `{ x: { $in: [a, b] } }`        | `x = ANY($1)` (array param)                  |
| `{ x: { $nin: [a, b] } }`       | `NOT (x = ANY($1))`                          |
| `{ x: { $exists: true } }`      | `x IS NOT NULL`                              |
| `{ x: { $exists: false } }`     | `x IS NULL`                                  |
| `{ x: { $between: [a, b] } }`   | `x BETWEEN $1 AND $2`                        |
| `{ x: { $startsWith: "p" } }`   | `x LIKE $1 \|\| '%' ESCAPE '\\'` (escaped)   |
| `{ x: { $endsWith: "s" } }`     | `x LIKE '%' \|\| $1 ESCAPE '\\'`             |
| `{ x: { $contains: "p" } }`     | `x LIKE '%' \|\| $1 \|\| '%' ESCAPE '\\'`    |
| `{ x: { $matches: /re/ } }`     | `x ~ $1` (or `~*` for `/i`)                  |
| `{ $all: [...] }`               | `(a AND b AND …)`                            |
| `{ $any: [...] }`               | `(a OR b OR …)`                              |
| `{ $not: {...} }`               | `NOT (…)`                                    |

## `predicateToMongo`

```ts
predicateToMongo(predicate, options?): Record<string, unknown>
```

| Option              | Type                | Default |
| ------------------- | ------------------- | ------- |
| `allowedKeys?`      | `readonly string[]` | none    |
| `allowDottedPaths?` | `boolean`           | `false` |

Field names beginning with `$` are **rejected** – that's the injection
vector for `$where` JavaScript-evaluation. Dotted field names (sub-document
paths like `"user.role"`) are rejected by default; opt in with
`allowDottedPaths: true` when you genuinely need them.

| Predicate                       | Mongo                                        |
| ------------------------------- | -------------------------------------------- |
| `{ x: { $between: [a, b] } }`   | `{ x: { $gte: a, $lte: b } }`                |
| `{ x: { $startsWith: "p" } }`   | `{ x: { $regex: "^p" } }` (regex-escaped)    |
| `{ x: { $endsWith: "s" } }`     | `{ x: { $regex: "s$" } }`                    |
| `{ x: { $contains: "p" } }`     | `{ x: { $regex: "p" } }`                     |
| `{ x: { $matches: /re/i } }`    | `{ x: { $regex: "re", $options: "i" } }`     |
| `{ $all: [...] }`               | `{ $and: [...] }`                            |
| `{ $any: [...] }`               | `{ $or: [...] }`                             |
| `{ $not: {...} }`               | `{ $nor: [{...}] }`                          |

The result is plain JSON – no BSON, no driver-specific types – so it
survives `JSON.stringify` round-trips and can be sent over the wire.

## `predicateToPostgrest`

```ts
predicateToPostgrest(predicate, options?): string
```

| Option         | Type                          | Default          |
| -------------- | ----------------------------- | ---------------- |
| `allowedKeys?` | `readonly string[]`           | none             |
| `mode?`        | `"querystring"` \| `"raw"`    | `"querystring"`  |

Returns a [PostgREST](https://postgrest.org/) querystring (no leading `?`).
`querystring` mode URL-encodes reserved characters; `raw` mode leaves them
readable for logging / debugging.

```ts
predicateToPostgrest({ age: { $gte: 18 } }, { mode: "raw" });
// → "age=gte.18"

predicateToPostgrest({ $any: [{ tier: "gold" }, { score: { $gte: 100 } }] }, { mode: "raw" });
// → "or=(tier.eq.gold,score.gte.100)"
```

## Safety guarantees

### SQL injection by construction

Every operand flows through the `params` array – *never* the SQL string.
The only thing interpolated literally into the SQL is the table name and
the column names, both regex-validated against
`[A-Za-z_][A-Za-z0-9_]*` (optionally dotted for qualified names).

```ts
// SAFE – even with a malicious-looking value:
predicateToSQL(
  { name: "Robert'); DROP TABLE Students;--" },
  { table: "users" },
);
// → { sql: "SELECT * FROM users WHERE name = $1",
//     params: ["Robert'); DROP TABLE Students;--"] }
```

The pgolfer's classic ["Bobby Tables"](https://xkcd.com/327/) attack
becomes a literal string parameter. The database sees one bound
parameter – never SQL.

### Mongo `$where` injection blocked

`predicateToMongo` rejects any field name beginning with `$`. This is
the only way an attacker-controlled predicate could land a top-level
`$where` (which evaluates server-side JavaScript) – closed by
construction:

```ts
predicateToMongo({ $where: "function(){return true}" });
// → throws: field name "$where" starts with "$" – reserved for Mongo operators
```

### Combinator-and-sibling-key rejection

A predicate like `{ $all: [aiPredicate], tenant_id: "abc" }` would
silently drop the `tenant_id` clause if combinators and sibling keys were
both honored – a real cross-tenant data leak waiting to happen. All
three codegens **throw** when a combinator coexists with sibling keys:

```ts
predicateToSQL(
  { $all: [aiPredicate], tenant_id: req.user.tenant_id },
  { table: "rows" },
);
// → throws: $all cannot coexist with sibling keys (tenant_id) – wrap them in $all together
```

The fix is to nest: `{ $all: [aiPredicate, { tenant_id: req.user.tenant_id }] }`.

### Depth limit

All three codegens enforce a 64-level recursion limit, the same as
`evaluatePredicate`. Catches cyclic spec objects and DoS attacks via
absurdly nested combinators.

### `allowedKeys` allowlists

For predicates that come from untrusted sources (AI agents, public APIs,
user-built rule editors), pass an `allowedKeys` list. Any predicate
key not in the list throws *before* the SQL is built:

```ts
predicateToSQL(
  aiGeneratedPredicate,
  {
    table: "users",
    allowedKeys: ["age", "status", "tier"], // SSN/email NOT in list
  },
);
// → throws if the AI emitted `{ ssn: { $eq: "..." } }`
```

### LIKE wildcard escaping (SQL)

`%`, `_`, and `\` inside `$startsWith` / `$endsWith` / `$contains`
operands are automatically escaped. The generated `LIKE` clauses carry
an explicit `ESCAPE '\'` so the escape character behaves identically
across `standard_conforming_strings` settings and MySQL's
`NO_BACKSLASH_ESCAPES` mode.

### `select` projection validation

`select` accepts `"*"`, a single column identifier, or an array of
column identifiers. Free-form SQL is rejected – build the wrapper SQL
yourself with `predicateToWhere` for COUNT, JOIN, or other constructs:

```ts
predicateToSQL({ x: 1 }, { table: "u", select: "*, password FROM admin --" });
// → throws: invalid column identifier
```

### Effects-only operators are rejected

`$changed` requires a `prev` snapshot – meaningful in the Directive
runtime, meaningless on a SQL row. All three codegens throw
`[Directive] predicateTo*: $changed is an effects-only operator` rather
than silently producing wrong queries.

## Real-world patterns

### Same filter on client and server

```ts
// shared/filters.ts
export const activeAdults = {
  age: { $gte: 18 },
  status: { $eq: "active" },
} as const;

// client/UserList.tsx
import { evaluatePredicate } from "@directive-run/core";
import { activeAdults } from "@/shared/filters";

const visible = users.filter((u) => evaluatePredicate(activeAdults, u));

// server/api/users.ts
import { predicateToSQL } from "@directive-run/core";
import { activeAdults } from "@/shared/filters";

const { sql, params } = predicateToSQL(activeAdults, { table: "users" });
const rows = await pg.query(sql, params);
```

### AI-generated query, safely

Pair this with `predicateFromIntent` – an LLM emits a `FactPredicate` (JSON, validated
by the type system before it ever reaches a database) – and pass it
through `predicateToSQL` with an `allowedKeys` list. Three layers of
defense:

1. The predicate type system rejects unknown fact keys at parse time.
2. The codegen rejects keys not in the allowlist at compile time.
3. Combinator-and-sibling-key rejection blocks the "AI ANDs my tenant
   check" silent-drop attack.

No string concatenation. No `eval`. No prompt-injected `DROP TABLE`.

### Edge runtimes

PostgREST sits in front of Postgres; Supabase exposes it directly. The
`predicateToPostgrest` output drops straight into `fetch`:

```ts
const qs = predicateToPostgrest(predicate, { allowedKeys });
const res = await fetch(`${SUPABASE_URL}/rest/v1/users?${qs}`, {
  headers: { apikey: KEY },
});
```

Zero cold-start, no Node runtime, no driver – the predicate compiles to
a querystring in microseconds at the edge.

## Limitations

- **Single table per call.** No JOINs. A predicate describes a row
  predicate; joins describe relationships and need a separate API.
- **`$between` is decomposed** to `$gte` + `$lte` in Mongo and PostgREST
  (`age=gte.18&age=lte.65`) for portability.
- **Mongo `$contains` is string-only.** For array element-membership use
  `$elemMatch` or `$in` directly.
- **`$matches` flag semantics differ** between JS, Postgres, and Mongo –
  the `i` flag is portable; multiline / dotall flags are not.
- **RegExp operands reach the server.** Catastrophic-backtracking
  patterns (`/(a+)+/`, `/(.+)*/`) will burn database CPU. Treat
  `$matches` operands from untrusted sources with caution.

## Reference

- API: `predicateToSQL`, `predicateToWhere`, `predicateToMongo`, `predicateToPostgrest`
- Types: `PredicateToSqlOptions`, `PredicateToSqlResult`, `PredicateToMongoOptions`, `PredicateToPostgrestOptions`
- Source: `packages/core/src/core/predicate-to-{sql,mongo,pgrest}.ts`
- Related: [Data-form definitions](./data-triggers.md), [Rules diff](./rules-diff.md)
