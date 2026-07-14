---
"@directive-run/mcp": patch
---

Republishes `@directive-run/mcp` (previous release stopped at 0.6.2 on
npm because the changesets publish step's parallel `prepublishOnly`
hooks raced: `packages/lint`'s `pnpm clean && pnpm build` had wiped
`dist/index.d.ts` right as `packages/mcp`'s tsup dts pass tried to read
it, producing TS7016 "Could not find a declaration file"). Every other
package in that release did publish successfully, so mcp was one minor
behind its peers.

The root-cause fix (in the same release) is to change the shared
`prepublishOnly` script in `packages/lint`, `packages/mcp`, and
`packages/sandbox` from `"pnpm clean && pnpm build"` to `"test -d dist"`.
The release job already runs `pnpm -r --filter './packages/*' build`
before changesets publish, so the CI-built dist is authoritative. The
new `prepublishOnly` verifies the dist exists (fails loud if someone
publishes without building) but never rebuilds concurrently with sibling
packages, so the destructive clean window that broke this release
cannot recur.

Consumer impact: same shape as v0.6.3 (no code change to `@directive-run/mcp`
itself). Upgrade to `0.6.4` to receive the version that actually
reached npm.
