'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { CircleNodeData } from '../types'
import { getNodeColors } from '../theme'

export function CircleNode({ data }: NodeProps) {
  const { label, sublabel, status, colorScheme } = data as CircleNodeData
  const colors = getNodeColors(colorScheme, status)
  const isActive = status === 'active'

  const DOT_COLORS: Record<string, string> = {
    emerald: 'text-emerald-500 dark:text-emerald-400',
    red: 'text-red-500 dark:text-red-400',
    amber: 'text-amber-500 dark:text-amber-400',
    primary: 'text-sky-500 dark:text-sky-400',
    violet: 'text-violet-500 dark:text-violet-400',
    slate: 'text-slate-500 dark:text-slate-400',
  }

  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
      <Handle id="top" type="target" position={Position.Top} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />

      <div
        className={clsx(
          'flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 shadow-sm transition-all duration-300',
          colors.bg,
          colors.border,
          isActive && 'shadow-md',
        )}
      >
        <div className={clsx('text-[10px] font-medium leading-tight', colors.text)}>{label}</div>
        {sublabel && (
          <div className={clsx('text-[10px] leading-tight', colors.text)}>{sublabel}</div>
        )}
        <div className={clsx('text-xs', DOT_COLORS[colorScheme] ?? DOT_COLORS.slate)}>
          {'\u25CF'}
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="!h-2 !w-2 !border-none !bg-slate-400 dark:!bg-slate-500" />
    </>
  )
}
