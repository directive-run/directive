'use client'

import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'

const STEPS = [
  'researcher',
  'factChecker',
  'writer',
  'editor',
  'seo',
] as const

type Step = (typeof STEPS)[number]

// Animation sequence: parallel nodes → writer → editor → conditional seo
const ANIMATION_PHASES = [
  ['researcher', 'factChecker'], // parallel
  ['writer'],
  ['editor'],
  ['seo'],
] as const

export const DagFlowDiagram = memo(function DagFlowDiagram() {
  const [phase, setPhase] = useState(-1)

  useEffect(() => {
    const timer = setTimeout(() => setPhase(0), 400)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (phase < 0) {
      return
    }

    const interval = setInterval(() => {
      setPhase((prev) => (prev + 1) % (ANIMATION_PHASES.length + 1))
    }, 1200)

    return () => clearInterval(interval)
  }, [phase >= 0])

  const isActive = (step: Step) => {
    if (phase < 0 || phase >= ANIMATION_PHASES.length) {
      return false
    }

    return (ANIMATION_PHASES[phase] as readonly string[]).includes(step)
  }

  const isPast = (step: Step) => {
    if (phase < 0) {
      return false
    }

    for (let i = 0; i < Math.min(phase, ANIMATION_PHASES.length); i++) {
      if ((ANIMATION_PHASES[i] as readonly string[]).includes(step)) {
        return true
      }
    }

    return false
  }

  const isArrowActive = (from: Step | Step[], to: Step) => {
    return isActive(to) || isPast(to)
  }

  return (
    <div className="not-prose my-8 overflow-x-auto">
      <svg
        viewBox="0 0 700 320"
        className="mx-auto h-auto w-full max-w-3xl"
        aria-labelledby="dag-flow-title"
        role="img"
      >
        <title id="dag-flow-title">DAG Pipeline Flow — parallel nodes converge into sequential stages</title>

        <defs>
          <marker
            id="dag-arrow"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className="fill-slate-400 dark:fill-slate-500"
            />
          </marker>
          <marker
            id="dag-arrow-active"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className="fill-brand-primary"
            />
          </marker>
        </defs>

        {/* researcher node */}
        <g transform="translate(60, 30)">
          <rect
            width="140"
            height="52"
            rx="8"
            className={clsx(
              'transition-all duration-300',
              isActive('researcher')
                ? 'fill-brand-primary-200 stroke-brand-primary-600 dark:fill-brand-primary-800 dark:stroke-brand-primary-300'
                : isPast('researcher')
                  ? 'fill-brand-primary-100 stroke-brand-primary-400 dark:fill-brand-primary-900/60 dark:stroke-brand-primary-500'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={isActive('researcher') ? 2.5 : 1.5}
          />
          <text x="70" y="31" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            researcher
          </text>
          {isActive('researcher') && (
            <rect width="140" height="52" rx="8" fill="none" stroke="var(--brand-primary)" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* factChecker node */}
        <g transform="translate(320, 30)">
          <rect
            width="140"
            height="52"
            rx="8"
            className={clsx(
              'transition-all duration-300',
              isActive('factChecker')
                ? 'fill-brand-primary-200 stroke-brand-primary-600 dark:fill-brand-primary-800 dark:stroke-brand-primary-300'
                : isPast('factChecker')
                  ? 'fill-brand-primary-100 stroke-brand-primary-400 dark:fill-brand-primary-900/60 dark:stroke-brand-primary-500'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={isActive('factChecker') ? 2.5 : 1.5}
          />
          <text x="70" y="31" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            factChecker
          </text>
          {isActive('factChecker') && (
            <rect width="140" height="52" rx="8" fill="none" stroke="var(--brand-primary)" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* "parallel" label */}
        <text x="260" y="18" textAnchor="middle" className="fill-slate-400 text-xs italic dark:fill-slate-500">
          parallel (no deps)
        </text>

        {/* Arrows from researcher → writer */}
        <line
          x1="200" y1="82" x2="295" y2="128"
          className={clsx(
            'transition-all duration-300',
            isArrowActive('researcher', 'writer') ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={isArrowActive('researcher', 'writer') ? 2 : 1.5}
          markerEnd={isArrowActive('researcher', 'writer') ? 'url(#dag-arrow-active)' : 'url(#dag-arrow)'}
        />

        {/* Arrows from factChecker → writer */}
        <line
          x1="320" y1="82" x2="295" y2="128"
          className={clsx(
            'transition-all duration-300',
            isArrowActive('factChecker', 'writer') ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={isArrowActive('factChecker', 'writer') ? 2 : 1.5}
          markerEnd={isArrowActive('factChecker', 'writer') ? 'url(#dag-arrow-active)' : 'url(#dag-arrow)'}
        />

        {/* writer node */}
        <g transform="translate(220, 120)">
          <rect
            width="140"
            height="52"
            rx="8"
            className={clsx(
              'transition-all duration-300',
              isActive('writer')
                ? 'fill-violet-200 stroke-violet-600 dark:fill-violet-800 dark:stroke-violet-300'
                : isPast('writer')
                  ? 'fill-violet-100 stroke-violet-400 dark:fill-violet-900/60 dark:stroke-violet-500'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={isActive('writer') ? 2.5 : 1.5}
          />
          <text x="70" y="31" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            writer
          </text>
          {isActive('writer') && (
            <rect width="140" height="52" rx="8" fill="none" stroke="#8b5cf6" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Arrow writer → editor */}
        <line
          x1="290" y1="172" x2="290" y2="198"
          className={clsx(
            'transition-all duration-300',
            isArrowActive('writer', 'editor') ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={isArrowActive('writer', 'editor') ? 2 : 1.5}
          markerEnd={isArrowActive('writer', 'editor') ? 'url(#dag-arrow-active)' : 'url(#dag-arrow)'}
        />

        {/* editor node */}
        <g transform="translate(220, 200)">
          <rect
            width="140"
            height="52"
            rx="8"
            className={clsx(
              'transition-all duration-300',
              isActive('editor')
                ? 'fill-emerald-200 stroke-emerald-600 dark:fill-emerald-800 dark:stroke-emerald-300'
                : isPast('editor')
                  ? 'fill-emerald-100 stroke-emerald-400 dark:fill-emerald-900/60 dark:stroke-emerald-500'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={isActive('editor') ? 2.5 : 1.5}
          />
          <text x="70" y="31" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            editor
          </text>
          {isActive('editor') && (
            <rect width="140" height="52" rx="8" fill="none" stroke="#10b981" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Arrow editor → seo */}
        <line
          x1="360" y1="226" x2="440" y2="226"
          className={clsx(
            'transition-all duration-300',
            isArrowActive('editor', 'seo') ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={isArrowActive('editor', 'seo') ? 2 : 1.5}
          strokeDasharray="6 3"
          markerEnd={isArrowActive('editor', 'seo') ? 'url(#dag-arrow-active)' : 'url(#dag-arrow)'}
        />

        {/* seo node (conditional — dashed border) */}
        <g transform="translate(445, 200)">
          <rect
            width="160"
            height="52"
            rx="8"
            className={clsx(
              'transition-all duration-300',
              isActive('seo')
                ? 'fill-amber-200 stroke-amber-600 dark:fill-amber-800 dark:stroke-amber-300'
                : isPast('seo')
                  ? 'fill-amber-100 stroke-amber-400 dark:fill-amber-900/60 dark:stroke-amber-500'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={isActive('seo') ? 2.5 : 1.5}
            strokeDasharray={isActive('seo') ? 'none' : '6 3'}
          />
          <text x="80" y="25" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            seo
          </text>
          <text x="80" y="42" textAnchor="middle" className="pointer-events-none fill-slate-400 text-xs dark:fill-slate-500">
            when: input.includes('[SEO]')
          </text>
          {isActive('seo') && (
            <rect width="160" height="52" rx="8" fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Step indicator */}
        <g transform="translate(120, 290)">
          {['researcher + factChecker', 'writer', 'editor', 'seo (conditional)'].map((label, i) => {
            const active = phase === i
            const xOffset = i * 130

            return (
              <g key={label} transform={`translate(${xOffset}, 0)`}>
                <circle
                  cx="6"
                  cy="6"
                  r="4"
                  className={clsx(
                    'transition-all duration-300',
                    active ? 'fill-brand-primary' : 'fill-slate-300 dark:fill-slate-600',
                  )}
                />
                <text
                  x="16"
                  y="10"
                  className={clsx(
                    'text-xs transition-all duration-300',
                    active ? 'fill-brand-primary-700 dark:fill-brand-primary-300' : 'fill-slate-400 dark:fill-slate-500',
                  )}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
})
