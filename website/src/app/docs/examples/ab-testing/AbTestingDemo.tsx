'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function AbTestingDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
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
            name="ab-testing"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example ab-testing
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Two experiments are registered on load. The constraint chain
          automatically assigns variants and tracks exposures. Use
          &ldquo;Pause All&rdquo; to halt evaluation, &ldquo;Reset&rdquo; to
          clear assignments and watch re-assignment happen automatically.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A single <code>ab-testing</code> module implements a complete
            experiment engine with deterministic hash-based assignment and
            automatic exposure tracking:
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Register</strong>{' '}
              &ndash; <code>registerExperiment</code> adds experiments with
              weighted variants
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Assign</strong>{' '}
              &ndash; <code>needsAssignment</code> constraint fires when an
              active experiment has no assignment; resolver hashes{' '}
              <code>userId + experimentId</code> for deterministic variant
              selection
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Expose</strong>{' '}
              &ndash; <code>needsExposure</code> constraint fires when an
              experiment is assigned but not yet exposed; resolver records
              the timestamp
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Pause guard</strong>{' '}
              &ndash; both constraints check <code>facts.paused</code> first,
              halting all evaluation with one boolean flip
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
            A self-contained A/B testing engine with experiment registration,
            deterministic assignment, and automatic exposure tracking.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Two constraints chain together: assign &rarr; expose. The engine
            settles automatically after each event with no manual
            orchestration.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            The constraint&ndash;resolver chain replaces imperative experiment
            orchestration. Register an experiment, and the runtime handles
            assignment and exposure tracking automatically.
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
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - Module + DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
