'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { ProviderConfig, type ProviderConfigState } from '@/components/ProviderConfig'
import { decodeReplay } from '@/components/devtools/utils/replay-codec'
import type { DebugEvent } from '@/components/devtools/types'

const EXAMPLE_PROMPTS = [
  'An AI-powered personal stylist app',
  'A marketplace for local farm-to-table produce',
  'A SaaS tool that automates legal contract review',
]

export default function PitchDeckPage() {
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
      streamUrl="/api/pitch-deck-devtools/stream"
      snapshotUrl="/api/pitch-deck-devtools/snapshot"
      replayData={replayData}
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Startup Pitch Deck
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            4 agents in a goal execution pattern — market analyst, financial modeler, storyteller, scorer.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        <div className="mt-4 shrink-0">
          <ProviderConfig onChange={handleConfigChange} />
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/pitch-deck-chat"
            title="Pitch Deck Analyzer"
            subtitle="4-agent goal orchestration"
            placeholder="Describe your startup idea..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Describe a startup idea to see multi-agent goal execution in action"
            emptySubtitle="Watch 4 agents evaluate your idea with dependency-driven execution."
            pageUrl="/ai/examples/pitch-deck"
            headers={headers}
          />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
