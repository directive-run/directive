'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function OptimisticUpdatesDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'optimistic-updates.ts')
  const mockServerSource = sources.find((s) => s.filename === 'mock-server.ts')
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
            name="optimistic-updates"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example optimistic-updates
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Toggle, delete, or add todos to see instant optimistic updates.
          Adjust the fail rate to observe automatic rollbacks with toast
          notifications. Increase the server delay to clearly see pending
          states.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A todo list with optimistic mutations, automatic server sync,
            and per-operation rollback &ndash; all driven by Directive&rsquo;s
            constraint&ndash;resolver pattern.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Events</strong>{' '}
              &ndash; apply optimistic mutations instantly (toggle done, delete
              item, add item) and push undo data to a sync queue
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Sync queue</strong>{' '}
              &ndash; stores each pending operation with a snapshot of the
              pre-mutation items array for rollback
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>needsSync</code> (priority 100) fires when the
              queue is non-empty and no sync is in progress, targeting the
              queue head
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Resolvers</strong>{' '}
              &ndash; <code>syncTodo</code> calls the mock server. On success
              the optimistic state becomes truth. On failure, it restores the
              stored undo items and shows a toast
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Key deduplication</strong>{' '}
              &ndash; resolver <code>key</code> prevents concurrent syncs for
              the same operation ID
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
            A todo list with instant optimistic mutations (toggle, delete, add),
            configurable server delay and failure rate, automatic rollback with
            toast notifications, and live DevTools debugging.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Event handlers apply mutations immediately and push undo data to a
            sync queue. A constraint fires for the queue head, triggering a
            resolver that calls the mock server. On failure, the resolver
            restores the stored undo data.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Optimistic updates are notoriously tricky because of concurrent
            operations and partial failures. Directive&rsquo;s event-driven
            mutations give instant feedback, while the constraint&ndash;resolver
            pattern serializes server sync and handles rollback cleanly via the
            sync queue.
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
              filename: 'optimistic-updates.ts',
              label: 'optimistic-updates.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockServerSource && {
              filename: 'mock-server.ts',
              label: 'mock-server.ts - Mock server',
              code: mockServerSource.code,
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
