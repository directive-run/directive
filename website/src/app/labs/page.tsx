'use client'

import { useCallback, useState } from 'react'

import { LabsThemePanel } from '@/components/LabsThemePanel'
import {
  LabsExperimentPanel,
  type ExperimentChangeEvent,
} from '@/components/LabsExperimentPanel'
import { LabsConstraintViz } from '@/components/LabsConstraintViz'
import { DirectiveCallout } from '@/components/DirectiveCallout'

export default function LabsPage() {
  const [lastEvent, setLastEvent] = useState<ExperimentChangeEvent | null>(null)

  const handleExperimentChange = useCallback((event: ExperimentChangeEvent) => {
    setLastEvent(event)
  }, [])

  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-16 sm:px-6 lg:px-8 xl:px-12">
      <div className="mb-12">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          Labs
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          Customize your experience. Toggle experiments. Watch the runtime work.
        </p>
      </div>

      <div className="space-y-12">
        {/* Section 1: Theme Customization */}
        <section aria-label="Theme customization" className="rounded-2xl border border-slate-200 bg-brand-surface-card p-6 sm:p-8 dark:border-slate-700 dark:bg-slate-800/50">
          <LabsThemePanel />
        </section>

        {/* Section 2 + 3: Experiments and Constraint Viz */}
        <div className="grid gap-12 lg:grid-cols-5">
          <section aria-label="A/B experiments" className="rounded-2xl border border-slate-200 bg-brand-surface-card p-6 sm:p-8 lg:col-span-3 dark:border-slate-700 dark:bg-slate-800/50">
            <LabsExperimentPanel onExperimentChange={handleExperimentChange} />
          </section>

          <section aria-label="Constraint flow visualization" className="rounded-2xl border border-slate-200 bg-brand-surface-card p-6 sm:p-8 lg:col-span-2 dark:border-slate-700 dark:bg-slate-800/50">
            <LabsConstraintViz lastEvent={lastEvent} />
          </section>
        </div>

        <DirectiveCallout
          subject="page"
          href="/docs/quick-start"
          linkLabel="Get started"
        />
      </div>
    </div>
  )
}
