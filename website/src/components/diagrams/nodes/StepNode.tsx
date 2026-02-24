'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import { useState } from 'react'
import type { StepNodeData } from '../types'
import { SCHEME_CLASS, ACCENT_COLORS } from '../theme'

export function StepNode({ data }: NodeProps) {
  const { label, subtitle, tooltip, status, colorScheme } = data as StepNodeData
  const [showTooltip, setShowTooltip] = useState(false)
  const isActive = status === 'active'
  const accent = ACCENT_COLORS[colorScheme]

  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <Handle id="top" type="target" position={Position.Top} />

      <div
        className={clsx(
          'turbo-gradient turbo-step',
          SCHEME_CLASS[colorScheme],
          isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
        )}
        onMouseEnter={() => tooltip && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div className="turbo-inner">
          <div
            className="text-base font-semibold"
            style={{ color: isActive ? accent : '#f1f5f9' }}
          >
            {label}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs" style={{ color: '#94a3b8' }}>{subtitle}</div>
          )}
        </div>
      </div>

      {showTooltip && tooltip && (
        <div className="pointer-events-none absolute -top-24 left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm text-white shadow-xl">
          <div className="font-semibold" style={{ color: accent }}>{label}</div>
          <div className="mt-1 text-slate-300">{tooltip.description}</div>
          {tooltip.example && (
            <code className="mt-2 block rounded bg-slate-900 px-2 py-1 text-xs text-emerald-400">
              {tooltip.example}
            </code>
          )}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-800" />
        </div>
      )}

      <Handle type="source" position={Position.Right} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
    </div>
  )
}
