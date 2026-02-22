'use client'

import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'

// Animation phases: produce → evaluate → fail/revise → evaluate → pass → accept
const PHASE_COUNT = 6

export const ReflectLoopDiagram = memo(function ReflectLoopDiagram() {
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
      setPhase((prev) => (prev + 1) % PHASE_COUNT)
    }, 1400)

    return () => clearInterval(interval)
  }, [phase >= 0])

  // Derive iteration counter from phase
  const iteration = phase <= 1 ? 1 : phase <= 3 ? 2 : 3

  const producerActive = phase === 0 || phase === 2
  const evaluatorActive = phase === 1 || phase === 3 || phase === 4
  const feedbackActive = phase === 2
  const passActive = phase === 4 || phase === 5
  const acceptActive = phase === 5

  return (
    <div className="not-prose my-8 overflow-x-auto">
      <svg
        viewBox="0 0 700 300"
        className="mx-auto h-auto w-full max-w-3xl"
        aria-labelledby="reflect-loop-title"
        role="img"
      >
        <title id="reflect-loop-title">Reflect Loop — producer and evaluator iterate until quality threshold is met</title>

        <defs>
          <marker
            id="reflect-arrow"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-slate-400 dark:fill-slate-500" />
          </marker>
          <marker
            id="reflect-arrow-active"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-brand-primary" />
          </marker>
          <marker
            id="reflect-arrow-pass"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-emerald-500" />
          </marker>
          <marker
            id="reflect-arrow-fail"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-amber-500" />
          </marker>
        </defs>

        {/* Producer box */}
        <g transform="translate(60, 80)">
          <rect
            width="160"
            height="64"
            rx="10"
            className={clsx(
              'transition-all duration-300',
              producerActive
                ? 'fill-brand-primary-200 stroke-brand-primary-600 dark:fill-brand-primary-800 dark:stroke-brand-primary-300'
                : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={producerActive ? 2.5 : 1.5}
          />
          <text x="80" y="34" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            Producer
          </text>
          <text x="80" y="50" textAnchor="middle" className="pointer-events-none fill-slate-400 text-xs dark:fill-slate-500">
            (writer)
          </text>
          {producerActive && (
            <rect width="160" height="64" rx="10" fill="none" stroke="var(--brand-primary)" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Forward arrow: producer → evaluator */}
        <line
          x1="220" y1="112" x2="330" y2="112"
          className={clsx(
            'transition-all duration-300',
            evaluatorActive ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={evaluatorActive ? 2 : 1.5}
          markerEnd={evaluatorActive ? 'url(#reflect-arrow-active)' : 'url(#reflect-arrow)'}
        />
        <text x="275" y="102" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
          output
        </text>

        {/* Evaluator box */}
        <g transform="translate(335, 80)">
          <rect
            width="160"
            height="64"
            rx="10"
            className={clsx(
              'transition-all duration-300',
              evaluatorActive
                ? 'fill-violet-200 stroke-violet-600 dark:fill-violet-800 dark:stroke-violet-300'
                : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={evaluatorActive ? 2.5 : 1.5}
          />
          <text x="80" y="34" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            Evaluator
          </text>
          <text x="80" y="50" textAnchor="middle" className="pointer-events-none fill-slate-400 text-xs dark:fill-slate-500">
            (reviewer)
          </text>
          {evaluatorActive && (
            <rect width="160" height="64" rx="10" fill="none" stroke="#8b5cf6" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Feedback loop arrow (curved, bottom path) */}
        <path
          d="M 335 144 Q 335 195, 255 195 Q 175 195, 175 144"
          fill="none"
          className={clsx(
            'transition-all duration-300',
            feedbackActive ? 'stroke-amber-500' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={feedbackActive ? 2.5 : 1.5}
          markerEnd={feedbackActive ? 'url(#reflect-arrow-fail)' : 'url(#reflect-arrow)'}
        />
        <text x="255" y="215" textAnchor="middle" className={clsx(
          'text-xs transition-all duration-300',
          feedbackActive ? 'fill-amber-600 font-semibold dark:fill-amber-400' : 'fill-slate-400 dark:fill-slate-500',
        )}>
          feedback + revision
        </text>
        <text x="255" y="228" textAnchor="middle" className={clsx(
          'text-xs transition-all duration-300',
          feedbackActive ? 'fill-amber-500 dark:fill-amber-400' : 'fill-slate-400 dark:fill-slate-500',
        )}>
          (fail)
        </text>

        {/* Pass arrow: evaluator → accept */}
        <line
          x1="495" y1="130" x2="545" y2="175"
          className={clsx(
            'transition-all duration-300',
            passActive ? 'stroke-emerald-500' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth={passActive ? 2.5 : 1.5}
          markerEnd={passActive ? 'url(#reflect-arrow-pass)' : 'url(#reflect-arrow)'}
        />
        <text x="540" y="142" textAnchor="middle" className={clsx(
          'text-xs transition-all duration-300',
          passActive ? 'fill-emerald-600 font-semibold dark:fill-emerald-400' : 'fill-slate-400 dark:fill-slate-500',
        )}>
          pass
        </text>

        {/* Accept box */}
        <g transform="translate(530, 178)">
          <rect
            width="120"
            height="48"
            rx="10"
            className={clsx(
              'transition-all duration-300',
              acceptActive
                ? 'fill-emerald-200 stroke-emerald-600 dark:fill-emerald-800 dark:stroke-emerald-300'
                : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth={acceptActive ? 2.5 : 1.5}
          />
          <text x="60" y="29" textAnchor="middle" className="pointer-events-none fill-slate-700 text-sm font-semibold dark:fill-slate-200">
            Accept
          </text>
          {acceptActive && (
            <rect width="120" height="48" rx="10" fill="none" stroke="#10b981" strokeWidth="2" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* Iteration badge */}
        <g transform="translate(55, 35)">
          <rect
            width="90"
            height="26"
            rx="13"
            className={clsx(
              'transition-all duration-300',
              phase >= 0
                ? 'fill-brand-primary-100 stroke-brand-primary-400 dark:fill-brand-primary-900 dark:stroke-brand-primary-600'
                : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
            )}
            strokeWidth="1"
          />
          <text
            x="45"
            y="17"
            textAnchor="middle"
            className={clsx(
              'text-xs font-medium transition-all duration-300',
              phase >= 0
                ? 'fill-brand-primary-700 dark:fill-brand-primary-300'
                : 'fill-slate-400 dark:fill-slate-500',
            )}
          >
            iteration {iteration}/3
          </text>
        </g>

        {/* score ≥ threshold label near pass arrow */}
        <text x="558" y="162" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
          score ≥ threshold
        </text>
      </svg>
    </div>
  )
})
