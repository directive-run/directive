'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'
import type { ExampleBuild, ExampleSource } from '@/lib/examples'

interface Props {
  build: ExampleBuild | null
  sources: ExampleSource[]
}

export function GoalHeistDemo({ build, sources }: Props) {
  return (
    <div className="space-y-8">
      {/* ── Try it ── */}
      <section>
        <h2 className="font-display text-xl font-medium tracking-tight text-slate-900 dark:text-white">
          Try it
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Click <strong>Run Heist</strong> to watch the crew execute. Toggle
          failure scenarios to see stall detection and relaxation tiers in
          action. Use <strong>Step</strong> for manual advancement.
        </p>
        <div className="mt-4">
          {build ? (
            <ExampleEmbed
              name="goal-heist"
              css={build.css}
              html={build.html}
              scriptSrc={build.scriptSrc}
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              Example not built yet. Run{' '}
              <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">
                pnpm build:example goal-heist
              </code>{' '}
              to see the interactive demo.
            </div>
          )}
        </div>
      </section>

      {/* ── How it works ── */}
      <section>
        <h2 className="font-display text-xl font-medium tracking-tight text-slate-900 dark:text-white">
          How it works
        </h2>
        <ol className="mt-4 list-inside list-decimal space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <li>
            <strong>Facts</strong> track execution state, per-node statuses,
            goal facts (produced values), satisfaction score, and step history.
          </li>
          <li>
            <strong>Derivations</strong> compute ready nodes, progress
            percentage, stall detection, and summary text &mdash; all
            auto-tracked.
          </li>
          <li>
            <strong>Constraints</strong> declare <em>what</em> must happen:{' '}
            <code>autoAdvance</code> (priority 50) drives the execution loop,{' '}
            <code>stallDetected</code> (priority 80) triggers relaxation. Higher
            priority fires first.
          </li>
          <li>
            <strong>Resolvers</strong> declare <em>how</em> to make it happen:{' '}
            <code>executeStep</code> runs ready agents in parallel,{' '}
            <code>applyRelaxation</code> injects facts or allows reruns.
          </li>
          <li>
            <strong>Effects</strong> observe without mutating:{' '}
            <code>logStep</code> (auto-tracked deps) logs each step,{' '}
            <code>announceResult</code> (explicit deps) fires on completion.
          </li>
          <li>
            <strong>Events</strong> handle user interactions: start, pause,
            step, reset, strategy changes, and failure toggles.
          </li>
        </ol>
      </section>

      {/* ── Summary ── */}
      <section>
        <h2 className="font-display text-xl font-medium tracking-tight text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong>What:</strong> Six specialist agents collaborate to pull off
            a museum heist. Dependencies form a DAG with parallel roots, merge
            points, and a final convergence &mdash; demonstrating the
            constraint&ndash;resolver reconciliation loop.
          </p>
          <p>
            <strong>How:</strong> The <code>autoAdvance</code> constraint fires
            when ready agents exist, triggering the <code>executeStep</code>{' '}
            resolver. The resolver runs agents, updates facts, and the
            constraint re-evaluates &mdash; creating a self-driving loop. When
            progress stalls, the higher-priority{' '}
            <code>stallDetected</code> constraint fires first, and relaxation
            tiers inject facts or allow reruns.
          </p>
          <p>
            <strong>Why it works:</strong> Constraints declare intent
            (&ldquo;advance when ready&rdquo;), resolvers fulfill it
            (&ldquo;run these agents&rdquo;), and the runtime orchestrates the
            cycle. The same pattern scales from a demo heist to production
            multi-agent pipelines.
          </p>
        </div>
      </section>

      {/* ── Source code ── */}
      <section>
        <h2 className="font-display text-xl font-medium tracking-tight text-slate-900 dark:text-white">
          Source code
        </h2>
        <div className="mt-4">
          <CodeTabs
            tabs={sources.map((s) => ({
              filename: s.filename,
              code: s.code,
              language: 'typescript',
            }))}
          />
        </div>
      </section>
    </div>
  )
}
