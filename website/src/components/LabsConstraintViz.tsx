'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import type { ExperimentChangeEvent } from '@/components/LabsExperimentPanel'

interface Step {
  id: string
  label: string
  idleDetail: string
  activeDetail?: (event: ExperimentChangeEvent) => string

  bgActive: string
  bgIdle: string
  border: string
  borderActive: string
  textActive: string
  dot: string
}

const STEPS: Step[] = [
  {
    id: 'fact',
    label: 'Fact Mutated',
    idleDetail: 'assignments[experimentId] = variant',
    activeDetail: (e) => `assignments["${e.experimentId}"] = "${e.toVariant}"`,

    bgActive: 'bg-brand-primary-100 dark:bg-brand-primary-900/50',
    bgIdle: 'bg-brand-primary-50 dark:bg-brand-primary-950/30',
    border: 'border-brand-primary-300 dark:border-brand-primary-700',
    borderActive: 'border-brand-primary-500',
    textActive: 'text-brand-primary-700 dark:text-brand-primary-300',
    dot: 'bg-brand-primary',
  },
  {
    id: 'derivation',
    label: 'Derivation Invalidated',
    idleDetail: 'activeExperiments recomputed',

    bgActive: 'bg-sky-100 dark:bg-sky-900/50',
    bgIdle: 'bg-sky-50 dark:bg-sky-950/30',
    border: 'border-sky-300 dark:border-sky-700',
    borderActive: 'border-sky-500',
    textActive: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  {
    id: 'constraint',
    label: 'Constraint Evaluates',
    idleDetail: 'needsExposure(experimentId) → true',
    activeDetail: (e) => `needsExposure("${e.experimentId}") → true`,

    bgActive: 'bg-amber-100 dark:bg-amber-900/50',
    bgIdle: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-300 dark:border-amber-700',
    borderActive: 'border-amber-500',
    textActive: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  {
    id: 'requirement',
    label: 'Requirement Emitted',
    idleDetail: 'TRACK_EXPOSURE { experimentId, variantId }',
    activeDetail: (e) => `TRACK_EXPOSURE { "${e.experimentId}", "${e.toVariant}" }`,

    bgActive: 'bg-violet-100 dark:bg-violet-900/50',
    bgIdle: 'bg-violet-50 dark:bg-violet-950/30',
    border: 'border-violet-300 dark:border-violet-700',
    borderActive: 'border-violet-500',
    textActive: 'text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  {
    id: 'resolver',
    label: 'Resolver Executes',
    idleDetail: 'trackExposure(experimentId, variantId)',
    activeDetail: (e) => `trackExposure("${e.experimentId}", "${e.toVariant}")`,

    bgActive: 'bg-emerald-100 dark:bg-emerald-900/50',
    bgIdle: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-300 dark:border-emerald-700',
    borderActive: 'border-emerald-500',
    textActive: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  {
    id: 'settled',
    label: 'Facts Updated',
    idleDetail: 'exposures[experimentId] = timestamp',
    activeDetail: (e) => `exposures["${e.experimentId}"] = ${e.timestamp}`,

    bgActive: 'bg-brand-primary-100 dark:bg-brand-primary-900/50',
    bgIdle: 'bg-brand-primary-50 dark:bg-brand-primary-950/30',
    border: 'border-brand-primary-300 dark:border-brand-primary-700',
    borderActive: 'border-brand-primary-500',
    textActive: 'text-brand-primary-700 dark:text-brand-primary-300',
    dot: 'bg-brand-primary',
  },
]

interface LabsConstraintVizProps {
  lastEvent: ExperimentChangeEvent | null
}

export const LabsConstraintViz = memo(function LabsConstraintViz({
  lastEvent,
}: LabsConstraintVizProps) {
  const [activeStep, setActiveStep] = useState(-1)
  const [isAnimating, setIsAnimating] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevEventRef = useRef<ExperimentChangeEvent | null>(null)

  const animate = useCallback(() => {
    setIsAnimating(true)
    let step = 0

    function next() {
      setActiveStep(step)
      step++
      if (step <= STEPS.length) {
        timeoutRef.current = setTimeout(next, 500)
      } else {
        timeoutRef.current = setTimeout(() => {
          setActiveStep(-1)
          setIsAnimating(false)
        }, 1000)
      }
    }

    next()
  }, [])

  useEffect(() => {
    if (lastEvent && lastEvent !== prevEventRef.current) {
      prevEventRef.current = lastEvent
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      animate()
    }
  }, [lastEvent, animate])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Constraint Flow
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Toggle an experiment to watch the constraint → resolver cycle animate in real time.
        </p>
      </div>

      {/* Flow Visualization */}
      <div className="relative">
        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((step, i) => (
            <div key={step.id} className="flex items-start gap-4">
              {/* Timeline */}
              <div className="flex flex-col items-center">
                <div
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300',
                    activeStep === i
                      ? `${step.borderActive} ${step.bgActive} scale-110`
                      : activeStep > i
                        ? `${step.borderActive} ${step.bgActive}`
                        : `${step.border} ${step.bgIdle}`,
                  )}
                >
                  {activeStep > i ? (
                    <svg className={clsx('h-4 w-4', step.textActive)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className={clsx(
                      'text-xs font-bold transition-colors',
                      activeStep === i ? step.textActive : 'text-slate-400 dark:text-slate-500',
                    )}>
                      {i + 1}
                    </span>
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={clsx(
                      'h-6 w-0.5 transition-colors duration-300',
                      activeStep > i ? step.dot : 'bg-slate-200 dark:bg-slate-700',
                    )}
                  />
                )}
              </div>

              {/* Content */}
              <div
                className={clsx(
                  'flex-1 rounded-xl border px-4 py-3 transition-all duration-300',
                  activeStep === i
                    ? `${step.bgActive} ${step.borderActive} shadow-sm`
                    : activeStep > i
                      ? `${step.bgActive} ${step.border}`
                      : `${step.bgIdle} ${step.border}`,
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'text-sm font-semibold transition-colors',
                      activeStep >= i
                        ? step.textActive
                        : 'text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {step.label}
                  </span>
                  {activeStep === i && (
                    <span className={clsx('h-2 w-2 animate-pulse rounded-full', step.dot)} />
                  )}
                </div>
                <p
                  className={clsx(
                    'mt-0.5 font-mono text-xs transition-colors',
                    activeStep >= i
                      ? 'text-slate-600 dark:text-slate-300'
                      : 'text-slate-400 dark:text-slate-500',
                  )}
                >
                  {lastEvent && activeStep >= i && step.activeDetail
                    ? step.activeDetail(lastEvent)
                    : step.idleDetail}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Status */}
        <div className="mt-4 flex items-center justify-center gap-2" aria-live="polite">
          {isAnimating ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
              <span className="text-xs font-medium text-brand-primary">Reconciling&hellip;</span>
            </>
          ) : activeStep >= STEPS.length - 1 ? (
            <>
              <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Settled</span>
            </>
          ) : (
            <span className="text-xs text-slate-400">
              Toggle an experiment to see the cycle
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
