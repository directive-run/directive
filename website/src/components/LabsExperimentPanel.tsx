'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import { STORAGE_KEYS, safeGetItem, safeSetItem } from '@/lib/storage-keys'
import { EXPERIMENT_CHANGE_EVENT } from '@/lib/useExperiment'

interface Variant {
  id: string
  label: string
  description: string
}

interface Experiment {
  id: string
  name: string
  description: string
  variants: Variant[]
}

const EXPERIMENTS: Experiment[] = [
  {
    id: 'theme-icons',
    name: 'Theme Icons',
    description: 'Which icon style should the theme selector use?',
    variants: [
      { id: 'custom-svg', label: 'Custom SVG', description: 'Hand-drawn SVG icons' },
      { id: 'phosphor', label: 'Phosphor Duotone', description: 'Phosphor icon library with duotone weight (default)' },
    ],
  },
]

type Assignments = Record<string, string>

function getDefaultAssignments(): Assignments {
  const result: Assignments = {}
  for (const exp of EXPERIMENTS) {
    result[exp.id] = exp.variants[0].id
  }

  return result
}

function loadAssignments(): Assignments {
  const saved = safeGetItem(STORAGE_KEYS.EXPERIMENTS)
  if (saved) {
    try {
      const parsed: unknown = JSON.parse(saved)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { ...getDefaultAssignments(), ...(parsed as Assignments) }
      }
    } catch {
      // fall through
    }
  }

  return getDefaultAssignments()
}

export interface ExperimentChangeEvent {
  experimentId: string
  fromVariant: string
  toVariant: string
  timestamp: number
}

interface LabsExperimentPanelProps {
  onExperimentChange?: (event: ExperimentChangeEvent) => void
}

