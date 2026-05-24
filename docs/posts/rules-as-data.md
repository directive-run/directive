# Rules-as-Data: How Directive Got Six Tools From One Decision

*Posted 2026-05-24 · ~12 min read*

We shipped six tools to Directive in the last quarter. A devtools panel that renders why a constraint didn't fire, clause by clause. A function that backtests a proposed rule change against last month's recorded fact-state history. A grid-search optimizer that finds the best threshold for a predicate template. A structural diff that tells your auditor what changed between Q2 and Q3 business rules. A codegen pass that compiles the same predicate to SQL, MongoDB, and PostgREST. And the predicate type itself.

We didn't plan six tools. We made one decision early on and the six fell out of it. This is the post about that decision.

## The category problem

Every state library you've ever used has the same hole. It can run your rules. It cannot read them.

In XState, a guard is a function: `cond: (ctx) => ctx.balance >= 100`. Run it: you get a boolean. Inspect it: you get a `[function: cond]`. Diff two versions of it: you get a text diff of source code. Compile it to a SQL `WHERE`: you can't.

In Redux, a selector is a function. Same story.

In Zustand, a derived value is a closure. Same story.

In MobX, a `@computed` is a memoized function. Same story.

None of these are wrong. Functions are the right primitive for most state — they're flexible, they're fast, they're how programmers think. But the moment you want to do *anything* to a rule that isn't "run it," you fall off a cliff.

We hit that cliff three times in eighteen months at Sizls:

1. **An auditor asked what changed in our checkout rules between two quarterly releases.** We screenshotted `if`/`else` statements into a spreadsheet, lied a little about how current it was, and shipped. The auditor accepted it. The spreadsheet was wrong.

2. **A product manager asked us to A/B a 30-second elapsed-time threshold against 45 seconds.** We dropped a feature flag, waited a week, then realized we were measuring "did anyone notice" instead of "what would last month's traffic have done?" The answer to the second question was sitting in the analytics warehouse the whole time. We never used it.

3. **The same row-filter logic lived in three places: a Postgres `WHERE`, a React `filter()` for the client, and a Zod refinement for validation.** Two of them drifted from each other for nine weeks before anyone noticed.

These three failures share a shape. *The rule was a function.* Functions can be called. They cannot be inspected, diffed, replayed, optimized, compiled, or migrated. The cost of that limit shows up as auditor spreadsheets, gut-feel A/B tests, and triple-maintained filters.

We could have built around each one separately. A custom diff tool for compliance, a custom backtest harness for the PM, a custom shared-types package for the filter logic. Each one would have been a project. Each one would have rotted.

Instead, we asked a different question.

## The decision

What if the rule was data?

Not "the rule has data attached to it." Not "the rule can be serialized." The rule *is* a JSON object. Operators are strings, operands are JSON literals, combinators are arrays. No closures. No source-code parsing. No reflection. A tree of nouns and verbs that any program — including programs that don't know about Directive — can walk.

A normal constraint looks like this in Directive:

```ts
const adultUsers = createModule("adults", {
  schema: { ... },
  constraints: {
    canSeeContent: {
      when: { age: { $gte: 18 }, status: { $in: ["active", "pending"] } },
      require: { type: "GRANT_ACCESS" },
    },
  },
});
```

`when:` is a `FactPredicate` — a JSON tree. The operators (`$gte`, `$in`, `$all`, `$any`, `$not`, `$matches`, `$between`, etc.) are a small closed set. The runtime walks the tree once per evaluation, returns a boolean, and that's the constraint check.

If you've never used Mongo or built a query DSL, this looks like over-engineering. You could have just written `(facts) => facts.age >= 18 && ["active", "pending"].includes(facts.status)` and gotten the same boolean. Faster, too — one fewer object allocation per call.

The point isn't the boolean. The point is that *the same JSON* can be passed to any number of other programs.

## What that unlocks

We didn't see all six tools at the start. We saw the first one — the devtools panel that explains why a constraint didn't fire — and that was enough to commit. The others showed up as we kept asking "what else can read a predicate?"

### 1. The explanation

When a constraint fails, the runtime walks every clause. It already knows which one returned false. The data form lets us *report* that walk:

```
▼ Constraints (1)
  ✗ canSeeContent
    ✓ age ≥ 18
    ✗ status ∈ ["active", "pending"]  (actual: "banned")
```

This is the devtools panel ([whenExplain](../concepts/when-explain-panel.md)) we shipped two weeks ago. It's not magic — it's just `evaluatePredicateExplained(spec, facts)` returning a `ClauseResult[]` instead of a `boolean`. The data form makes the walk inspectable for free.

What does this replace? Print debugging. Specifically, the thirty seconds of "wait, was `status` `'banned'` or `'inactive'`? Let me console.log it…" that happens every time a guard doesn't fire. We watched a junior engineer spend an hour on this same loop in XState last year. The panel collapses it to zero.

### 2. The backtest

If a predicate is data, we can apply it to *past* facts, not just present ones. Given a recording of fact-state changes (from `history.snapshots`, from a production event log, from anywhere that emits `{ phase: "red", elapsed: 30, ts: 12345 }`), we can ask: *would this predicate have fired on each frame?*

