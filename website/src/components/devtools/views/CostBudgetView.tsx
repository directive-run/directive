'use client'

import { useMemo, useState } from 'react'
import type { DebugEvent } from '../types'
import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { DEFAULT_MODEL_PRICING, getDefaultPricing, formatCost } from '../constants'
import { EmptyState } from '../EmptyState'

type Section = 'cost' | 'budget'
type SortKey = 'time' | 'cost' | 'tokens'

const BAR_COLORS = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-indigo-500']

export function CostBudgetView() {
  const [section, setSection] = useState<Section>('cost')
  // Shared pricing state so both tabs use the same cost estimates
  const [modelPricing, setModelPricing] = useState<Record<string, { input: number; output: number }>>({})

  const getPricing = (modelId: string | null) => {
    const key = modelId ?? 'unknown'
    if (modelPricing[key]) {
      return modelPricing[key]
    }

    return getDefaultPricing(modelId)
  }

  const updateModelPrice = (modelId: string, field: 'input' | 'output', value: number) => {
    setModelPricing((prev) => ({
      ...prev,
      [modelId]: {
        ...getPricing(modelId),
        ...prev[modelId],
        [field]: Math.max(0, value),
      },
    }))
  }

  const resetPricing = () => {
    setModelPricing({})
  }

  return (
    <div className="flex h-full flex-col">
      {/* M2: ARIA radiogroup for section toggle */}
      <div className="mb-4 flex gap-1 rounded bg-zinc-100 p-0.5 dark:bg-zinc-800" role="radiogroup" aria-label="View section">
        <button
          role="radio"
          aria-checked={section === 'cost'}
          onClick={() => setSection('cost')}
          className={`flex-1 cursor-pointer rounded px-3 py-1 text-xs font-medium transition ${
            section === 'cost'
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
          }`}
        >
          Cost
        </button>
        <button
          role="radio"
          aria-checked={section === 'budget'}
          onClick={() => setSection('budget')}
          className={`flex-1 cursor-pointer rounded px-3 py-1 text-xs font-medium transition ${
            section === 'budget'
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
          }`}
        >
          Budget
        </button>
      </div>

      {section === 'cost'
        ? <CostSection
            getPricing={getPricing}
            updateModelPrice={updateModelPrice}
            resetPricing={resetPricing}
            modelPricing={modelPricing}
          />
        : <BudgetSection getPricing={getPricing} />
      }
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cost Section
// ---------------------------------------------------------------------------

interface CostSectionProps {
  getPricing: (modelId: string | null) => { input: number; output: number }
  updateModelPrice: (modelId: string, field: 'input' | 'output', value: number) => void
  resetPricing: () => void
  modelPricing: Record<string, { input: number; output: number }>
}

function CostSection({ getPricing, updateModelPrice, resetPricing, modelPricing }: CostSectionProps) {
  const system = useDevToolsSystem()
  const events = useSelector(system, (s) => s.facts.connection.events)

  const { completeEvents, agents, modelIds, totalTokens, totalInput, totalOutput } = useMemo(() => {
    const complete = events.filter((e) => e.type === 'agent_complete')

    const agentMap = new Map<string, { runs: number; tokens: number; inputTokens: number; outputTokens: number; modelId: string | null }>()
    for (const e of complete) {
      const id = e.agentId ?? 'unknown'
      const prev = agentMap.get(id) ?? { runs: 0, tokens: 0, inputTokens: 0, outputTokens: 0, modelId: null }
      agentMap.set(id, {
        runs: prev.runs + 1,
        tokens: prev.tokens + (e.totalTokens ?? 0),
        inputTokens: prev.inputTokens + (e.inputTokens ?? 0),
        outputTokens: prev.outputTokens + (e.outputTokens ?? 0),
        // Remove unnecessary `as string` cast
        modelId: e.modelId ?? prev.modelId,
      })
    }

    const agentList = Array.from(agentMap.entries()).map(([agent, data]) => ({ agent, ...data }))
    const models = [...new Set(agentList.map((a) => a.modelId ?? 'unknown'))]
    const tTotal = agentList.reduce((s, a) => s + a.tokens, 0)
    const tInput = agentList.reduce((s, a) => s + a.inputTokens, 0)
    const tOutput = agentList.reduce((s, a) => s + a.outputTokens, 0)

    return { completeEvents: complete, agents: agentList, modelIds: models, totalTokens: tTotal, totalInput: tInput, totalOutput: tOutput }
  }, [events])

  if (completeEvents.length === 0) {
    return <EmptyState message="No completed agent runs yet." />
  }

  const estimateAgentCost = (a: { inputTokens: number; outputTokens: number; modelId: string | null }) => {
    const p = getPricing(a.modelId)

    return (a.inputTokens / 1_000_000) * p.input + (a.outputTokens / 1_000_000) * p.output
  }

  const totalCost = agents.reduce((s, a) => s + estimateAgentCost(a), 0)

  const barSummary = agents
    .map((a) => `${a.agent}: ${totalTokens > 0 ? ((a.tokens / totalTokens) * 100).toFixed(0) : 0}%`)
    .join(', ')

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{totalTokens.toLocaleString()}</div>
        </div>
        {(totalInput > 0 || totalOutput > 0) && (
          <>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Input</span>
              <div className="text-lg font-semibold text-zinc-900 dark:text-white">{totalInput.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-zinc-500 dark:text-zinc-400">Output</span>
              <div className="text-lg font-semibold text-zinc-900 dark:text-white">{totalOutput.toLocaleString()}</div>
            </div>
          </>
        )}
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Runs</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{completeEvents.length}</div>
        </div>
        {(totalInput > 0 || totalOutput > 0) && (
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Est. cost</span>
            <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{formatCost(totalCost)}</div>
          </div>
        )}
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Avg tokens/run</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {completeEvents.length > 0 ? Math.round(totalTokens / completeEvents.length).toLocaleString() : 0}
          </div>
        </div>
        {modelIds.length > 1 && (
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Models</span>
            <div className="text-lg font-semibold text-zinc-900 dark:text-white">{modelIds.length}</div>
          </div>
        )}
      </div>

      {/* Stacked bar */}
      {totalTokens > 0 && (
        <div
          className="flex h-6 overflow-hidden rounded"
          role="img"
          aria-label={`Token distribution: ${barSummary}`}
        >
          {agents.map((a, i) => {
            const pct = (a.tokens / totalTokens) * 100

            return (
              <div
                key={a.agent}
                className={BAR_COLORS[i % BAR_COLORS.length]}
                style={{ width: `${pct}%` }}
                title={`${a.agent}: ${a.tokens.toLocaleString()} tokens (${pct.toFixed(0)}%)`}
                aria-hidden="true"
              />
            )
          })}
        </div>
      )}

      {/* Per-agent table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <th className="py-1 text-left font-medium">Agent</th>
            <th className="py-1 text-right font-medium">Runs</th>
            <th className="py-1 text-right font-medium">Input</th>
            <th className="py-1 text-right font-medium">Output</th>
            <th className="py-1 text-right font-medium">Total</th>
            <th className="py-1 text-right font-medium">Cost</th>
            <th className="py-1 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody className="text-zinc-700 dark:text-zinc-300">
          {agents.map((a) => {
            const agentCost = estimateAgentCost(a)

            return (
              <tr key={a.agent} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="py-1.5 font-mono">
                  {a.agent}
                  {a.modelId && <span className="ml-1 text-zinc-400 dark:text-zinc-500">({a.modelId})</span>}
                </td>
                <td className="py-1.5 text-right">{a.runs}</td>
                <td className="py-1.5 text-right">{a.inputTokens.toLocaleString()}</td>
                <td className="py-1.5 text-right">{a.outputTokens.toLocaleString()}</td>
                <td className="py-1.5 text-right">{a.tokens.toLocaleString()}</td>
                <td className="py-1.5 text-right text-emerald-600 dark:text-emerald-400">{formatCost(agentCost)}</td>
                <td className="py-1.5 text-right">
                  {totalTokens > 0 ? ((a.tokens / totalTokens) * 100).toFixed(0) : 0}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Per-model pricing */}
      <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Cost estimator — adjust pricing per model
            <span className="ml-1 font-normal normal-case text-zinc-400 dark:text-zinc-500">(local only — not saved)</span>
          </div>
          {Object.keys(modelPricing).length > 0 && (
            <button
              onClick={resetPricing}
              className="cursor-pointer rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
            >
              Reset to defaults
            </button>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              <th className="pb-1.5 text-left font-medium">Model</th>
              <th className="pb-1.5 text-right font-medium">Input ($/1M tokens)</th>
              <th className="pb-1.5 text-right font-medium">Output ($/1M tokens)</th>
            </tr>
          </thead>
          <tbody>
            {modelIds.map((mid) => {
              const p = getPricing(mid)
              const known = DEFAULT_MODEL_PRICING[mid]

              return (
                <tr key={mid} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 font-mono text-zinc-700 dark:text-zinc-300" title={mid}>
                    {known?.label ?? mid}
                  </td>
                  <td className="py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={p.input}
                      onChange={(e) => updateModelPrice(mid, 'input', Number(e.target.value))}
                      aria-label={`${known?.label ?? mid} input price per million tokens`}
                      className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={p.output}
                      onChange={(e) => updateModelPrice(mid, 'output', Number(e.target.value))}
                      aria-label={`${known?.label ?? mid} output price per million tokens`}
                      className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Budget Section
// ---------------------------------------------------------------------------

interface BudgetSectionProps {
  getPricing: (modelId: string | null) => { input: number; output: number }
}

function BudgetSection({ getPricing }: BudgetSectionProps) {
  const system = useDevToolsSystem()
  const events = useSelector(system, (s) => s.facts.connection.events)
  const data = useSelector(system, (s) => s.facts.snapshot.data)
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortKey>('time')

  const budgets = data?.config.budgets ?? [
    { window: 'hour', maxCost: 5.00 },
    { window: 'day', maxCost: 50.00 },
  ]

  // Use shared getPricing (respects user-edited model pricing from Cost tab)
  const modelId = data?.config.model ?? null
  const pricing = getPricing(modelId)

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

  // Look up budget limits by window name instead of array index
  const hourlyLimit = budgets.find((b) => b.window === 'hour')?.maxCost ?? 5.00
  const dailyLimit = budgets.find((b) => b.window === 'day')?.maxCost ?? 50.00

  const { filteredEvents, filteredTotalCost, filteredTotalTokens } = useMemo(() => {
    let filtered = completeEvents
    if (agentFilter !== 'all') {
      filtered = filtered.filter((e) => e.agentId === agentFilter)
    }

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
          <div className={`text-lg font-semibold ${hourlyCost > hourlyLimit * 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}>
            {formatCost(hourlyCost)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Today</span>
          <div className={`text-lg font-semibold ${dailyCost > dailyLimit * 0.8 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-white'}`}>
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
              {/* M1: Fixed light-mode styling on selects */}
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                <option value="all">All agents</option>
                {agentIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
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

          {/* M6: Fixed border to include light-mode variant */}
          {filteredEvents.length > 0 && (
            <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5 font-mono text-[11px] dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Total</span>
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
