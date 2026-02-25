'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function PaginationDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'pagination.ts')
  const mockApiSource = sources.find((s) => s.filename === 'mock-api.ts')
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
            name="pagination"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example pagination
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Scroll the list to trigger infinite loading. Change filters or search
          to reset to page 1. Open DevTools to see constraints fire.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Two modules &ndash; <code>filters</code> for search/sort/category
            and <code>list</code> for items and pagination state &ndash;
            compose into a system where filter changes automatically reset
            the list.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>items</code>, <code>cursor</code>,{' '}
              <code>hasMore</code>, <code>isLoadingMore</code>, and{' '}
              <code>scrollNearBottom</code> (set by IntersectionObserver)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>totalLoaded</code> and <code>isEmpty</code> for
              UI state
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>loadMore</code> fires when the scroll sentinel
              is visible and more pages exist; <code>filterChanged</code>{' '}
              resets the list when any filter changes
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Effects</strong>{' '}
              &ndash; <code>observeScroll</code> uses IntersectionObserver
              to detect when the sentinel enters the viewport, with proper
              cleanup on disconnect
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
            Cursor-based pagination with infinite scroll, search, category
            filters, and sort &ndash; all with automatic reset on filter change.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            The <code>loadMore</code> constraint gates on three conditions
            (hasMore, not loading, scroll near bottom). The{' '}
            <code>filterChanged</code> constraint uses a hash to detect filter
            changes and reset the list.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Directive&rsquo;s constraint system naturally prevents duplicate
            fetches (the three-condition gate) and handles filter resets
            declaratively. The IntersectionObserver effect with cleanup
            eliminates manual scroll listener management.
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
              filename: 'pagination.ts',
              label: 'pagination.ts - Directive modules',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockApiSource && {
              filename: 'mock-api.ts',
              label: 'mock-api.ts - Mock data',
              code: mockApiSource.code,
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
