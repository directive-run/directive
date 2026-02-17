import { Fragment } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  CheckCircle,
  CircleHalf,
  Cube,
  Gauge,
  Minus,
  PlugsConnected,
  ShieldCheck,
  Wrench,
} from '@phosphor-icons/react/dist/ssr'
import clsx from 'clsx'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const libraries = [
  'Directive',
  'Redux',
  'Zustand',
  'XState',
  'React Query',
] as const

type Library = (typeof libraries)[number]

type CellValue = boolean | string

interface Feature {
  name: string
  values: Record<Library, CellValue>
}

interface Section {
  name: string
  icon: Icon
  features: Feature[]
}

const sections: Section[] = [
  {
    name: 'Core',
    icon: Cube,
    features: [
      {
        name: 'Declarative constraints',
        values: {
          Redux: false,
          Zustand: false,

          XState: 'Partial',
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Auto-tracking derivations',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Effects system',
        values: {
          Redux: 'Middleware',
          Zustand: 'Middleware',

          XState: 'Actions',
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Multi-module composition',
        values: {
          Redux: 'Slices',
          Zustand: 'Slices',

          XState: 'Actors',
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Schema validation',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Optimistic updates',
        values: {
          Redux: 'RTK Query',
          Zustand: false,

          XState: false,
          'React Query': true,
          Directive: true,
        },
      },
    ],
  },
  {
    name: 'Resilience',
    icon: ShieldCheck,
    features: [
      {
        name: 'Built-in retry/timeout',
        values: {
          Redux: 'RTK Query',
          Zustand: false,

          XState: 'Partial',
          'React Query': true,
          Directive: true,
        },
      },
      {
        name: 'Error boundaries',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': true,
          Directive: true,
        },
      },
      {
        name: 'Batched resolution',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': true,
          Directive: true,
        },
      },
      {
        name: 'Settlement detection',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': false,
          Directive: true,
        },
      },
    ],
  },
  {
    name: 'Developer Experience',
    icon: Wrench,
    features: [
      {
        name: 'Snapshots',
        values: {
          Redux: true,
          Zustand: false,

          XState: true,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Time-travel debugging',
        values: {
          Redux: true,
          Zustand: true,

          XState: true,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Plugin architecture',
        values: {
          Redux: 'Middleware',
          Zustand: 'Middleware',

          XState: false,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Testing utilities',
        values: {
          Redux: false,
          Zustand: false,

          XState: true,
          'React Query': true,
          Directive: true,
        },
      },
      {
        name: 'TypeScript inference',
        values: {
          Redux: 'Good',
          Zustand: 'Good',

          XState: 'Good',
          'React Query': 'Good',
          Directive: 'Good',
        },
      },
      {
        name: 'Bundle size (gzip)',
        values: {
          Redux: '~11KB',
          Zustand: '~1KB',

          XState: '~14KB',
          'React Query': '~13KB',
          Directive: '~3KB',
        },
      },
      {
        name: 'Learning curve',
        values: {
          Redux: 'Medium',
          Zustand: 'Low',

          XState: 'High',
          'React Query': 'Low',
          Directive: 'Medium',
        },
      },
    ],
  },
  {
    name: 'Integration',
    icon: PlugsConnected,
    features: [
      {
        name: 'AI agent orchestration',
        values: {
          Redux: false,
          Zustand: false,

          XState: false,
          'React Query': false,
          Directive: true,
        },
      },
      {
        name: 'Framework agnostic',
        values: {
          Redux: true,
          Zustand: true,

          XState: true,
          'React Query': true,
          Directive: true,
        },
      },
      {
        name: 'SSR support',
        values: {
          Redux: true,
          Zustand: true,

          XState: true,
          'React Query': true,
          Directive: true,
        },
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

const learningCurveStyles: Record<string, { color: string; label: string }> = {
  Low: { color: 'text-emerald-500', label: 'Low difficulty' },
  Medium: { color: 'text-amber-500', label: 'Medium difficulty' },
  High: { color: 'text-red-500', label: 'High difficulty' },
}

function CellContent({
  value,
  featureName,
}: {
  value: CellValue
  featureName: string
}) {
  if (value === true) {
    return (
      <CheckCircle
        weight="fill"
        className="h-5 w-5 text-emerald-500"
        aria-label="Supported"
      />
    )
  }

  if (value === false) {
    return (
      <Minus
        className="h-5 w-5 text-slate-400 dark:text-slate-600"
        aria-label="Not supported"
      />
    )
  }

  // Partial support
  if (value === 'Partial') {
    return (
      <span className="inline-flex items-center gap-1">
        <CircleHalf
          weight="fill"
          className="h-4 w-4 text-amber-500"
          aria-hidden="true"
        />
        <span className="text-sm text-amber-600 dark:text-amber-400">
          Partial
        </span>
      </span>
    )
  }

  // Learning curve with gauge icon
  if (featureName === 'Learning curve' && learningCurveStyles[value]) {
    const style = learningCurveStyles[value]

    return (
      <span className="inline-flex items-center gap-1">
        <Gauge
          weight="fill"
          className={clsx('h-4 w-4', style.color)}
          aria-label={style.label}
        />
        <span className="text-sm text-slate-700 dark:text-slate-200">
          {value}
        </span>
      </span>
    )
  }

  // Default text
  return (
    <span className="text-sm text-slate-700 dark:text-slate-200">{value}</span>
  )
}

// ---------------------------------------------------------------------------
// Table component
// ---------------------------------------------------------------------------

const DIRECTIVE_INDEX = libraries.indexOf('Directive')

export function ComparisonTable() {
  return (
    <div className="not-prose my-10">
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700/60">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">
            Comparison of state management libraries: Directive, Redux, Zustand,
            XState, and React Query
          </caption>

          {/* Header */}
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-brand-surface px-3 py-3 text-sm font-semibold text-slate-900 dark:text-white" />
              {libraries.map((lib, i) => (
                <th
                  key={lib}
                  className={clsx(
                    'px-3 py-3 text-center text-sm font-semibold',
                    i === DIRECTIVE_INDEX
                      ? 'border-t-2 border-brand-primary bg-brand-primary-50 text-brand-primary-700 dark:bg-brand-primary-950/30 dark:text-brand-primary-300'
                      : 'bg-brand-surface text-slate-900 dark:text-white',
                  )}
                >
                  {lib}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sections.map((section) => {
              const SectionIcon = section.icon

              return (
                <Fragment key={section.name}>
                  {/* Section header */}
                  <tr>
                    <td
                      colSpan={libraries.length + 1}
                      className="bg-brand-surface-raised px-3 py-2.5"
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <SectionIcon className="h-4 w-4" />
                        {section.name}
                      </span>
                    </td>
                  </tr>

                  {/* Feature rows */}
                  {section.features.map((feature) => (
                    <tr
                      key={feature.name}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-brand-surface-raised/50 dark:border-slate-800"
                    >
                      <td className="sticky left-0 z-10 bg-brand-surface px-3 py-3 text-sm font-medium text-slate-900 dark:text-white">
                        {feature.name}
                      </td>
                      {libraries.map((lib, i) => (
                        <td
                          key={lib}
                          className={clsx(
                            'px-3 py-3 text-center',
                            i === DIRECTIVE_INDEX &&
                              'bg-brand-primary-50/50 dark:bg-brand-primary-950/20',
                          )}
                        >
                          <span className="inline-flex items-center justify-center">
                            <CellContent
                              value={feature.values[lib]}
                              featureName={feature.name}
                            />
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
