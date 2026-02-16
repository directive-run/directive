/**
 * AI Docs Chat Widget
 *
 * Floating chat button + dialog that streams responses from /api/chat via SSE.
 * Features: real-time token streaming, lightweight markdown rendering with
 * syntax-highlighted code blocks, dark mode support, conversation history.
 */
'use client'

import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { Highlight } from 'prism-react-renderer'
import { ChatCircleDots, PaperPlaneTilt, Sparkle, X } from '@phosphor-icons/react'
import clsx from 'clsx'

import { DirectiveCallout } from '@/components/DirectiveCallout'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXAMPLE_QUESTIONS = [
  'How do constraints work?',
  'What is the difference between effects and resolvers?',
  'How do I use Directive with React?',
  'Can you show me a data fetching example?',
]

function LoadingDots() {
  return (
    <div className="flex gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lightweight Markdown Renderer
// ---------------------------------------------------------------------------
// Intentionally inline rather than pulling in react-markdown + rehype-highlight.
// The chat widget only needs a small subset of markdown (code blocks, bold,
// inline code, links, lists, tables) and this keeps the client bundle ~40KB
// lighter than a full markdown pipeline.

/** Fenced code block with Prism syntax highlighting */
const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  return (
    <Highlight code={code.trimEnd()} language={language || 'typescript'} theme={{ plain: {}, styles: [] }}>
      {({ className, style, tokens, getTokenProps }) => (
        <pre
          className={clsx(className, 'my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs')}
          style={style}
        >
          <code>
            {tokens.map((line, lineIndex) => (
              <span key={lineIndex}>
                {line
                  .filter((token) => !token.empty)
                  .map((token, tokenIndex) => (
                    <span key={tokenIndex} {...getTokenProps({ token })} />
                  ))}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  )
})

/** Process inline markdown: bold, inline code, links */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Pattern matches: **bold**, *italic*, `code`, [text](url)
  const inlinePattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match

  while ((match = inlinePattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      // **bold**
      nodes.push(
        <strong key={match.index} className="font-semibold">
          {match[2]}
        </strong>,
      )
    } else if (match[3]) {
      // *italic*
      nodes.push(
        <em key={match.index}>
          {match[3]}
        </em>,
      )
    } else if (match[4]) {
      // `inline code`
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-600"
        >
          {match[4]}
        </code>,
      )
    } else if (match[5] && match[6]) {
      // [text](url) — only allow safe protocols to prevent javascript: XSS
      const href = match[6]
      const isSafe = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')
      if (isSafe) {
        nodes.push(
          <a
            key={match.index}
            href={href}
            className="text-brand-primary underline hover:text-brand-primary-600"
            target={href.startsWith('http') ? '_blank' : undefined}
            rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {match[5]}
          </a>,
        )
      } else {
        // Unsafe protocol — render as plain text
        nodes.push(match[0])
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

/** Render markdown content from assistant messages */
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const elements: React.ReactNode[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <CodeBlock key={`code-${elements.length}`} code={codeLines.join('\n')} language={lang} />,
      )
      continue
    }

    // Headings (#, ##, ###)
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h-${elements.length}`} className="mt-3 mb-1 text-xs font-bold">
          {renderInlineMarkdown(line.slice(4))}
        </h4>,
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h-${elements.length}`} className="mt-3 mb-1 text-sm font-bold">
          {renderInlineMarkdown(line.slice(3))}
        </h3>,
      )
      i++
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h-${elements.length}`} className="mt-3 mb-1 text-base font-bold">
          {renderInlineMarkdown(line.slice(2))}
        </h2>,
      )
      i++
      continue
    }

    // Unordered list item
    if (line.match(/^[-*]\s/)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*]\s/)) {
        items.push(
          <li key={`li-${items.length}`}>
            {renderInlineMarkdown(lines[i].replace(/^[-*]\s/, ''))}
          </li>,
        )
        i++
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-1 list-disc pl-4 text-sm">
          {items}
        </ul>,
      )
      continue
    }

    // Ordered list item
    if (line.match(/^\d+\.\s/)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(
          <li key={`li-${items.length}`}>
            {renderInlineMarkdown(lines[i].replace(/^\d+\.\s/, ''))}
          </li>,
        )
        i++
      }
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-1 list-decimal pl-4 text-sm">
          {items}
        </ol>,
      )
      continue
    }

    // Table (simple: | col | col |)
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const cells = lines[i]
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)
        // Skip separator rows (---|---)
        if (!cells.every((c) => /^[-:]+$/.test(c))) {
          tableRows.push(cells)
        }
        i++
      }
      if (tableRows.length > 0) {
        elements.push(
          <div key={`table-${elements.length}`} className="my-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {tableRows[0].map((cell, ci) => (
                    <th
                      key={ci}
                      className="border-b border-slate-300 px-2 py-1 text-left font-semibold dark:border-slate-600"
                    >
                      {renderInlineMarkdown(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border-b border-slate-200 px-2 py-1 dark:border-slate-700">
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
      }
      continue
    }

    // Empty line
    if (!line.trim()) {
      i++
      continue
    }

    // Paragraph
    elements.push(
      <p key={`p-${elements.length}`} className="my-1 text-sm">
        {renderInlineMarkdown(line)}
      </p>,
    )
    i++
  }

  return <div className="space-y-0.5">{elements}</div>
})

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={clsx('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={clsx(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-brand-primary' : '[background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]'
        )}
      >
        {isUser ? (
          <span className="text-sm font-medium text-white">U</span>
        ) : (
          <Sparkle weight="duotone" className="h-4 w-4 text-white" />
        )}
      </div>
      <div
        className={clsx(
          'max-w-[80%] rounded-2xl px-4 py-2',
          isUser
            ? 'bg-brand-primary text-white'
            : 'bg-slate-100 text-slate-900 dark:bg-brand-surface-raised dark:text-slate-100'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat Dialog
// ---------------------------------------------------------------------------

const ChatDialog = memo(function ChatDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null)
  const [dailyLimit, setDailyLimit] = useState(15)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Scroll to bottom when messages change, streaming updates, or dialog opens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, isOpen])

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleSend = useCallback(
    async (messageText?: string) => {
      const text = (messageText ?? input).trim()
      if (!text || isLoading || dailyRemaining === 0) return

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])
      setInput('')
      setIsLoading(true)
      setStreamingContent('')
      setError(null)

      // Build history for context
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const controller = new AbortController()
      abortControllerRef.current = controller
      let accumulated = ''

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history,
            pageUrl: typeof window !== 'undefined' ? window.location.pathname : undefined,
          }),
          signal: controller.signal,
        })

        // Read daily usage headers (available on both success and 429 responses)
        const remainingHeader = response.headers.get('X-Daily-Remaining')
        const limitHeader = response.headers.get('X-Daily-Limit')
        if (remainingHeader !== null) {
          setDailyRemaining(parseInt(remainingHeader, 10))
        }
        if (limitHeader !== null) {
          setDailyLimit(parseInt(limitHeader, 10))
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: 'Request failed' }))
          throw new Error(errData.error || `Request failed (${response.status})`)
        }

        // Read SSE stream
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const event = JSON.parse(data)

              if (event.type === 'text') {
                accumulated += event.text
                setStreamingContent(accumulated)
              } else if (event.type === 'done') {
                // Finalize the message
                const assistantMessage: Message = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: accumulated,
                  timestamp: new Date(),
                }
                setMessages((prev) => [...prev, assistantMessage])
                setStreamingContent('')
                accumulated = '' // Prevent duplicate finalization
              } else if (event.type === 'truncated') {
                accumulated += event.text
                setStreamingContent(accumulated)
              } else if (event.type === 'heartbeat') {
                // Keep-alive signal, no action needed
              } else if (event.type === 'error') {
                throw new Error(event.message || 'Stream error')
              }
            } catch (parseErr) {
              // Re-throw stream errors (from the 'error' event handler above);
              // silently skip JSON.parse failures from malformed SSE frames.
              if (parseErr instanceof SyntaxError) continue
              throw parseErr
            }
          }
        }

        // Fallback: if the stream closed without a 'done' event (e.g. server crash),
        // save whatever we received. Safe from duplicates because the 'done' handler
        // above clears `accumulated` after finalizing.
        if (accumulated) {
          const assistantMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: accumulated,
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, assistantMessage])
          setStreamingContent('')
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return // User cancelled
        const errorMessage =
          err instanceof Error ? err.message : 'Something went wrong. Try the search feature instead.'
        setError(errorMessage)

        // If we have partial content, save it
        if (accumulated) {
          const partialMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: accumulated + '\n\n*[Connection interrupted]*',
            timestamp: new Date(),
          }
          setMessages((prev) => [...prev, partialMessage])
          setStreamingContent('')
        }
      } finally {
        setIsLoading(false)
        abortControllerRef.current = null
      }
    },
    [input, isLoading, messages, dailyRemaining],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleExampleClick = (question: string) => {
    handleSend(question)
  }

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-end justify-end p-6">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            enterTo="opacity-100 translate-y-0 sm:scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
          >
            <DialogPanel className="flex h-[600px] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-brand-surface-raised">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
                    <Sparkle weight="duotone" className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Directive AI
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Powered by Directive AI
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4">
                {messages.length === 0 && !streamingContent ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
                      <Sparkle weight="duotone" className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                      Ask anything about Directive
                    </h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      I can help you understand concepts, write code, and debug issues.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {EXAMPLE_QUESTIONS.map((question) => (
                        <button
                          key={question}
                          onClick={() => handleExampleClick(question)}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand-primary-300 hover:bg-brand-primary-50 hover:text-brand-primary-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-brand-primary dark:hover:bg-brand-primary-900/20 dark:hover:text-brand-primary-400"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}

                    {/* Streaming content (not yet finalized) */}
                    {streamingContent && (
                      <div className="flex gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
                          <Sparkle weight="duotone" className="h-4 w-4 text-white" />
                        </div>
                        <div className="max-w-[80%] rounded-2xl bg-slate-100 px-4 py-2 text-slate-900 dark:bg-brand-surface-raised dark:text-slate-100">
                          <MarkdownContent content={streamingContent} />
                        </div>
                      </div>
                    )}

                    {/* Loading dots (before stream starts) */}
                    {isLoading && !streamingContent && (
                      <div className="flex gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
                          <Sparkle weight="duotone" className="h-4 w-4 text-white" />
                        </div>
                        <div className="flex items-center rounded-2xl bg-slate-100 px-4 py-3 dark:bg-brand-surface-raised">
                          <LoadingDots />
                        </div>
                      </div>
                    )}

                    {/* Error message */}
                    {error && (
                      <div className="mx-auto max-w-[90%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-slate-200 p-4 dark:border-slate-700">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={dailyRemaining === 0 ? 'Daily limit reached' : 'Ask about Directive...'}
                    disabled={dailyRemaining === 0}
                    className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-brand-surface-raised dark:text-white dark:placeholder-slate-400"
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isLoading || dailyRemaining === 0}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary text-white transition hover:bg-brand-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PaperPlaneTilt weight="fill" className="h-5 w-5" />
                  </button>
                </div>
                <p className="mt-2 text-center text-xs text-slate-400">
                  AI responses are generated and may not always be accurate.
                </p>
                {dailyRemaining !== null && (
                  <p
                    className={clsx(
                      'mt-1 text-center text-xs',
                      dailyRemaining <= 5
                        ? 'font-medium text-amber-500 dark:text-amber-400'
                        : 'text-slate-400',
                    )}
                  >
                    {dailyRemaining} of {dailyLimit} questions remaining today
                  </p>
                )}

                <div className="mt-3">
                  <DirectiveCallout
                    subject="chat"
                    href="/blog/building-ai-docs-chatbot"
                    compact
                  />
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  )
})

// ---------------------------------------------------------------------------
// Widget Entry Point
// ---------------------------------------------------------------------------

export const AIChatWidget = memo(function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))] text-white shadow-lg transition hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2"
        aria-label="Open AI Chat"
      >
        <ChatCircleDots weight="duotone" className="h-6 w-6" />
      </button>

      {/* Chat dialog */}
      <ChatDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
})
