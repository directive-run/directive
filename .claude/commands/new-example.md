---
description: Create an interactive example for the Directive docs website
---

# New Interactive Example

Create an interactive, embeddable example that renders directly in the docs site using a light DOM custom element (no iframe, no shadow DOM).

## Code Quality Requirements

Every example is a **showcase of Directive**. The code must be:

- **100% Directive** - Use `createModule`, `createSystem`, facts, derivations, constraints, resolvers, effects, and events. Do not use raw `useState`, Redux, Zustand, or any other state management. The entire application state must flow through Directive.
- **Clean and professional** - Production-quality TypeScript. Strict types, no `any`, no `as` casts unless truly necessary. Consistent formatting. Clear variable names.
- **Implementation spec** - Follow the exact Directive API as documented. Use the correct patterns: `schema` + `t.*` type builders, `init` for initial state, `derive` for computed values, `constraints` with `when`/`require`, `resolvers` with `requirement`/`resolve`, `effects` with `run`.
- **Well-structured** - Separate Directive module logic from rendering. Module definition in its own file (e.g., `src/counter.ts`), rendering/DOM in `src/main.ts`. Pure business logic (if any) in its own file (e.g., `src/rules.ts`).
- **Demonstrative** - Each example should clearly demonstrate specific Directive features. The "How it works" section on the page must list which Directive concepts are used and why.
- **Self-contained** - No external API dependencies unless the example specifically demonstrates API integration. Should work offline after build.

**The source code IS the documentation.** Readers will study it to learn Directive. Write it as if it will be read more than it will be run.

## Decision: Interactive vs. Code-Only

**Use AskUserQuestion:** Is this example interactive (visual output) or code-only?

- **Interactive** - Has visual output (games, UIs, forms, dashboards). Follow all steps below.
- **Code-only** - Server-side, CLI, or pattern-showcase. Create a `page.md` with Markdoc instead. Skip the build/embed steps.

## Step 0: AE Brainstorm

Before writing any code, brainstorm the example design from multiple perspectives.
Launch 4 Plan agents in parallel with these focuses:

1. **UX & Game Design** - Visual layout, user flow, interaction patterns,
   difficulty tuning, mobile responsiveness, wow factor
2. **Directive Architecture** - Schema design, which facts/derivations/events/
   constraints/resolvers/effects, how the constraint cascade works, what makes
   this a compelling Directive showcase
3. **Code Quality & Teaching** - File organization, line count targets, what
   this example teaches better than existing examples, "How it works" narrative,
   minimum viable features vs nice-to-haves
4. **AI Integration** - Is there a natural use case for `@directive-run/ai`?
   Could an AI agent enhance the example (opponent, assistant, hint engine,
   content generation)? What AI adapter features would it showcase (orchestrator,
   streaming, guardrails, circuit breaker, memory)? If no compelling fit, say so
   - not every example needs AI

Present the synthesized brainstorm to the user and resolve design decisions
before proceeding to Step 1.

## Step 1: Example Package

Create `examples/<name>/` with:

### package.json

```json
{
  "name": "@directive-run/example-<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@directive-run/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

### vite.config.ts

**CRITICAL:** `base` must match `/examples/<name>/` so assets resolve correctly when embedded.

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/<name>/",
  build: {
    target: "esnext",
  },
});
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

### Element IDs

Use unique IDs prefixed with the example name (e.g., `checkers-board`, `counter-display`). Never use generic IDs like `root`, `app`, or `container` - they will conflict with the host page.

### Source file structure

```
src/
  index.html        # Entry HTML (uses prefixed IDs)
  main.ts           # Entry point: imports module, sets up system, renders DOM
  <name>.ts          # Directive module definition (schema, derive, constraints, resolvers, effects)
  <logic>.ts         # Pure business logic (no Directive dependency, optional)
```

### Standard HTML Layout

Every example follows the three-zone stack: **Header &rarr; Board &rarr; Controls &rarr; Rules**.

```html
<!-- Zone 1: Header -->
<h1><Name></h1>
<p class="subtitle">...</p>

<!-- Zone 2: Board (full-width, no inner max-width) -->
<div id="<name>-grid" class="<name>-grid" data-testid="<name>-grid"></div>

