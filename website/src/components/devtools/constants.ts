// ---------------------------------------------------------------------------
// Shared constants for LiveDevTools
// ---------------------------------------------------------------------------

export const MAX_EVENTS = 2000
export const RECONNECT_DELAY = 3000

// M1: Max reconnect attempts before showing manual retry
export const MAX_RECONNECT_RETRIES = 10

// SSE flush interval (ms) — batches incoming events before setState
export const FLUSH_INTERVAL_MS = 100

// Timeline zoom bounds
export const ZOOM_MIN = 1
export const ZOOM_MAX = 20
// Per-wheel-tick zoom factor (applied as deltaY * ZOOM_STEP * 0.01)
export const ZOOM_STEP = 0.15

// Snapshot polling interval (ms) — shared by all polling views
export const SNAPSHOT_POLL_INTERVAL = 3000

export const EVENT_COLORS: Record<string, string> = {
  agent_start: 'bg-sky-500',
  agent_complete: 'bg-emerald-500',
  agent_error: 'bg-red-500',
  agent_retry: 'bg-red-400',
  guardrail_check: 'bg-amber-500',
  constraint_evaluate: 'bg-violet-500',
  resolver_start: 'bg-indigo-500',
  resolver_complete: 'bg-indigo-500',
  resolver_error: 'bg-red-500',
  reroute: 'bg-orange-500',
  pattern_start: 'bg-teal-500',
  pattern_complete: 'bg-teal-400',
  dag_node_update: 'bg-cyan-500',
  breakpoint_hit: 'bg-rose-500',
  breakpoint_resumed: 'bg-emerald-400',
  derivation_update: 'bg-purple-500',
  scratchpad_update: 'bg-fuchsia-500',
}

export const EVENT_LABELS: Record<string, string> = {
  agent_start: 'Agent Start',
  agent_complete: 'Agent Complete',
  agent_error: 'Agent Error',
  agent_retry: 'Agent Retry',
  guardrail_check: 'Guardrail',
  constraint_evaluate: 'Constraint',
  resolver_start: 'Resolver Start',
  resolver_complete: 'Resolver Done',
  resolver_error: 'Resolver Error',
  reroute: 'Reroute',
  pattern_start: 'Pattern Start',
  pattern_complete: 'Pattern Done',
  dag_node_update: 'DAG Update',
  breakpoint_hit: 'Breakpoint',
  breakpoint_resumed: 'Resumed',
  derivation_update: 'Derivation',
  scratchpad_update: 'Scratchpad',
}

export const VIEWS = ['Timeline', 'Cost', 'State', 'Guardrails', 'Events', 'Health', 'Flamechart', 'Graph', 'Goal', 'Memory', 'Budget', 'Config'] as const

// Known model pricing defaults (per 1M tokens)
export const DEFAULT_MODEL_PRICING: Record<string, { input: number; output: number; label: string }> = {
  'claude-haiku-4-5': { input: 0.80, output: 4.00, label: 'Haiku 4.5' },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, label: 'Haiku 4.5' },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00, label: 'Sonnet 4.5' },
  'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00, label: 'Sonnet 4.5' },
  'claude-opus-4': { input: 15.00, output: 75.00, label: 'Opus 4' },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00, label: 'Opus 4' },
  'gpt-4o': { input: 2.50, output: 10.00, label: 'GPT-4o' },
  'gpt-4o-mini': { input: 0.15, output: 0.60, label: 'GPT-4o Mini' },
}

export const FLAMECHART_COLORS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500',
  'bg-indigo-500', 'bg-rose-500', 'bg-teal-500', 'bg-orange-500',
]

export const GUARDRAIL_INFO: Record<string, { description: string; type: 'input' | 'output'; icon: string }> = {
  'rate-limit': {
    description: 'Limits requests per minute to prevent abuse and control costs.',
    type: 'input',
    icon: '⏱',
  },
  'prompt-injection': {
    description: 'Detects prompt injection attempts that try to override system instructions.',
    type: 'input',
    icon: '🛡',
  },
  'pii-detection': {
    description: 'Scans for personally identifiable information and redacts it before processing.',
    type: 'input',
    icon: '🔒',
  },
  'length': {
    description: 'Ensures responses stay within the configured character limit.',
    type: 'output',
    icon: '📏',
  },
}

// Shared utility: get pricing for a model (exact match or fuzzy)
export function getDefaultPricing(modelId: string | null): { input: number; output: number } {
  if (!modelId) {
    return { input: 0.80, output: 4.00 }
  }

  const exact = DEFAULT_MODEL_PRICING[modelId]
  if (exact) {
    return { input: exact.input, output: exact.output }
  }

  // Fuzzy match: check if modelId contains a known key
  for (const [key, val] of Object.entries(DEFAULT_MODEL_PRICING)) {
    if (modelId.includes(key) || key.includes(modelId)) {
      return { input: val.input, output: val.output }
    }
  }

  return { input: 0.80, output: 4.00 }
}

// Shared cost formatter
export function formatCost(cost: number): string {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}
