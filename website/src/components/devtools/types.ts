// ---------------------------------------------------------------------------
// Shared types for LiveDevTools
// ---------------------------------------------------------------------------

export interface DebugEvent {
  id: number
  type: string
  timestamp: number
  agentId?: string
  snapshotId: number | null
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  guardrailName?: string
  guardrailType?: string
  passed?: boolean
  reason?: string
  inputLength?: number
  outputLength?: number
  modelId?: string
  [key: string]: unknown
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'waiting'

// Breakpoint definition for pause-on-event
export interface BreakpointDef {
  id: string
  label: string
  eventType: string
  enabled: boolean
}

// Fact mutation breakpoints — pause on fact change
export interface FactBreakpointDef {
  id: string
  factKey: string
  condition: string        // JS expression: "newValue > 10" — empty = watch only
  enabled: boolean
  createdAt: number
}

export interface FactBreakpointHit {
  id: string
  breakpointId: string
  factKey: string
  oldValue: unknown
  newValue: unknown
  timestamp: number
  conditionMet: boolean
}

// System event breakpoints — pause on dispatch
export interface EventBreakpointDef {
  id: string
  eventType: string        // e.g. "increment", "setLabel", "*" for all
  condition: string        // JS expression on event data — empty = always
  enabled: boolean
  createdAt: number
}

export interface EventBreakpointHit {
  id: string
  breakpointId: string
  eventType: string
  eventData: unknown
  timestamp: number
  conditionMet: boolean
}

// Typed snapshot response — cast once at fetch boundary
export interface SnapshotResponse {
  timestamp: number
  eventCount: number
  totalTokens: number
  orchestrator: {
    status: string
    currentAgent: string | null
    totalRuns: number
    totalTurns: number
    avgDurationMs: number
    agentRunCounts: Record<string, number>
  }
  guardrails: {
    totalChecks: number
    blocked: number
    passRate: string
  }
  chatbot: {
    totalRequests: number
    totalTokensUsed: number
    consecutiveErrors: number
    isHealthy: boolean
    activeIPs: number
  }
  memory: {
    totalMessages: number
    contextMessages: number
    summaries: number
    messages: Array<{
      role: string
      contentLength: number
      preview: string
    }>
  }
  config: {
    model: string
    maxTokenBudget: number
    maxResponseChars: number
    maxHistoryMessages: number
    preserveRecentCount: number
    memoryStrategy: string
    retry: {
      maxRetries: number
      baseDelayMs: number
      maxDelayMs: number
    }
    circuitBreaker: {
      failureThreshold: number
      recoveryTimeMs: number
    }
    budgets: Array<{ window: string; maxCost: number }>
    guardrails: {
      input: string[]
      output: string[]
    }
    fallbackModel: string | null
  }
}
