'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  PencilSimple,
  ArrowsClockwise,
  Funnel,
  PaperPlaneTilt,
  Lightning,
  CheckCircle,
  Clock,
} from '@phosphor-icons/react'

import type { ExperimentChangeEvent } from '@/components/LabsExperimentPanel'

interface Step {
  id: string
  label: string
  idleDetail: string
  activeDetail?: (event: ExperimentChangeEvent) => string
  icon: React.ElementType
  iconBg: string
  iconBgDone: string
}

const STEPS: Step[] = [
  {
    id: 'fact',
    label: 'Fact mutated',
    idleDetail: 'A value in the store changes',
    activeDetail: (e) => `assignments["${e.experimentId}"] = "${e.toVariant}"`,
    icon: PencilSimple,
    iconBg: 'bg-brand-primary',
    iconBgDone: 'bg-brand-primary',
  },
  {
    id: 'derivation',
    label: 'Derivation invalidated',
    idleDetail: 'Computed values that depend on it recompute',
    icon: ArrowsClockwise,
    iconBg: 'bg-sky-500',
    iconBgDone: 'bg-sky-500',
  },
  {
    id: 'constraint',
    label: 'Constraint evaluates',
    idleDetail: 'Rules check if any action is needed',
    activeDetail: (e) => `needsExposure("${e.experimentId}") → true`,
    icon: Funnel,
    iconBg: 'bg-amber-500',
    iconBgDone: 'bg-amber-500',
  },
  {
    id: 'requirement',
    label: 'Requirement emitted',
    idleDetail: 'A needed action is identified and queued',
    activeDetail: (e) => `TRACK_EXPOSURE { "${e.experimentId}", "${e.toVariant}" }`,
    icon: PaperPlaneTilt,
    iconBg: 'bg-violet-500',
    iconBgDone: 'bg-violet-500',
  },
  {
    id: 'resolver',
    label: 'Resolver executes',
    idleDetail: 'The matching handler fulfills the requirement',
    activeDetail: (e) => `trackExposure("${e.experimentId}", "${e.toVariant}")`,
    icon: Lightning,
    iconBg: 'bg-emerald-500',
    iconBgDone: 'bg-emerald-500',
  },
  {
    id: 'settled',
    label: 'Facts updated',
    idleDetail: 'Results written back to the store',
    activeDetail: (e) => `exposures["${e.experimentId}"] = ${e.timestamp}`,
    icon: CheckCircle,
    iconBg: 'bg-brand-primary',
    iconBgDone: 'bg-brand-primary',
  },
]

/** Delay between steps in ms (slowed for visualization). */
const STEP_DELAY = 600

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
        timeoutRef.current = setTimeout(next, STEP_DELAY)
      } else {
        timeoutRef.current = setTimeout(() => {
          setIsAnimating(false)
        }, 800)
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
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          Constraint Flow
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Toggle an experiment to watch the constraint &rarr; resolver cycle.
        </p>
      </div>

      {/* Slow-motion callout */}
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
        <Clock weight="bold" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Slowed to {STEP_DELAY}ms per step for visualization. In production this cycle completes synchronously in &lt;1ms.
        </p>
      </div>

      {/* Feed */}
      <div className="flow-root">
        <ul role="list" className="-mb-8">
          {STEPS.map((step, i) => {
            const isActive = activeStep === i
            const isDone = activeStep > i
            const isReached = activeStep >= i
            const Icon = step.icon

            return (
              <li key={step.id}>
                <div className="relative pb-8">
                  {/* Connector line */}
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'absolute top-4 left-4 -ml-px h-full w-0.5 transition-colors duration-300',
                        isDone
                          ? 'bg-slate-300 dark:bg-slate-600'
                          : 'bg-slate-200 dark:bg-slate-700/50',
                      )}
                    />
                  )}

                  <div className="relative flex space-x-3">
                    {/* Icon circle */}
                    <div>
                      <span
                        className={clsx(
                          'flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white transition-all duration-300 dark:ring-slate-800',
                          isReached
                            ? step.iconBg
                            : 'bg-slate-200 dark:bg-slate-700',
                          isActive && 'scale-110 shadow-lg',
                        )}
                      >
                        <Icon
                          weight="bold"
                          aria-hidden="true"
                          className={clsx(
                            'h-4 w-4 transition-colors duration-300',
                            isReached
                              ? 'text-white'
                              : 'text-slate-400 dark:text-slate-500',
                          )}
                        />
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex min-w-0 flex-1 justify-between pt-1">
                      <div className="min-w-0">
                        <p
                          className={clsx(
                            'flex items-center text-sm font-medium transition-colors duration-300',
                            isReached
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-400 dark:text-slate-500',
                          )}
                        >
                          {step.label}
                          {isActive && (
                            <span className="ml-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand-primary" />
                          )}
                        </p>
                        <p
                          className={clsx(
                            'mt-0.5 truncate font-mono text-xs transition-colors duration-300',
                            isReached
                              ? 'text-slate-500 dark:text-slate-400'
                              : 'text-slate-300 dark:text-slate-600',
                          )}
                        >
                          {lastEvent && isReached && step.activeDetail
                            ? step.activeDetail(lastEvent)
                            : step.idleDetail}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Status banner */}
      <div aria-live="polite">
        {isAnimating && activeStep < STEPS.length ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-brand-primary-200 bg-brand-primary-50 px-4 py-3 dark:border-brand-primary-800/40 dark:bg-brand-primary-950/30">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-primary" />
            <span className="text-sm font-semibold text-brand-primary-700 dark:text-brand-primary-300">
              Reconciling&hellip;
            </span>
            <span className="text-xs text-brand-primary-500 dark:text-brand-primary-400">
              Step {activeStep + 1} of {STEPS.length}
            </span>
          </div>
        ) : activeStep >= STEPS.length - 1 ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-950/30">
            <CheckCircle weight="fill" className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Settled
            </span>
            <span className="text-xs text-emerald-500 dark:text-emerald-400">
              All constraints resolved
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <span className="text-sm text-slate-400 dark:text-slate-500">
              Toggle an experiment to see the cycle
            </span>
          </div>
        )}
      </div>
    </div>
  )
})
