'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { useState } from 'react'
import type { StepNodeData } from '../types'
import { getNodeColors } from '../theme'

export function StepNode({ data }: NodeProps) {
  const { label, subtitle, tooltip, status, colorScheme } = data as StepNodeData
  const colors = getNodeColors(colorScheme, status)
  const [showTooltip, setShowTooltip] = useState(false)
  const isActive = status === 'active'

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
      <Handle id="top" type="target" position={Position.Top} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />

      <div
        className={clsx(
          'rounded-lg border-2 px-5 py-3 shadow-sm transition-all duration-300',
          colors.bg,
          colors.border,
          isActive && 'shadow-md',
        )}
        onMouseEnter={() => tooltip && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {isActive && (
          <div className={clsx('absolute inset-0 rounded-lg border-2 opacity-50', colors.border, 'animate-pulse')} />
        )}
        <div className={clsx('text-sm font-semibold', colors.text)}>{label}</div>
        {subtitle && (
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
        )}
      </div>

      {showTooltip && tooltip && (
        <div className="pointer-events-none absolute -top-24 left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg bg-slate-900 p-3 text-sm text-white shadow-xl dark:bg-slate-700">
          <div className="font-semibold text-sky-400">{label}</div>
          <div className="mt-1 text-slate-300">{tooltip.description}</div>
          {tooltip.example && (
            <code className="mt-2 block rounded bg-slate-800 px-2 py-1 text-xs text-emerald-400 dark:bg-slate-600">
              {tooltip.example}
            </code>
          )}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900 dark:border-t-slate-700" />
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
    </div>
  )
}
