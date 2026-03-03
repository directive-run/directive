'use client'

import { useCallback, useMemo, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { ProviderConfig, type ProviderConfigState } from '@/components/ProviderConfig'

const EXAMPLE_PROMPTS = [
  'Process this document through the full pipeline',
  'Checkpoint after extraction and resume later',
  'What happens when a stage fails mid-pipeline?',
]

export default function CheckpointPage() {
  const [config, setConfig] = useState<ProviderConfigState>({ provider: 'anthropic', apiKey: '' })

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
    <DevToolsWithProvider mode="ai" label="Checkpoint">
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Pipeline Checkpoint
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            4-stage document pipeline with checkpoint save/restore, retry with exponential backoff, and failure injection.
            Open DevTools to watch pipeline stages execute.
          </p>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/chat"
            title="Pipeline Checkpoint"
            subtitle="Extract, summarize, classify, archive"
            placeholder="Describe a document to process..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Test pipeline checkpointing"
            emptySubtitle="Watch a 4-stage pipeline with checkpoint save/restore, retry backoff, and failure recovery in the DevTools."
            pageUrl="/ai/examples/checkpoint"
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
