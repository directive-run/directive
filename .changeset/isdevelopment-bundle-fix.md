---
"@directive-run/core": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
---

fix: dev-mode validation runs in consumer production builds (v1.5.0 / v1.6.0)

The published bundles in v1.5.0 and v1.6.0 baked `isDevelopment = true`
as a literal — tsup resolved the `#is-development` package.json import
to `dev-true.ts` (which was `export default true;`) and shipped the
constant into the chunk. Every consumer's production build then ran
dev-mode fact-validation as if `NODE_ENV` were `development`, and a
fact-write that should have been valid threw mid-build:

```
[Directive] Validation failed for "<key>": expected <type>, got null
```

`directive.run` itself hit this — `next build` failed end-to-end on a
clean v1.5.0 doc-site against the `@directive-run/ai` orchestrator's
fact init.

**The fix.** `dev-true.ts` is now a runtime expression that bundlers
inline:

```ts
export default typeof process !== "undefined" &&
  process.env?.NODE_ENV !== "production";
```

- In a bundler (Webpack / Vite / Turbopack / Rollup / esbuild) for a
  consumer production build, the expression folds to literal `false` via
  the bundler's standard `process.env.NODE_ENV = "production"` define —
  dev-mode validation is dropped.
- In a Node.js process, the check evaluates at runtime against the live
  `NODE_ENV`. Setting `NODE_ENV=production` correctly disables dev-mode
  validation; the default and `NODE_ENV=development` keep it on.
- Edge / Workers / web-worker envs where `process` is undefined or
  partially polyfilled are guarded by the `typeof` check and the optional
  chain on `.env`.

Also patched a sibling reference: `warnIfNotStarted` in `system.ts`
read `process.env.NODE_ENV` without the same guard. Now mirrors the
`dev-true.ts` form.

**Required action for consumers on v1.5.0 / v1.6.0:** upgrade. There
is no runtime workaround for the broken published bundle — the literal
`true` was baked into the chunk and is read every time `createSystem`
runs in any environment.

Tested via the doc-site's `next build` against a local link of the
patched packages — clean end-to-end after the change.
