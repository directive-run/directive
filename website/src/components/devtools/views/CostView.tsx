'use client'

import { useMemo, useState } from 'react'
import type { DebugEvent } from '../types'
import { DEFAULT_MODEL_PRICING, getDefaultPricing, formatCost } from '../constants'
import { EmptyState } from '../EmptyState'

// C3: Expensive computations wrapped in useMemo

export function CostView({ events }: { events: DebugEvent[] }) {
  const [modelPricing, setModelPricing] = useState<Record<string, { input: number; output: number }>>({})

  // C3: Memoize filtering and aggregation
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
        modelId: (e.modelId as string) ?? prev.modelId,
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

  // Get pricing for a model (user override or default)
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

  // M7: Reset to defaults button
  const resetPricing = () => {
    setModelPricing({})
  }

  // Cost estimation per agent
  const estimateAgentCost = (a: { inputTokens: number; outputTokens: number; modelId: string | null }) => {
    const p = getPricing(a.modelId)

    return (a.inputTokens / 1_000_000) * p.input + (a.outputTokens / 1_000_000) * p.output
  }

  const totalCost = agents.reduce((s, a) => s + estimateAgentCost(a), 0)

  const BAR_COLORS = ['bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-indigo-500']

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

      {/* Per-model pricing — M7: "(local only)" label + reset button */}
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
