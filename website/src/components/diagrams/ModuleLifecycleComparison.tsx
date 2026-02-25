'use client'

import { memo } from 'react'
import { ModuleLifecycleDiagram } from './ModuleLifecycleDiagram'
import { Fence } from '../Fence'

const ASCII_DIAGRAM = `
                         ┌───────────────────────────────────┐
                         │              Define               │
                         │          createModule()           │
                         └─────────────────┬─────────────────┘
                                           │
                                         create
                                           │
                                           ▼
                         ┌───────────────────────────────────┐
                         │               Init                │
                         │         init(facts) runs          │
                         └─────────────────┬─────────────────┘
                                           │
                                       initialize
                                           │
                                           ▼
                         ┌───────────────────────────────────┐
                         │              Start                │
                         │          system.start()           │
                         └─────────────────┬─────────────────┘
                                           │
                                        activate
                                           │
                                           ▼
                         ┌───────────────────────────────────┐
                         │             Running               │
                         │        constraints active         │
                         └─────────────────┬─────────────────┘
                                           │
                                          stop
                                           │
                                           ▼
                         ┌───────────────────────────────────┐
                         │            Stopping               │
                         │             cleanup               │
                         └─────────────────┬─────────────────┘
                                           │
                                          done
                                           │
                                           ▼
                         ┌───────────────────────────────────┐
                         │             Stopped               │
                         └───────────────────────────────────┘
`

const labelStyle = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: '8px',
}

export const ModuleLifecycleComparison = memo(function ModuleLifecycleComparison() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={labelStyle}>React Flow</div>
        <ModuleLifecycleDiagram />
      </div>
      <div>
        <div style={labelStyle}>Markdown (ASCII)</div>
        <Fence language="text">{ASCII_DIAGRAM}</Fence>
      </div>
    </div>
  )
})
