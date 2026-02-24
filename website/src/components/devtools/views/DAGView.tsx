'use client'

import { useMemo } from 'react'
import type { DebugEvent } from '../types'
import { EmptyState } from '../EmptyState'

// C3: Node/edge building wrapped in useMemo

interface AgentNode {
  id: string
  runs: number
  totalTokens: number
  avgDurationMs: number
  totalDurationMs: number
  modelId: string | null
  status: 'idle' | 'running' | 'error'
}

export function DAGView({ events }: { events: DebugEvent[] }) {
  // C3: Memoize node/edge computation
  const { nodes, edgeList } = useMemo(() => {
    if (events.length === 0) {
      return { nodes: [], edgeList: [] }
    }

    const nodeMap = new Map<string, AgentNode>()
    const edges = new Map<string, number>() // "from->to" -> count
    let lastCompletedAgent: string | null = null

    for (const e of events) {
      const agent = e.agentId ?? (e.guardrailName ? `guardrail:${e.guardrailName}` : null)
      if (!agent) continue

      if (!nodeMap.has(agent)) {
        nodeMap.set(agent, {
          id: agent,
          runs: 0,
          totalTokens: 0,
          avgDurationMs: 0,
          totalDurationMs: 0,
          modelId: null,
          status: 'idle',
        })
      }

      const node = nodeMap.get(agent)!

      if (e.type === 'agent_start') {
        node.status = 'running'
        if (lastCompletedAgent && lastCompletedAgent !== agent) {
          const edgeKey = `${lastCompletedAgent}\u2192${agent}`
          edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1)
        }
      } else if (e.type === 'agent_complete') {
        node.runs++
        node.totalTokens += e.totalTokens ?? 0
        node.totalDurationMs += e.durationMs ?? 0
        node.avgDurationMs = Math.round(node.totalDurationMs / node.runs)
        node.modelId = (e.modelId as string) ?? node.modelId
        node.status = 'idle'
        lastCompletedAgent = agent
      } else if (e.type === 'agent_error') {
        node.status = 'error'
      } else if (e.type === 'guardrail_check') {
        node.runs++
        node.totalDurationMs += e.durationMs ?? 0
        node.avgDurationMs = node.runs > 0 ? Math.round(node.totalDurationMs / node.runs) : 0

        if (e.agentId && e.guardrailName) {
          const gKey = `guardrail:${e.guardrailName}`
          const edgeKey = `${gKey}\u2192${e.agentId}`
          edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1)
        }
      }
    }

    const builtNodes = Array.from(nodeMap.values())
    const builtEdges = Array.from(edges.entries()).map(([key, count]) => {
      const [from, to] = key.split('\u2192')

      return { from, to, count }
    })

    return { nodes: builtNodes, edgeList: builtEdges }
  }, [events])

  if (events.length === 0) {
    return <EmptyState message="No events recorded yet." />
  }

  const NODE_COLORS: Record<string, string> = {
    idle: 'border-emerald-500 bg-emerald-500/10',
    running: 'border-sky-500 bg-sky-500/10',
    error: 'border-red-500 bg-red-500/10',
  }

  const statusDots: Record<string, string> = {
    idle: 'bg-emerald-500',
    running: 'bg-sky-500 animate-pulse',
    error: 'bg-red-500',
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        {nodes.length} nodes, {edgeList.length} edges — inferred from event ordering
      </div>

      {/* Node cards */}
      <div className="flex flex-wrap gap-3">
        {nodes.map((node) => {
          const isGuardrail = node.id.startsWith('guardrail:')
          const displayName = isGuardrail ? node.id.replace('guardrail:', '') : node.id

          return (
            <div
              key={node.id}
              className={`rounded-lg border-2 px-3 py-2 ${NODE_COLORS[node.status]}`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDots[node.status]}`} />
                <span className="font-mono text-xs font-medium text-zinc-900 dark:text-white">{displayName}</span>
                {isGuardrail && (
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">guardrail</span>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                <div>{node.runs} run{node.runs !== 1 ? 's' : ''}</div>
                {node.totalTokens > 0 && <div>{node.totalTokens.toLocaleString()} tokens</div>}
                {node.avgDurationMs > 0 && <div>avg {node.avgDurationMs}ms</div>}
                {node.modelId && <div className="font-mono text-[9px]">{node.modelId}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Edges table */}
      {edgeList.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Flow edges
          </div>
          <div className="space-y-1">
            {edgeList.map(({ from, to, count }) => {
              const fromLabel = from.startsWith('guardrail:') ? from.replace('guardrail:', '') : from
              const toLabel = to.startsWith('guardrail:') ? to.replace('guardrail:', '') : to

              return (
                <div key={`${from}\u2192${to}`} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-zinc-700 dark:text-zinc-300">{fromLabel}</span>
                  <span className="text-zinc-400">{'\u2192'}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{toLabel}</span>
                  {count > 1 && (
                    <span className="rounded bg-zinc-200 px-1 py-0.5 text-[9px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400">
                      ×{count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
