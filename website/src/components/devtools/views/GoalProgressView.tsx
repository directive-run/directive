'use client'

import { useMemo, useState } from 'react'
import type { DebugEvent } from '../types'
import { EmptyState } from '../EmptyState'

// ---------------------------------------------------------------------------
// Types — aligned with GoalStepMetrics from @directive-run/ai
// ---------------------------------------------------------------------------

interface GoalStep {
  step: number
  /** nodesRun in GoalStepMetrics — agents that ran this step */
  nodesRun: string[]
  satisfaction: number
  satisfactionDelta: number
  tokensConsumed: number
  durationMs: number
  factsProduced: string[]
}

interface GoalExecution {
  startTimestamp: number
  endTimestamp: number | null
  achieved: boolean | null
  steps: GoalStep[]
  relaxations: Array<{ step: number; label: string; strategy: string }>
  totalTokens: number
  totalDurationMs: number
  finalSatisfaction: number
  error?: string
}

// ---------------------------------------------------------------------------
// Event parsing — extract goal executions from the event stream
// ---------------------------------------------------------------------------

function isValidStep(s: unknown): s is GoalStep {
  if (typeof s !== 'object' || s === null) {
    return false
  }
  const obj = s as Record<string, unknown>

  return (
    typeof obj.step === 'number' &&
    Array.isArray(obj.nodesRun) &&
    typeof obj.satisfaction === 'number' &&
    typeof obj.satisfactionDelta === 'number'
  )
}

function extractGoalExecutions(events: DebugEvent[]): GoalExecution[] {
  const executions: GoalExecution[] = []
  let current: GoalExecution | null = null

  for (const e of events) {
    if (e.type === 'pattern_start' && e.patternType === 'goal') {
      current = {
        startTimestamp: e.timestamp,
        endTimestamp: null,
        achieved: null,
        steps: [],
        relaxations: [],
        totalTokens: 0,
        totalDurationMs: 0,
        finalSatisfaction: 0,
      }
    }

    if (e.type === 'pattern_complete' && e.patternType === 'goal' && current) {
      current.endTimestamp = e.timestamp
      current.achieved = typeof e.achieved === 'boolean' ? e.achieved : null
      current.totalDurationMs = e.durationMs ?? (e.timestamp - current.startTimestamp)
      current.totalTokens = typeof e.totalTokens === 'number' ? e.totalTokens : current.totalTokens
      current.error = typeof e.error === 'string' ? e.error : undefined

      // Accept stepMetrics from the event payload (validated per-item)
      const stepMetrics = e.stepMetrics
      if (Array.isArray(stepMetrics)) {
        current.steps = stepMetrics.filter(isValidStep)
        if (current.steps.length > 0) {
          current.finalSatisfaction = current.steps[current.steps.length - 1].satisfaction
        }
      }

      const relaxations = e.relaxations
      if (Array.isArray(relaxations)) {
        current.relaxations = relaxations as GoalExecution['relaxations']
      }

      executions.push(current)
      current = null
    }

    // Accumulate tokens from agent completions during an active goal
    if (current && e.type === 'agent_complete' && e.totalTokens) {
      current.totalTokens += e.totalTokens
    }
  }

  // Include in-progress goal (no pattern_complete yet)
  if (current) {
    current.totalDurationMs = events.length > 0
      ? events[events.length - 1].timestamp - current.startTimestamp
      : 0
    executions.push(current)
  }

  return executions
}

// ---------------------------------------------------------------------------
// Sparkline SVG
// ---------------------------------------------------------------------------

const SPARKLINE_W = 600
const SPARKLINE_H = 120
const SPARKLINE_PAD = { top: 12, right: 16, bottom: 20, left: 40 }
/** Max x-axis labels before decimation kicks in */
const MAX_STEP_LABELS = 15

