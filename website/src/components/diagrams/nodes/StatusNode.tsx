'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import clsx from 'clsx'
import type { StatusNodeData } from '../types'
import { SCHEME_CLASS, ACCENT_COLORS } from '../theme'

const STATUS_ICONS: Record<string, string> = {
  idle: '',
  active: '',
  past: '',
  success: '\u2714',
  error: '\u2715',
}

export function StatusNode({ data }: NodeProps) {
  const { label, status, icon, colorScheme } = data as StatusNodeData
  const displayIcon = icon ?? STATUS_ICONS[status] ?? ''
  const isActive = status === 'active'

  return (
    <div
      className={clsx(
        'turbo-status',
        SCHEME_CLASS[colorScheme],
        isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
      )}
    >
      <div className="wrapper gradient">
        <div className="inner">
          <div
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: isActive ? ACCENT_COLORS[colorScheme] : '#f1f5f9',
            }}
          >
            {label}
          </div>
          {displayIcon && (
            <div
              style={{
                marginTop: '4px',
                fontSize: '14px',
                fontWeight: 700,
                color: status === 'error' ? '#f87171'
                  : status === 'success' ? '#34d399'
                  : ACCENT_COLORS[colorScheme],
              }}
            >
              {displayIcon}
            </div>
          )}
          <Handle type="target" position={Position.Left} />
          <Handle type="source" position={Position.Right} />
        </div>
      </div>
    </div>
  )
}
