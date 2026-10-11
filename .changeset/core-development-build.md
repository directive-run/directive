---
"@directive-run/core": minor
---

Browser dev servers now get Directive's development checks.

A browser has no `process`, so the default build's development check read `false` under a dev server such as Vite's: no dev warnings, and no error when an effect wrote a fact. The package now also publishes a build under the `development` export condition with every development check compiled on. Vite 5 and 6 dev servers select it automatically (checked), and so does webpack 5 in `mode: "development"`; with esbuild, pass `--conditions=development`. Production builds still select the `production` build, and Node without a condition still gets the default build, which follows `NODE_ENV`.

The development build ships unminified and without sourcemaps, so it reads directly in devtools. The package grows from 1.84 MB to 2.2 MB packed.

A browser with no bundler still runs the default build in production mode. That branch has to stay off: a bundler that only defines `process.env.NODE_ENV` cannot fold `typeof process`, and turning it on would keep every dev check in its production bundles.
