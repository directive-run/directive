'use client'

import { type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { BadgeNodeData, ColorScheme } from '../types'
import { SCHEME_CLASS } from '../theme'

export function BadgeNode({ data }: NodeProps) {
  const { text, active, colorScheme } = data as BadgeNodeData & { colorScheme?: ColorScheme }
  const scheme = colorScheme ?? 'primary'

  return (
    <div
      className={clsx(
        'turbo-gradient turbo-badge',
        SCHEME_CLASS[scheme],
        active ? 'turbo-node-active' : 'turbo-gradient-idle',
      )}
    >
      <div
        className="turbo-inner text-sm font-medium"
        style={{ color: active ? '#f1f5f9' : '#94a3b8' }}
      >
        {text}
      </div>
    </div>
  )
}