<!-- Zone 3: Controls (CSS grid, not flex) -->
<div class="<name>-actions" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 0.5rem;">
  <button id="<name>-action" data-testid="<name>-action">Action</button>
</div>

<!-- Zone 4: Rules -->
<div class="<name>-rules">...</div>
```

Key rules:
- Board fills container width &ndash; never set `max-width` on the board element
- Controls use CSS grid (`grid-template-columns`) &ndash; never single-row flex
- Every interactive element gets a `data-testid` attribute matching its ID
- Dynamically created elements (cells, squares) get `data-testid="<name>-cell-${index}"` in `main.ts`
- All IDs prefixed with example name (no generic `root`, `app`, `board`)

For two-panel layouts (e.g., game + chat sidebar), wrap in a flex container:

```html
<div class="app-container" style="display: flex; gap: 1.5rem;">
  <div class="game-side"><!-- board + controls --></div>
  <div class="chat-panel"><!-- sidebar --></div>
</div>
```

### main.ts Rendering Pattern

`main.ts` follows six canonical sections, each separated by `===` comment bars:

```
1. System          &ndash; createSystem + modules
2. DOM References  &ndash; ALL getElementById in one block
3. Render          &ndash; reads state, writes DOM
4. Subscribe       &ndash; system.subscribeModule(...)
5. Controls        &ndash; event listener wiring
6. Initial Render  &ndash; render() as the last line
```

Key rules:
- No scattered DOM refs &ndash; all `getElementById` calls live in section 2
- Render reads state then writes DOM &ndash; never mix mutations with reads
- Events use `system.events.{module}.{event}()` &ndash; never mutate facts directly
- Initial `render()` is always the last line in the file
- Each section starts with:
  ```typescript
  // ============================================================================
  // Section Name
  // ============================================================================
  ```

The Directive module file (`<name>.ts`) is the star of the example. It must demonstrate Directive patterns clearly:

```typescript
import { createModule, t } from "directive";

export const counterModule = createModule("counter", {
  schema: {
    count: t.number(),
  },

  init: (facts) => {
    facts.count = 0;
  },

  derive: {
    isEven: (facts) => facts.count % 2 === 0,
    display: (facts) => `Count: ${facts.count}`,
  },

  constraints: {
    tooHigh: {
      when: (facts) => facts.count > 100,
      require: { type: "RESET" },
    },
  },

  resolvers: {
    reset: {
      requirement: "RESET",
      resolve: (req, context) => {
        context.facts.count = 0;
      },
    },
  },

  effects: {
    log: {
      run: (facts, prev) => {
        if (prev && facts.count !== prev.count) {
          console.log(`Count changed: ${prev.count} → ${facts.count}`);
        }
      },
    },
  },
});
```

## Step 2: Build & Copy

```bash
cd website && pnpm build:example <name>
```

Verify output exists:

```bash
ls website/public/examples/<name>/index.html
```

## Step 3: Website Page

Create `website/src/app/docs/examples/<name>/page.tsx`:

```tsx
import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { <Name>Demo } from './<Name>Demo'

export const metadata = buildPageMetadata({
  title: '<Title>',
  description: '<Description>',
  path: '/docs/examples/<name>',
  section: 'Docs',
})

export default function <Name>Page() {
  const build = parseExampleBuild('<name>')
  const sources = readExampleSources('<name>', ['<module>.ts', '<logic>.ts'])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          <Title>
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          <Description>
        </p>
      </header>

      <<Name>Demo build={build} sources={sources} />
    </div>
  )
}
```

Create `website/src/app/docs/examples/<name>/<Name>Demo.tsx`:

```tsx
'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import type { ExampleBuild, ExampleSource } from '@/lib/examples'
import { CodeTabs } from '@/components/CodeTabs'

