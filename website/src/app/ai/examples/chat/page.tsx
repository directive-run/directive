'use client'

import { useCallback, useMemo, useState } from 'react'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'
import { ProviderConfig, type ProviderConfigState } from '@/components/ProviderConfig'
import { useChatSystem } from './useChatSystem'

const EXAMPLE_PROMPTS = [
  "Tell me about Directive's constraint system",
  'What happens if I send personal data?',
  'Compare resolvers and effects',
]

export default function AIChatPage() {
  // Create a Directive system that tracks chat metrics.
  // Registers on window.__DIRECTIVE__ so DevToolsProvider auto-detects it,
  // enabling System tabs (Facts, Derivations, Pipeline) alongside AI tabs.
  useChatSystem('/api/chat')

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
    <DevToolsWithProvider mode="ai">
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            AI Chat
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Send a message below and watch the agent lifecycle in real time.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        <div className="mt-4 shrink-0">
          <ProviderConfig onChange={handleConfigChange} />
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/chat"
            title="Directive AI"
            subtitle="Ask about Directive"
            placeholder="Ask about Directive..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Send a message to see DevTools in action"
            emptySubtitle="Watch guardrails, agent lifecycle, and token usage stream live."
            pageUrl="/ai/examples/chat"
            headers={headers}
          />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
