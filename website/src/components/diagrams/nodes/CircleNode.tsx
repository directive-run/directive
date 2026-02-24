'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { CircleNodeData } from '../types'
import { SCHEME_CLASS, ACCENT_COLORS } from '../theme'

export function CircleNode({ data }: NodeProps) {
  const { label, sublabel, status, colorScheme } = data as CircleNodeData
  const isActive = status === 'active'

  return (
    <div
      className={clsx(
        'turbo-circle',
        SCHEME_CLASS[colorScheme],
        isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
      )}
    >
      <div className="wrapper gradient">
        <div className="inner">
          <div style={{ fontSize: '10px', fontWeight: 500, lineHeight: 1.2, color: '#f1f5f9' }}>
            {label}
          </div>
          {sublabel && (
            <div style={{ fontSize: '10px', lineHeight: 1.2, color: '#94a3b8' }}>
              {sublabel}
            </div>
          )}
          <div style={{ fontSize: '12px', color: ACCENT_COLORS[colorScheme] }}>
            {'\u25CF'}
          </div>
          <Handle type="target" position={Position.Left} />
          <Handle id="top" type="target" position={Position.Top} />
          <Handle type="source" position={Position.Right} />
          <Handle id="bottom" type="source" position={Position.Bottom} />
        </div>
      </div>
    </div>
  )
}
