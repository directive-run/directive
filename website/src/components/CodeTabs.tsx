'use client'

import { Fragment, memo, useCallback, useState } from 'react'
import { Highlight } from 'prism-react-renderer'
import { Check, Copy } from '@phosphor-icons/react'

export interface CodeTab {
  filename: string
  label?: string
  code: string
  language: string
}

interface CodeTabsProps {
  tabs: CodeTab[]
}

export const CopyButton = memo(function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err instanceof Error ? err.message : 'Unknown error')
    }
  }, [code])

  return (
    <button
      onClick={handleCopy}
      className="cursor-pointer absolute right-2 top-2 z-10 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400 opacity-50 transition hover:bg-white/10 hover:text-slate-300 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      aria-label={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" weight="bold" />
          Copied
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          Copy
        </span>
      )}
    </button>
  )
})

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  const trimmed = code.trimEnd()

  return (
    <>
      <CopyButton code={trimmed} />
      <Highlight
        code={trimmed}
        language={language || 'text'}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto p-5 text-[0.875em] leading-7`}
            style={style}
          >
            <code>
              {tokens.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line
                    .filter((token) => !token.empty)
                    .map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  {'\n'}
                </Fragment>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </>
  )
})

export const CodeTabs = memo(function CodeTabs({ tabs }: CodeTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  if (tabs.length === 0) {
    return null
  }

  const activeTab = tabs[activeIndex] ?? tabs[0]
  const isSingle = tabs.length === 1

  return (
    <div className="group relative overflow-hidden rounded-xl bg-brand-code-bg shadow-lg dark:shadow-none dark:ring-1 dark:ring-slate-300/10">
      {/* Header: single title or tab bar */}
      {isSingle ? (
        <div className="border-b border-slate-700/50 px-5 pt-3 pb-2 font-mono text-xs text-slate-400">
          {activeTab.filename}
        </div>
      ) : (
        <div className="flex border-b border-slate-700/50" data-testid="code-tabs-bar">
          {tabs.map((tab, i) => {
            const isActive = i === activeIndex
            const lines = tab.code.trimEnd().split('\n').length

            return (
              <button
                key={tab.filename}
                onClick={() => setActiveIndex(i)}
                className={`cursor-pointer px-4 pt-3 pb-2 font-mono text-xs transition-colors ${
                  isActive
                    ? 'border-b-2 border-brand-primary text-slate-200'
                    : 'text-slate-500 hover:text-slate-400'
                }`}
              >
                {tab.filename}
                <span className="ml-1.5 text-slate-600">
                  ({lines})
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Code block */}
      <CodeBlock code={activeTab.code} language={activeTab.language} />
    </div>
  )
})
