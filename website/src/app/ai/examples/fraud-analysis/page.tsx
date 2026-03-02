'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { ProviderConfig, type ProviderConfigState } from '@/components/ProviderConfig'
import { decodeReplay } from '@/components/devtools/utils/replay-codec'
import type { DebugEvent } from '@/components/devtools/types'

const EXAMPLE_PROMPTS = [
  'Investigate the account takeover case',
  'Review the deposit name mismatch',
  'Analyze the cash in / cash out pattern',
]

export default function FraudAnalysisPage() {
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
      streamUrl="/api/fraud-review-devtools/stream"
      snapshotUrl="/api/fraud-review-devtools/snapshot"
      replayData={replayData}
      runtimeSystemName={null}
      label="Fraud Analysis"
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Fraud Review Board
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Supervisor delegates to 3 specialist analysts — transaction patterns, geographic risk, identity/PII.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/fraud-review-chat"
            title="Fraud Review Board"
            subtitle="Supervisor + 3 specialist analysts"
            placeholder="Describe a fraud case to investigate..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Select a fraud scenario to see multi-agent supervisor execution in action"
            emptySubtitle="Watch the senior investigator delegate to transaction, geographic, and identity analysts."
            pageUrl="/ai/examples/fraud-analysis"
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
