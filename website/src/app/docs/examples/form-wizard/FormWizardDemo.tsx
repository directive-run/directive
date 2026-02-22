'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function FormWizardDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'form-wizard.ts')
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
            name="form-wizard"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example form-wizard
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Fill in each step and click Next. The button is disabled until the
          step validates. Go back to see data preserved. Try
          &ldquo;taken@test.com&rdquo; for async email validation.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A wizard module manages step state and field data, while a
            validation module handles async checks &ndash; composed with
            constraint ordering and persistence.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>currentStep</code>, per-step field facts
              (<code>email</code>, <code>password</code>, <code>name</code>,{' '}
              <code>plan</code>), and <code>advanceRequested</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; per-step validators (<code>step0Valid</code>,{' '}
              <code>step1Valid</code>, <code>step2Valid</code>),{' '}
              <code>currentStepValid</code>, <code>canAdvance</code>, and{' '}
              <code>progress</code> percentage
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>advance</code> (priority 50) only fires when
              both <code>advanceRequested</code> and{' '}
              <code>currentStepValid</code> are true
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Persistence</strong>{' '}
              &ndash; <code>persistencePlugin</code> saves field values and
              current step, enabling save-and-resume across page reloads
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
            A three-step form wizard with per-step validation, async email
            availability checks, and persistent draft state.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Derivations compute step validity. The <code>advance</code>{' '}
            constraint gates on <code>currentStepValid</code>, preventing
            advancement until all fields pass. The persistence plugin saves
            progress automatically.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Constraint-gated advancement replaces imperative validation chains.
            Back navigation preserves all data because facts persist until
            explicitly cleared. The persistence plugin enables resume without
            any custom save logic.
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
              filename: 'form-wizard.ts',
              label: 'form-wizard.ts - Directive modules',
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
