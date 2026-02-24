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
    <>
      <Handle type="target" position={Position.Left} />

      <div
        className={clsx(
          'turbo-gradient turbo-status',
          SCHEME_CLASS[colorScheme],
          isActive ? 'turbo-node-active' : 'turbo-gradient-idle',
        )}
      >
        <div className="turbo-inner">
          <div
            className="text-base font-semibold"
            style={{ color: isActive ? ACCENT_COLORS[colorScheme] : '#f1f5f9' }}
          >
            {label}
          </div>
          {displayIcon && (
            <div
              className="mt-1 text-sm font-bold"
              style={{
                color: status === 'error' ? '#f87171'
                  : status === 'success' ? '#34d399'
                  : ACCENT_COLORS[colorScheme],
              }}
            >
              {displayIcon}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </>
  )
}