That's `replayUnder` ([predicate backtest](../concepts/replay-under.md)):

```ts
const report = replayUnder({
  predicate: { cartTotal: { $gte: 50 } }, // proposed new threshold
  baseline:  { cartTotal: { $gte: 100 } }, // current threshold
  frames: lastMonthCheckouts,
});

// → { samples: 4_293_017,
//     before: { trueFrames: 18_402 },
//     after:  { trueFrames: 31_204 },
//     drift:  { newlyTrue: 12_801, newlyFalse: 0 } }
```

Translation: lowering the threshold from $100 to $50 would have triggered 12,801 additional events on last month's traffic. The PM doesn't need a feature flag. They have the answer in milliseconds.

We didn't write a "backtest engine." We wrote a `for` loop over frames and called the predicate's existing evaluator on each one. The data form is what made it cheap — predicates have no closures over module state, so they're portable across time.

### 3. The diff

Auditors want to know what changed between two versions of the rule set. Engineering teams want to know which threshold moved. Both questions are about *structural* differences in the predicate tree, not text diffs in source code.

`diffRules` ([rules diff](../concepts/rules-diff.md)) walks two predicate trees in parallel and emits a structured report:

```
constraint blockCheckout
  changed:
    cartTotal $gte 100 → $gte 50  (relaxed, matches more)
  added:
    region $in ["US", "EU"]
```

"Relaxed" and "tightened" are first-class concepts here. If you drop `$gte 100` to `$gte 50`, that's not just "the literal changed" — it's *more rows match now*, and the diff says so. Auditors get clauses, not lines.

We didn't write a "rule version control system." We wrote a tree walker that knew the algebra of numeric comparisons. Same predicate type, different consumer.

### 4. The parameter sweep

Predicates can be templated:

```ts
const checkout = {
  cartTotal: { $gte: { $hole: "minTotal" } },
  region: { $in: { $hole: "regions" } },
};
```

`$hole` is a placeholder. `sweepUnder` ([parameter sweep](../concepts/tune.md)) does a cartesian sweep over user-supplied values, evaluates each combination against historical frames, and ranks the results by an objective:

```bash
$ directive tune --predicate checkout.json --frames last-month.jsonl \
                 --sweep minTotal:25..200:25 --sweep regions:'["US"],["US","EU"]'
                 --objective 'r.trueFrames'

minTotal=25  regions=["US"]      → 24,892 ████████░░
minTotal=50  regions=["US"]      → 18,402 ██████░░░░
…
minTotal=100 regions=["US","EU"] → 12,300 ████░░░░░░  ← current
```

The PM gets a sparkline. We got a tool. We didn't build a separate "experiments platform" — we recombined the predicate evaluator with the `for` loop from `replayUnder` and added a generator.

### 5. The codegen

The most useful trick, because it solves a problem every full-stack app has: the *same* rule lives in three places. A `WHERE` clause for the API, a `filter()` for the client, a Zod refinement for the validation layer. Three sources of truth, three drift surfaces.

```ts
const adults = {
  age: { $gte: 18 },
  status: { $in: ["active", "pending"] },
};

evaluatePredicate(adults, user);           // client (boolean)
predicateToSQL(adults, { table: "users" }); // server (Postgres SQL)
predicateToMongo(adults);                   // server (Mongo)
predicateToPostgrest(adults);               // edge (querystring)
```

One JSON, three execution sites ([predicate codegen](../concepts/predicate-codegen.md)). The SQL compile is parameterized — operand values flow through the `params` array, never the SQL string, so it's SQL-injection-safe by construction. The Mongo translator rejects `$where` injection by blocking `$`-prefixed field keys. PostgREST is just a URL.

We didn't write an ORM. We wrote a few hundred lines of switch statements that walked the predicate tree and emitted strings.

### 6. The predicate itself

The predicate type is the load-bearing layer under all five tools above. It's also a useful primitive in its own right. You write it once, and the type system catches typos (`$gtee`), wrong operand shapes (`$gt: "red"` on a number fact), and unknown fact keys at compile time. Auto-tracking is built in: the runtime knows which facts a predicate reads and re-evaluates only when those facts change.

That last bit matters more than it sounds. In Redux, you wire `useSelector` and hope you remembered every dep. In XState, you write `guard:` and trust the machine knows when to re-check. In Directive, the predicate's dependencies are *extracted from its structure* — the same walk that evaluates the boolean also records every fact and derivation it touched. No deps array. No memo helper. No closure tracking. The data form is what makes it cheap.

## The recombination

Notice what these six tools share. **They all read the same data structure.** None of them read your source code. None of them require codegen at build time. None of them require a schema migration. The cost of adding a new tool that reads predicates is a `for` loop and a switch statement.

This is the case for choosing data over functions when you can afford the verbosity tax. The verbosity tax is real: `{ age: { $gte: 18 } }` is more characters than `u => u.age >= 18`. The compounding benefit is also real: every new tool you'd ever want costs an afternoon, not a project.

