# @directive-run/conformance (private)

The 2.0 oracle. Core's black-box tests, copied unchanged and run against more
than one engine:

| Project | Engine |
| --- | --- |
| `conformance:v1`, `conformance:v1:prod` | the published `@directive-run/core@1.35.0` (npm alias `directive-v1`), development and production builds. The reference. |
| `conformance:local`, `conformance:local:prod` | the workspace's `packages/core` source |
| `conformance:v2` (slot) | core-next, from Phase 1, filtered by `layers.json` |

```bash
pnpm --filter @directive-run/core build   # one test imports the built entry
pnpm conformance                          # check-expects, then every project
pnpm --filter @directive-run/conformance port   # re-copy after core's tests change
```

- `scripts/port.ts` copies every core test whose imports resolve to a public
  entry point, rewriting only module specifiers (plus one declared rewrite for
  a test that locates `dist/`). Re-runnable; regenerates `tests/`,
  `scripts/manifest.json` and `scripts/classification.json`.
- `scripts/check-expects.ts` fails if any assertion, or any other line outside
  the imports, differs from the original, if a core test is newer than the
  last port, or if a port is missing from `layers.json`.
- `layers.json` maps every port to the 2.0 layer (L0–L13) that must pass it.
- `WHITE-BOX.md` lists the tests that are not ported and a proposed fate for
  each, for the Phase 0 gate.

Never published. Do not edit `tests/` by hand.
