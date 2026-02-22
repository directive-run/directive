'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function NotificationsDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'notifications.ts')
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
            name="notifications"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example notifications
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click the buttons to add notifications. Watch them auto-dismiss based
          on level (errors stay longer). Try &ldquo;Burst&rdquo; to test
          overflow handling.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A notification module manages a queue with auto-dismiss constraints
            driven by <code>tickMs</code>, while an app module demonstrates
            cross-module notification triggers.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>queue</code> (notification array), <code>maxVisible</code>,{' '}
              <code>now</code> (ticking timestamp), and <code>idCounter</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>visibleNotifications</code> (first N from queue),{' '}
              <code>oldestExpired</code> (checks TTL against ticking <code>now</code>)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>autoDismiss</code> (priority 50) fires when the
              oldest notification exceeds its TTL; <code>overflow</code>{' '}
              (priority 60) removes excess notifications first
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">tickMs</strong>{' '}
              &ndash; the system ticks every 1000ms, advancing <code>now</code>{' '}
              and driving constraint re-evaluation without manual timers
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
            A notification queue with level-based TTL (errors 10s, info 4s),
            priority-based overflow handling, and cross-module triggers.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            The <code>tickMs</code> system option drives a ticking{' '}
            <code>now</code> fact. The <code>autoDismiss</code> constraint
            checks if the oldest notification has exceeded its TTL, while{' '}
            <code>overflow</code> handles queue limits at higher priority.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Time-based constraints replace manual <code>setTimeout</code>{' '}
            chains. Priority ordering ensures overflow is handled before
            TTL-based dismissal. Any module can trigger notifications through
            events.
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
              filename: 'notifications.ts',
              label: 'notifications.ts - Directive modules',
              code: moduleSource.code,
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
