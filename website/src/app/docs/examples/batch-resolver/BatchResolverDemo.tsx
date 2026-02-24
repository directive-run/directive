'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function BatchResolverDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const mainSource = sources.find((s) => s.filename === 'main.ts')

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="batch-resolver"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example batch-resolver
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Load All 5&rdquo; to see batching in action &ndash;
          5 individual loads become 1 batch request. Try &ldquo;Load 20&rdquo;
          to see automatic batch splitting.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A user directory that loads profiles through a batch resolver.
            Multiple simultaneous loads are grouped into a single batch call,
            preventing the N+1 problem.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Batch Window</strong>{' '}
              &ndash; Requests within a configurable time window are grouped
              together into a single batch
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Per-Item Results</strong>{' '}
              &ndash; Each item in the batch can succeed or fail independently,
              with partial success handling
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Batch Splitting</strong>{' '}
              &ndash; Large batches are automatically split based on max batch
              size constraints
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - System + DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
