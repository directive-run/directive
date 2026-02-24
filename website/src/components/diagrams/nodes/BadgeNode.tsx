'use client'

import { type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { BadgeNodeData } from '../types'

export function BadgeNode({ data }: NodeProps) {
  const { text, active } = data as BadgeNodeData

  return (
    <div
      className={clsx(
        'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-300',
        active
          ? 'border-sky-400 bg-sky-100 text-sky-700 dark:border-sky-600 dark:bg-sky-900 dark:text-sky-300'
          : 'border-slate-300 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500',
      )}
    >
      {text}
    </div>
  )
}
