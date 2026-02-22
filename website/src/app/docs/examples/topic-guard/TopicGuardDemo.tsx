'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function TopicGuardDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'topic-guard.ts')
  const guardrailsSource = sources.find(
    (s) => s.filename === 'mock-guardrails.ts',
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
            name="topic-guard"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-[#4a4035] bg-[#161412] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example topic-guard
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Type a message and press Enter or click Send. On-topic messages get a
          mock agent response. Off-topic messages are blocked by the guardrail.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Before any message reaches the agent, it passes through two{' '}
            <strong className="text-slate-900 dark:text-slate-200">
              input guardrails
            </strong>
            : a keyword matcher and a topic classifier. If either flags the
            input, the constraint&ndash;resolver flow blocks the message and
            shows a rejection.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Facts
              </strong>{' '}
              &ndash; Input text, chat history, processing state, guardrail
              result, allowed topics, audit log
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{' '}
              &ndash; Message count, blocked/allowed count, block rate, canSend
              (auto-tracked, no manual deps)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{' '}
              &ndash; <code>offTopicDetected</code> (priority 100) triggers{' '}
              <code>BLOCK_MESSAGE</code>; <code>onTopicConfirmed</code> (90)
              triggers <code>ALLOW_MESSAGE</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{' '}
              &ndash; <code>blockMessage</code> marks the user message as
              blocked and adds a rejection; <code>allowMessage</code> runs the
              mock agent and appends the response
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Effects
              </strong>{' '}
              &ndash; Guardrail audit log updated whenever
              <code>lastGuardrailResult</code> changes
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
            A topic-guardrail playground. Type messages and watch guardrails
            block off-topic input before it reaches the agent.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              How:
            </strong>{' '}
            Two guardrails run in sequence: a keyword matcher (regex patterns for
            cooking, politics, sports) and a topic classifier (checks against
            configurable allowed topics). Constraints detect the guardrail
            outcome, and resolvers handle blocking or allowing the message.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{' '}
            Input guardrails are a natural fit for constraints &ndash; they
            express &ldquo;if this is true, require that action.&rdquo; The
            constraint&ndash;resolver flow cleanly separates detection from
            handling.
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
              filename: 'topic-guard.ts',
              label: 'topic-guard.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            guardrailsSource && {
              filename: 'mock-guardrails.ts',
              label: 'mock-guardrails.ts - Guardrail logic',
              code: guardrailsSource.code,
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
