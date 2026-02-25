'use client'

import { useEffect, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { decodeReplay } from '@/components/devtools/utils/replay-codec'
import type { DebugEvent } from '@/components/devtools/types'

const EXAMPLE_PROMPTS = [
  'Research the impact of AI on healthcare',
  'What are the latest trends in renewable energy?',
  'Investigate quantum computing breakthroughs',
]

export default function AIResearchPipelinePage() {
  const [replayData, setReplayData] = useState<DebugEvent[] | undefined>(undefined)

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

  return (
    <DevToolsWithProvider
      streamUrl="/api/dag-devtools/stream"
      snapshotUrl="/api/dag-devtools/snapshot"
      replayData={replayData}
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Research Pipeline
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            6 agents in a research pipeline — news, academic, sentiment, fact-checker, synthesizer, reviewer.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        <div className="mt-6 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/dag-chat"
            title="Research Pipeline"
            subtitle="6-agent DAG orchestration"
            placeholder="Enter a research topic..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Send a research topic to see multi-agent DAG in action"
            emptySubtitle="Watch 6 agents execute in parallel with dependency edges."
            pageUrl="/ai/examples/ai-research-pipeline"
          />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