export const LabsExperimentPanel = memo(function LabsExperimentPanel({
  onExperimentChange,
}: LabsExperimentPanelProps) {
  const [assignments, setAssignments] = useState<Assignments>(getDefaultAssignments)
  const [mounted, setMounted] = useState(false)
  const assignmentsRef = useRef(assignments)
  assignmentsRef.current = assignments

  useEffect(() => {
    setMounted(true)
    setAssignments(loadAssignments())
  }, [])

  const handleVariantChange = useCallback(
    (experimentId: string, variantId: string) => {
      if (assignmentsRef.current[experimentId] === variantId) {
        return
      }

      const fromVariant = assignmentsRef.current[experimentId]

      setAssignments((prev) => {
        const next = { ...prev, [experimentId]: variantId }
        safeSetItem(STORAGE_KEYS.EXPERIMENTS, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent(EXPERIMENT_CHANGE_EVENT))

        return next
      })

      onExperimentChange?.({
        experimentId,
        fromVariant,
        toVariant: variantId,
        timestamp: Date.now(),
      })
    },
    [onExperimentChange],
  )

  if (!mounted) {
    return <div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
          A/B Experiments
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Toggle between variants and see simulated previews. These do not change the live site &ndash; they show what each variant would look like. Assignments persist in localStorage.
        </p>
      </div>

      {EXPERIMENTS.map((experiment) => (
        <div
          key={experiment.id}
          className="rounded-2xl border border-slate-200 p-6 dark:border-slate-700"
        >
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {experiment.name}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {experiment.description}
            </p>
          </div>

          {/* Variant Selector */}
          <div className="mb-6 flex flex-wrap gap-2">
            {experiment.variants.map((variant) => (
              <button
                key={variant.id}
                onClick={() => handleVariantChange(experiment.id, variant.id)}
                aria-label={`${experiment.name}: ${variant.label}`}
                className={clsx(
                  'cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition',
                  assignments[experiment.id] === variant.id
                    ? 'border-brand-primary bg-brand-primary-50 text-brand-primary-700 dark:bg-brand-primary-900/30 dark:text-brand-primary-300'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800',
                )}
              >
                {variant.label}
              </button>
            ))}
          </div>

          {/* Live Preview */}
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Live Preview
            </p>
            {experiment.id === 'theme-icons' && (
              <ThemeIconPreview activeVariant={assignments[experiment.id]} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
})

function ThemeIconPreview({ activeVariant }: { activeVariant: string }) {
  return (
    <div className="flex items-center gap-8">
      {/* Custom SVG variant */}
      <div
        className={clsx(
          'flex flex-col items-center gap-2 rounded-xl p-4 transition',
          activeVariant === 'custom-svg'
            ? 'bg-white shadow-sm ring-2 ring-brand-primary dark:bg-slate-700'
            : 'opacity-50',
        )}
      >
        <div className="flex gap-3">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-6 w-6 fill-brand-primary">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M7 1a1 1 0 0 1 2 0v1a1 1 0 1 1-2 0V1Zm4 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm2.657-5.657a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm-1.415 11.313-.707-.707a1 1 0 0 1 1.415-1.415l.707.708a1 1 0 0 1-1.415 1.414ZM16 7.999a1 1 0 0 0-1-1h-1a1 1 0 1 0 0 2h1a1 1 0 0 0 1-1ZM7 14a1 1 0 1 1 2 0v1a1 1 0 1 1-2 0v-1Zm-2.536-2.464a1 1 0 0 0-1.414 0l-.707.707a1 1 0 0 0 1.414 1.414l.707-.707a1 1 0 0 0 0-1.414Zm0-8.486A1 1 0 0 1 3.05 4.464l-.707-.707a1 1 0 0 1 1.414-1.414l.707.707ZM3 8a1 1 0 0 0-1-1H1a1 1 0 0 0 0 2h1a1 1 0 0 0 1-1Z"
            />
          </svg>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-6 w-6 fill-brand-primary">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M7.23 3.333C7.757 2.905 7.68 2 7 2a6 6 0 1 0 0 12c.68 0 .758-.905.23-1.332A5.989 5.989 0 0 1 5 8c0-1.885.87-3.568 2.23-4.668ZM12 5a1 1 0 0 1 1 1 1 1 0 0 0 1 1 1 1 0 1 1 0 2 1 1 0 0 0-1 1 1 1 0 1 1-2 0 1 1 0 0 0-1-1 1 1 0 1 1 0-2 1 1 0 0 0 1-1 1 1 0 0 1 1-1Z"
            />
          </svg>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-6 w-6 fill-brand-primary">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M1 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-1.5l.31 1.242c.084.333.36.573.63.808.091.08.182.158.264.24A1 1 0 0 1 11 15H5a1 1 0 0 1-.704-1.71c.082-.082.173-.16.264-.24.27-.235.546-.475.63-.808L5.5 11H4a3 3 0 0 1-3-3V4Zm3-1a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4Z"
            />
          </svg>
        </div>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Custom SVG</span>
      </div>

      <span className="text-sm text-slate-400">vs</span>

      {/* Phosphor variant */}
      <div
        className={clsx(
          'flex flex-col items-center gap-2 rounded-xl p-4 transition',
          activeVariant === 'phosphor'
            ? 'bg-white shadow-sm ring-2 ring-brand-primary dark:bg-slate-700'
            : 'opacity-50',
        )}
      >
        <div className="flex gap-3">
          {/* Sun-like (simplified Phosphor style) */}
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand-primary" fill="currentColor">
            <circle cx="12" cy="12" r="4" opacity="0.2" />
            <path d="M12 2a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1Zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm10-6a1 1 0 0 1-1 1h-2a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1ZM6 12a1 1 0 0 1-1 1H3a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1Zm12.364-5.636a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 0 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0ZM8.464 15.536a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 0 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0Zm9.9 2.828a1 1 0 0 1-1.414 0l-1.414-1.414a1 1 0 0 1 1.414-1.414l1.414 1.414a1 1 0 0 1 0 1.414ZM8.464 8.464a1 1 0 0 1-1.414 0L5.636 7.05A1 1 0 0 1 7.05 5.636l1.414 1.414a1 1 0 0 1 0 1.414ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
          </svg>
          {/* Moon-like */}
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand-primary" fill="currentColor">
            <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1Z" opacity="0.2" />
            <path d="M21.067 11.857a1 1 0 0 0-1.104-.676 4.389 4.389 0 0 1-5.144-5.144 1 1 0 0 0-1.39-1.072A9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 9.067-9.143Z" />
          </svg>
          {/* Monitor-like */}
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand-primary" fill="currentColor">
            <rect x="3" y="4" width="18" height="12" rx="2" opacity="0.2" />
            <path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5l-1 2H7a1 1 0 0 0 0 2h10a1 1 0 0 0 0-2h-1l-1-2h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 12H4V6h16v10Z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Phosphor</span>
      </div>
    </div>
  )
}

