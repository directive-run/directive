'use client'

import { usePolledSnapshot } from '../hooks/usePolledSnapshot'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'

// C1: Uses shared usePolledSnapshot instead of independent fetch
// M4: preview field still displayed — server-side sanitization handles redaction

export function MemoryView() {
  const { data, error } = usePolledSnapshot()

  if (error) {
    return <EmptyState message={error} />
  }

  if (!data) {
    return <Skeleton rows={5} />
  }

  const { memory, config } = data
  const totalMessages = memory.totalMessages
  const contextMessages = memory.contextMessages
  const summaries = memory.summaries
  const messages = memory.messages
  const maxHistory = config.maxHistoryMessages
  const preserveRecent = config.preserveRecentCount

  const prunedCount = Math.max(0, totalMessages - contextMessages)
  const usagePct = maxHistory > 0 ? Math.min(100, (totalMessages / maxHistory) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total messages</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{totalMessages}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">In context</span>
          <div className="text-lg font-semibold text-sky-600 dark:text-sky-400">{contextMessages}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Pruned</span>
          <div className={`text-lg font-semibold ${prunedCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}>{prunedCount}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Summaries</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{summaries}</div>
        </div>
      </div>

      {/* Context window usage bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
          <span>Context window usage</span>
          <span>{totalMessages}/{maxHistory} messages ({usagePct.toFixed(0)}%)</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
          <div
            className={`transition-all ${usagePct > 80 ? 'bg-amber-500' : 'bg-sky-500'}`}
            style={{ width: `${usagePct}%` }}
          />
        </div>
        <div className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          Strategy: sliding window (preserves {preserveRecent} most recent)
        </div>
      </div>

      {/* Message list */}
      {messages.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Context messages
          </div>
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    m.role === 'user'
                      ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
                      : m.role === 'assistant'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                  }`}>
                    {m.role}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">{m.contentLength} chars</span>
                </div>
                {m.preview && (
                  <div className="mt-1 truncate text-[11px] text-zinc-600 dark:text-zinc-400">{m.preview}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
