'use client'

import { useState } from 'react'

// Pre-loaded demo session: a research pipeline with 3 agents
const DEMO_EVENTS = [
  { id: 1, type: 'pattern_start', agent: null, label: 'pipeline', time: 0, duration: 5200 },
  { id: 2, type: 'agent_start', agent: 'researcher', label: 'Start', time: 50, duration: 0 },
  { id: 3, type: 'guardrail_check', agent: 'researcher', label: 'PII check (pass)', time: 80, duration: 30 },
  { id: 4, type: 'agent_complete', agent: 'researcher', label: '150 tokens', time: 1800, duration: 1750 },
  { id: 5, type: 'agent_start', agent: 'writer', label: 'Start', time: 1850, duration: 0 },
  { id: 6, type: 'guardrail_check', agent: 'writer', label: 'PII check (pass)', time: 1870, duration: 20 },
  { id: 7, type: 'agent_complete', agent: 'writer', label: '320 tokens', time: 3900, duration: 2050 },
  { id: 8, type: 'agent_start', agent: 'reviewer', label: 'Start', time: 3950, duration: 0 },
  { id: 9, type: 'agent_complete', agent: 'reviewer', label: '80 tokens', time: 5100, duration: 1150 },
  { id: 10, type: 'pattern_complete', agent: null, label: 'pipeline (5.2s)', time: 5200, duration: 0 },
] as const

const AGENTS = ['researcher', 'writer', 'reviewer'] as const

const VIEWS = ['Timeline', 'Cost', 'State'] as const

const EVENT_COLORS: Record<string, string> = {
  agent_start: 'bg-sky-500',
  agent_complete: 'bg-emerald-500',
  agent_error: 'bg-red-500',
  guardrail_check: 'bg-amber-500',
  pattern_start: 'bg-violet-500',
  pattern_complete: 'bg-violet-500',
}

function TimelineView() {
  const totalMs = 5500
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="space-y-3">
      {/* Agent lanes */}
      {AGENTS.map((agent) => {
        const events = DEMO_EVENTS.filter((e) => e.agent === agent)

        return (
          <div key={agent} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500 text-right">
              {agent}
            </span>
            <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
              {events.map((e) => {
                const left = (e.time / totalMs) * 100
                const width = Math.max((e.duration / totalMs) * 100, 1.5)

                return (
                  <button
                    key={e.id}
                    className={`absolute top-1 h-5 rounded-sm ${EVENT_COLORS[e.type] ?? 'bg-zinc-400'} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: '6px' }}
                    onClick={() => setSelected(e.id === selected ? null : e.id)}
                    title={`${e.type}: ${e.label}`}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Pattern bar */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500 text-right">
          pattern
        </span>
        <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
          <div
            className="absolute top-1 h-5 rounded-sm bg-violet-500/30 border border-violet-500/50"
            style={{ left: '0%', width: `${(5200 / totalMs) * 100}%` }}
          />
        </div>
      </div>

      {/* Time axis */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
          <span>0s</span>
          <span>1s</span>
          <span>2s</span>
          <span>3s</span>
          <span>4s</span>
          <span>5s</span>
        </div>
      </div>

      {/* Selected event detail */}
      {selected && (
        <div className="mt-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 text-xs font-mono">
          {(() => {
            const e = DEMO_EVENTS.find((ev) => ev.id === selected)
            if (!e) {
              return null
            }

            return (
              <div className="space-y-1">
                <div>
                  <span className="text-zinc-500">type:</span> {e.type}
                </div>
                {e.agent && (
                  <div>
                    <span className="text-zinc-500">agent:</span> {e.agent}
                  </div>
                )}
                <div>
                  <span className="text-zinc-500">detail:</span> {e.label}
                </div>
                <div>
                  <span className="text-zinc-500">time:</span> {e.time}ms
                </div>
                {e.duration > 0 && (
                  <div>
                    <span className="text-zinc-500">duration:</span> {e.duration}ms
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function CostView() {
  const costs = [
    { agent: 'researcher', runs: 1, tokens: 150, pct: 27 },
    { agent: 'writer', runs: 1, tokens: 320, pct: 58 },
    { agent: 'reviewer', runs: 1, tokens: 80, pct: 15 },
  ]
  const total = 550

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{total}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Est. cost</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            ${(total * 0.00001).toFixed(4)}
          </div>
        </div>
      </div>

      {/* Stacked bar */}
      <div className="flex h-6 rounded overflow-hidden">
        <div className="bg-sky-500" style={{ width: '27%' }} title="researcher: 27%" />
        <div className="bg-emerald-500" style={{ width: '58%' }} title="writer: 58%" />
        <div className="bg-amber-500" style={{ width: '15%' }} title="reviewer: 15%" />
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-1 font-medium">Agent</th>
            <th className="text-right py-1 font-medium">Runs</th>
            <th className="text-right py-1 font-medium">Tokens</th>
            <th className="text-right py-1 font-medium">%</th>
          </tr>
        </thead>
        <tbody className="text-zinc-700 dark:text-zinc-300">
          {costs.map((c) => (
            <tr key={c.agent} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5 font-mono">{c.agent}</td>
              <td className="py-1.5 text-right">{c.runs}</td>
              <td className="py-1.5 text-right">{c.tokens}</td>
              <td className="py-1.5 text-right">{c.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StateView() {
  const scratchpad = {
    taskList: "['research', 'write', 'review']",
    completedCount: '3',
    lastUpdate: "'review phase done'",
  }
  const derived = {
    totalTokens: '550',
    allIdle: 'true',
    progress: "'3/3 agents done'",
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Scratchpad
        </h4>
        <div className="space-y-1">
          {Object.entries(scratchpad).map(([key, value]) => (
            <div key={key} className="flex text-xs font-mono">
              <span className="text-sky-600 dark:text-sky-400 w-32 shrink-0">{key}</span>
              <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Derived
        </h4>
        <div className="space-y-1">
          {Object.entries(derived).map(([key, value]) => (
            <div key={key} className="flex text-xs font-mono">
              <span className="text-violet-600 dark:text-violet-400 w-32 shrink-0">{key}</span>
              <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DevToolsDemo() {
  const [view, setView] = useState<(typeof VIEWS)[number]>('Timeline')

  return (
    <div className="not-prose my-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 ml-2">
            Directive DevTools
          </span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
          ws://localhost:4040
        </span>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-700 px-4 gap-0">
        {VIEWS.map((v) => (
          <button
            key={v}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              v === view
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
        {/* Disabled tabs */}
        {['Flamechart', 'DAG', 'Health', 'Breakpoints', 'Compare'].map((v) => (
          <span
            key={v}
            className="px-3 py-2 text-xs font-medium text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
          >
            {v}
          </span>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 min-h-[200px]">
        {view === 'Timeline' && <TimelineView />}
        {view === 'Cost' && <CostView />}
        {view === 'State' && <StateView />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-700 px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
        <span>10 events | 550 tokens | 5.2s</span>
        <span>Demo session (pre-loaded)</span>
      </div>
    </div>
  )
}
