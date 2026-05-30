---
"@directive-run/el": minor
---

Export the shared XSS prop blocklist so the two render paths can't drift.

`el()` and the JSX runtime both refuse to write `innerHTML`, `outerHTML`,
and `srcdoc` via `Object.assign`. Both used to keep their own copy of
that list, which left room for one path to grow a new sink without the
other knowing. The blocklist now lives once as `XSS_BLOCKED_PROPS` in
`@directive-run/el`, with `el()` and the JSX runtime both reading from
that single export.

Also adds an `SSR` section to the README clarifying that `@directive-run/el`
is browser-only (it calls `document.createElement` directly) and pointing
SSR-needing apps at the framework adapters.
