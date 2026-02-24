'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function ProviderRoutingDemo({
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
            name="provider-routing"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example provider-routing
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Send requests and inject errors on providers to watch circuit
          breakers open and routing fall back. Use the budget slider and
          &ldquo;Prefer Cheapest&rdquo; toggle to change routing behavior.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Three mock providers (OpenAI, Anthropic, Ollama) with different
            costs and latencies. A constraint router selects the best
            provider based on circuit state, budget, and cost preference.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraint Router</strong>{' '}
              &ndash; Selects provider based on circuit breaker state, remaining
              budget, and cost preference
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Circuit Breakers</strong>{' '}
              &ndash; Each provider has its own breaker. 3 failures opens the
              circuit, auto-recovers after 5s
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Fallback Chain</strong>{' '}
              &ndash; On error, automatically routes to the next available
              provider
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Budget Tracking</strong>{' '}
              &ndash; Per-request cost deducted, providers blocked when budget
              is exhausted
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
