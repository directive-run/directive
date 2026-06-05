---
"@directive-run/mcp": patch
---

Fix `@directive-run/mcp@0.3.0` crashing Claude Desktop on first handshake with `SyntaxError: Named export 'compressToEncodedURIComponent' not found. The requested module 'lz-string' is a CommonJS module`.

`lz-string@1.5.0` ships CJS-only, but tsup's default externalization preserved the named-import shape in the ESM build, which Node's ESM loader rejects when the underlying module has no named exports. `lz-string` is now bundled inline (`noExternal` in `tsup.config.ts`) — adds ~6 KB minified, removes the CJS↔ESM interop trap entirely. Added a `dist-smoke.test.ts` regression suite that loads the built artifacts through Node's real ESM loader so this class of bug can't reach npm again.

No API or behavior changes — `playground_link` works the same as the broken 0.3.0 release was supposed to.
