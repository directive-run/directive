'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { StatusNodeData } from '../types'
import { getNodeColors } from '../theme'

const STATUS_ICONS: Record<string, string> = {
  idle: '',
  active: '',
  past: '',
  success: '\u2714',
  error: '\u2715',
}

export function StatusNode({ data }: NodeProps) {
  const { label, status, icon, colorScheme } = data as StatusNodeData
  const colors = getNodeColors(colorScheme, status)
  const displayIcon = icon ?? STATUS_ICONS[status] ?? ''
  const isActive = status === 'active'

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />

      <div
        className={clsx(
          'rounded-md border-2 px-4 py-2 text-center shadow-sm transition-all duration-300',
          colors.bg,
          colors.border,
          isActive && 'shadow-md',
        )}
      >
        {isActive && (
          <div className={clsx('absolute inset-0 rounded-md border-2 opacity-50', colors.border, 'animate-pulse')} />
        )}
        <div className={clsx('text-xs font-medium', colors.text)}>{label}</div>
        {displayIcon && (
          <div className={clsx(
            'mt-1 text-sm font-bold',
            status === 'error' ? 'text-red-500 dark:text-red-400' : status === 'success' ? 'text-emerald-500 dark:text-emerald-400' : colors.text,
          )}>
            {displayIcon}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
    </>
  )
}
