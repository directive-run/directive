---
"@directive-run/core": minor
---

Production builds no longer ship Directive's development-only code.

The package now publishes a second build under the `production` export condition, with every development check compiled to `false`. The dev warnings, the validation that only runs in development, and their message text are gone from it. webpack 5, Vite and Next.js select it automatically in a production build; with esbuild, pass `--conditions=production`. A minimal app drops from 53.2 KB to 44.2 KB gzipped.

Builds that don't set the condition still get the default build, which now writes the development check in a form a bundler can fold: with `process.env.NODE_ENV` defined as `"production"`, most of the dev code drops out there too (53.2 KB to 47.5 KB for the same app). With no bundler, behavior is unchanged: a browser without `process` runs in production mode, and Node follows `NODE_ENV`.

Nothing changes at runtime. The production build behaves exactly as the default build does when `NODE_ENV` is `"production"`.
