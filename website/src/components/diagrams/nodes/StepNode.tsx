'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { StepNodeData } from '../types'
import { SCHEME_CLASS, ACCENT_COLORS } from '../theme'

export function StepNode({ data }: NodeProps) {
  const { label, subtitle, icon, status, colorScheme } = data as StepNodeData
  const isActive = status === 'active'
  const accent = ACCENT_COLORS[colorScheme]

  return (
    <div
      className={clsx(
        'turbo-step',
        SCHEME_CLASS[colorScheme],
        isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
      )}
    >
      <div className="cloud gradient">
        <div>{icon}</div>
      </div>
      <div className="wrapper gradient">
        <div className="inner">
          <div className="body">
            <div>
              <div
                className="title"
                style={{ color: isActive ? accent : '#f1f5f9' }}
              >
                {label}
              </div>
              {subtitle && (
                <div className="subtitle">{subtitle}</div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Default handles */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      {/* Reverse-direction handles for bidirectional layouts */}
      <Handle type="source" position={Position.Left} id="left-source" />
      <Handle type="target" position={Position.Right} id="right-target" />
      <Handle type="source" position={Position.Top} id="top-source" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" />

    </div>
  )
}
