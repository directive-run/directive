'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PaperPlaneTilt, Sparkle } from '@phosphor-icons/react'
import { MarkdownContent } from '@/components/ChatMarkdown'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'
import { decodeReplay } from '@/components/devtools/utils/replay-codec'
import type { DebugEvent } from '@/components/devtools/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatState {
  messages: Message[]
  streamingContent: string
  isLoading: boolean
  error: string | null
  input: string
}

// ---------------------------------------------------------------------------
// External chat store (separate from /devtools page store)
// ---------------------------------------------------------------------------

let _state: ChatState = {
  messages: [],
  streamingContent: '',
  isLoading: false,
  error: null,
  input: '',
}

const _listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  _listeners.add(listener)

  return () => {
    _listeners.delete(listener)
  }
}

function getSnapshot(): ChatState {
  return _state
}

function setState(patch: Partial<ChatState>) {
  _state = { ..._state, ...patch }
  for (const l of _listeners) l()
}

let _gen = 0
let _abortController: AbortController | null = null

// ---------------------------------------------------------------------------
// Example prompts (research-themed)
// ---------------------------------------------------------------------------

const EXAMPLE_PROMPTS = [
  'Research the impact of AI on healthcare',
  'What are the latest trends in renewable energy?',
  'Investigate quantum computing breakthroughs',
]

// ---------------------------------------------------------------------------
// handleSend — sends to /api/dag-chat
// ---------------------------------------------------------------------------

async function handleSend(messageText?: string) {
  const text = (messageText ?? _state.input).trim()
  if (!text || _state.isLoading) {
    return
  }

  const myGen = ++_gen

  _abortController?.abort()
  const controller = new AbortController()
  _abortController = controller

  const userMessage: Message = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: text,
  }

  setState({
    messages: [..._state.messages, userMessage],
    input: '',
    isLoading: true,
    streamingContent: '',
    error: null,
  })

  let accumulated = ''

  try {
    const response = await fetch('/api/dag-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    })

    if (myGen !== _gen) {
      return
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(errData.error || `Request failed (${response.status})`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (myGen !== _gen) {
        reader.cancel()

        return
      }

      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue
        }

        const data = line.slice(6).trim()
        if (!data) {
          continue
        }

        try {
          const event = JSON.parse(data)
          if (event.type === 'text') {
            accumulated += event.text
            setState({ streamingContent: accumulated })
          } else if (event.type === 'done') {
            setState({
              messages: [
                ..._state.messages,
                { id: `assistant-${Date.now()}`, role: 'assistant', content: accumulated },
              ],
              streamingContent: '',
            })
            accumulated = ''
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Pipeline error')
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) {
            continue
          }

          throw parseErr
        }
      }
    }

    // Flush remaining if stream ended without 'done'
    if (accumulated && myGen === _gen) {
      setState({
        messages: [
          ..._state.messages,
          { id: `assistant-${Date.now()}`, role: 'assistant', content: accumulated },
        ],
        streamingContent: '',
      })
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return
    }

    if (myGen !== _gen) {
      return
    }

    const errorMessage =
      err instanceof Error ? err.message : 'Something went wrong.'

    if (accumulated) {
      setState({
        messages: [
          ..._state.messages,
          { id: `assistant-${Date.now()}`, role: 'assistant', content: accumulated + '\n\n*[Connection interrupted]*' },
        ],
        streamingContent: '',
        error: errorMessage,
      })
    } else {
      setState({ error: errorMessage })
    }
  } finally {
    if (myGen === _gen) {
      setState({ isLoading: false })
    }
  }
}

// ---------------------------------------------------------------------------
// Inline Chat Panel
// ---------------------------------------------------------------------------

function InlineChat() {
  const { messages, streamingContent, isLoading, error, input } =
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, streamingContent])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex h-7 w-7 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
          <Sparkle weight="duotone" className="h-3.5 w-3.5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Research Pipeline</h3>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">6-agent DAG orchestration</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
              <Sparkle weight="duotone" className="h-6 w-6 text-white" />
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white">
              Send a research topic to see multi-agent DAG in action
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Watch 6 agents execute in parallel with dependency edges.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLE_PROMPTS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-sky-500 dark:hover:bg-sky-900/20 dark:hover:text-sky-400"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-sky-500 text-white'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  <MarkdownContent content={streamingContent} />
                </div>
              </div>
            )}

            {isLoading && !streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mx-auto max-w-[90%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setState({ input: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Enter a research topic..."
            aria-label="Enter a research topic"
            className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-400"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 disabled:opacity-50"
          >
            <PaperPlaneTilt weight="fill" className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DevTools2Page() {
  // Phase 4: Decode replay data from URL hash fragment (avoids 431 header-too-large)
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
        {/* Header */}
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            DevTools — Multi-Agent DAG Pipeline
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            6 agents in a research pipeline — news, academic, sentiment, fact-checker, synthesizer, reviewer.
            Open DevTools with the button in the bottom-left corner.
          </p>
        </div>

        {/* Chat — full-width, DevTools accessible via FAB drawer */}
        <div className="mt-6 min-h-0 flex-1">
          <InlineChat />
        </div>
      </div>
    </DevToolsWithProvider>
  )
}
