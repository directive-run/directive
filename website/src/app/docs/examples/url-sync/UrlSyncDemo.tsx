'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function UrlSyncDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'url-sync.ts')
  const mockSource = sources.find((s) => s.filename === 'mock-products.ts')
  const mainSource = sources.find((s) => s.filename === 'main.ts')

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="url-sync"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example url-sync
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Change filters, search, or sort &ndash; watch the URL update. Only
          non-default values appear in the query string. The state inspector
          shows the guard flag preventing sync loops.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A <code>url</code> module owns filter state and syncs it
            bidirectionally with the browser URL, while a{' '}
            <code>products</code> module reacts to filter changes via
            cross-module dependencies.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>search</code>, <code>category</code>,{' '}
              <code>sortBy</code>, <code>page</code>, and the guard flag{' '}
              <code>syncingFromUrl</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Effects</strong>{' '}
              &ndash; <code>urlToState</code> listens to <code>popstate</code>{' '}
              for back/forward navigation; <code>stateToUrl</code> writes
              facts to URL params, skipping when <code>syncingFromUrl</code>{' '}
              is true to prevent loops
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Guard flag</strong>{' '}
              &ndash; <code>syncingFromUrl</code> breaks the URL &rarr; facts
              &rarr; URL infinite loop. Set to true during popstate handling,
              cleared after a microtask
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Cross-module</strong>{' '}
              &ndash; the products constraint reads all URL facts via{' '}
              <code>crossModuleDeps</code>, automatically re-fetching when
              any filter changes
            </li>
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
            Bidirectional URL-state sync for a filterable product list with
            search, category, sort, and pagination.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Two effects handle the bidirectional sync: one reads popstate
            events into facts, the other writes fact changes to URL params.
            A <code>syncingFromUrl</code> guard flag prevents infinite loops.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Directive&rsquo;s effect system with cleanup handles the popstate
            listener lifecycle. The guard flag pattern is simple and reliable.
            Cross-module deps ensure the product list stays in sync without
            manual wiring.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: 'url-sync.ts',
              label: 'url-sync.ts - Directive modules',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockSource && {
              filename: 'mock-products.ts',
              label: 'mock-products.ts - Mock data',
              code: mockSource.code,
              language: 'typescript',
            },
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
