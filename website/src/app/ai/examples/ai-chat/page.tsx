'use client'

import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { InlineChat } from '@/components/InlineChat'

const EXAMPLE_PROMPTS = [
  "Tell me about Directive's constraint system",
  'What happens if I send personal data?',
  'Compare resolvers and effects',
]

export default function AIChatPage() {
  return (
    <DevToolsWithProvider>
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

        <div className="mt-6 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/chat"
            title="Directive AI"
            subtitle="Ask about Directive"
            placeholder="Ask about Directive..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Send a message to see DevTools in action"
            emptySubtitle="Watch guardrails, agent lifecycle, and token usage stream live."
            pageUrl="/ai/examples/ai-chat"
          />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
