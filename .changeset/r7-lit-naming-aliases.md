---
"@directive-run/lit": minor
---

Disambiguate two long-standing Lit naming collisions via deprecation aliases. Existing imports keep working.

**`createModule` → `createModuleController`.** `@directive-run/lit`'s `createModule(host, moduleDef, config)` factory previously collided with `@directive-run/core`'s `createModule(id, def)` — importing both into the same scope shadowed whichever landed last in editor auto-import order, and the trap fired silently on the first paired import. The factory is now `createModuleController`. `createModule` remains as a deprecated alias so existing imports still resolve.

**`useHistory` → `getHistory`.** `@directive-run/lit`'s `useHistory(system)` returns a one-shot snapshot. The hooks of the same name in `@directive-run/{react,vue,svelte,solid}` are REACTIVE — they re-fire on every history navigation. Same name, opposite contract. The functional helper is now `getHistory(system)`; reactive history under Lit stays in `HistoryController`. `useHistory` remains as a deprecated alias.

VS Code shows the `@deprecated` strikethrough on both legacy names.
