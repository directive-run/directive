'use client'

import { usePolledSnapshot } from '../hooks/usePolledSnapshot'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'

// C1: Uses shared usePolledSnapshot
// m8: Polls on interval (matches other views) instead of fetching once

export function ConfigView() {
  const { data, error } = usePolledSnapshot()

  if (error) {
    return <EmptyState message={error} />
  }

  if (!data) {
    return <Skeleton rows={6} />
  }

  const { config } = data

  interface ConfigSection {
    title: string
    items: { label: string; value: string }[]
  }

  const sections: ConfigSection[] = [
    {
      title: 'Model',
      items: [
        { label: 'Primary', value: config.model },
        { label: 'Fallback', value: config.fallbackModel ?? 'none' },
        { label: 'Max tokens', value: String(config.maxTokenBudget) },
        { label: 'Max response chars', value: String(config.maxResponseChars) },
      ],
    },
    {
      title: 'Memory',
      items: [
        { label: 'Strategy', value: config.memoryStrategy },
        { label: 'Max history', value: `${config.maxHistoryMessages} messages` },
        { label: 'Preserve recent', value: `${config.preserveRecentCount} messages` },
      ],
    },
    {
      title: 'Retry',
      items: [
        { label: 'Max retries', value: String(config.retry.maxRetries) },
        { label: 'Base delay', value: `${config.retry.baseDelayMs}ms` },
        { label: 'Max delay', value: `${config.retry.maxDelayMs}ms` },
      ],
    },
    {
      title: 'Circuit Breaker',
      items: [
        { label: 'Failure threshold', value: String(config.circuitBreaker.failureThreshold) },
        { label: 'Recovery time', value: `${config.circuitBreaker.recoveryTimeMs / 1000}s` },
      ],
    },
    {
      title: 'Budgets',
      items: config.budgets.map((b) => ({
        label: `${b.window}ly cap`,
        value: `$${b.maxCost.toFixed(2)}`,
      })),
    },
    {
      title: 'Guardrails',
      items: [
        { label: 'Input', value: config.guardrails.input.join(', ') || 'none' },
        { label: 'Output', value: config.guardrails.output.join(', ') || 'none' },
      ],
    },
  ]

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.title} className="rounded border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {section.title}
          </div>
          <div className="space-y-1">
            {section.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{item.label}</span>
                <span className="font-mono text-zinc-900 dark:text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
