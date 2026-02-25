'use client'

import { type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { LayerNodeData } from '../types'

export function LayerNode({ data }: NodeProps) {
  const { label, active, width, height } = data as LayerNodeData

  return (
    <div
      className={clsx(
        'turbo-layer',
        active && 'turbo-layer-active',
      )}
      style={{
        width,
        height,
        borderColor: active ? 'var(--accent)' : undefined,
      }}
    >
      <div
        className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: active ? 'var(--accent)' : '#94a3b8' }}
      >
        {label}
      </div>
    </div>
  )
}
