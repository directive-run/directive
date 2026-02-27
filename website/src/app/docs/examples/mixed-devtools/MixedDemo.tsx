'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'

export function MixedDemo({
  counterBuild,
  guardrailsBuild,
  heistBuild,
}: {
  counterBuild: import('@/lib/examples').ExampleBuild | null
  guardrailsBuild: import('@/lib/examples').ExampleBuild | null
  heistBuild: import('@/lib/examples').ExampleBuild | null
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Three systems from different domains on one page. Open DevTools and
          use the SystemSelector dropdown to switch between
          &ldquo;number-match&rdquo;, &ldquo;ai-guardrails&rdquo;, and
          &ldquo;goal-heist&rdquo;. System-core tabs (Facts, Derivations,
          Constraints) populate for each system. AI tabs show empty state since
          there is no SSE backend for embedded examples.
        </p>

        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Number Match (System)
            </h3>
            {counterBuild ? (
              <ExampleEmbed
                name="counter"
                css={counterBuild.css}
                html={counterBuild.html}
                scriptSrc={counterBuild.scriptSrc}
              />
            ) : (
              <BuildPlaceholder name="counter" />
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              AI Guardrails (AI)
            </h3>
            {guardrailsBuild ? (
              <ExampleEmbed
                name="ai-guardrails"
                css={guardrailsBuild.css}
                html={guardrailsBuild.html}
                scriptSrc={guardrailsBuild.scriptSrc}
              />
            ) : (
              <BuildPlaceholder name="ai-guardrails" />
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Goal Heist (AI)
            </h3>
            {heistBuild ? (
              <ExampleEmbed
                name="goal-heist"
                css={heistBuild.css}
                html={heistBuild.html}
                scriptSrc={heistBuild.scriptSrc}
              />
            ) : (
              <BuildPlaceholder name="goal-heist" />
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          What to verify
        </h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-400">
          <li>
            <code>window.__DIRECTIVE__.getSystems()</code> returns all three
            system names
          </li>
          <li>
            SystemSelector dropdown shows 3 entries
          </li>
          <li>
            Switching between systems updates all system-core tabs
          </li>
          <li>
            AI tabs (Timeline, Cost, etc.) show empty state — expected without
            an SSE backend
          </li>
        </ul>
      </section>
    </div>
  )
}

function BuildPlaceholder({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
      Example not built yet. Run{' '}
      <code className="text-slate-300">pnpm build:example {name}</code> to
      generate the embed.
    </div>
  )
}