export function <Name>Demo({
  build,
  sources,
}: {
  build: ExampleBuild | null
  sources: ExampleSource[]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="<name>"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-[#0f172a] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">pnpm build:example <name></code>{' '}
            to generate the embed.
          </div>
        )}
      </section>

      {/* How it works — list Directive features demonstrated */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            {/* Describe the Directive architecture: what modules, how they compose */}
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            {/* List each Directive concept used:
              - Facts — what state is tracked
              - Derivations — what is computed
              - Constraints — what conditions trigger requirements
              - Resolvers — how requirements are fulfilled
              - Effects — what side effects occur
              - Events — what user actions are dispatched
            */}
          </ol>
        </div>
      </section>

      {/* Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-200">What:</strong>{' '}
            {/* What was built — one sentence describing the example */}
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            {/* How Directive powers it — which features, how they connect */}
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            {/* Why Directive is a natural fit for this problem */}
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={sources.map((s) => ({
            filename: s.filename,
            label: s.filename,
            code: s.code,
            language: 'typescript',
          }))}
        />
      </section>
    </div>
  )
}
```

## Step 4: Navigation & Examples Overview

### Navigation sidebar

Add entry in `website/src/lib/navigation.ts` under the Examples section:

```typescript
{ title: '<Title>', href: '/docs/examples/<name>' },
```

### Examples overview page

Add a listing in `website/src/app/docs/examples/overview/page.md` under the
appropriate category (or create one). Include:

- Link to the example page
- 1-2 sentence description of what it demonstrates
- **Directive features** line listing which concepts it showcases

```markdown
### [<Title>](/docs/examples/<name>)

<Description of what the example does and why it's a good Directive showcase.>

**Directive features:** Facts, derivations, constraints, resolvers, effects, events
```

## Step 5: Install & Build

```bash
pnpm install
cd website && pnpm build:next-only
```

## Step 5.5: E2E Tests

Create `website/e2e/specs/<name>.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { gotoExample, tid } from "../helpers/example-test.js";

test.describe("<Name> example", () => {
  test.beforeEach(async ({ page }) => {
    await gotoExample(page, "<name>");
  });

  test("page loads and embed renders", async ({ page }) => {
    const el = page.locator("directive-<name>");
    await expect(el).toBeAttached();
  });

  test("interactive elements respond to clicks", async ({ page }) => {
    // Test primary interaction (click cell/square, press button, etc.)
    const target = tid(page, "<name>-<primary-element>");
    await target.click();
    // Assert visible state change
  });

  test("controls respond", async ({ page }) => {
    // Test each control button
    const btn = tid(page, "<name>-<action>");
    await btn.click();
    // Assert state change
  });

  test("no JS errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await gotoExample(page, "<name>");
    expect(errors).toEqual([]);
  });
});
```

Run the tests:

```bash
cd website && pnpm test:e2e
```

## Step 6: Verification Checklist

### Functionality
- [ ] Interactive &ndash; clicks/inputs work in the embed
- [ ] No CSS leakage to host page (check headings, buttons, links)
- [ ] Source code uses tabbed view (CodeTabs component)
- [ ] Source code displays as always-visible code blocks (not collapsible)
- [ ] Source code renders with syntax highlighting
- [ ] Summary section has What/How/Why content filled in
- [ ] Dark mode looks correct
- [ ] Mobile responsive
- [ ] `pnpm build` (full website build) succeeds
- [ ] Element IDs are unique (not generic `root`, `app`, etc.)
- [ ] `vite.config.ts` has correct `base` path

### Layout & Testing
- [ ] All interactive elements have `data-testid` attributes
- [ ] Board fills container width (no inner `max-width`)
- [ ] Controls use CSS grid (not single-row flex)
- [ ] `main.ts` follows the six-section pattern
- [ ] E2E test at `website/e2e/specs/<name>.spec.ts`
- [ ] IDs prefixed with example name (no generic `root`, `app`, `board`)

### Docs Integration
- [ ] Navigation entry added in `website/src/lib/navigation.ts`
- [ ] Listed on examples overview page (`website/src/app/docs/examples/overview/page.md`)
- [ ] Overview listing has description, Directive features line, and link to example page

### Code Quality
- [ ] 100% Directive - all state managed through `createModule`/`createSystem`, no raw React state or third-party state libs
- [ ] TypeScript strict mode passes (`pnpm typecheck`)
- [ ] No `any` types, no unnecessary `as` casts
- [ ] Module file is clean, well-commented, and demonstrates Directive patterns clearly
- [ ] Rendering logic is separate from Directive module definition
- [ ] "How it works" section accurately describes which Directive features are used
- [ ] Code reads like documentation - a developer learning Directive could study it
