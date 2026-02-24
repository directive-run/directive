'use client'

import { type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { LayerNodeData } from '../types'
import { LAYER_COLORS } from '../theme'

export function LayerNode({ data }: NodeProps) {
  const { label, active, colorScheme, width, height } = data as LayerNodeData
  const colors = LAYER_COLORS[colorScheme]

  return (
    <div
      className={clsx(
        'rounded-xl border-[1.5px] transition-all duration-300',
        active ? colors.bgActive : colors.bg,
        active ? colors.borderActive : colors.border,
      )}
      style={{ width, height }}
    >
      <div className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
    </div>
  )
}
