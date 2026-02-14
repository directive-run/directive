---
title: Migrating to @directive-run Packages
description: Move from the monolithic directive package to scoped @directive-run packages for smaller bundles, selective installs, and independent versioning.
---

Move from the monolithic `directive` package to scoped `@directive-run/*` packages for smaller bundles, selective installs, and independent versioning. {% .lead %}

---

## Why the Change

The original `directive` package shipped everything in a single bundle &ndash; core runtime, framework adapters, AI orchestration, and LLM-specific adapters. This meant:

- **Larger install size** &ndash; installing `directive` pulled in React, Vue, Svelte, Solid, Lit, and AI code even if you only used the core runtime.
- **Coupled versioning** &ndash; a patch to the Anthropic adapter forced a new release of the entire package.
- **Tree-shaking limits** &ndash; bundlers could remove unused exports, but not unused dependencies or type pollution.

The new `@directive-run/*` scope fixes all three. Install only what you need, get independent changelogs per package, and keep your `node_modules` lean.

---

## Import Mapping

| Old Import | New Package | New Import |
|------------|-------------|------------|
| `from 'directive'` | `@directive-run/core` | `from '@directive-run/core'` |
| `from 'directive/react'` | `@directive-run/react` | `from '@directive-run/react'` |
| `from 'directive/vue'` | `@directive-run/vue` | `from '@directive-run/vue'` |
| `from 'directive/svelte'` | `@directive-run/svelte` | `from '@directive-run/svelte'` |
| `from 'directive/solid'` | `@directive-run/solid` | `from '@directive-run/solid'` |
| `from 'directive/lit'` | `@directive-run/lit` | `from '@directive-run/lit'` |
| `from 'directive/plugins'` | `@directive-run/core` | `from '@directive-run/core/plugins'` |
| `from 'directive/testing'` | `@directive-run/core` | `from '@directive-run/core/testing'` |
| `from 'directive/ai'` | `@directive-run/ai` | `from '@directive-run/ai'` |
| `from 'directive/templates'` | `@directive-run/core` | `from '@directive-run/core/templates'` |
| `from 'directive/worker'` | `@directive-run/core` | `from '@directive-run/core/worker'` |
| `from 'directive/adapter-utils'` | `@directive-run/ai` | `from '@directive-run/ai/adapter-utils'` |
| `createOpenAIRunner` | `@directive-run/adapter-openai` | `from '@directive-run/adapter-openai'` |
| `createAnthropicRunner` | `@directive-run/adapter-anthropic` | `from '@directive-run/adapter-anthropic'` |
| `createOllamaRunner` | `@directive-run/adapter-ollama` | `from '@directive-run/adapter-ollama'` |

---

## Install Commands

Pick the packages that match your stack.

### Core only (no framework, no AI)

```bash
pnpm add @directive-run/core
```

### Core + React

```bash
pnpm add @directive-run/core @directive-run/react
```

### Core + Vue

```bash
pnpm add @directive-run/core @directive-run/vue
```

### Core + Svelte

```bash
pnpm add @directive-run/core @directive-run/svelte
```

### Core + AI (OpenAI)

```bash
pnpm add @directive-run/core @directive-run/ai @directive-run/adapter-openai
```

### Core + AI (Anthropic)

```bash
pnpm add @directive-run/core @directive-run/ai @directive-run/adapter-anthropic
```

### Core + AI (Ollama &ndash; local)

```bash
pnpm add @directive-run/core @directive-run/ai @directive-run/adapter-ollama
```

### Full stack (React + AI + all adapters)

```bash
pnpm add @directive-run/core @directive-run/react @directive-run/ai \
  @directive-run/adapter-openai @directive-run/adapter-anthropic @directive-run/adapter-ollama
```

---

## Automated Find-and-Replace

Run these regex replacements across your codebase. Each one handles a single import path.

### Core

```bash
# directive → @directive-run/core
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i \
  "s|from ['\"]directive['\"]|from '@directive-run/core'|g"
```

{% callout type="note" title="Platform note" %}
On macOS, use `sed -i ''` (with empty string) instead of `sed -i`. On Linux, `sed -i` works as-is. For cross-platform scripts, consider using `perl -pi -e` instead.
{% /callout %}

### Plugins

```bash
# directive/plugins → @directive-run/core/plugins
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i \
  "s|from ['\"]directive/plugins['\"]|from '@directive-run/core/plugins'|g"
```

### Testing

```bash
# directive/testing → @directive-run/core/testing
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i \
  "s|from ['\"]directive/testing['\"]|from '@directive-run/core/testing'|g"
```

### Framework adapters

```bash
# directive/react → @directive-run/react (repeat for vue, svelte, solid, lit)
for fw in react vue svelte solid lit; do
  find src -name '*.ts' -o -name '*.tsx' | xargs sed -i \
    "s|from ['\"]directive/${fw}['\"]|from '@directive-run/${fw}'|g"
done
```

### AI

```bash
# directive/ai → @directive-run/ai
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i \
  "s|from ['\"]directive/ai['\"]|from '@directive-run/ai'|g"
```

### Templates

```bash
# directive/templates → @directive-run/core/templates
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i 's|from ['"'"'"]directive/templates['"'"'"]|from '"'"'@directive-run/core/templates'"'"'|g'
```

### Worker

```bash
# directive/worker → @directive-run/core/worker
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i 's|from ['"'"'"]directive/worker['"'"'"]|from '"'"'@directive-run/core/worker'"'"'|g'
```

### Adapter Utilities

```bash
# directive/adapter-utils → @directive-run/ai/adapter-utils
find src -name '*.ts' -o -name '*.tsx' | xargs sed -i 's|from ['"'"'"]directive/adapter-utils['"'"'"]|from '"'"'@directive-run/ai/adapter-utils'"'"'|g'
```

### Adapter-specific exports

If you imported adapter creators directly from `directive/ai`, update those to point at the dedicated adapter packages:

```bash
# createOpenAIRunner / createOpenAIEmbedder
sed -i "s|from ['\"]directive/ai['\"]|from '@directive-run/adapter-openai'|g" src/**/openai*.ts

# createAnthropicRunner / createAnthropicStreamingRunner
sed -i "s|from ['\"]directive/ai['\"]|from '@directive-run/adapter-anthropic'|g" src/**/anthropic*.ts

# createOllamaRunner
sed -i "s|from ['\"]directive/ai['\"]|from '@directive-run/adapter-ollama'|g" src/**/ollama*.ts
```

{% callout type="warning" title="Manual review required" %}
The regex replacements above cover the common cases. If you re-exported Directive symbols from barrel files, or used dynamic `import()` expressions, verify those paths manually after running the replacements.
{% /callout %}

---

## Removing the Old Package

Once all imports are updated and your build passes:

```bash
pnpm remove directive
```

---

## Verifying the Migration

1. **Build** &ndash; `pnpm build` should complete with zero errors.
2. **Tests** &ndash; `pnpm test` should pass without import resolution failures.
3. **Bundle size** &ndash; compare before/after with your bundler's analyzer. You should see a meaningful reduction if you dropped unused framework or AI packages.

---

## Next Steps

- [Getting Started](/docs/getting-started) &ndash; updated install instructions for the new packages
- [AI Overview](/docs/ai/overview) &ndash; setting up runners with scoped adapter packages
- [Migration Overview](/docs/migration/overview) &ndash; guides for migrating from Redux, Zustand, or XState
