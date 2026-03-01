'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function FraudAnalysisDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'fraud-analysis.ts')
  const mockDataSource = sources.find((s) => s.filename === 'mock-data.ts')
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
            name="fraud-analysis"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example fraud-analysis
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Select a scenario, adjust the risk threshold and budget sliders,
          then click &ldquo;Run Pipeline&rdquo; or &ldquo;Auto-Run
          All&rdquo;. Watch constraints fire in the DevTools panel as cases
          progress through the pipeline.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A single module drives a multi-stage fraud detection pipeline.
            Flagged transactions are normalized, grouped into cases, enriched
            with external signals, analyzed for risk, and dispositioned
            &ndash; all through constraint-driven resolution.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                6 Constraints with priority + after
              </strong>{' '}
              &ndash; <code>normalizeNeeded</code> (100) fires first, then{' '}
              <code>groupingNeeded</code> (90), <code>enrichmentNeeded</code>{' '}
              (80), <code>analysisNeeded</code> (70), and{' '}
              <code>humanReviewNeeded</code> (65). The{' '}
              <code>budgetEscalation</code> (60) constraint competes with
              analysis &ndash; when budget runs out, remaining cases get
              escalated instead of analyzed.
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                6 Resolvers with retry + custom keys
              </strong>{' '}
              &ndash; <code>enrichCase</code> uses{' '}
              <code>key: enrich-$&#123;caseId&#125;</code> for dedup and
              retries with exponential backoff. Each resolver mutates facts
              to drive the next constraint.
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                PII detection
              </strong>{' '}
              &ndash; The normalize resolver runs{' '}
              local <code>detectPII</code> regex scanner on
              merchant names and memo fields, redacting SSNs, credit cards,
              and bank account numbers.
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                User-adjustable constraints
              </strong>{' '}
              &ndash; The risk threshold slider changes when{' '}
              <code>humanReviewNeeded</code> fires. The budget slider
              controls when <code>budgetEscalation</code> kicks in. Both
              re-evaluate constraints in real time.
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
            A fraud detection pipeline that normalizes, groups, enriches,
            and analyzes flagged transactions through 6 prioritized
            constraints, 6 resolvers, 3 effects, and 9 derivations.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              How:
            </strong>{' '}
            Constraints declare &ldquo;when this is true, require that
            action.&rdquo; Priority and <code>after</code> ordering
            sequence the pipeline. Resolvers fulfill requirements,
            mutating facts to trigger the next constraint. Effects log
            stage changes, PII detections, and budget warnings.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{' '}
            Adding a new fraud rule is just another constraint definition.
            Competing constraints (analysis vs. escalation) handle edge
            cases declaratively. The DevTools panel shows every
            constraint evaluation, requirement, and state change in real
            time.
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
              filename: 'fraud-analysis.ts',
              label: 'fraud-analysis.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockDataSource && {
              filename: 'mock-data.ts',
              label: 'mock-data.ts - Scenarios & types',
              code: mockDataSource.code,
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
