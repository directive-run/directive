---
"@directive-run/core": minor
---

Core no longer ships sourcemaps, and its default build is no longer minified. The default build is what Node and bundlers without a `development`/`production` setting load, so a stack trace through it now reads directly, with real names, instead of needing a map. App bundles are unchanged: bundlers minify the default build themselves, and production builds use the separate minified `production` build. The package drops from 6.1 MB to 4.7 MB unpacked (1.66 MB to 1.1 MB packed, compared with 1.34.1), despite now carrying three builds.