/** Clamp satisfaction to [0, 1] for rendering */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function SatisfactionSparkline({ steps, relaxations }: {
  steps: GoalStep[]
  relaxations: GoalExecution['relaxations']
}) {
  const w = SPARKLINE_W - SPARKLINE_PAD.left - SPARKLINE_PAD.right
  const h = SPARKLINE_H - SPARKLINE_PAD.top - SPARKLINE_PAD.bottom

  if (steps.length === 0) {
    return null
  }

  // Build points: step 0 starts at the pre-first-step satisfaction
  const startSatisfaction = clamp01(steps[0].satisfaction - steps[0].satisfactionDelta)
  const points = [{ x: 0, y: startSatisfaction }]
  for (const step of steps) {
    points.push({ x: step.step, y: clamp01(step.satisfaction) })
  }

  const maxStep = steps[steps.length - 1].step
  const xScale = maxStep > 0 ? w / maxStep : w
  const yScale = h

  const toSvgX = (step: number) => SPARKLINE_PAD.left + step * xScale
  const toSvgY = (sat: number) => SPARKLINE_PAD.top + h - sat * yScale

  // Build path
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x).toFixed(1)} ${toSvgY(p.y).toFixed(1)}`)
    .join(' ')

  // Fill area under curve
  const areaD = pathD
    + ` L ${toSvgX(points[points.length - 1].x).toFixed(1)} ${toSvgY(0).toFixed(1)}`
    + ` L ${toSvgX(0).toFixed(1)} ${toSvgY(0).toFixed(1)} Z`

  // Relaxation step numbers
  const relaxationSteps = useMemo(() => new Set(relaxations.map((r) => r.step)), [relaxations])

  // Step label decimation: show every Nth label when count exceeds threshold
  const labelInterval = steps.length > MAX_STEP_LABELS
    ? Math.ceil(steps.length / MAX_STEP_LABELS)
    : 1

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      className="w-full"
      role="img"
      aria-label={`Satisfaction curve: ${startSatisfaction.toFixed(2)} → ${steps[steps.length - 1].satisfaction.toFixed(2)} over ${maxStep} steps`}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line
            x1={SPARKLINE_PAD.left}
            y1={toSvgY(tick)}
            x2={SPARKLINE_W - SPARKLINE_PAD.right}
            y2={toSvgY(tick)}
            stroke="currentColor"
            className="text-zinc-200 dark:text-zinc-700"
            strokeWidth={0.5}
            strokeDasharray={tick === 1 ? '3,2' : undefined}
          />
          <text
            x={SPARKLINE_PAD.left - 6}
            y={toSvgY(tick) + 3}
            textAnchor="end"
            className="fill-zinc-400 dark:fill-zinc-500"
            fontSize={9}
            fontFamily="monospace"
          >
            {tick.toFixed(tick === 0 || tick === 1 ? 0 : 2)}
          </text>
        </g>
      ))}

      {/* Step labels on x-axis (decimated when > MAX_STEP_LABELS) */}
      {steps.filter((_, i) => i % labelInterval === 0 || i === steps.length - 1).map((step) => (
        <text
          key={step.step}
          x={toSvgX(step.step)}
          y={SPARKLINE_H - 2}
          textAnchor="middle"
          className="fill-zinc-400 dark:fill-zinc-500"
          fontSize={9}
          fontFamily="monospace"
        >
          {step.step}
        </text>
      ))}

      {/* Area fill */}
      <path
        d={areaD}
        className="fill-emerald-500/10 dark:fill-emerald-400/10"
      />

      {/* Line */}
      <path
        d={pathD}
        fill="none"
        className="stroke-emerald-500 dark:stroke-emerald-400"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Data points */}
      {points.slice(1).map((p, i) => {
        const isRelaxation = relaxationSteps.has(steps[i].step)

        return (
          <circle
            key={i}
            cx={toSvgX(p.x)}
            cy={toSvgY(p.y)}
            r={isRelaxation ? 5 : 3.5}
            className={isRelaxation
              ? 'fill-amber-500 stroke-amber-300 dark:fill-amber-400 dark:stroke-amber-200'
              : 'fill-emerald-500 stroke-white dark:fill-emerald-400 dark:stroke-zinc-900'
            }
            strokeWidth={isRelaxation ? 1.5 : 1}
          >
            <title>
              Step {steps[i].step}: {p.y.toFixed(3)}
              {isRelaxation ? ' (relaxation applied)' : ''}
            </title>
          </circle>
        )
      })}

      {/* Relaxation markers — vertical dashed lines */}
      {relaxations.map((r, i) => (
        <line
          key={`relax-${i}`}
          x1={toSvgX(r.step)}
          y1={SPARKLINE_PAD.top}
          x2={toSvgX(r.step)}
          y2={SPARKLINE_PAD.top + h}
          className="stroke-amber-500/50 dark:stroke-amber-400/50"
          strokeWidth={1}
          strokeDasharray="4,3"
        />
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalView({ events }: { events: DebugEvent[] }) {
  const executions = useMemo(() => extractGoalExecutions(events), [events])
  const [selectedIdx, setSelectedIdx] = useState(-1)

  if (executions.length === 0) {
    return <EmptyState message="No goal pattern executions detected. Run a goal pattern to see progress." />
  }

  // Default to latest execution; allow selection if multiple exist
  const idx = selectedIdx >= 0 && selectedIdx < executions.length ? selectedIdx : executions.length - 1
  const latest = executions[idx]

  return (
    <div className="space-y-4">
      {/* Execution selector (E11: when multiple executions exist) */}
      {executions.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Execution:</span>
          <select
            value={idx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"
            aria-label="Select goal execution"
          >
            {executions.map((ex, i) => (
              <option key={i} value={i}>
                #{i + 1} — {ex.achieved === true ? 'achieved' : ex.achieved === false ? 'not achieved' : 'in progress'}
                {ex.steps.length > 0 ? ` (${ex.steps.length} steps)` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary stats */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Status</span>
          <div className={`text-lg font-semibold ${
            latest.achieved === true
              ? 'text-emerald-600 dark:text-emerald-400'
              : latest.achieved === false
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400'
          }`}>
            {latest.achieved === true ? 'Achieved' : latest.achieved === false ? 'Not achieved' : 'In progress'}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Steps</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{latest.steps.length}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Satisfaction</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {latest.finalSatisfaction.toFixed(3)}
          </div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{latest.totalTokens.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Duration</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">{latest.totalDurationMs.toLocaleString()}ms</div>
        </div>
        {latest.relaxations.length > 0 && (
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Relaxations</span>
            <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">{latest.relaxations.length}</div>
          </div>
        )}
      </div>

      {/* Error display */}
      {latest.error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {latest.error}
        </div>
      )}

      {/* Sparkline */}
      {latest.steps.length > 0 && (
        <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Satisfaction curve
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-400 dark:text-zinc-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> step
              </span>
              {latest.relaxations.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> relaxation
                </span>
              )}
            </div>
          </div>
          <SatisfactionSparkline steps={latest.steps} relaxations={latest.relaxations} />
        </div>
      )}

      {/* Per-step table (E8: overflow-x-auto for mobile) */}
      {latest.steps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <th className="py-1 text-left font-medium">Step</th>
                <th className="py-1 text-left font-medium">Agents</th>
                <th className="py-1 text-right font-medium">Satisfaction</th>
                <th className="py-1 text-right font-medium">Delta</th>
                <th className="py-1 text-right font-medium">Tokens</th>
                <th className="py-1 text-right font-medium">Duration</th>
                <th className="py-1 text-left font-medium">Facts produced</th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-300">
              {latest.steps.map((step) => (
                <tr key={step.step} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 font-mono">{step.step}</td>
                  <td className="py-1.5 font-mono">{step.nodesRun.join(', ')}</td>
                  <td className="py-1.5 text-right font-mono">{step.satisfaction.toFixed(3)}</td>
                  <td className={`py-1.5 text-right font-mono ${
                    step.satisfactionDelta > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : step.satisfactionDelta < 0
                        ? 'text-red-600 dark:text-red-400'
                        : ''
                  }`}>
                    {step.satisfactionDelta >= 0 ? '+' : ''}{step.satisfactionDelta.toFixed(3)}
                  </td>
                  <td className="py-1.5 text-right">{step.tokensConsumed.toLocaleString()}</td>
                  <td className="py-1.5 text-right">{step.durationMs}ms</td>
                  <td className="max-w-[200px] truncate py-1.5 font-mono text-zinc-500 dark:text-zinc-400" title={step.factsProduced.join(', ')}>
                    {step.factsProduced.length > 0 ? step.factsProduced.join(', ') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Relaxation events (E10: aria-label) */}
      {latest.relaxations.length > 0 && (
        <div
          className="rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
          role="region"
          aria-label="Relaxation events applied"
        >
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Relaxations applied
          </div>
          <div className="space-y-1.5">
            {latest.relaxations.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">Step {r.step}</span>
                <span className="rounded bg-amber-200/50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800 dark:bg-amber-800/30 dark:text-amber-300">
                  {r.strategy}
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
