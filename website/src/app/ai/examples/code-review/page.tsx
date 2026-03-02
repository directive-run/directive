'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { ProviderConfig, type ProviderConfigState } from '@/components/ProviderConfig'
import { decodeReplay } from '@/components/devtools/utils/replay-codec'
import type { DebugEvent } from '@/components/devtools/types'

const EXAMPLE_PROMPTS = [
  'Review this login handler for security issues',
  'Check this React component for code quality',
  'Audit this API endpoint for vulnerabilities',
]

export default function CodeReviewPage() {
  const [replayData, setReplayData] = useState<DebugEvent[] | undefined>(undefined)
  const [config, setConfig] = useState<ProviderConfigState>({ provider: 'anthropic', apiKey: '' })

  useEffect(() => {
    const hash = window.location.hash
    const prefix = '#replay='
    if (!hash.startsWith(prefix)) {
      return
    }

    try {
      setReplayData(decodeReplay(hash.slice(prefix.length)))
    } catch {
      console.warn('[DevTools] Failed to decode replay URL')
    }
  }, [])

  const handleConfigChange = useCallback((next: ProviderConfigState) => {
    setConfig(next)
  }, [])

  const headers = useMemo(() => {
    if (!config.apiKey) {
      return undefined
    }

    return { 'x-api-key': config.apiKey, 'x-provider': config.provider }
  }, [config.apiKey, config.provider])

  return (
    <DevToolsWithProvider
      streamUrl="/api/code-review-devtools/stream"
      snapshotUrl="/api/code-review-devtools/snapshot"
      replayData={replayData}
      runtimeSystemName={null}
      label="Code Review"
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Code Review Board
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Supervisor delegates to 2 agents + 3 tasks — security analysis, style review, lint check, dependency audit, merge decision.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/code-review-chat"
            title="Code Review Board"
            subtitle="Supervisor + 2 agents + 3 tasks"
            placeholder="Paste code or describe what to review..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Submit code to see the review board in action"
            emptySubtitle="Watch the supervisor delegate to LLM reviewers and imperative tasks in real time."
            pageUrl="/ai/examples/code-review"
            headers={headers}
          />
        </div>

        <div className="mt-3 shrink-0">
          <ProviderConfig onChange={handleConfigChange} />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
