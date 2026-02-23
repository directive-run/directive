'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function ContactFormDemo({
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
            name="contact-form"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example contact-form
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Fill in all fields to enable the submit button. Blur a field to
          trigger validation. Submission is simulated with a 20% random failure
          rate. On success the form auto-resets after 3 seconds.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A single <code>contact-form</code> module demonstrates all six
            Directive primitives working together:
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; field values, touched state, submission status, error
              message, rate-limit timestamp
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; per-field validation errors (touch-gated),{' '}
              <code>isValid</code>, <code>canSubmit</code> (composing{' '}
              <code>isValid</code>), character count
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>submitForm</code> fires when status is
              &ldquo;submitting&rdquo;; <code>resetAfterSuccess</code> fires on
              success
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Resolvers</strong>{' '}
              &ndash; <code>sendMessage</code> simulates an async POST;{' '}
              <code>resetAfterDelay</code> waits 3 seconds then clears the form
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
            A contact form with per-field validation, async submission, and
            automatic post-success reset.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Two constraints chain the lifecycle: submit &rarr; send &rarr;
            success &rarr; auto-reset. Derivation composition lets{' '}
            <code>canSubmit</code> reuse <code>isValid</code>.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            The constraint&ndash;resolver chain manages the entire async
            lifecycle declaratively. No useEffect, no cleanup functions, no
            dependency arrays.
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
