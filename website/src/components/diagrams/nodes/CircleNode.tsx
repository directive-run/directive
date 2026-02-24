'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { CircleNodeData } from '../types'
import { SCHEME_CLASS, ACCENT_COLORS } from '../theme'

export function CircleNode({ data }: NodeProps) {
  const { label, sublabel, status, colorScheme } = data as CircleNodeData
  const isActive = status === 'active'

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <Handle id="top" type="target" position={Position.Top} />

      <div
        className={clsx(
          'turbo-gradient turbo-circle',
          SCHEME_CLASS[colorScheme],
          isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
        )}
      >
        <div className="turbo-inner">
          <div className="text-[10px] font-medium leading-tight" style={{ color: '#f1f5f9' }}>
            {label}
          </div>
          {sublabel && (
            <div className="text-[10px] leading-tight" style={{ color: '#94a3b8' }}>
              {sublabel}
            </div>
          )}
          <div className="text-xs" style={{ color: ACCENT_COLORS[colorScheme] }}>
            {'\u25CF'}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
    </>
  )
}
