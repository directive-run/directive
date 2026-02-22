'use client'

import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'

// Animation phases:
// 0: attempt 1 (running)
// 1: attempt 1 fail, attempt 2 running
// 2: attempt 2 fail, attempt 3 running
// 3: all retries failed → fallback primary
// 4: primary fails → backup running
// 5: circuit breaker closed → open
// 6: 30s passes → half-open
// 7: success → closed again
const PHASE_COUNT = 8

export const ResilienceCascadeDiagram = memo(function ResilienceCascadeDiagram() {
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
    }, 1200)

    return () => clearInterval(interval)
  }, [phase >= 0])

  const retryActive = phase >= 0 && phase <= 2
  const fallbackActive = phase >= 3 && phase <= 4
  const circuitActive = phase >= 5

  return (
    <div className="not-prose my-8 overflow-x-auto">
      <svg
        viewBox="0 0 700 400"
        className="mx-auto h-auto w-full max-w-3xl"
        aria-labelledby="resilience-cascade-title"
        role="img"
      >
        <title id="resilience-cascade-title">Resilience Cascade — retry, fallback, and circuit breaker layers</title>

        <defs>
          <marker
            id="rc-arrow"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-slate-400 dark:fill-slate-500" />
          </marker>
          <marker
            id="rc-arrow-active"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" className="fill-brand-primary" />
          </marker>
        </defs>

        {/* ── Retry Layer ── */}
        <g transform="translate(40, 20)">
          {/* Background */}
          <rect
            width="620"
            height="100"
            rx="12"
            className={clsx(
              'transition-all duration-300',
              retryActive
                ? 'fill-brand-primary-50 stroke-brand-primary-300 dark:fill-brand-primary-950 dark:stroke-brand-primary-700'
                : 'fill-slate-50 stroke-slate-200 dark:fill-slate-900 dark:stroke-slate-700',
            )}
            strokeWidth="1.5"
          />
          <text x="16" y="24" className="fill-slate-500 text-xs font-semibold uppercase tracking-wide dark:fill-slate-400">
            Retry Layer
          </text>

          {/* Attempt 1 */}
          <g transform="translate(30, 40)">
            <rect
              width="120"
              height="44"
              rx="6"
              className={clsx(
                'transition-all duration-300',
                phase === 0
                  ? 'fill-brand-primary-200 stroke-brand-primary-500 dark:fill-brand-primary-800 dark:stroke-brand-primary-400'
                  : phase > 0
                    ? 'fill-red-100 stroke-red-400 dark:fill-red-900/50 dark:stroke-red-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={phase === 0 ? 2 : 1.5}
            />
            <text x="60" y="22" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Attempt 1
            </text>
            {phase > 0 && (
              <text x="60" y="38" textAnchor="middle" className="fill-red-500 text-xs font-bold dark:fill-red-400">
                ✕
              </text>
            )}
          </g>

          {/* Arrow 1→2 */}
          <line
            x1="160" y1="62" x2="210" y2="62"
            className={clsx(
              'transition-all duration-300',
              phase >= 1 ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase >= 1 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="185" y="55" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            1s
          </text>

          {/* Attempt 2 */}
          <g transform="translate(220, 40)">
            <rect
              width="120"
              height="44"
              rx="6"
              className={clsx(
                'transition-all duration-300',
                phase === 1
                  ? 'fill-brand-primary-200 stroke-brand-primary-500 dark:fill-brand-primary-800 dark:stroke-brand-primary-400'
                  : phase > 1
                    ? 'fill-red-100 stroke-red-400 dark:fill-red-900/50 dark:stroke-red-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={phase === 1 ? 2 : 1.5}
            />
            <text x="60" y="22" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Attempt 2
            </text>
            {phase > 1 && (
              <text x="60" y="38" textAnchor="middle" className="fill-red-500 text-xs font-bold dark:fill-red-400">
                ✕
              </text>
            )}
          </g>

          {/* Arrow 2→3 */}
          <line
            x1="350" y1="62" x2="400" y2="62"
            className={clsx(
              'transition-all duration-300',
              phase >= 2 ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase >= 2 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="375" y="55" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            2s
          </text>

          {/* Attempt 3 */}
          <g transform="translate(410, 40)">
            <rect
              width="120"
              height="44"
              rx="6"
              className={clsx(
                'transition-all duration-300',
                phase === 2
                  ? 'fill-brand-primary-200 stroke-brand-primary-500 dark:fill-brand-primary-800 dark:stroke-brand-primary-400'
                  : phase > 2
                    ? 'fill-red-100 stroke-red-400 dark:fill-red-900/50 dark:stroke-red-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={phase === 2 ? 2 : 1.5}
            />
            <text x="60" y="22" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Attempt 3
            </text>
            {phase > 2 && (
              <text x="60" y="38" textAnchor="middle" className="fill-red-500 text-xs font-bold dark:fill-red-400">
                ✕
              </text>
            )}
          </g>
        </g>

        {/* Connector: retry → fallback */}
        <line
          x1="350" y1="120" x2="350" y2="148"
          className={clsx(
            'transition-all duration-300',
            fallbackActive ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth="1.5"
          markerEnd={fallbackActive ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
        />
        <text x="430" y="138" textAnchor="middle" className={clsx(
          'text-xs',
          fallbackActive ? 'fill-red-500 font-medium dark:fill-red-400' : 'fill-slate-400 dark:fill-slate-500',
        )}>
          all retries failed
        </text>

        {/* ── Fallback Layer ── */}
        <g transform="translate(40, 150)">
          <rect
            width="620"
            height="85"
            rx="12"
            className={clsx(
              'transition-all duration-300',
              fallbackActive
                ? 'fill-amber-50 stroke-amber-300 dark:fill-amber-950 dark:stroke-amber-700'
                : 'fill-slate-50 stroke-slate-200 dark:fill-slate-900 dark:stroke-slate-700',
            )}
            strokeWidth="1.5"
          />
          <text x="16" y="24" className="fill-slate-500 text-xs font-semibold uppercase tracking-wide dark:fill-slate-400">
            Fallback Layer
          </text>

          {/* Primary */}
          <g transform="translate(80, 36)">
            <rect
              width="140"
              height="40"
              rx="6"
              className={clsx(
                'transition-all duration-300',
                phase === 3
                  ? 'fill-amber-200 stroke-amber-500 dark:fill-amber-800 dark:stroke-amber-400'
                  : phase > 3
                    ? 'fill-red-100 stroke-red-400 dark:fill-red-900/50 dark:stroke-red-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={phase === 3 ? 2 : 1.5}
            />
            <text x="70" y="25" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Primary
            </text>
          </g>

          {/* Arrow primary → backup */}
          <line
            x1="230" y1="56" x2="330" y2="56"
            className={clsx(
              'transition-all duration-300',
              phase >= 4 ? 'stroke-amber-500' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase >= 4 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="280" y="49" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            failover
          </text>

          {/* Backup */}
          <g transform="translate(340, 36)">
            <rect
              width="140"
              height="40"
              rx="6"
              className={clsx(
                'transition-all duration-300',
                phase === 4
                  ? 'fill-emerald-200 stroke-emerald-500 dark:fill-emerald-800 dark:stroke-emerald-400'
                  : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={phase === 4 ? 2 : 1.5}
            />
            <text x="70" y="25" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Backup
            </text>
            {phase === 4 && (
              <rect width="140" height="40" rx="6" fill="none" stroke="#10b981" strokeWidth="2" opacity="0.4">
                <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite" />
              </rect>
            )}
          </g>
        </g>

        {/* Connector: fallback → circuit breaker */}
        <line
          x1="350" y1="235" x2="350" y2="263"
          className={clsx(
            'transition-all duration-300',
            circuitActive ? 'stroke-brand-primary' : 'stroke-slate-300 dark:stroke-slate-600',
          )}
          strokeWidth="1.5"
          markerEnd={circuitActive ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
        />

        {/* ── Circuit Breaker Layer ── */}
        <g transform="translate(40, 265)">
          <rect
            width="620"
            height="115"
            rx="12"
            className={clsx(
              'transition-all duration-300',
              circuitActive
                ? 'fill-violet-50 stroke-violet-300 dark:fill-violet-950 dark:stroke-violet-700'
                : 'fill-slate-50 stroke-slate-200 dark:fill-slate-900 dark:stroke-slate-700',
            )}
            strokeWidth="1.5"
          />
          <text x="16" y="24" className="fill-slate-500 text-xs font-semibold uppercase tracking-wide dark:fill-slate-400">
            Circuit Breaker
          </text>

          {/* Closed state */}
          <g transform="translate(80, 45)">
            <circle
              cx="28"
              cy="24"
              r="22"
              className={clsx(
                'transition-all duration-300',
                (phase === 5 || phase === 7)
                  ? 'fill-emerald-200 stroke-emerald-500 dark:fill-emerald-800 dark:stroke-emerald-400'
                  : circuitActive
                    ? 'fill-slate-100 stroke-slate-400 dark:fill-slate-700 dark:stroke-slate-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={(phase === 5 || phase === 7) ? 2.5 : 1.5}
            />
            <text x="28" y="20" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Closed
            </text>
            <text x="28" y="33" textAnchor="middle" className="pointer-events-none fill-emerald-500 text-xs dark:fill-emerald-400">
              ●
            </text>
          </g>

          {/* Arrow: closed → open */}
          <line
            x1="140" y1="69" x2="230" y2="69"
            className={clsx(
              'transition-all duration-300',
              phase === 5 ? 'stroke-red-500' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase === 5 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="185" y="62" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            5 fails
          </text>

          {/* Open state */}
          <g transform="translate(240, 45)">
            <circle
              cx="28"
              cy="24"
              r="22"
              className={clsx(
                'transition-all duration-300',
                (phase === 5 || phase === 6)
                  ? 'fill-red-200 stroke-red-500 dark:fill-red-900 dark:stroke-red-400'
                  : circuitActive
                    ? 'fill-slate-100 stroke-slate-400 dark:fill-slate-700 dark:stroke-slate-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={(phase === 5 || phase === 6) ? 2.5 : 1.5}
            />
            <text x="28" y="20" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Open
            </text>
            <text x="28" y="33" textAnchor="middle" className="pointer-events-none fill-red-500 text-xs dark:fill-red-400">
              ●
            </text>
          </g>

          {/* Arrow: open → half-open */}
          <line
            x1="300" y1="69" x2="390" y2="69"
            className={clsx(
              'transition-all duration-300',
              phase === 6 ? 'stroke-amber-500' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase === 6 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="345" y="62" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            30s
          </text>

          {/* Half-Open state */}
          <g transform="translate(400, 45)">
            <circle
              cx="28"
              cy="24"
              r="22"
              className={clsx(
                'transition-all duration-300',
                (phase === 6 || phase === 7)
                  ? 'fill-amber-200 stroke-amber-500 dark:fill-amber-800 dark:stroke-amber-400'
                  : circuitActive
                    ? 'fill-slate-100 stroke-slate-400 dark:fill-slate-700 dark:stroke-slate-500'
                    : 'fill-slate-100 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600',
              )}
              strokeWidth={(phase === 6 || phase === 7) ? 2.5 : 1.5}
            />
            <text x="28" y="17" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Half-
            </text>
            <text x="28" y="29" textAnchor="middle" className="pointer-events-none fill-slate-700 text-xs font-medium dark:fill-slate-200">
              Open
            </text>
            <text x="28" y="42" textAnchor="middle" className="pointer-events-none fill-amber-500 text-xs dark:fill-amber-400">
              ●
            </text>
          </g>

          {/* Arrow: half-open → closed (curved, above) */}
          <path
            d="M 428 43 Q 428 15, 280 15 Q 108 15, 108 43"
            fill="none"
            className={clsx(
              'transition-all duration-300',
              phase === 7 ? 'stroke-emerald-500' : 'stroke-slate-300 dark:stroke-slate-600',
            )}
            strokeWidth="1.5"
            markerEnd={phase === 7 ? 'url(#rc-arrow-active)' : 'url(#rc-arrow)'}
          />
          <text x="280" y="11" textAnchor="middle" className="fill-slate-400 text-xs dark:fill-slate-500">
            success
          </text>
        </g>
      </svg>
    </div>
  )
})
