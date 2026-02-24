'use client'

import { useMemo, useState } from 'react'
import type { DebugEvent } from '../types'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { getDefaultPricing, formatCost } from '../constants'

// m10: Uses getDefaultPricing instead of hardcoded Haiku pricing

type SortKey = 'time' | 'cost' | 'tokens'

export function BudgetView() {
  const system = useDevToolsSystem()
  const events = useSelector(system, (s) => s.facts.connection.events)
  const data = useSelector(system, (s) => s.facts.snapshot.data)
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortKey>('time')

  const budgets = data?.config.budgets ?? [
    { window: 'hour', maxCost: 5.00 },
    { window: 'day', maxCost: 50.00 },
  ]

  // m10: Use shared getDefaultPricing for the configured model
  const modelId = data?.config.model ?? null
  const pricing = getDefaultPricing(modelId)

  // C3: Memoize cost calculations
  const { hourlyCost, dailyCost, totalCost, hourlyEvents, dailyEvents, completeEvents, agentIds, budgetData } = useMemo(() => {
    const complete = events.filter((e) => e.type === 'agent_complete')
    const now = Date.now()
    const oneHourAgo = now - 3_600_000
    const oneDayAgo = now - 86_400_000

    const estimateCost = (evts: DebugEvent[]) => {
      let cost = 0
      for (const e of evts) {
        const inp = e.inputTokens ?? 0
        const out = e.outputTokens ?? 0
        cost += (inp / 1_000_000) * pricing.input + (out / 1_000_000) * pricing.output
      }

      return cost
    }

    const hourly = complete.filter((e) => e.timestamp >= oneHourAgo)
    const daily = complete.filter((e) => e.timestamp >= oneDayAgo)
    const hCost = estimateCost(hourly)
    const dCost = estimateCost(daily)
    const tCost = estimateCost(complete)

    // Collect unique agent IDs
    const ids = new Set<string>()
    for (const e of complete) {
      if (e.agentId) {
        ids.add(e.agentId)
      }
    }

    const bData = budgets.map((b) => {
      const spent = b.window === 'hour' ? hCost : dCost
      const pct = b.maxCost > 0 ? Math.min(100, (spent / b.maxCost) * 100) : 0

      return { ...b, spent, pct }
    })

    return { hourlyCost: hCost, dailyCost: dCost, totalCost: tCost, hourlyEvents: hourly, dailyEvents: daily, completeEvents: complete, agentIds: Array.from(ids).sort(), budgetData: bData }
  }, [events, budgets, pricing])

  // Filter and sort the recent spend list
  const { filteredEvents, filteredTotalCost, filteredTotalTokens } = useMemo(() => {
    let filtered = completeEvents
    if (agentFilter !== 'all') {
      filtered = filtered.filter((e) => e.agentId === agentFilter)
    }

    // Compute totals across all filtered (before slicing)
    let fCost = 0
    let fTokens = 0
    for (const e of filtered) {
      fCost += ((e.inputTokens ?? 0) / 1_000_000) * pricing.input + ((e.outputTokens ?? 0) / 1_000_000) * pricing.output
      fTokens += e.totalTokens ?? 0
    }

    const sorted = [...filtered]
    if (sortBy === 'cost') {
      sorted.sort((a, b) => {
        const costA = ((a.inputTokens ?? 0) * pricing.input + (a.outputTokens ?? 0) * pricing.output)
        const costB = ((b.inputTokens ?? 0) * pricing.input + (b.outputTokens ?? 0) * pricing.output)

        return costB - costA
      })
    } else if (sortBy === 'tokens') {
      sorted.sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))
    } else {
      sorted.reverse()
    }

    return { filteredEvents: sorted.slice(0, 30), filteredTotalCost: fCost, filteredTotalTokens: fTokens }
  }, [completeEvents, agentFilter, sortBy, pricing])

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total spend</span>
          <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatCost(totalCost)}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">This hour</span>
          <div className={`text-lg font-semibold ${hourlyCost > budgets[0]?.maxCost * 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}>
            {formatCost(hourlyCost)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Today</span>
          <div className={`text-lg font-semibold ${dailyCost > (budgets[1]?.maxCost ?? 50) * 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}>
            {formatCost(dailyCost)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Runs (hour)</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{hourlyEvents.length}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Runs (day)</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{dailyEvents.length}</div>
        </div>
      </div>

      {/* Budget bars */}
      <div className="space-y-3">
        {budgetData.map((b) => (
          <div key={b.window}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium capitalize text-zinc-700 dark:text-zinc-300">{b.window}ly budget</span>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">
                {formatCost(b.spent)} / {formatCost(b.maxCost)}
              </span>
            </div>
            <div className="flex h-4 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
              <div
                className={`transition-all ${
                  b.pct > 90 ? 'bg-red-500' : b.pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${b.pct}%` }}
              />
            </div>
            <div className="mt-0.5 text-right text-[10px] text-zinc-400 dark:text-zinc-500">
              {(100 - b.pct).toFixed(1)}% remaining
            </div>
          </div>
        ))}
      </div>

      {/* Spend list with filters */}
      {completeEvents.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Recent spend
            </div>
            <div className="flex items-center gap-2">
              {/* Agent filter */}
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none focus:border-zinc-500"
              >
                <option value="all">All agents</option>
                {agentIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 outline-none focus:border-zinc-500"
              >
                <option value="time">Newest</option>
                <option value="cost">Highest cost</option>
                <option value="tokens">Most tokens</option>
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {filteredEvents.map((e) => {
              const cost = ((e.inputTokens ?? 0) / 1_000_000) * pricing.input + ((e.outputTokens ?? 0) / 1_000_000) * pricing.output

              return (
                <div key={e.id} className="flex items-center justify-between font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 dark:text-zinc-400">{e.agentId ?? 'unknown'}</span>
                    <span className="text-zinc-400 dark:text-zinc-500">{e.totalTokens?.toLocaleString()} tokens</span>
                  </div>
                  <span className="text-emerald-600 dark:text-emerald-400">{formatCost(cost)}</span>
                </div>
              )
            })}
            {filteredEvents.length === 0 && (
              <div className="py-2 text-center text-[11px] text-zinc-500">
                No events for this agent.
              </div>
            )}
          </div>

          {/* Totals footer */}
          {filteredEvents.length > 0 && (
            <div className="flex items-center justify-between border-t border-zinc-700 pt-1.5 font-mono text-[11px]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-300">Total</span>
                <span className="text-zinc-400 dark:text-zinc-500">{filteredTotalTokens.toLocaleString()} tokens</span>
              </div>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCost(filteredTotalCost)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
