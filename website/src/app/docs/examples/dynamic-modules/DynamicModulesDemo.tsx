'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function DynamicModulesDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const modulesSource = sources.find((s) => s.filename === 'modules.ts')
  const mockWeatherSource = sources.find(
    (s) => s.filename === 'mock-weather.ts',
  )
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
            name="dynamic-modules"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example dynamic-modules
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Load&rdquo; to register modules at runtime. Each module
          brings its own facts, constraints, resolvers, and derivations into the
          shared system. Watch the inspector grow as modules load.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A widget dashboard where feature modules load dynamically at
            runtime &ndash; the first multi-module namespaced system example.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                System starts
              </strong>{' '}
              &ndash; with only the <code>dashboard</code> module using{' '}
              <code>createSystem(&#123; modules &#125;)</code> (multi-module
              mode)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                User clicks &ldquo;Load Counter&rdquo;
              </strong>{' '}
              &ndash; calls{' '}
              <code>
                system.registerModule(&quot;counter&quot;, counterModule)
              </code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Module integrates
              </strong>{' '}
              &ndash; facts, constraints, resolvers, and derivations are added
              under the <code>counter</code> namespace
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                subscribeModule
              </strong>{' '}
              &ndash;{' '}
              <code>
                system.subscribeModule(&quot;counter&quot;, render)
              </code>{' '}
              wires up reactivity for the new module
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Widget appears
              </strong>{' '}
              &ndash; counter card with increment/decrement, step slider, and
              overflow constraint (auto-resets at 100)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Same for Weather and Dice
              </strong>{' '}
              &ndash; Weather uses an async resolver for city lookup; Dice uses
              pure derivations for total and doubles detection
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Inspector grows
              </strong>{' '}
              &ndash; shows all namespaced facts across every loaded module in
              real time
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
            <strong className="text-slate-900 dark:text-slate-200">
              What:
            </strong>{' '}
            A widget dashboard with 3 dynamically loadable modules (Counter,
            Weather, Dice), a system inspector showing namespaced facts, and an
            event timeline.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              How:
            </strong>{' '}
            <code>createSystem</code> initializes with a dashboard module.{' '}
            <code>registerModule</code> adds modules at runtime with their own
            facts, constraints, resolvers, and derivations.{' '}
            <code>subscribeModule</code> subscribes to per-namespace changes for
            reactive rendering.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{' '}
            Each module is self-contained with its own schema, events, and
            resolution logic. The system handles namespace isolation
            automatically &mdash; modules can&rsquo;t interfere with each
            other&rsquo;s facts, and the inspector reveals the full namespaced
            state tree.
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
            modulesSource && {
              filename: 'modules.ts',
              label: 'modules.ts - Directive modules',
              code: modulesSource.code,
              language: 'typescript',
            },
            mockWeatherSource && {
              filename: 'mock-weather.ts',
              label: 'mock-weather.ts - Mock weather API',
              code: mockWeatherSource.code,
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