A second observation: none of the six tools were planned in the original design. We shipped the runtime, then the panel, then someone asked "could we backtest this against history?" — and the answer was yes, here it is, three days. Then "could we diff two of these?" — yes, here it is, two days. The architecture had room for the question we didn't know to ask.

That's the thing we'd defend as the *real* product decision. Not "predicates," not "constraints," not any specific tool. The fact that the architecture made future tools cheap.

## The shape of the trade-off

This isn't free. There are four costs we'd flag honestly.

**Verbosity.** `{ age: { $gte: 18 } }` is wordier than `u => u.age >= 18`. For one-off filters in component code, this hurts. We mitigated it with type inference (TypeScript catches every typo), but the keystrokes are real.

**Closed operator set.** We picked 15 operators (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$between`, `$matches`, `$startsWith`, `$endsWith`, `$contains`, `$changed`). If you need an operator that isn't on that list, you either ask us to add it, write a function predicate (which is still allowed everywhere data predicates are), or convince yourself the function form is fine. Most teams reach for function form 5-10% of the time, which is fine — the panel just shows "function-form when (no clause tree)" for those.

**Learning curve.** If you've never seen Mongo's query language, the operator set looks alien. We invested in good error messages (the typed `OperatorObject<V>` union catches `$gtee` and "wrong operand type for this fact" at compile time) and in a comparison page (`docs/comparison`), but you should know going in: this is a new vocabulary.

**Not every state library decision is a constraint.** Predicates fit the "should this rule fire?" question well. They don't fit "what should the next phase be?" or "what should this string display?" as cleanly. Those still need functions. The runtime supports both — data form *or* function form, your call per surface — but we'd recommend you not try to predicate everything.

The trade-off looks like this in practice:

- **Choose data form when:** the rule is a row predicate, will live more than three months, may need to be diffed/explained/translated/replayed, and is worth a longer type for the auditability it gains.
- **Choose function form when:** the rule is local, ephemeral, has complex bespoke logic, or is too dynamic to express in 15 operators.

In our 26,000-line migration from XState last quarter, about 70% of `when:` predicates were data-form by the end. The other 30% were function-form and stayed that way. Both ran on the same runtime; neither got special treatment.

## What this means for "state libraries"

We didn't set out to argue that state libraries should ship six tools. We set out to ship a state library. The tools fell out of one architectural decision — predicates are data — that we made for completely different reasons (we wanted to inspect them).

But here's the broader claim we'd defend: **the existing state-library category is too narrow.** Redux, Zustand, MobX, Jotai, Recoil, XState — they all answer the question "where does the state live and how does it update?" None of them answer the question "what does the state mean, and can other tools read that meaning?"

Compliance teams want to know what your rules say without reading your source code. Product teams want to know what would happen if you changed a threshold. Backend teams want the same rule to run on the server that runs on the client. None of these are "state management" problems in the narrow sense. They're *rule management* problems — and a state library that treats rules as opaque code can't help.

Directive treats rules as data. Once you've made that decision, every consumer of the rule — the runtime, the devtools, the auditor, the PM, the SQL compiler — gets to participate. The runtime evaluates. The devtools explain. The auditor diffs. The PM backtests. The compiler emits SQL. Same JSON.

This isn't a knock on functions. Functions are still the right primitive for *most* state. But for the slice of state that is "rules" — the conditions, the predicates, the guards — data is a strictly better primitive when you can afford the verbosity.

## Where this goes

The six tools we shipped are early. We have a longer list of things that fall out of the same architecture:

- **LLM-emit-predicate**: GPT generates a `FactPredicate`. The type system validates it. The runtime runs it. The SQL compiler compiles it. The data form means there's no string concatenation anywhere in the loop — closing a whole class of "prompt-injected `DROP TABLE`" attacks for AI-generated queries.
- **Audit log query DSL**: The same predicate the constraint uses on the client lets the compliance team query "show me every fact-state change where this rule fired" in the audit log. Same predicate, different consumer.
- **Per-clause attribution**: When a constraint fails, tag the actor who *changed* the fact that broke the predicate. The data form has the path; the audit log has the actor; the join is one `Map` lookup.
- **Time-travel optimization**: A predicate is pure data, so it's hashable. Memoize the evaluation per `(predicate-hash, facts-snapshot-hash)` and a 100-frame `replayUnder` runs in microseconds.

None of these are planned for next month. All of them are an afternoon of code each. That's the dividend.

## Try it

```bash
npm install @directive-run/core
```

The runtime is open source ([github.com/directive-run/directive](https://github.com/directive-run/directive)), the docs are at [directive.run/docs](https://directive.run/docs), and the migration field report from XState is at [directive.run/docs/posts/migrating-55-machines](https://directive.run/docs/posts/migrating-55-machines).

Start with [Choosing Primitives](/docs/choosing-primitives) if you're new to constraint-driven state. Start with [Data-form definitions](/docs/data-triggers) if you want to see the predicate type in detail. Start with [Predicate codegen](/docs/predicate-codegen) if the SQL/Mongo/PostgREST story is what got you here.

If you're holding three implementations of the same rule across your stack, this is the library that's going to feel like it was built for you. It was. By accident, six tools deep.
