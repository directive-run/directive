---
"@directive-run/sandbox": patch
---

Resolve the worker entry via a static `new URL("./worker.js", import.meta.url)` reference before falling back to `createRequire().resolve()`. Bundlers (Next.js `outputFileTracing`, esbuild, webpack) follow static URL references at build time and now include `worker.js` in the output bundle automatically — fixing "Cannot find module worker.js" 500s on Vercel, AWS Lambda, and Cloud Run without any consumer-side config. The fallback path preserves Vitest dev-mode resolution where `import.meta.url` points at the `.ts` source.
