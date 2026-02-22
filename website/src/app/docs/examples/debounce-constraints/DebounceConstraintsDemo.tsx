'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function DebounceConstraintsDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'debounce-search.ts')
  const mockSearchSource = sources.find((s) => s.filename === 'mock-search.ts')
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
            name="debounce-constraints"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example debounce-constraints
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Type in the search box to see debounce in action. Watch the progress
          bar fill as the timer counts down. Adjust the debounce delay, API
          delay, and min chars sliders to experiment with different
          configurations.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A search interface with time-based reactive debouncing &ndash; all
            driven by Directive&rsquo;s constraint system with no manual timers
            in effects.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Every keystroke</strong>{' '}
              &ndash; updates <code>query</code> and <code>queryChangedAt</code>{' '}
              instantly via an event
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">100ms clock</strong>{' '}
              &ndash; a <code>setInterval</code> ticks <code>now</code>, making
              time a reactive dependency
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraint (debounceSettled)</strong>{' '}
              &ndash; fires when{' '}
              <code>now - queryChangedAt &ge; debounceDelay</code>, producing a{' '}
              <code>SETTLE_DEBOUNCE</code> requirement
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Resolver (settleDebounce)</strong>{' '}
              &ndash; copies <code>query</code> to <code>debouncedQuery</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraint (needsSearch)</strong>{' '}
              &ndash; fires when <code>debouncedQuery</code> settles and differs
              from the last searched query
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Resolver key</strong>{' '}
              &ndash; <code>search-&#123;query&#125;</code> deduplicates, and a
              stale check prevents applying old results
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
            A search interface with debounced API calls, a visual progress bar,
            configurable delay/API latency/min chars, and efficiency stats
            showing keystrokes vs API calls.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            A ticking <code>now</code> fact makes time reactive. A constraint
            checks if enough time has passed since the last keystroke, then
            settles the debounce. A second constraint triggers the search when
            the debounced query changes.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Debouncing lives entirely in Directive&rsquo;s constraint system
            &mdash; no effect cleanup timers, no manual cancellation. The
            two-constraint pipeline (settle then search) serializes naturally,
            and resolver key deduplication prevents stale results.
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
              filename: 'debounce-search.ts',
              label: 'debounce-search.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockSearchSource && {
              filename: 'mock-search.ts',
              label: 'mock-search.ts - Mock search',
              code: mockSearchSource.code,
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
