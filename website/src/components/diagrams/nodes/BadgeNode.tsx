'use client'

import { type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { BadgeNodeData } from '../types'

export function BadgeNode({ data }: NodeProps) {
  const { text, active } = data as BadgeNodeData

  return (
    <div
      className={clsx(
        'turbo-badge',
        active ? 'turbo-node-active' : 'turbo-gradient-idle',
      )}
    >
      <div className="wrapper gradient">
        <div
          className="inner"
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: active ? '#f1f5f9' : '#94a3b8',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}
